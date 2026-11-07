#!/usr/bin/env python3
"""Build near-real-time observed temperature grids from JMA AMeDAS 10-minute JSON."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
import html
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from build_temperature_distribution_tool_data import find_grid_csv, write_csv
from build_temperature_distribution_tool_data import load_station_values as load_daily_station_values
from create_jma_wdist_max_temp_anomaly_map import (
    INDEX_PATH,
    MAX_INTERPOLATION_ELEVATION_M,
    STATION_DIR,
    idw_normals_for_points,
    load_station_normals,
)
from update_temperature_distribution_extremes import parse_daily_rankings


JST = ZoneInfo("Asia/Tokyo")
OUT_DIR = Path("outputs/weather/temperature_distribution_tool")
LATEST_TIME_URL = "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt"
AMEDAS_TABLE_URL = "https://www.jma.go.jp/bosai/amedas/const/amedastable.json"
AMEDAS_MAP_URL = "https://www.jma.go.jp/bosai/amedas/data/map/{time_key}.json"
MDRR_ALLTABLE_URL = "https://www.data.jma.go.jp/stats/data/mdrr/tem_rct/alltable/{code}{mmdd}.html"
MDRR_RANK_DAILY_URL = "https://www.data.jma.go.jp/stats/data/mdrr/rank_daily/data{mmdd}.html"
STATION_INVENTORY = Path("data/weather/japan_all_stations/station_inventory_current_temperature.csv")


@dataclass
class RealtimeStationValue:
    station_key: str
    name: str
    region: str
    lon: float
    lat: float
    normal_c: float


class DailyTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = ""

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell += data

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._cell is not None:
            if self._row is not None:
                self._row.append(clean_text(self._cell))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value).replace("\u3000", " ")).strip()


def station_name(value: str) -> str:
    return value.split("（", 1)[0].replace("*", "").replace("ヶ", "ケ").replace(" ", "").strip()


def region_name(value: str) -> str:
    return value.replace("北海道", "").replace(" ", "").replace("\u3000", "").strip()


def number(value: str) -> float | None:
    if any(marker in (value or "") for marker in ("]", ")")):
        return None
    match = re.search(r"[+-]?\d+(?:\.\d+)?", value or "")
    return float(match.group(0)) if match else None


def write_text_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def load_station_inventory(path: Path) -> dict[tuple[str, str], list[dict[str, str]]]:
    lookup: dict[tuple[str, str], list[dict[str, str]]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if str(row.get("is_current", "")).lower() != "true":
                continue
            if str(row.get("has_temperature", "")).lower() != "true":
                continue
            key = (station_name(str(row.get("jma_name", ""))), region_name(str(row.get("prefecture", ""))))
            lookup.setdefault(key, []).append(row)
    return lookup


def fetch_daily_station_values(
    target_date,
    element: str,
    inventory: dict[tuple[str, str], list[dict[str, str]]],
) -> dict[str, list[RealtimeStationValue]]:
    code = "mxtemsad" if element == "max" else "mntemsad"
    url = MDRR_ALLTABLE_URL.format(code=code, mmdd=target_date.strftime("%m%d"))
    parser = DailyTableParser()
    parser.feed(fetch_text(url))
    fields = {"value": [], "anomaly": [], "previous": []}
    for cells in parser.rows:
        if len(cells) != 9:
            continue
        value = number(cells[3])
        if value is None:
            continue
        key = (station_name(cells[2]), region_name(cells[0]))
        matches = inventory.get(key, [])
        if len(matches) != 1:
            continue
        station = matches[0]
        common = {
            "station_key": str(station["station_key"]),
            "name": str(station["jma_name"]),
            "region": str(station["prefecture"]),
            "lon": float(station["longitude"]),
            "lat": float(station["latitude"]),
        }
        fields["value"].append(RealtimeStationValue(**common, normal_c=value))
        anomaly = number(cells[5])
        previous = number(cells[6])
        if anomaly is not None:
            fields["anomaly"].append(RealtimeStationValue(**common, normal_c=anomaly))
        if previous is not None:
            fields["previous"].append(RealtimeStationValue(**common, normal_c=previous))
    return fields


def fetch_text(url: str, attempts: int = 5) -> str:
    """Fetch JMA text while tolerating short publication and transport gaps."""
    retryable_http = {404, 408, 425, 429, 500, 502, 503, 504}
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            if error.code not in retryable_http or attempt >= attempts:
                raise
            reason = f"HTTP {error.code}"
        except (TimeoutError, urllib.error.URLError, ConnectionError) as error:
            if attempt >= attempts:
                raise
            reason = str(error)
        delay = 2 ** (attempt - 1)
        print(f"JMA fetch retry {attempt}/{attempts} after {reason}: {url} (sleep {delay}s)", flush=True)
        time.sleep(delay)
    raise RuntimeError(f"JMA fetch retries exhausted: {url}")


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


def parse_latest_time(value: str) -> datetime:
    return datetime.fromisoformat(value.strip()).astimezone(JST)


def time_key(value: datetime) -> str:
    return value.strftime("%Y%m%d%H%M00")


def day_key_from_date(value: datetime) -> str:
    return value.strftime("%m-%d")


def load_index(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_amedas_table(out_dir: Path, latest: datetime) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / "amedastable_cache.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if str(cached.get("cache_date")) == latest.date().isoformat() and isinstance(cached.get("stations"), dict):
                print("using daily AMeDAS station table cache", flush=True)
                return cached["stations"]
        except (json.JSONDecodeError, OSError):
            pass
    stations = fetch_json(AMEDAS_TABLE_URL)
    write_text_atomic(cache_path, json.dumps({"cache_date": latest.date().isoformat(), "stations": stations}, ensure_ascii=False, separators=(",", ":")))
    return stations


def latlon_decimal(parts: list[float | int]) -> float:
    return float(parts[0]) + float(parts[1]) / 60.0


def observation_value(row: dict, key: str) -> tuple[float | None, int | None]:
    """Return the value and JMA's raw quality code without inventing semantics for it."""
    item = row.get(key)
    if not isinstance(item, list) or not item:
        return None, None
    value = item[0]
    quality = item[1] if len(item) > 1 else None
    try:
        parsed_value = None if value is None else float(value)
    except (TypeError, ValueError):
        parsed_value = None
    try:
        parsed_quality = None if quality is None else int(quality)
    except (TypeError, ValueError):
        parsed_quality = None
    return parsed_value, parsed_quality


def build_latest_station_observations(
    latest: datetime,
    payload: dict,
    amedas_table: dict,
) -> tuple[dict, list[dict[str, str]]]:
    """Build a stable, station-level feed for realtime temperature, rain and wind."""
    stations = []
    csv_rows: list[dict[str, str]] = []
    counts = {"temperature": 0, "precipitation_1h": 0, "wind": 0}
    for amedas_id in sorted(payload):
        row = payload.get(amedas_id)
        meta = amedas_table.get(amedas_id)
        if not isinstance(row, dict) or not isinstance(meta, dict):
            continue
        if "lat" not in meta or "lon" not in meta:
            continue
        temperature, temperature_quality = observation_value(row, "temp")
        precipitation, precipitation_quality = observation_value(row, "precipitation1h")
        wind_speed, wind_speed_quality = observation_value(row, "wind")
        wind_direction_code, wind_direction_quality = observation_value(row, "windDirection")
        wind_direction_deg = None
        if wind_direction_code is not None and 0 <= wind_direction_code <= 16:
            wind_direction_deg = (wind_direction_code % 16) * 22.5
        if all(value is None for value in (temperature, precipitation, wind_speed, wind_direction_code)):
            continue
        if temperature is not None:
            counts["temperature"] += 1
        if precipitation is not None:
            counts["precipitation_1h"] += 1
        if wind_speed is not None and wind_direction_code is not None:
            counts["wind"] += 1
        station = {
            "amedas_id": str(amedas_id),
            "name": str(meta.get("kjName") or meta.get("enName") or amedas_id),
            "longitude": round(latlon_decimal(meta["lon"]), 6),
            "latitude": round(latlon_decimal(meta["lat"]), 6),
            "elevation_m": meta.get("alt"),
            "observed_at": latest.isoformat(),
            "temperature_c": temperature,
            "temperature_quality": temperature_quality,
            "precipitation_1h_mm": precipitation,
            "precipitation_1h_quality": precipitation_quality,
            "wind_speed_ms": wind_speed,
            "wind_speed_quality": wind_speed_quality,
            "wind_direction_code": wind_direction_code,
            "wind_direction_deg": wind_direction_deg,
            "wind_direction_quality": wind_direction_quality,
        }
        stations.append(station)
        csv_rows.append({key: "" if value is None else str(value) for key, value in station.items()})
    document = {
        "schema_version": 1,
        "generated_at": datetime.now(JST).isoformat(),
        "latest_time": latest.isoformat(),
        "source": "JMA AMeDAS data/map 10-minute observations",
        "quality_note": "Quality fields are unmodified numeric codes supplied by JMA; null means unavailable.",
        "elements": {
            "temperature": {"field": "temperature_c", "unit": "degC", "station_count": counts["temperature"]},
            "precipitation_1h": {"field": "precipitation_1h_mm", "unit": "mm", "station_count": counts["precipitation_1h"]},
            "wind_speed": {"field": "wind_speed_ms", "unit": "m/s", "station_count": counts["wind"]},
            "wind_direction": {"field": "wind_direction_deg", "unit": "degree", "station_count": counts["wind"]},
        },
        "station_count": len(stations),
        "stations": stations,
    }
    return document, csv_rows


