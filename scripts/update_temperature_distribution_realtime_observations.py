#!/usr/bin/env python3
"""Build near-real-time observed temperature grids from JMA AMeDAS 10-minute JSON."""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
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


JST = ZoneInfo("Asia/Tokyo")
OUT_DIR = Path("outputs/weather/temperature_distribution_tool")
LATEST_TIME_URL = "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt"
AMEDAS_TABLE_URL = "https://www.jma.go.jp/bosai/amedas/const/amedastable.json"
AMEDAS_MAP_URL = "https://www.jma.go.jp/bosai/amedas/data/map/{time_key}.json"
MDRR_ALLTABLE_URL = "https://www.data.jma.go.jp/stats/data/mdrr/tem_rct/alltable/{code}{mmdd}.html"
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
    match = re.search(r"[+-]?\d+(?:\.\d+)?", value or "")
    return float(match.group(0)) if match else None


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


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode("utf-8")


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
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


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
    times = []
    current = start
    while current <= latest:
        times.append(current)
        current += timedelta(minutes=10)
    if max_steps > 0:
        times = times[-max_steps:]

    values: dict[str, dict[str, float | str]] = {}
    for value_time in times:
        payload = fetch_json(AMEDAS_MAP_URL.format(time_key=time_key(value_time)))
        for amedas_id, observation in payload.items():
            temp = observation.get("temp")
            if not isinstance(temp, list) or not temp or temp[0] is None:
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


def observed_slot_files_exist(out_dir: Path, slot_id: str) -> bool:
    return all(
        (out_dir / f"observed_{slot_id}_anomaly_{period_suffix(period)}.csv").exists()
        for period in ["normal", "30", "20", "10", "5", "3"]
    )


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
    index = load_index(args.index)
    amedas_table = fetch_json(AMEDAS_TABLE_URL)
    latest_payload = fetch_json(AMEDAS_MAP_URL.format(time_key=time_key(latest)))
    latest_observations, latest_observation_rows = build_latest_station_observations(
        latest, latest_payload, amedas_table
    )
    latest_json_name = "observed_realtime_station_observations.json"
    latest_csv_name = "observed_realtime_station_observations.csv"
    (args.out_dir / latest_json_name).write_text(
        json.dumps(latest_observations, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    write_station_observations_csv(args.out_dir / latest_csv_name, latest_observation_rows)
    latest, records = collect_station_extremes(latest, index, amedas_table, args.out_dir, args.max_steps)
    grid_points_2d = load_grid_points(args.out_dir)
    grid_points = [(lon, lat, 0.0) for lon, lat in grid_points_2d]
    periods = ["normal", "30", "20", "10", "5", "3"]
    station_inventory = load_station_inventory(args.station_inventory)
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
                "region": str(record["region"]),
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
        cutoff = latest - timedelta(days=max(1, args.days))
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
    station_series_path.write_text(
        json.dumps(station_series, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

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
                and existing_sources.get(slot_id) == "daily"
                and observed_slot_files_exist(args.out_dir, slot_id)
            ):
                slots.append({
                    "id": slot_id,
                    "label": short_slot_label(target_date, element),
                    "element": element,
                    "target_date": target_date.isoformat(),
                    "target_time": target_date.isoformat(),
                    "status": "available",
                    "source": "daily",
                })
                continue
            skip_write = False
            official_normal_average_grid = None
            try:
                official = fetch_daily_station_values(target_date, element, station_inventory)
            except Exception as exc:
                print(f"warning: failed to fetch JMA MDRR all-station table for {slot_id}: {exc}")
                official = {"value": [], "anomaly": [], "previous": []}
            if official["value"]:
                official_station_count = max(official_station_count, len(official["value"]))
                grid = idw_values(grid_points, official["value"])
                if official["anomaly"]:
                    anomaly_grid = idw_values(grid_points, official["anomaly"])
                    official_normal_average_grid = grid - anomaly_grid
                if official["previous"]:
                    previous_diff_grid = idw_values(grid_points, official["previous"])
                    previous_grid = grid - previous_diff_grid
                else:
                    previous_grid = realtime_previous_grids.get(element) if target_date == latest_date else None
                source = "realtime" if target_date == latest_date else "daily"
            elif target_date == latest_date:
                grid = value_grids[element]
                previous_grid = realtime_previous_grids.get(element)
                source = "realtime"
            elif observed_latest and target_date <= observed_latest:
                station_values = load_daily_station_values(args.index, args.station_dir, element, target_date)
                if not station_values:
                    continue
                previous_values = load_daily_station_values(args.index, args.station_dir, element, target_date - timedelta(days=1))
                grid = idw_values(grid_points, station_values)
                if previous_values:
                    previous_grid = idw_values(grid_points, previous_values)
                else:
                    previous_slot_id = f"{(target_date - timedelta(days=1)).strftime('%Y%m%d')}_{element}"
                    previous_grid = load_saved_slot_observed_grid(args.out_dir, previous_slot_id, len(grid_points_2d))
                source = "daily"
            elif observed_slot_files_exist(args.out_dir, slot_id):
                grid = None
                previous_grid = None
                source = "saved_realtime"
                skip_write = True
            else:
                continue
            if not skip_write:
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
            if target_date == latest_date:
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
                    slot_id=None,
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
                }
            )

    manifest = {
        "generator_version": 3,
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
            }
        },
        "daily_distribution_source": "JMA MDRR all-station max/min tables, IDW interpolated to the display grid",
        "days": args.days,
        "slots": slots,
        "station_count": max(len(records), official_station_count),
        "realtime_timeseries_station_count": len(records),
        "daily_distribution_station_count": max(len(records), official_station_count),
        "grid_count": len(grid_points_2d),
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    parser.add_argument("--station-dir", type=Path, default=STATION_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--station-inventory", type=Path, default=STATION_INVENTORY)
    parser.add_argument("--max-steps", type=int, default=0, help="Limit 10-minute files, for tests. 0 means from midnight.")
    parser.add_argument("--days", type=int, default=7, help="Observed min/max days to expose in the timeline and point chart, including today.")
    return parser.parse_args()


def main() -> None:
    build(parse_args())


if __name__ == "__main__":
    main()
