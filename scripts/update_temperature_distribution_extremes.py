#!/usr/bin/env python3
"""Fetch JMA MDRR temperature rankings and record updates for the map tool."""

from __future__ import annotations

import argparse
import csv
import html
import json
import os
import re
import time
from datetime import datetime, timedelta
from html.parser import HTMLParser
from http.client import IncompleteRead
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


JST = ZoneInfo("Asia/Tokyo")
BASE = "https://www.data.jma.go.jp/stats/data/mdrr"
USER_AGENT = "NatureWxLab-TemperatureDistribution/0.3"
OUT_DIR = Path("outputs/weather/temperature_distribution_tool")
STATION_INVENTORY = Path("data/weather/japan_all_stations/station_inventory_current_temperature.csv")

RANKING_TABLES = {
    "日最高気温の高い方から": ("max_high", "最高 高い方"),
    "日最高気温の低い方から": ("max_low", "最高 低い方"),
    "日最低気温の低い方から": ("min_low", "最低 低い方"),
    "日最低気温の高い方から": ("min_high", "最低 高い方"),
}


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[dict[str, object]] = []
        self._in_table = False
        self._in_caption = False
        self._in_cell = False
        self._caption = ""
        self._rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell = ""
        self.title = ""
        self._in_h1 = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "h1":
            self._in_h1 = True
        if tag == "table":
            self._in_table = True
            self._caption = ""
            self._rows = []
        elif self._in_table and tag == "caption":
            self._in_caption = True
        elif self._in_table and tag == "tr":
            self._row = []
        elif self._in_table and tag in {"td", "th"}:
            self._in_cell = True
            self._cell = ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1":
            self._in_h1 = False
        elif self._in_table and tag == "caption":
            self._in_caption = False
        elif self._in_table and tag in {"td", "th"}:
            if self._row is not None:
                self._row.append(clean_text(self._cell))
            self._in_cell = False
        elif self._in_table and tag == "tr":
            if self._row:
                self._rows.append(self._row)
            self._row = None
        elif tag == "table" and self._in_table:
            self.tables.append({"caption": clean_text(self._caption), "rows": self._rows})
            self._in_table = False

    def handle_data(self, data: str) -> None:
        if self._in_h1:
            self.title += data
        if self._in_caption:
            self._caption += data
        if self._in_cell:
            self._cell += data


def clean_text(value: str) -> str:
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value.replace("\u3000", " ")).strip()
    return value


def numeric_text(value: str) -> str:
    match = re.search(r"-?\d+(?:\.\d+)?", value or "")
    return match.group(0) if match else ""


def quality_marker(value: str) -> str:
    if "]" in (value or ""):
        return "]"
    if ")" in (value or ""):
        return ")"
    return ""


def station_display_name(value: str) -> str:
    return value.split("（", 1)[0].replace("*", "").strip()


def normalize_station(value: str) -> str:
    return station_display_name(value).replace("ヶ", "ケ").replace(" ", "")


def fetch_text(url: str, attempts: int = 5) -> str | None:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    retryable_http = {404, 408, 425, 429, 500, 502, 503, 504}
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8", errors="replace")
        except HTTPError as error:
            if error.code not in retryable_http or attempt >= attempts:
                print(f"MDRR fetch failed after {attempt} attempts: HTTP {error.code} {url}", flush=True)
                return None
            reason = f"HTTP {error.code}"
        except (TimeoutError, URLError, ConnectionError, IncompleteRead) as error:
            if attempt >= attempts:
                print(f"MDRR fetch failed after {attempt} attempts: {error} {url}", flush=True)
                return None
            reason = str(error)
        delay = 2 ** (attempt - 1)
        print(f"MDRR fetch retry {attempt}/{attempts} after {reason}: {url}", flush=True)
        time.sleep(delay)
    return None


def write_text_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def parse_tables(text: str) -> tuple[str, list[dict[str, object]]]:
    parser = TableParser()
    parser.feed(text)
    return clean_text(parser.title), parser.tables