def write_station_observations_csv(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = [
        "amedas_id",
        "name",
        "longitude",
        "latitude",
        "elevation_m",
        "observed_at",
        "temperature_c",
        "temperature_quality",
        "precipitation_1h_mm",
        "precipitation_1h_quality",
        "wind_speed_ms",
        "wind_speed_quality",
        "wind_direction_code",
        "wind_direction_deg",
        "wind_direction_quality",
    ]
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        with tmp.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def nearest_amedas_id(station: dict, amedas_table: dict, candidates: set[str]) -> str | None:
    block_no = str(station.get("block_no", ""))
    if block_no in candidates:
        return block_no
    lat = float(station["latitude"])
    lon = float(station["longitude"])
    best_id = None
    best_dist = math.inf
    for amedas_id in candidates:
        item = amedas_table.get(amedas_id)
        if not item or "lat" not in item or "lon" not in item:
            continue
        a_lat = latlon_decimal(item["lat"])
        a_lon = latlon_decimal(item["lon"])
        dx = (a_lon - lon) * math.cos(math.radians(lat))
        dy = a_lat - lat
        dist = dx * dx + dy * dy
        if dist < best_dist:
            best_dist = dist
            best_id = amedas_id
    return best_id if best_dist < 0.02 else None


def load_temperature_station_records(
    path: Path,
    inventory: dict[tuple[str, str], list[dict[str, str]]],
    amedas_table: dict,
) -> tuple[dict[str, dict[str, object]], dict[str, object], dict[str, str]]:
    """Map the durable JMA record cache from inventory keys to live AMeDAS IDs."""
    if not path.exists():
        return {}, {}, {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}, {}, {}
    cached = payload.get("stations")
    if not isinstance(cached, dict):
        return {}, payload, {}
    candidates = set(amedas_table)
    mapped: dict[str, dict[str, object]] = {}
    inventory_key_by_amedas: dict[str, str] = {}
    for matches in inventory.values():
        for station in matches:
            inventory_key = str(station.get("station_key") or "")
            record = cached.get(inventory_key)
            if not inventory_key or not isinstance(record, dict):
                continue
            amedas_id = nearest_amedas_id(station, amedas_table, candidates)
            if not amedas_id:
                continue
            mapped[amedas_id] = record
            inventory_key_by_amedas[amedas_id] = inventory_key
    return mapped, payload, inventory_key_by_amedas


def record_before_date(
    station_record: dict[str, object] | None,
    target_date,
    element: str,
    month: int | None = None,
) -> tuple[str, str]:
    """Return the JMA record that existed before the selected ranking date."""
    if not station_record:
        return "", ""
    scope = (
        station_record.get("all_time")
        if month is None
        else (station_record.get("months") or {}).get(str(month))
    )
    element_record = (scope or {}).get(element) if isinstance(scope, dict) else None
    entries = element_record.get("records") if isinstance(element_record, dict) else []
    valid: list[tuple[float, str]] = []
    for entry in entries or []:
        if not isinstance(entry, list) or len(entry) < 2:
            continue
        try:
            value = float(entry[0])
            record_date = datetime.strptime(str(entry[1]), "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        if record_date < target_date and (month is None or record_date.month == month):
            valid.append((value, record_date.isoformat()))
    if not valid:
        return "", ""
    value, date_value = (
        max(valid, key=lambda item: (item[0], item[1]))
        if element == "max"
        else min(valid, key=lambda item: (item[0], item[1]))
    )
    return f"{value:.1f}", date_value


def station_record_metrics(
    station_record: dict[str, object] | None,
    target_date,
    element: str,
) -> tuple[str, str, str, str, str]:
    all_time_value, all_time_date = record_before_date(station_record, target_date, element)
    month_value, month_date = record_before_date(
        station_record,
        target_date,
        element,
        month=target_date.month,
    )
    all_time = station_record.get("all_time") if station_record else {}
    element_record = (all_time or {}).get(element) if isinstance(all_time, dict) else {}
    statistics_start = str((element_record or {}).get("statistics_start") or "")
    statistics_start_year = statistics_start[:4] if re.match(r"^\d{4}", statistics_start) else ""
    return all_time_value, all_time_date, month_value, month_date, statistics_start_year


def merge_completed_race_records(
    payload: dict[str, object],
    inventory_key_by_amedas: dict[str, str],
    days: list[dict],
    latest_date,
) -> bool:
    """Advance cached top-10 records with completed archived ranking days."""
    cached = payload.get("stations")
    if not isinstance(cached, dict):
        return False
    changed = False
    for day in days:
        try:
            target_date = datetime.strptime(str(day.get("date") or ""), "%Y-%m-%d").date()
        except ValueError:
            continue
        if target_date >= latest_date:
            continue
        for element in ("max", "min"):
            for row in (day.get(element) or {}).get("final_rankings") or []:
                if not isinstance(row, list) or len(row) < 2:
                    continue
                inventory_key = inventory_key_by_amedas.get(str(row[0]))
                station_record = cached.get(inventory_key) if inventory_key else None
                if not isinstance(station_record, dict):
                    continue
                try:
                    value = round(float(row[1]), 1)
                except (TypeError, ValueError):
                    continue
                for scope in (
                    station_record.get("all_time"),
                    (station_record.get("months") or {}).get(str(target_date.month)),
                ):
                    element_record = (scope or {}).get(element) if isinstance(scope, dict) else None
                    if not isinstance(element_record, dict):
                        continue
                    before = element_record.get("records") or []
                    candidates = [
                        [round(float(item[0]), 1), str(item[1])]
                        for item in before
                        if isinstance(item, list) and len(item) >= 2
                    ]
                    candidate = [value, target_date.isoformat()]
                    if candidate not in candidates:
                        candidates.append(candidate)
                    candidates.sort(
                        key=lambda item: (
                            -float(item[0]) if element == "max" else float(item[0]),
                            str(item[1]),
                        )
                    )
                    after = candidates[:10]
                    if after != before:
                        element_record["records"] = after
                        changed = True
    return changed


def official_daily_extreme_time(target_date, value: str) -> datetime | None:
    """Parse the occurrence minute published in a JMA daily-extreme table."""
    match = re.search(r"(\d{1,2}):(\d{2})", value or "")
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 24 or minute > 59:
        return None
    day_offset = 1 if hour == 24 else 0
    return datetime(
        target_date.year,
        target_date.month,
        target_date.day,
        hour % 24,
        minute,
        tzinfo=JST,
    ) + timedelta(days=day_offset)


def official_daily_extreme_number(value: str) -> tuple[float | None, str]:
    """Keep MDRR's provisional marker while accepting its published numeric value."""
    match = re.search(r"[+-]?\d+(?:\.\d+)?", value or "")
    if not match:
        return None, ""
    marker = "]" if "]" in (value or "") else ")" if ")" in (value or "") else ""
    return float(match.group(0)), marker


def mdrr_publication_time(target_date, text: str) -> datetime | None:
    """Return the latest `HH時MM分現在` timestamp printed in an MDRR page."""
    values: list[datetime] = []
    for hour_text, minute_text in re.findall(r"(\d{1,2})時(\d{2})分現在", clean_text(text)):
        hour = int(hour_text)
        minute = int(minute_text)
        if hour > 24 or minute > 59:
            continue
        values.append(
            datetime(
                target_date.year,
                target_date.month,
                target_date.day,
                hour % 24,
                minute,
                tzinfo=JST,
            ) + timedelta(days=1 if hour == 24 else 0)
        )
    return max(values) if values else None


def overlay_newer_rank_daily_extrema(
    extrema: dict[str, dict[str, str | float]],
    target_date,
    element: str,
    rank_daily_text: str,
    alltable_published_at: datetime | None,
    inventory: dict[tuple[str, str], list[dict[str, str]]],
    amedas_table: dict,
) -> int:
    """Overlay a newer JMA ranking page onto the full-station daily table."""
    rank_published_at = mdrr_publication_time(target_date, rank_daily_text)
    if rank_published_at is None or (
        alltable_published_at is not None and rank_published_at <= alltable_published_at
    ):
        return 0

    ranking_keys = ("max_high", "max_low") if element == "max" else ("min_low", "min_high")
    ranking_info = parse_daily_rankings(rank_daily_text, {})
    candidates = set(amedas_table)
    overlay_count = 0
    for ranking_key in ranking_keys:
        for row in (ranking_info.get("rankings") or {}).get(ranking_key) or []:
            value, _unused_marker = official_daily_extreme_number(str(row.get("value") or ""))
            observed_time = official_daily_extreme_time(target_date, str(row.get("time") or ""))
            if value is None or observed_time is None or not math.isfinite(value):
                continue
            key = (
                station_name(str(row.get("station") or "")),
                region_name(str(row.get("prefecture") or "")),
            )
            matches = inventory.get(key, [])
            if len(matches) != 1:
                continue
            amedas_id = nearest_amedas_id(matches[0], amedas_table, candidates)
            if not amedas_id:
                continue
            replacement = {
                "station_key": amedas_id,
                "value_c": round(value, 1),
                "observed_time": observed_time.isoformat(),
                "municipality": str(row.get("municipality") or ""),
                "normal_diff_c": str(row.get("normal_diff") or ""),
                "previous_diff_c": str(row.get("previous_diff") or ""),
                "quality_marker": str(row.get("value_quality") or ""),
                "source_page": "mdrr_rank_daily",
            }
            previous = extrema.get(amedas_id)
            if previous:
                try:
                    previous_value = float(previous["value_c"])
                    previous_time = datetime.fromisoformat(str(previous["observed_time"])).astimezone(JST)
                except (KeyError, TypeError, ValueError):
                    previous_value = value
                    previous_time = observed_time
                extends_later = observed_time > previous_time and (
                    value > previous_value + 0.05
                    if element == "max"
                    else value < previous_value - 0.05
                )
                if extends_later:
                    prior_events = [
                        {
                            key: item[key]
                            for key in ("station_key", "value_c", "observed_time", "municipality", "quality_marker", "source_page")
                            if key in item
                        }
                        for item in (previous.get("prior_events") or [])
                        if isinstance(item, dict)
                    ]
                    prior_events.append({
                        key: previous[key]
                        for key in ("station_key", "value_c", "observed_time", "municipality", "quality_marker", "source_page")
                        if key in previous
                    })
                    replacement["prior_events"] = prior_events
            if previous != replacement:
                overlay_count += 1
            extrema[amedas_id] = replacement
    return overlay_count


def rank_daily_only_extrema(
    target_date,
    element: str,
    rank_daily_text: str,
    inventory: dict[tuple[str, str], list[dict[str, str]]],
    amedas_table: dict,
) -> tuple[dict[str, dict[str, str | float]], int]:
    """Build official extrema from the ranking page while the full table is unpublished."""
    extrema: dict[str, dict[str, str | float]] = {}
    overlay_count = overlay_newer_rank_daily_extrema(
        extrema,
        target_date,
        element,
        rank_daily_text,
        None,
        inventory,
        amedas_table,
    )
    return extrema, overlay_count


def fetch_official_daily_extrema(
    target_date,
    element: str,
    inventory: dict[tuple[str, str], list[dict[str, str]]],
    amedas_table: dict,
    rank_daily_text: str | None = None,
) -> dict[str, dict[str, str | float]]:
    """Fetch JMA-published daily extrema and their arbitrary-minute occurrence times."""
    if element not in {"max", "min"}:
        raise ValueError(f"Unsupported daily extreme element: {element}")
    code = "mxtemsad" if element == "max" else "mntemsad"
    url = MDRR_ALLTABLE_URL.format(code=code, mmdd=target_date.strftime("%m%d"))
    alltable_text = fetch_text(url)
    parser = DailyTableParser()
    parser.feed(alltable_text)
    candidates = set(amedas_table)
    extrema: dict[str, dict[str, str | float]] = {}
    for cells in parser.rows:
        if len(cells) != 9:
            continue
        value, quality_marker = official_daily_extreme_number(cells[3])
        observed_time = official_daily_extreme_time(target_date, cells[4])
        if value is None or observed_time is None or not math.isfinite(value):
            continue
        normal_diff, _normal_marker = official_daily_extreme_number(cells[5])
        previous_diff, _previous_marker = official_daily_extreme_number(cells[6])
        key = (station_name(cells[2]), region_name(cells[0]))
        matches = inventory.get(key, [])
        if len(matches) != 1:
            continue
        amedas_id = nearest_amedas_id(matches[0], amedas_table, candidates)
        if not amedas_id:
            continue
        extrema[amedas_id] = {
            "station_key": amedas_id,
            "value_c": round(value, 1),
            "observed_time": observed_time.isoformat(),
            "municipality": cells[1],
            "normal_diff_c": "" if normal_diff is None else f"{normal_diff:+.1f}",
            "previous_diff_c": "" if previous_diff is None else f"{previous_diff:+.1f}",
            "quality_marker": quality_marker,
            "source_page": "mdrr_alltable",
        }
    overlay_count = 0
    if rank_daily_text:
        overlay_count = overlay_newer_rank_daily_extrema(
            extrema,
            target_date,
            element,
            rank_daily_text,
            mdrr_publication_time(target_date, alltable_text),
            inventory,
            amedas_table,
        )
    print(
        f"JMA official daily {element} corrections: {len(extrema)} stations "
        f"(newer rank_daily overlays={overlay_count})",
        flush=True,
    )
    return extrema


def official_daily_maximum_time(target_date, value: str) -> datetime | None:
    """Backward-compatible alias used by focused parser tests."""
    return official_daily_extreme_time(target_date, value)


def official_daily_maximum_number(value: str) -> tuple[float | None, str]:
    """Backward-compatible alias used by focused parser tests."""
    return official_daily_extreme_number(value)


def fetch_official_daily_maxima(
    target_date,
    inventory: dict[tuple[str, str], list[dict[str, str]]],
    amedas_table: dict,
) -> dict[str, dict[str, str | float]]:
    """Backward-compatible wrapper for the maximum-temperature table."""
    return fetch_official_daily_extrema(target_date, "max", inventory, amedas_table)


def load_grid_points(out_dir: Path) -> list[tuple[float, float]]:
    path = find_grid_csv(out_dir, "max")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [(float(row["longitude"]), float(row["latitude"])) for row in csv.DictReader(handle)]


def collect_station_extremes(
    latest: datetime,
    index: dict,
    amedas_table: dict,
    out_dir: Path,
    max_steps: int,
) -> tuple[datetime, dict[str, dict[str, float | str]]]:
    start = latest.replace(hour=0, minute=0, second=0, microsecond=0)
    values: dict[str, dict[str, float | str]] = {}
    series_path = out_dir / "observed_realtime_station_timeseries.json"
    if series_path.exists() and max_steps == 0:
        existing = json.loads(series_path.read_text(encoding="utf-8"))
        for station in existing.get("stations", []):
            today_series = [
                (datetime.fromisoformat(str(timestamp)).astimezone(JST), float(value))
                for timestamp, value in station.get("series", [])
                if datetime.fromisoformat(str(timestamp)).astimezone(JST).date() == latest.date()
            ]
            if not today_series:
                continue
            today_series.sort(key=lambda item: item[0])
            temperatures = [item[1] for item in today_series]
            maximum = max(temperatures)
            minimum = min(temperatures)
            values[str(station["station_key"])] = {
                "station_key": str(station["station_key"]),
                "name": str(station.get("name", station["station_key"])),
                "region": str(station.get("region", "")),
                "lon": float(station["longitude"]),
                "lat": float(station["latitude"]),
                "current": today_series[-1][1],
                "current_time": today_series[-1][0].isoformat(),
                "max": maximum,
                "max_time": next(item[0].isoformat() for item in today_series if item[1] == maximum),
                "min": minimum,
                "min_time": next(item[0].isoformat() for item in today_series if item[1] == minimum),
                "series": [[item[0].isoformat(), round(item[1], 1)] for item in today_series],
            }
        if values:
            last_saved = max(datetime.fromisoformat(str(item["current_time"])).astimezone(JST) for item in values.values())
            start = max(start, last_saved + timedelta(minutes=10))
    times = []
    current = start
    while current <= latest:
        times.append(current)
        current += timedelta(minutes=10)
    if max_steps > 0:
        times = times[-max_steps:]

    print(f"AMeDAS incremental extreme fetch count={len(times)} start={times[0].isoformat() if times else 'none'}", flush=True)
    for value_time in times:
        payload = fetch_json(AMEDAS_MAP_URL.format(time_key=time_key(value_time)))
        for amedas_id, observation in payload.items():
            temp = observation.get("temp")
            if not isinstance(temp, list) or len(temp) < 2 or temp[0] is None or temp[1] is None or int(temp[1]) != 0:
                continue
            station = amedas_table.get(amedas_id) or {}
            if "lat" not in station or "lon" not in station:
                continue
            elevation = station.get("alt")
            if elevation is not None and float(elevation) > MAX_INTERPOLATION_ELEVATION_M:
                continue
            temp_f = float(temp[0])
            station_key = str(amedas_id)
            station_name = str(station.get("kjName") or station.get("enName") or amedas_id)
            item = values.setdefault(
                station_key,
                {
                    "station_key": station_key,
                    "name": station_name,
                    "region": "",
                    "lon": latlon_decimal(station["lon"]),
                    "lat": latlon_decimal(station["lat"]),
                    "current": temp_f,
                    "current_time": value_time.isoformat(),
                    "max": temp_f,
                    "max_time": value_time.isoformat(),
                    "min": temp_f,
                    "min_time": value_time.isoformat(),
                    "series": [],
                },
            )
            item["current"] = temp_f
            item["current_time"] = value_time.isoformat()
            item.setdefault("series", []).append([value_time.isoformat(), round(temp_f, 1)])
            if temp_f > float(item["max"]):
                item["max"] = temp_f
                item["max_time"] = value_time.isoformat()
            if temp_f < float(item["min"]):
                item["min"] = temp_f
                item["min_time"] = value_time.isoformat()

    return latest, values


def backfill_station_timeseries(
    path: Path,
    latest: datetime,
    amedas_table: dict,
    days: int,
    workers: int,
) -> None:
    """Backfill the public 10-minute point series from JMA's still-available map archive."""
    cutoff = latest - timedelta(days=max(1, days))
    times: list[datetime] = []
    current = cutoff.replace(second=0, microsecond=0)
    current -= timedelta(minutes=current.minute % 10)
    while current <= latest:
        times.append(current)
        current += timedelta(minutes=10)

    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"stations": []}
    stations = {str(item.get("station_key")): item for item in existing.get("stations", [])}
    series_by_key = {
        key: {
            str(time_value): float(value)
            for time_value, value in item.get("series", [])
            if datetime.fromisoformat(str(time_value)).astimezone(JST) >= cutoff
        }
        for key, item in stations.items()
    }

    def fetch_one(value_time: datetime) -> tuple[datetime, dict]:
        return value_time, fetch_json(AMEDAS_MAP_URL.format(time_key=time_key(value_time)))

    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(fetch_one, value_time): value_time for value_time in times}
        for future in as_completed(futures):
            value_time, payload = future.result()
            time_label = value_time.isoformat()
            for amedas_id, observation in payload.items():
                temp = observation.get("temp")
                station = amedas_table.get(amedas_id) or {}
                if (
                    not isinstance(temp, list)
                    or len(temp) < 2
                    or temp[0] is None
                    or temp[1] is None
                    or int(temp[1]) != 0
                    or "lat" not in station
                    or "lon" not in station
                ):
                    continue
                elevation = station.get("alt")
                if elevation is not None and float(elevation) > MAX_INTERPOLATION_ELEVATION_M:
                    continue
                key = str(amedas_id)
                if key not in stations:
                    stations[key] = {
                        "station_key": key,
                        "name": str(station.get("kjName") or station.get("enName") or key),
                        "region": "",
                        "longitude": latlon_decimal(station["lon"]),
                        "latitude": latlon_decimal(station["lat"]),
                        "series": [],
                    }
                series_by_key.setdefault(key, {})[time_label] = round(float(temp[0]), 1)
            completed += 1
            if completed % 100 == 0 or completed == len(times):
                print(f"backfill station series: {completed}/{len(times)}", flush=True)

    output_stations = []
    for key, station in stations.items():
        by_time = series_by_key.get(key, {})
        if not by_time:
            continue
        station["series"] = [[time_value, by_time[time_value]] for time_value in sorted(by_time)]
        output_stations.append(station)
    output = {
        "generated_at": datetime.now(JST).isoformat(),
        "latest_time": latest.isoformat(),
        "source": f"JMA AMeDAS data/map 10-minute observations, {max(1, days)}-day rolling archive backfill and saved refresh",
        "stations": output_stations,
    }
    write_text_atomic(path, json.dumps(output, ensure_ascii=False, separators=(",", ":")))
    print(f"backfilled {len(output_stations)} stations from {times[0].isoformat()} to {times[-1].isoformat()}", flush=True)


