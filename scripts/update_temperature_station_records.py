#!/usr/bin/env python3
"""Cache JMA per-station temperature records used by the nationwide ranking."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from update_temperature_distribution_extremes import fetch_text, parse_tables


JST = ZoneInfo("Asia/Tokyo")
OUT_DIR = Path("outputs/weather/temperature_distribution_tool")
STATION_INVENTORY = Path("data/weather/japan_all_stations/station_inventory_current_temperature.csv")
BASE_URL = "https://www.data.jma.go.jp/stats/etrn/view/rank_{kind}.php"
ELEMENT_LABELS = {
    "max": "日最高気温の高い方から",
    "min": "日最低気温の低い方から",
}


def write_text_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def load_inventory(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [
            row
            for row in csv.DictReader(handle)
            if str(row.get("is_current", "")).lower() == "true"
            and str(row.get("has_temperature", "")).lower() == "true"
            and str(row.get("kind", "")) in {"a", "s"}
        ]


def record_page_url(station: dict[str, str], month: int | None) -> str:
    return (
        f"{BASE_URL.format(kind=station['kind'])}"
        f"?prec_no={station['prec_no']}&block_no={station['block_no']}"
        f"&year=&month={month or ''}&day=&view="
    )


def parse_value_and_date(value: str) -> list[object] | None:
    value_match = re.search(r"[+-]?\d+(?:\.\d+)?", value or "")
    date_match = re.search(r"(\d{4})/(\d{1,2})/(\d{1,2})", value or "")
    if not value_match or not date_match:
        return None
    date_value = f"{int(date_match.group(1)):04d}-{int(date_match.group(2)):02d}-{int(date_match.group(3)):02d}"
    return [round(float(value_match.group(0)), 1), date_value]


def parse_statistics_period(value: str) -> tuple[str, str]:
    compact = re.sub(r"[^\d/]+", "", value or "")
    matches = re.findall(
        r"(\d{4})/(1[0-2]|0?[1-9])(?=\d{4}/|$)",
        compact,
    )
    if not matches:
        year_matches = re.findall(r"\d{4}", value or "")
        if not year_matches:
            return "", ""
        return year_matches[0], year_matches[-1]
    labels = [f"{int(year):04d}-{int(month):02d}" for year, month in matches]
    return labels[0], labels[-1]


def parse_record_page(text: str) -> dict[str, dict[str, object]]:
    _title, tables = parse_tables(text)
    data_table = next(
        (
            table
            for table in tables
            if any((row or [""])[0] == "要素名／順位" for row in table.get("rows", []))
        ),
        None,
    )
    if not data_table:
        return {}
    parsed: dict[str, dict[str, object]] = {}
    for row in data_table.get("rows", []):
        if len(row) < 12:
            continue
        label = str(row[0]).replace(" ", "")
        element = next(
            (key for key, prefix in ELEMENT_LABELS.items() if label.startswith(prefix)),
            "",
        )
        if not element:
            continue
        records = [
            parsed_record
            for parsed_record in (parse_value_and_date(cell) for cell in row[1:11])
            if parsed_record
        ]
        start, end = parse_statistics_period(str(row[11]))
        parsed[element] = {
            "records": records,
            "statistics_start": start,
            "statistics_end": end,
        }
    return parsed


def fetch_scope(station: dict[str, str], month: int | None) -> tuple[str, str, dict[str, object]]:
    station_key = str(station["station_key"])
    scope = "all_time" if month is None else str(month)
    text = fetch_text(record_page_url(station, month))
    if not text:
        raise RuntimeError("empty response")
    parsed = parse_record_page(text)
    if not {"max", "min"}.issubset(parsed):
        raise RuntimeError(f"temperature record rows missing: {sorted(parsed)}")
    return station_key, scope, parsed


def station_shell(station: dict[str, str]) -> dict[str, object]:
    return {
        "name": str(station.get("jma_name") or ""),
        "prefecture": str(station.get("prefecture") or ""),
        "prec_no": str(station.get("prec_no") or ""),
        "block_no": str(station.get("block_no") or ""),
        "kind": str(station.get("kind") or ""),
        "latitude": float(station["latitude"]),
        "longitude": float(station["longitude"]),
        "all_time": {},
        "months": {},
    }


def build(args: argparse.Namespace) -> None:
    output_path = args.out_dir / "temperature_station_records.json"
    inventory = load_inventory(args.station_inventory)
    if output_path.exists():
        try:
            payload = json.loads(output_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            payload = {}
    else:
        payload = {}
    stations = payload.get("stations")
    if not isinstance(stations, dict):
        stations = {}

    tasks: list[tuple[dict[str, str], int | None]] = []
    for station in inventory:
        station_key = str(station["station_key"])
        existing = stations.get(station_key)
        if not isinstance(existing, dict):
            existing = station_shell(station)
            stations[station_key] = existing
        else:
            existing.update({
                key: value
                for key, value in station_shell(station).items()
                if key not in {"all_time", "months"}
            })
            existing.setdefault("all_time", {})
            existing.setdefault("months", {})
        if args.force or not {"max", "min"}.issubset(existing.get("all_time") or {}):
            tasks.append((station, None))
        if args.force or not {"max", "min"}.issubset((existing.get("months") or {}).get(str(args.month)) or {}):
            tasks.append((station, args.month))

    if not tasks:
        print(
            f"temperature station records already current: stations={len(stations)} month={args.month}",
            flush=True,
        )
        return

    failures: list[str] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(fetch_scope, station, month): (station, month)
            for station, month in tasks
        }
        for future in as_completed(futures):
            station, month = futures[future]
            station_key = str(station["station_key"])
            try:
                _key, scope, parsed = future.result()
                if scope == "all_time":
                    stations[station_key]["all_time"] = parsed
                else:
                    stations[station_key].setdefault("months", {})[scope] = parsed
            except Exception as error:
                failures.append(f"{station_key}:{month or 'all'}:{error}")
            completed += 1
            if completed % 100 == 0 or completed == len(tasks):
                print(f"temperature station record fetch {completed}/{len(tasks)}", flush=True)

    all_time_count = sum(
        {"max", "min"}.issubset((station.get("all_time") or {}))
        for station in stations.values()
        if isinstance(station, dict)
    )
    month_count = sum(
        {"max", "min"}.issubset(((station.get("months") or {}).get(str(args.month)) or {}))
        for station in stations.values()
        if isinstance(station, dict)
    )
    if all_time_count < 800 or month_count < 800:
        sample = "; ".join(failures[:8])
        raise SystemExit(
            f"temperature station record coverage too low: all_time={all_time_count} "
            f"month={month_count} failures={len(failures)} {sample}"
        )

    output = {
        "schema_version": 1,
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "source": "JMA past weather data search, station-specific historical top-10 records",
        "months": sorted({
            int(month)
            for station in stations.values()
            if isinstance(station, dict)
            for month in (station.get("months") or {})
            if str(month).isdigit()
        }),
        "station_count": len(stations),
        "stations": stations,
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_text_atomic(output_path, json.dumps(output, ensure_ascii=False, separators=(",", ":")))
    print(
        f"wrote {output_path} stations={len(stations)} all_time={all_time_count} "
        f"month={args.month}:{month_count} failures={len(failures)}",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--station-inventory", type=Path, default=STATION_INVENTORY)
    parser.add_argument("--month", type=int, default=datetime.now(JST).month, choices=range(1, 13))
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--force", action="store_true")
    build(parser.parse_args())


if __name__ == "__main__":
    main()