def load_station_lookup(path: Path) -> dict[str, dict[str, object]]:
    lookup: dict[str, dict[str, object]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if str(row.get("is_current", "")).lower() != "true":
                continue
            key = normalize_station(str(row.get("jma_name", "")))
            if not key:
                continue
            lookup.setdefault(key, {
                "name": row.get("jma_name", ""),
                "kana": row.get("kana", ""),
                "prefecture": row.get("prefecture", ""),
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "station_key": row.get("station_key", ""),
                "block_no": row.get("block_no", ""),
            })
    return lookup


def attach_station(row: dict[str, object], lookup: dict[str, dict[str, object]]) -> None:
    station = lookup.get(normalize_station(str(row.get("station", ""))))
    if not station:
        row["matched"] = False
        return
    row["matched"] = True
    row["latitude"] = station["latitude"]
    row["longitude"] = station["longitude"]
    row["station_key"] = station["station_key"]
    row["block_no"] = station["block_no"]


def parse_rank_table(table: dict[str, object], key: str, lookup: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    rows = table.get("rows", [])
    parsed: list[dict[str, object]] = []
    for cells in rows[2:]:
        if len(cells) < 6 or cells[0] == "順位":
            continue
        rank = cells[0]
        if not rank or "観測値" in rank:
            continue
        waiting_for_differences = any("お待ちください" in cell for cell in cells)
        has_difference_columns = len(cells) >= 14 and not waiting_for_differences
        row = {
            "kind": key,
            "rank": rank,
            "prefecture": cells[1],
            "municipality": cells[2],
            "station": station_display_name(cells[3]),
            "station_label": cells[3],
            "value": numeric_text(cells[4]),
            "value_quality": quality_marker(cells[4]),
            "time": cells[5],
            "normal_diff": numeric_text(cells[6]) if has_difference_columns else "",
            "normal_diff_quality": quality_marker(cells[6]) if has_difference_columns else "",
            "previous_diff": numeric_text(cells[7]) if has_difference_columns else "",
            "previous_diff_quality": quality_marker(cells[7]) if has_difference_columns else "",
        }
        attach_station(row, lookup)
        parsed.append(row)
    return parsed[:16]


def parse_update_table(table: dict[str, object], key: str, record_type: str, lookup: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    rows = table.get("rows", [])
    parsed: list[dict[str, object]] = []
    for cells in rows[2:]:
        if len(cells) < 5 or "ありません" in " ".join(cells):
            continue
        row = {
            "kind": key,
            "record_type": record_type,
            "prefecture": cells[0],
            "municipality": cells[1],
            "station": station_display_name(cells[2]),
            "station_label": cells[2],
            "value": numeric_text(cells[3]),
            "value_quality": quality_marker(cells[3]),
            "time": cells[4] if len(cells) > 4 else "",
            "previous_record": numeric_text(cells[5]) if len(cells) > 5 else "",
            "previous_record_quality": quality_marker(cells[5]) if len(cells) > 5 else "",
            "previous_record_date": cells[6] if len(cells) > 6 else "",
            "start_year": cells[7] if len(cells) > 7 else "",
            "remarks": cells[8] if len(cells) > 8 else "",
        }
        attach_station(row, lookup)
        parsed.append(row)
    return parsed


def parse_daily_rankings(text: str, lookup: dict[str, dict[str, object]]) -> dict[str, object]:
    title, tables = parse_tables(text)
    rankings: dict[str, list[dict[str, object]]] = {}
    for table in tables:
        caption = str(table.get("caption", ""))
        for prefix, (key, _label) in RANKING_TABLES.items():
            if caption.startswith(prefix):
                rankings[key] = parse_rank_table(table, key, lookup)
                break
    return {"title": title, "rankings": rankings}


def parse_updates(text: str, lookup: dict[str, dict[str, object]]) -> dict[str, object]:
    title, tables = parse_tables(text)
    updates: dict[str, list[dict[str, object]]] = {}
    seen: dict[str, int] = {}
    for table in tables:
        caption = str(table.get("caption", ""))
        for prefix, (key, _label) in RANKING_TABLES.items():
            if not caption.startswith(prefix):
                continue
            seen[key] = seen.get(key, 0) + 1
            record_type = "all_time" if seen[key] == 1 else "monthly"
            updates[f"{key}_{record_type}"] = parse_update_table(table, key, record_type, lookup)
            break
    return {"title": title, "updates": updates}


def build(args: argparse.Namespace) -> None:
    lookup = load_station_lookup(args.station_inventory)
    today = datetime.now(JST).date()
    days = []
    for offset in range(args.days):
        day = today - timedelta(days=offset)
        mmdd = day.strftime("%m%d")
        rank_url = f"{BASE}/rank_daily/data{mmdd}.html"
        update_url = f"{BASE}/rank_update/d{mmdd}.html"
        rank_text = fetch_text(rank_url)
        update_text = fetch_text(update_url)
        item: dict[str, object] = {
            "date": day.isoformat(),
            "label": f"{day.month}月{day.day}日",
            "rank_url": rank_url,
            "update_url": update_url,
            "rankings": {},
            "updates": {},
        }
        if rank_text:
            rank_info = parse_daily_rankings(rank_text, lookup)
            item["ranking_title"] = rank_info.get("title", "")
            item["rankings"] = rank_info.get("rankings", {})
        if update_text:
            update_info = parse_updates(update_text, lookup)
            item["update_title"] = update_info.get("title", "")
            item["updates"] = update_info.get("updates", {})
        days.append(item)

    payload = {
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "source": "JMA latest weather data MDRR daily ranking / record update HTML",
        "days": days,
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / "temperature_extremes.json"
    if out_path.exists() and not any(day.get("rankings") or day.get("updates") for day in days):
        raise SystemExit("No JMA MDRR ranking/update data fetched; keeping existing temperature_extremes.json")
    write_text_atomic(out_path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {out_path} days={len(days)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=8)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--station-inventory", type=Path, default=STATION_INVENTORY)
    build(parser.parse_args())


if __name__ == "__main__":
    main()