def race_window(target_date, element: str, latest: datetime) -> tuple[datetime, datetime]:
    """Return the requested animation window, clipped only for the current day."""
    day_start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=JST)
    latest = latest.astimezone(JST).replace(second=0, microsecond=0)
    latest -= timedelta(minutes=latest.minute % 10)
    if element == "max":
        window_start = day_start
        scheduled_end = day_start.replace(hour=23, minute=50)
    elif element == "min":
        window_start = day_start - timedelta(hours=6)
        scheduled_end = day_start.replace(hour=9, minute=0)
    else:
        raise ValueError(f"Unsupported race element: {element}")
    window_end = min(scheduled_end, latest) if target_date == latest.date() else scheduled_end
    return window_start, window_end


def build_temperature_race_payload(
    station_series: dict,
    target_date,
    element: str,
    latest: datetime,
    top_n: int = 100,
    official_extrema: dict[str, dict[str, str | float]] | None = None,
    previous_payload: dict | None = None,
    station_records: dict[str, dict[str, object]] | None = None,
) -> dict:
    """Build max/min running-extreme rankings with JMA arbitrary-minute corrections."""
    window_start, window_end = race_window(target_date, element, latest)
    observations_by_time: dict[str, dict[str, float]] = {}
    stations: dict[str, dict[str, str | float]] = {}
    previous_final_by_station = {
        str(row[0]): row
        for row in (previous_payload or {}).get("final_rankings") or []
        if isinstance(row, list) and len(row) >= 3
    }

    for station in station_series.get("stations") or []:
        station_key = str(station.get("station_key") or "")
        if not station_key:
            continue
        previous_final = previous_final_by_station.get(station_key) or []
        stations[station_key] = {
            "name": str(station.get("name") or station_key),
            "prefecture": str(station.get("region") or ""),
            "municipality": str(previous_final[3] if len(previous_final) >= 4 else ""),
            "longitude": float(station.get("longitude")),
            "latitude": float(station.get("latitude")),
        }
        for time_value, value in station.get("series") or []:
            try:
                value_time = datetime.fromisoformat(str(time_value)).astimezone(JST)
                temperature = float(value)
            except (TypeError, ValueError):
                continue
            if value_time < window_start or value_time > window_end or not math.isfinite(temperature):
                continue
            time_label = value_time.replace(second=0, microsecond=0).isoformat()
            observations_by_time.setdefault(time_label, {})[station_key] = round(temperature, 1)

    official_events: list[dict[str, str | float]] = []
    previous_date_matches = str((previous_payload or {}).get("date") or "") == target_date.isoformat()
    if previous_date_matches:
        previous_events = (
            (previous_payload or {}).get("official_events")
            or (previous_payload or {}).get("official_max_events")
            or []
        )
        for event in previous_events:
            try:
                station_key = str(event["station_key"])
                observed_time = datetime.fromisoformat(str(event["observed_time"])).astimezone(JST)
                value_c = float(event["value_c"])
            except (KeyError, TypeError, ValueError):
                continue
            if station_key not in stations or observed_time < window_start or observed_time > window_end or not math.isfinite(value_c):
                continue
            official_events.append({
                "station_key": station_key,
                "observed_time": observed_time.isoformat(),
                "value_c": round(value_c, 1),
                "municipality": str(event.get("municipality") or ""),
                "quality_marker": str(event.get("quality_marker") or ""),
                "source_page": str(event.get("source_page") or "mdrr_alltable"),
            })

    events_by_station: dict[str, list[dict[str, str | float]]] = {}
    for event in official_events:
        events_by_station.setdefault(str(event["station_key"]), []).append(event)
    for station_key, latest_extreme in (official_extrema or {}).items():
        candidates = [
            event
            for event in (latest_extreme.get("prior_events") or [])
            if isinstance(event, dict)
        ]
        candidates.append(latest_extreme)
        for extreme in candidates:
            if station_key not in stations:
                continue
            municipality = str(extreme.get("municipality") or "")
            if municipality:
                stations[station_key]["municipality"] = municipality
            try:
                value_c = round(float(extreme["value_c"]), 1)
                observed_time = datetime.fromisoformat(str(extreme["observed_time"])).astimezone(JST)
            except (KeyError, TypeError, ValueError):
                continue
            if observed_time < window_start or observed_time > window_end or not math.isfinite(value_c):
                continue
            existing = events_by_station.get(station_key, [])
            previous_extreme = (
                max((float(event["value_c"]) for event in existing), default=-math.inf)
                if element == "max"
                else min((float(event["value_c"]) for event in existing), default=math.inf)
            )
            revised_toward_normal = (
                previous_extreme > value_c + 0.05
                if element == "max"
                else previous_extreme < value_c - 0.05
            )
            if revised_toward_normal:
                existing = [
                    event
                    for event in existing
                    if (
                        float(event["value_c"]) <= value_c + 0.05
                        if element == "max"
                        else float(event["value_c"]) >= value_c - 0.05
                    )
                ]
                events_by_station[station_key] = existing
                previous_extreme = (
                    max((float(event["value_c"]) for event in existing), default=-math.inf)
                    if element == "max"
                    else min((float(event["value_c"]) for event in existing), default=math.inf)
                )
            extends_extreme = previous_extreme < value_c - 0.05 if element == "max" else previous_extreme > value_c + 0.05
            if extends_extreme:
                event = {
                    "station_key": station_key,
                    "observed_time": observed_time.isoformat(),
                    "value_c": value_c,
                    "municipality": municipality,
                    "quality_marker": str(extreme.get("quality_marker") or ""),
                    "source_page": str(extreme.get("source_page") or "mdrr_alltable"),
                }
                events_by_station.setdefault(station_key, []).append(event)

    official_events = []
    official_events_by_frame: dict[str, list[dict[str, str | float]]] = {}
    for station_key, events in events_by_station.items():
        deduplicated: dict[float, dict[str, str | float]] = {}
        for event in sorted(events, key=lambda item: str(item["observed_time"])):
            deduplicated.setdefault(round(float(event["value_c"]), 1), event)
        for event in deduplicated.values():
            observed_time = datetime.fromisoformat(str(event["observed_time"])).astimezone(JST)
            frame_time = observed_time.replace(second=0, microsecond=0)
            remainder = frame_time.minute % 10
            if remainder:
                frame_time += timedelta(minutes=10 - remainder)
            if frame_time < window_start or frame_time > window_end:
                continue
            normalized = {
                "station_key": station_key,
                "observed_time": observed_time.isoformat(),
                "frame_time": frame_time.isoformat(),
                "value_c": round(float(event["value_c"]), 1),
                "municipality": str(event.get("municipality") or ""),
                "quality_marker": str(event.get("quality_marker") or ""),
                "source_page": str(event.get("source_page") or "mdrr_alltable"),
            }
            official_events.append(normalized)
            official_events_by_frame.setdefault(frame_time.isoformat(), []).append(normalized)
    official_events.sort(key=lambda item: (str(item["observed_time"]), str(item["station_key"]), float(item["value_c"])))

    frames = []
    running_extreme: dict[str, float] = {}
    running_extreme_time: dict[str, str] = {}
    frame_time = window_start
    while frame_time <= window_end:
        time_label = frame_time.isoformat()
        for station_key, temperature in observations_by_time.get(time_label, {}).items():
            previous = running_extreme.get(station_key, -math.inf if element == "max" else math.inf)
            extends_extreme = temperature > previous if element == "max" else temperature < previous
            if extends_extreme:
                running_extreme[station_key] = temperature
                running_extreme_time[station_key] = time_label
        for event in official_events_by_frame.get(time_label, []):
            station_key = str(event["station_key"])
            temperature = float(event["value_c"])
            previous = running_extreme.get(station_key, -math.inf if element == "max" else math.inf)
            extends_or_matches = temperature >= previous if element == "max" else temperature <= previous
            if extends_or_matches:
                running_extreme[station_key] = temperature
                running_extreme_time[station_key] = str(event["observed_time"])
            municipality = str(event.get("municipality") or "")
            if municipality and station_key in stations:
                stations[station_key]["municipality"] = municipality
        rankings = sorted(
            running_extreme.items(),
            key=lambda item: (
                -item[1] if element == "max" else item[1],
                str(stations.get(item[0], {}).get("name") or item[0]),
                item[0],
            ),
        )[:top_n]
        frames.append({
            "time": time_label,
            "rows": [[station_key, round(temperature, 1)] for station_key, temperature in rankings],
        })
        frame_time += timedelta(minutes=10)

    final_rankings = sorted(
        running_extreme.items(),
        key=lambda item: (
            -item[1] if element == "max" else item[1],
            str(stations.get(item[0], {}).get("name") or item[0]),
            item[0],
        ),
    )

    def final_ranking_row(station_key: str, temperature: float) -> list[object]:
        previous_final = previous_final_by_station.get(station_key) or []
        official = (official_extrema or {}).get(station_key) or {}
        official_value = math.nan
        try:
            official_value = float(official.get("value_c"))
        except (TypeError, ValueError):
            pass
        previous_matches = False
        try:
            previous_matches = (
                len(previous_final) >= 6
                and abs(float(previous_final[1]) - float(temperature)) < 0.05
            )
        except (TypeError, ValueError):
            pass
        def adjusted_difference(field: str, previous_index: int) -> str:
            try:
                official_difference = float(official.get(field))
                if math.isfinite(official_value) and math.isfinite(official_difference):
                    return f"{official_difference + float(temperature) - official_value:+.1f}"
            except (TypeError, ValueError):
                pass
            return str(previous_final[previous_index] or "") if previous_matches else ""

        normal_diff = adjusted_difference("normal_diff_c", 4)
        previous_diff = adjusted_difference("previous_diff_c", 5)
        record_metrics = station_record_metrics(
            (station_records or {}).get(station_key),
            target_date,
            element,
        )
        return [
            station_key,
            round(temperature, 1),
            running_extreme_time.get(station_key, ""),
            str(stations.get(station_key, {}).get("municipality") or ""),
            normal_diff,
            previous_diff,
            *record_metrics,
        ]

    return {
        "date": target_date.isoformat(),
        "element": element,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "source": "JMA AMeDAS data/map 10-minute observations + JMA MDRR all-station daily extrema, overlaid by a newer MDRR daily-ranking publication when available",
        "metric": f"10-minute running {'maximum' if element == 'max' else 'minimum'} rankings corrected from the first frame at or after each JMA-published daily-extreme occurrence minute",
        "quality_policy": "AMeDAS 10-minute observations use quality code 0; JMA MDRR daily extrema and newer daily-ranking overlays retain their published provisional markers; missing observations are not interpolated.",
        "frame_interval_minutes": 10,
        "top_n": top_n,
        "station_population": len(stations),
        "eligible_station_count": len(running_extreme),
        "official_daily_extrema_count": len(official_extrema or {}) or int((previous_payload or {}).get("official_daily_extrema_count") or (previous_payload or {}).get("official_daily_maxima_count") or 0),
        "official_correction_event_count": len(official_events),
        "official_events": official_events,
        "final_rankings": [
            final_ranking_row(station_key, temperature)
            for station_key, temperature in final_rankings
        ],
        "stations": stations,
        "frames": frames,
    }


def build_daily_max_race_payload(
    station_series: dict,
    latest: datetime,
    top_n: int = 100,
    official_maxima: dict[str, dict[str, str | float]] | None = None,
    previous_payload: dict | None = None,
) -> dict:
    """Backward-compatible current-day maximum payload used by focused tests."""
    payload = build_temperature_race_payload(
        station_series,
        latest.astimezone(JST).date(),
        "max",
        latest,
        top_n=top_n,
        official_extrema=official_maxima,
        previous_payload=previous_payload,
    )
    payload.update({
        "schema_version": 2,
        "generated_at": datetime.now(JST).isoformat(),
        "latest_time": payload["window_end"],
        "official_daily_maxima_count": payload["official_daily_extrema_count"],
        "official_max_events": payload["official_events"],
    })
    return payload


def write_daily_max_race(
    path: Path,
    station_series: dict,
    latest: datetime,
    official_maxima: dict[str, dict[str, str | float]] | None = None,
) -> dict:
    previous_payload = {}
    if path.exists():
        try:
            previous_payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            previous_payload = {}
    payload = build_daily_max_race_payload(
        station_series,
        latest,
        official_maxima=official_maxima,
        previous_payload=previous_payload,
    )
    write_text_atomic(path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return payload


def previous_race_payload(previous_archive: dict, target_date, element: str) -> dict:
    """Find a prior schema-3 race, with schema-2 current-maximum migration support."""
    target_label = target_date.isoformat()
    if int(previous_archive.get("schema_version") or 0) >= 3:
        for day in previous_archive.get("days") or []:
            if str(day.get("date") or "") == target_label:
                payload = day.get(element)
                return payload if isinstance(payload, dict) else {}
    if element == "max" and str(previous_archive.get("date") or "") == target_label:
        return previous_archive
    return {}


def write_temperature_race_archive(
    path: Path,
    station_series: dict,
    latest: datetime,
    inventory: dict[tuple[str, str], list[dict[str, str]]],
    amedas_table: dict,
    day_count: int = 7,
    top_n: int = 100,
) -> dict:
    """Write seven selectable days of maximum and minimum animations."""
    previous_archive: dict = {}
    if path.exists():
        try:
            previous_archive = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            previous_archive = {}

    latest = latest.astimezone(JST).replace(second=0, microsecond=0)
    dates = [latest.date() - timedelta(days=offset) for offset in range(day_count - 1, -1, -1)]
    station_record_path = path.with_name("temperature_station_records.json")
    station_records, station_record_payload, inventory_key_by_amedas = load_temperature_station_records(
        station_record_path,
        inventory,
        amedas_table,
    )
    shared_stations: dict[str, dict[str, str | float]] = {}
    days: list[dict] = []
    rank_daily_by_date: dict[object, str] = {}
    for target_date in dates:
        day_payload: dict[str, object] = {"date": target_date.isoformat()}
        for element in ("max", "min"):
            previous_payload = previous_race_payload(previous_archive, target_date, element)
            official_extrema: dict[str, dict[str, str | float]] = {}
            previous_full_rankings = (previous_payload or {}).get("final_rankings") or []
            needs_full_ranking_refresh = (
                len(previous_full_rankings) < 800
                or any(not isinstance(row, list) or len(row) < 11 for row in previous_full_rankings)
            )
            if target_date == latest.date() or not previous_payload or needs_full_ranking_refresh:
                if target_date not in rank_daily_by_date:
                    try:
                        rank_daily_by_date[target_date] = fetch_text(
                            MDRR_RANK_DAILY_URL.format(mmdd=target_date.strftime("%m%d"))
                        )
                    except Exception as error:
                        rank_daily_by_date[target_date] = ""
                        print(
                            f"JMA daily ranking fetch failed for {target_date}; "
                            f"using all-station extrema only: {error}",
                            flush=True,
                        )
                try:
                    official_extrema = fetch_official_daily_extrema(
                        target_date,
                        element,
                        inventory,
                        amedas_table,
                        rank_daily_text=rank_daily_by_date[target_date],
                    )
                except Exception as error:
                    official_extrema, rank_only_count = rank_daily_only_extrema(
                        target_date,
                        element,
                        rank_daily_by_date[target_date],
                        inventory,
                        amedas_table,
                    )
                    if rank_only_count:
                        print(
                            f"JMA official daily {element} all-station table is unavailable for {target_date}; "
                            f"using {rank_only_count} extrema from the official daily ranking page: {error}",
                            flush=True,
                        )
                    else:
                        print(
                            f"JMA official daily {element} fetch failed for {target_date}; retaining saved corrections: {error}",
                            flush=True,
                        )
            race = build_temperature_race_payload(
                station_series,
                target_date,
                element,
                latest,
                top_n=top_n,
                official_extrema=official_extrema,
                previous_payload=previous_payload,
                station_records=station_records,
            )
            for station_key, station_meta in race.pop("stations").items():
                previous_meta = shared_stations.get(station_key) or {}
                shared_stations[station_key] = {
                    **previous_meta,
                    **station_meta,
                    "municipality": str(
                        station_meta.get("municipality")
                        or previous_meta.get("municipality")
                        or ""
                    ),
                }
            day_payload[element] = race
        days.append(day_payload)

    if station_record_payload and merge_completed_race_records(
        station_record_payload,
        inventory_key_by_amedas,
        days,
        latest.date(),
    ):
        station_record_payload["generated_at"] = datetime.now(JST).isoformat(timespec="seconds")
        write_text_atomic(
            station_record_path,
            json.dumps(station_record_payload, ensure_ascii=False, separators=(",", ":")),
        )

    payload = {
        "schema_version": 5,
        "generated_at": datetime.now(JST).isoformat(),
        "latest_time": latest.isoformat(),
        "date_range": {"start": dates[0].isoformat(), "end": dates[-1].isoformat()},
        "dates": [value.isoformat() for value in dates],
        "elements": ["max", "min"],
        "source": "JMA AMeDAS 10-minute observations + JMA MDRR all-station daily extrema, overlaid by a newer MDRR daily-ranking publication when available",
        "quality_policy": "AMeDAS 10-minute observations use quality code 0; MDRR daily extrema and newer daily-ranking overlays retain published provisional markers; missing observations are not interpolated.",
        "frame_interval_minutes": 10,
        "top_n": top_n,
        "station_population": len(shared_stations),
        "stations": shared_stations,
        "days": days,
    }
    write_text_atomic(path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return payload


def content_addressed_json(
    out_dir: Path,
    prefix: str,
    payload: dict,
) -> dict[str, str | int]:
    """Write compact immutable JSON and return its public delivery metadata."""
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    encoded = text.encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    filename = f"{prefix}_{digest[:16]}.json"
    path = out_dir / filename
    if not path.exists() or path.read_bytes() != encoded:
        write_text_atomic(path, text)
    return {
        "json": filename,
        "sha256": digest,
        "bytes": len(encoded),
    }


def temperature_race_delivery_references(index_payload: dict) -> set[str]:
    references = {
        str((index_payload.get("stations") or {}).get("json") or ""),
    }
    for elements in (index_payload.get("files") or {}).values():
        if not isinstance(elements, dict):
            continue
        for metadata in elements.values():
            if isinstance(metadata, dict):
                references.add(str(metadata.get("json") or ""))
    return {value for value in references if value}


def write_temperature_race_delivery(
    out_dir: Path,
    archive: dict,
    keep_index_versions: int = 3,
) -> dict[str, object]:
    """Publish small immutable race slices and retain recent indexes for fallback."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stations_payload = {
        "schema_version": 1,
        "station_count": int(archive.get("station_population") or 0),
        "stations": archive.get("stations") or {},
    }
    stations_meta = content_addressed_json(
        out_dir,
        "observed_temperature_race_stations",
        stations_payload,
    )
    files: dict[str, dict[str, dict[str, str | int]]] = {}
    total_slice_bytes = 0
    maximum_slice_bytes = 0
    for day in archive.get("days") or []:
        target_date = str(day.get("date") or "")
        if not target_date:
            continue
        files[target_date] = {}
        for element in ("max", "min"):
            race = day.get(element)
            if not isinstance(race, dict):
                continue
            slice_payload = {
                "schema_version": 1,
                "date": target_date,
                "element": element,
                "race": race,
            }
            slice_meta = content_addressed_json(
                out_dir,
                f"observed_temperature_race_{target_date.replace('-', '')}_{element}",
                slice_payload,
            )
            slice_meta.update({
                "frame_count": len(race.get("frames") or []),
                "eligible_station_count": int(race.get("eligible_station_count") or 0),
            })
            files[target_date][element] = slice_meta
            total_slice_bytes += int(slice_meta["bytes"])
            maximum_slice_bytes = max(maximum_slice_bytes, int(slice_meta["bytes"]))

    index_payload = {
        "schema_version": 1,
        "generated_at": archive.get("generated_at"),
        "latest_time": archive.get("latest_time"),
        "dates": archive.get("dates") or [],
        "elements": archive.get("elements") or ["max", "min"],
        "frame_interval_minutes": int(archive.get("frame_interval_minutes") or 0),
        "top_n": int(archive.get("top_n") or 0),
        "station_population": int(archive.get("station_population") or 0),
        "stations": stations_meta,
        "files": files,
    }
    index_meta = content_addressed_json(
        out_dir,
        "observed_temperature_race_index",
        index_payload,
    )

    current_index = str(index_meta["json"])
    index_paths = sorted(
        out_dir.glob("observed_temperature_race_index_*.json"),
        key=lambda candidate: candidate.stat().st_mtime_ns,
        reverse=True,
    )
    retained_indexes = [out_dir / current_index]
    retained_indexes.extend(
        path
        for path in index_paths
        if path.name != current_index
    )
    retained_indexes = retained_indexes[:max(1, keep_index_versions)]
    referenced_files = {path.name for path in retained_indexes}
    for index_path in retained_indexes:
        try:
            retained_payload = json.loads(index_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        referenced_files.update(temperature_race_delivery_references(retained_payload))

    delivery_patterns = (
        "observed_temperature_race_index_*.json",
        "observed_temperature_race_stations_*.json",
        "observed_temperature_race_????????_max_*.json",
        "observed_temperature_race_????????_min_*.json",
    )
    for pattern in delivery_patterns:
        for candidate in out_dir.glob(pattern):
            if candidate.name not in referenced_files:
                candidate.unlink(missing_ok=True)

    return {
        "schema_version": 1,
        "index_json": current_index,
        "index_sha256": str(index_meta["sha256"]),
        "index_bytes": int(index_meta["bytes"]),
        "index_history": [path.name for path in retained_indexes],
        "slice_count": sum(len(elements) for elements in files.values()),
        "total_slice_bytes": total_slice_bytes,
        "maximum_slice_bytes": maximum_slice_bytes,
        "stations_json": str(stations_meta["json"]),
        "stations_bytes": int(stations_meta["bytes"]),
    }


def idw_values(points: list[tuple[float, float, float]], values: list[RealtimeStationValue]) -> np.ndarray:
    return idw_normals_for_points(points, values)


def make_station_values(records: dict[str, dict[str, float | str]], element: str) -> list[RealtimeStationValue]:
    return [
        RealtimeStationValue(
            station_key=str(record["station_key"]),
            name=str(record["name"]),
            region=str(record["region"]),
            lon=float(record["lon"]),
            lat=float(record["lat"]),
            normal_c=float(record[element]),
        )
        for record in records.values()
        if element in record
    ]


def build_rows(
    grid_points: list[tuple[float, float]],
    values_grid: np.ndarray,
    average_grid: np.ndarray | None,
    previous_grid: np.ndarray | None,
    source_date: str,
    target_label: str,
    mode: str,
) -> list[dict[str, str]]:
    rows = []
    for (lon, lat), value, average, previous in zip(
        grid_points,
        values_grid,
        average_grid if average_grid is not None else [math.nan] * len(grid_points),
        previous_grid if previous_grid is not None else [math.nan] * len(grid_points),
    ):
        value_f = float(value)
        average_f = float(average) if math.isfinite(float(average)) else math.nan
        previous_f = float(previous) if math.isfinite(float(previous)) else math.nan
        anomaly = value_f - average_f if math.isfinite(average_f) else math.nan
        previous_diff = value_f - previous_f if math.isfinite(previous_f) else math.nan
        display = value_f
        if mode == "anomaly" and math.isfinite(anomaly):
            display = anomaly
        elif mode == "previous" and math.isfinite(previous_diff):
            display = previous_diff
        rows.append(
            {
                "longitude": f"{lon:.5f}",
                "latitude": f"{lat:.5f}",
                "display_c": f"{display:+.2f}" if mode != "value" else f"{display:.2f}",
                "forecast_c": "",
                "observed_c": f"{value_f:.2f}",
                "average_c": "" if not math.isfinite(average_f) else f"{average_f:.2f}",
                "anomaly_c": "" if not math.isfinite(anomaly) else f"{anomaly:+.2f}",
                "previous_day_c": "" if not math.isfinite(previous_f) else f"{previous_f:.2f}",
                "previous_diff_c": "" if not math.isfinite(previous_diff) else f"{previous_diff:+.2f}",
                "source_date": source_date,
                "target_date": target_label,
            }
        )
    return rows


def short_slot_label(value_date, element: str) -> str:
    return f"{value_date.day}日{'最高' if element == 'max' else '最低'}"


def write_observed_grid_set(
    *,
    args: argparse.Namespace,
    grid_points_2d: list[tuple[float, float]],
    grid_points: list[tuple[float, float, float]],
    value_grid: np.ndarray,
    element: str,
    target_date,
    target_label: str,
    previous_grid: np.ndarray | None,
    official_normal_average_grid: np.ndarray | None,
    periods: list[str],
    slot_id: str | None,
) -> None:
    for period in periods:
        suffix = period_suffix(period)
        if period == "normal" and official_normal_average_grid is not None:
            average_grid = official_normal_average_grid
        else:
            normals = load_station_normals(args.index, args.station_dir, target_date.strftime("%m-%d"), period, element)
            average_grid = idw_normals_for_points(grid_points, normals)
        rows = build_rows(
            grid_points_2d,
            value_grid,
            average_grid,
            previous_grid,
            target_date.isoformat(),
            target_label,
            "anomaly",
        )
        if slot_id:
            write_csv(args.out_dir / f"observed_{slot_id}_anomaly_{suffix}.csv", rows)
        if not slot_id:
            write_csv(args.out_dir / f"observed_{element}_anomaly_{suffix}.csv", rows)


def period_suffix(period: str) -> str:
    return "normal" if period == "normal" else f"{period}y"


def station_reference_path(out_dir: Path, slot_id: str) -> Path:
    return out_dir / f"observed_{slot_id}_station_values.json"


def write_station_reference(
    path: Path,
    values: list[RealtimeStationValue],
    target_date,
    element: str,
    source: str,
) -> None:
    payload = {
        "target_date": target_date.isoformat(),
        "element": element,
        "source": source,
        "station_count": len(values),
        "stations": [
            {
                "station_key": value.station_key,
                "name": value.name,
                "region": value.region,
                "longitude": value.lon,
                "latitude": value.lat,
                "value_c": value.normal_c,
            }
            for value in values
        ],
    }
    write_text_atomic(path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def observed_slot_files_exist(out_dir: Path, slot_id: str) -> bool:
    return all(
        (out_dir / f"observed_{slot_id}_anomaly_{period_suffix(period)}.csv").exists()
        for period in ["normal", "30", "20", "10", "5", "3"]
    )


def reusable_station_reference_count(out_dir: Path, slot_id: str) -> int:
    path = station_reference_path(out_dir, slot_id)
    if not path.exists():
        return 0
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return 0
    declared_count = int(payload.get("station_count") or 0)
    actual_count = len(payload.get("stations") or [])
    return min(declared_count, actual_count)


def load_saved_slot_observed_grid(out_dir: Path, slot_id: str, expected_count: int) -> np.ndarray | None:
    path = out_dir / f"observed_{slot_id}_anomaly_30y.csv"
    if not path.exists():
        return None
    values: list[float] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            value = row.get("observed_c", "")
            if value == "":
                return None
            values.append(float(value))
    if len(values) != expected_count:
        return None
    return np.array(values)


def build(args: argparse.Namespace) -> None:
    latest = parse_latest_time(fetch_text(LATEST_TIME_URL))
    amedas_table = load_amedas_table(args.out_dir, latest)
    station_inventory = load_station_inventory(args.station_inventory)
    if args.backfill_series_only:
        backfill_station_timeseries(
            args.out_dir / "observed_realtime_station_timeseries.json",
            latest,
            amedas_table,
            args.days + 1,
            args.backfill_workers,
        )
        station_series = json.loads(
            (args.out_dir / "observed_realtime_station_timeseries.json").read_text(encoding="utf-8")
        )
        race_payload = write_temperature_race_archive(
            args.out_dir / "observed_daily_max_race.json",
            station_series,
            latest,
            station_inventory,
            amedas_table,
            day_count=args.days,
        )
        write_temperature_race_delivery(args.out_dir, race_payload)
        return
    index = load_index(args.index)
    latest_payload = fetch_json(AMEDAS_MAP_URL.format(time_key=time_key(latest)))
    latest_observations, latest_observation_rows = build_latest_station_observations(
        latest, latest_payload, amedas_table
    )
    latest_json_name = "observed_realtime_station_observations.json"
    latest_csv_name = "observed_realtime_station_observations.csv"
    write_text_atomic(args.out_dir / latest_json_name, json.dumps(latest_observations, ensure_ascii=False, separators=(",", ":")))
    write_station_observations_csv(args.out_dir / latest_csv_name, latest_observation_rows)
    latest, records = collect_station_extremes(latest, index, amedas_table, args.out_dir, args.max_steps)
    grid_points_2d = load_grid_points(args.out_dir)
    grid_points = [(lon, lat, 0.0) for lon, lat in grid_points_2d]
    periods = ["normal", "30", "20", "10", "5", "3"]
    amedas_ids = set(amedas_table)
    region_by_station_key = {}
    for matches in station_inventory.values():
        for row in matches:
            amedas_id = nearest_amedas_id(row, amedas_table, amedas_ids)
            if amedas_id:
                region_by_station_key[amedas_id] = str(row.get("prefecture") or "")
    source_date = latest.date().isoformat()
    latest_label = latest.isoformat()

    value_grids = {
        "temp": idw_values(grid_points, make_station_values(records, "current")),
        "max": idw_values(grid_points, make_station_values(records, "max")),
        "min": idw_values(grid_points, make_station_values(records, "min")),
    }

    station_series_path = args.out_dir / "observed_realtime_station_timeseries.json"
    station_series = {
        "generated_at": datetime.now(JST).isoformat(),
        "latest_time": latest.isoformat(),
        "source": "JMA AMeDAS data/map 10-minute observations, station time series from saved refresh",
        "stations": [
            {
                "station_key": str(record["station_key"]),
                "name": str(record["name"]),
                "region": str(record["region"] or region_by_station_key.get(str(record["station_key"]), "")),
                "longitude": float(record["lon"]),
                "latitude": float(record["lat"]),
                "series": record.get("series", []),
            }
            for record in records.values()
            if record.get("series")
        ],
    }
    if station_series_path.exists():
        existing = json.loads(station_series_path.read_text(encoding="utf-8"))
        existing_by_key = {str(item.get("station_key")): item for item in existing.get("stations", [])}
        # Minimum-temperature animations start at 18:00 on the preceding day,
        # so retain one extra day behind the seven selectable target dates.
        cutoff = latest - timedelta(days=max(1, args.days + 1))
        for station in station_series["stations"]:
            previous = existing_by_key.get(str(station["station_key"]), {})
            by_time = {
                str(time_value): value
                for time_value, value in previous.get("series", [])
                if datetime.fromisoformat(str(time_value)).astimezone(JST) >= cutoff
            }
            for time_value, value in station["series"]:
                by_time[str(time_value)] = value
            station["series"] = [
                [time_value, by_time[time_value]]
                for time_value in sorted(by_time)
            ]
    write_text_atomic(station_series_path, json.dumps(station_series, ensure_ascii=False, separators=(",", ":")))
    race_payload = write_temperature_race_archive(
        args.out_dir / "observed_daily_max_race.json",
        station_series,
        latest,
        station_inventory,
        amedas_table,
        day_count=args.days,
    )
    race_delivery = write_temperature_race_delivery(args.out_dir, race_payload)

    rows = build_rows(
        grid_points_2d,
        value_grids["temp"],
        None,
        None,
        source_date,
        latest_label,
        "value",
    )
    write_csv(args.out_dir / "observed_temp_value_30y.csv", rows)

    manifest_path = args.out_dir / "observed_realtime_manifest.json"
    existing_manifest = {}
    if manifest_path.exists():
        try:
            existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing_manifest = {}
    existing_sources = {
        str(slot.get("id")): str(slot.get("source"))
        for slot in existing_manifest.get("slots") or []
    }
    can_reuse_corrected_daily = int(existing_manifest.get("generator_version") or 0) >= 2
    last_daily_refresh = str(existing_manifest.get("daily_refresh_date") or "")
    slots = []
    official_station_count = 0
    latest_date = latest.date()
    observed_latest_text = index.get("current_year", {}).get("latest_date")
    observed_latest = datetime.strptime(observed_latest_text, "%Y-%m-%d").date() if observed_latest_text else None
    realtime_previous_grids = {}
    previous_date = latest_date - timedelta(days=1)
    if observed_latest and previous_date <= observed_latest:
        for element in ["max", "min"]:
            previous_values = load_daily_station_values(args.index, args.station_dir, element, previous_date)
            if previous_values:
                realtime_previous_grids[element] = idw_values(grid_points, previous_values)
    else:
        for element in ["max", "min"]:
            saved_slot_id = f"{previous_date.strftime('%Y%m%d')}_{element}"
            saved_grid = load_saved_slot_observed_grid(args.out_dir, saved_slot_id, len(grid_points_2d))
            if saved_grid is not None:
                realtime_previous_grids[element] = saved_grid
    for offset in range(args.days - 1, -1, -1):
        target_date = latest_date - timedelta(days=offset)
        for element in ["min", "max"]:
            slot_id = f"{target_date.strftime('%Y%m%d')}_{element}"
            target_label = latest_label if target_date == latest_date else target_date.isoformat()
            if (
                target_date < latest_date
                and can_reuse_corrected_daily
                and last_daily_refresh == latest_date.isoformat()
                and existing_sources.get(slot_id) == "daily"
                and observed_slot_files_exist(args.out_dir, slot_id)
                and station_reference_path(args.out_dir, slot_id).exists()
                and reusable_station_reference_count(args.out_dir, slot_id) >= 800
            ):
                reference_path = station_reference_path(args.out_dir, slot_id)
                reference_payload = json.loads(reference_path.read_text(encoding="utf-8"))
                slots.append({
                    "id": slot_id,
                    "label": short_slot_label(target_date, element),
                    "element": element,
                    "target_date": target_date.isoformat(),
                    "target_time": target_date.isoformat(),
                    "status": "available",
                    "source": "daily",
                    "station_reference": reference_path.name,
                    "station_reference_count": int(reference_payload.get("station_count") or 0),
                    "previous_comparison_date": (target_date - timedelta(days=1)).isoformat(),
                    "previous_comparison_source": "observed_daily",
                    "previous_comparison_method": "jma_mdrr_previous_difference",
                })
                continue
            skip_write = False
            official_normal_average_grid = None
            station_reference_values: list[RealtimeStationValue] = []
            previous_comparison_source = ""
            previous_comparison_method = ""
            try:
                official = fetch_daily_station_values(target_date, element, station_inventory)
            except Exception as exc:
                print(f"warning: failed to fetch JMA MDRR all-station table for {slot_id}: {exc}")
                official = {"value": [], "anomaly": [], "previous": []}
            if official["value"]:
                station_reference_values = official["value"]
                official_station_count = max(official_station_count, len(official["value"]))
                grid = idw_values(grid_points, official["value"])
                if official["anomaly"]:
                    anomaly_grid = idw_values(grid_points, official["anomaly"])
                    official_normal_average_grid = grid - anomaly_grid
                if official["previous"]:
                    previous_diff_grid = idw_values(grid_points, official["previous"])
                    previous_grid = grid - previous_diff_grid
                    previous_comparison_source = "observed_daily"
                    previous_comparison_method = "jma_mdrr_previous_difference"
                else:
                    previous_grid = realtime_previous_grids.get(element) if target_date == latest_date else None
                    if previous_grid is not None:
                        previous_comparison_source = (
                            "observed_daily"
                            if observed_latest and target_date - timedelta(days=1) <= observed_latest
                            else "observed_realtime"
                        )
                        previous_comparison_method = "difference_of_observed_grids"
                source = "realtime" if target_date == latest_date else "daily"
            elif target_date == latest_date:
                station_reference_values = make_station_values(records, element)
                grid = value_grids[element]
                previous_grid = realtime_previous_grids.get(element)
                if previous_grid is not None:
                    previous_comparison_source = (
                        "observed_daily"
                        if observed_latest and target_date - timedelta(days=1) <= observed_latest
                        else "observed_realtime"
                    )
                    previous_comparison_method = "difference_of_observed_grids"
                source = "realtime"
            elif observed_latest and target_date <= observed_latest:
                station_values = load_daily_station_values(args.index, args.station_dir, element, target_date)
                if not station_values:
                    continue
                station_reference_values = station_values
                previous_values = load_daily_station_values(args.index, args.station_dir, element, target_date - timedelta(days=1))
                grid = idw_values(grid_points, station_values)
                if previous_values:
                    previous_grid = idw_values(grid_points, previous_values)
                    previous_comparison_source = "observed_daily"
                    previous_comparison_method = "difference_of_observed_grids"
                else:
                    previous_slot_id = f"{(target_date - timedelta(days=1)).strftime('%Y%m%d')}_{element}"
                    previous_grid = load_saved_slot_observed_grid(args.out_dir, previous_slot_id, len(grid_points_2d))
                    if previous_grid is not None:
                        previous_comparison_source = "observed_realtime"
                        previous_comparison_method = "difference_of_observed_grids"
                source = "daily"
            elif observed_slot_files_exist(args.out_dir, slot_id):
                grid = None
                previous_grid = None
                source = "saved_realtime"
                skip_write = True
            else:
                continue
            if not skip_write:
                if station_reference_values:
                    write_station_reference(
                        station_reference_path(args.out_dir, slot_id),
                        station_reference_values,
                        target_date,
                        element,
                        source,
                    )
                write_observed_grid_set(
                    args=args,
                    grid_points_2d=grid_points_2d,
                    grid_points=grid_points,
                    value_grid=grid,
                    element=element,
                    target_date=target_date,
                    target_label=target_label,
                    previous_grid=previous_grid,
                    official_normal_average_grid=official_normal_average_grid,
                    periods=periods,
                    slot_id=slot_id,
                )
            slots.append(
                {
                    "id": slot_id,
                    "label": short_slot_label(target_date, element),
                    "element": element,
                    "target_date": target_date.isoformat(),
                    "target_time": target_label,
                    "status": "available",
                    "source": source,
                    "station_reference": station_reference_path(args.out_dir, slot_id).name
                    if station_reference_path(args.out_dir, slot_id).exists() else "",
                    "station_reference_count": len(station_reference_values),
                    "previous_comparison_date": (target_date - timedelta(days=1)).isoformat()
                    if previous_grid is not None else "",
                    "previous_comparison_source": previous_comparison_source,
                    "previous_comparison_method": previous_comparison_method,
                }
            )

    manifest = {
        "generator_version": 11,
        "generated_at": datetime.now(JST).isoformat(),
        "latest_time": latest.isoformat(),
        "source": "JMA AMeDAS latest_time.txt / data/map/{YYYYMMDDHHMM00}.json 10-minute observations",
        "realtime_layers": {
            "station_observations": {
                "json": latest_json_name,
                "csv": latest_csv_name,
                "latest_time": latest_observations["latest_time"],
                "station_count": latest_observations["station_count"],
                "elements": latest_observations["elements"],
                "quality_fields": "JMA raw numeric quality codes",
            },
            "temperature_races": {
                "json": "observed_daily_max_race.json",
                "delivery_schema": race_delivery["schema_version"],
                "index_json": race_delivery["index_json"],
                "index_sha256": race_delivery["index_sha256"],
                "index_bytes": race_delivery["index_bytes"],
                "index_history": race_delivery["index_history"],
                "slice_count": race_delivery["slice_count"],
                "total_slice_bytes": race_delivery["total_slice_bytes"],
                "maximum_slice_bytes": race_delivery["maximum_slice_bytes"],
                "stations_json": race_delivery["stations_json"],
                "stations_bytes": race_delivery["stations_bytes"],
                "dates": race_payload["dates"],
                "elements": race_payload["elements"],
                "latest_time": race_payload["latest_time"],
                "frame_interval_minutes": race_payload["frame_interval_minutes"],
                "top_n": race_payload["top_n"],
                "station_count": race_payload["station_population"],
                "method": "hybrid_10minute_running_extreme_plus_jma_published_daily_extreme",
                "maximum_window": "00:00-23:50; current day through latest observation",
                "minimum_window": "previous day 18:00-target day 09:00",
            },
            "daily_max_race": {
                "json": "observed_daily_max_race.json",
                "delivery_schema": race_delivery["schema_version"],
                "index_json": race_delivery["index_json"],
                "index_history": race_delivery["index_history"],
                "dates": race_payload["dates"],
                "elements": race_payload["elements"],
                "latest_time": race_payload["latest_time"],
                "frame_interval_minutes": race_payload["frame_interval_minutes"],
                "top_n": race_payload["top_n"],
                "station_count": race_payload["station_population"],
                "method": "hybrid_10minute_running_extreme_plus_jma_published_daily_extreme",
            },
        },
        "daily_distribution_source": "JMA MDRR all-station max/min tables, IDW interpolated to the display grid",
        "days": args.days,
        "slots": slots,
        "station_count": max(len(records), official_station_count),
        "realtime_timeseries_station_count": len(records),
        "daily_distribution_station_count": max(len(records), official_station_count),
        "grid_count": len(grid_points_2d),
        "quality_policy": "Raw station feed retains JMA quality codes; 10-minute interpolation and extrema use quality code 0 only. Ranking corrections use JMA MDRR's published daily maximum/minimum and occurrence minute while retaining provisional markers. Other MDRR grid values marked ] or ) remain excluded.",
        "daily_refresh_date": latest_date.isoformat(),
    }
    write_text_atomic(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    parser.add_argument("--station-dir", type=Path, default=STATION_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--station-inventory", type=Path, default=STATION_INVENTORY)
    parser.add_argument("--max-steps", type=int, default=0, help="Limit 10-minute files, for tests. 0 means from midnight.")
    parser.add_argument("--days", type=int, default=7, help="Observed min/max days to expose in the timeline and point chart, including today.")
    parser.add_argument("--backfill-series-only", action="store_true", help="Backfill only the 10-minute station time series for the requested number of days.")
    parser.add_argument("--backfill-workers", type=int, default=8, help="Parallel JMA requests used by --backfill-series-only.")
    return parser.parse_args()


def main() -> None:
    build(parse_args())


if __name__ == "__main__":
    main()
