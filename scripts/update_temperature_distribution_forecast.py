#!/usr/bin/env python3
"""Refresh JMA weather-distribution forecast CSVs for the local map prototype."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import numpy as np

from build_temperature_distribution_tool_data import (
    OUT_DIR,
    day_key_from_date,
    idw_values,
    load_index,
    load_station_values,
    write_csv,
)
from create_jma_wdist_max_temp_anomaly_map import (
    INDEX_PATH,
    STATION_DIR,
    TARGET_TIMES_URL,
WDIST_GEOJSON_URL,
    day_key_from_validtime,
    fetch_json,
    idw_normals_for_points,
    load_forecast_points,
    load_station_normals,
    parse_jma_time,
    StationNormal,
)

JST = ZoneInfo("Asia/Tokyo")
PERIODS = ["normal", "30", "20", "10", "5", "3"]
USER_AGENT = "NatureWxLab-TemperatureDistribution/0.2"
RAW_FORECAST_DIR = Path("outputs/weather/jma_wdist_temperature_maps")
FORECAST_AREA_URL = "https://www.jma.go.jp/bosai/forecast/const/forecast_area.json"
AREA_CONST_URL = "https://www.jma.go.jp/bosai/common/const/area.json"
VPFD_URL = "https://www.jma.go.jp/bosai/jmatile/data/wdist/VPFD/{class10}.json"
AMEDAS_TABLE_URL = "https://www.jma.go.jp/bosai/amedas/const/amedastable.json"
MIN_DAILY_REFERENCE_STATIONS = 800
WDIST_SURF_GEOJSON_URL = (
    "https://www.jma.go.jp/bosai/jmatile/data/wdist/"
    "{basetime}/{member}/{validtime}/surf/{element}/data.geojson?id={element}"
)


def period_suffix(period: str) -> str:
    return "normal" if period == "normal" else f"{period}y"


def write_text_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def fetch_json_fresh(url: str, attempts: int = 5) -> object:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    retryable_http = {404, 408, 425, 429, 500, 502, 503, 504}
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(request, timeout=30) as response:
                payload = response.read()
                if response.headers.get("Content-Encoding") == "gzip" or payload[:2] == b"\x1f\x8b":
                    payload = gzip.decompress(payload)
            return json.loads(payload.decode("utf-8"))
        except HTTPError as error:
            if error.code not in retryable_http or attempt >= attempts:
                raise
            reason = f"HTTP {error.code}"
        except (TimeoutError, URLError, ConnectionError) as error:
            if attempt >= attempts:
                raise
            reason = str(error)
        delay = 2 ** (attempt - 1)
        print(f"JMA fetch retry {attempt}/{attempts} after {reason}: {url} (sleep {delay}s)", flush=True)
        time.sleep(delay)
    raise RuntimeError(f"JMA fetch retries exhausted: {url}")


def latlon_decimal(parts: list[float | int]) -> float:
    return float(parts[0]) + float(parts[1]) / 60.0


def find_target(target_times: list[dict[str, object]], target_date, element: str) -> dict[str, str] | None:
    point_name = f"{element}_temp_point"
    matches = [
        item
        for item in target_times
        if point_name in item.get("elements", [])
        and parse_jma_time(str(item["validtime"])).date() == target_date
    ]
    if not matches:
        return None
    selected = max(matches, key=lambda item: str(item["validtime"]))
    return {
        "basetime": str(selected["basetime"]),
        "validtime": str(selected["validtime"]),
        "member": str(selected.get("member", "none")),
        "element": f"{element}_temp",
    }


def cached_slot_matches(out_dir: Path, slot_id: str, target_date) -> bool:
    path = out_dir / f"forecast_{slot_id}_value_30y.csv"
    if not path.exists():
        return False
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            row = next(csv.DictReader(handle), None)
    except (OSError, StopIteration):
        return False
    return bool(row and row.get("target_date") == target_date.isoformat())


def raw_cache_exists(slot_id: str, element: str, target_date, raw_dir: Path) -> bool:
    return (raw_dir / f"jma_wdist_{element}_temp_value_{target_date.isoformat()}_30y.csv").exists()


def stale_message(slot_id: str) -> str:
    if slot_id == "today_min":
        return "予測対象時刻を過ぎているため、実況の最低気温を参照ください。"
    if slot_id == "today_max":
        return "予測対象時刻を過ぎているため、実況の最高気温を参照ください。"
    return "JMA天気分布予報の最新対象時刻を過ぎています。必要に応じて実況も確認してください。"


def missing_message(slot_id: str) -> str:
    if slot_id == "today_min":
        return "予測対象時刻を過ぎているため、実況の最低気温を参照ください。"
    if slot_id == "today_max":
        return "予測対象時刻を過ぎているため、実況の最高気温を参照ください。"
    return "JMA天気分布予報に該当する予測値がありません。"


def is_past_slot(slot_id: str, now: datetime) -> bool:
    return slot_id == "today_min" or (slot_id == "today_max" and now.hour >= 14)


def station_difference_values(
    forecast_points: list[tuple[float, float, float]],
    references,
) -> list[StationNormal]:
    """Calculate differences at common locations before spatial interpolation.

    Subtracting two independently interpolated absolute-temperature surfaces
    leaves forecast terrain effects in the difference field. Sampling the JMA
    forecast at each reference station, taking the difference there, and only
    then interpolating removes that artificial mountain signature.
    """
    if not forecast_points or not references:
        return []
    forecast_lons = np.array([point[0] for point in forecast_points], dtype=np.float32)
    forecast_lats = np.array([point[1] for point in forecast_points], dtype=np.float32)
    forecast_values = np.array([point[2] for point in forecast_points], dtype=np.float32)
    differences: list[StationNormal] = []
    for reference in references:
        cos_lat = math.cos(math.radians(reference.lat))
        dist2 = ((forecast_lons - reference.lon) * cos_lat) ** 2 + (forecast_lats - reference.lat) ** 2
        nearest = int(np.argmin(dist2))
        if float(dist2[nearest]) > 0.12**2:
            continue
        differences.append(StationNormal(
            station_key=reference.station_key,
            name=reference.name,
            region=reference.region,
            lon=reference.lon,
            lat=reference.lat,
            normal_c=float(forecast_values[nearest]) - float(reference.normal_c),
        ))
    return differences


def load_previous_forecast_grid(
    out_dir: Path,
    slot_ids: str | list[str] | tuple[str, ...],
    target_date,
    forecast_points: list[tuple[float, float, float]],
) -> tuple[np.ndarray | None, str]:
    """Load the preceding day's forecast on the identical display grid."""
    candidates = [slot_ids] if isinstance(slot_ids, str) else list(slot_ids)
    failures: list[str] = []
    for slot_id in candidates:
        path = out_dir / f"forecast_{slot_id}_anomaly_30y.csv"
        if not path.exists():
            failures.append(f"{slot_id}:file_missing")
            continue
        values: list[float] = []
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        if len(rows) != len(forecast_points):
            failures.append(f"{slot_id}:grid_row_count_mismatch")
            continue
        mismatch = False
        for row, (lon, lat, _) in zip(rows, forecast_points):
            if row.get("target_date") != target_date.isoformat() or row.get("forecast_c") in (None, ""):
                failures.append(f"{slot_id}:target_date_or_value_mismatch")
                mismatch = True
                break
            if abs(float(row["longitude"]) - lon) > 0.001 or abs(float(row["latitude"]) - lat) > 0.001:
                failures.append(f"{slot_id}:grid_coordinate_mismatch")
                mismatch = True
                break
            values.append(float(row["forecast_c"]))
        if not mismatch:
            return np.array(values), f"matched:{slot_id}"
    return None, ";".join(failures) or "previous_forecast_file_missing"


def should_use_previous_forecast(slot_id: str, previous_slot: dict[str, object] | None) -> bool:
    if not slot_id.startswith("tomorrow_"):
        return False
    # A new forecast cycle can start after today's minimum slot has become
    # unavailable. The previous cycle's tomorrow_min file is still the only
    # valid same-forecast comparison candidate at that rollover.
    if slot_id == "tomorrow_min":
        return True
    # For maximum temperature, once today's forecast slot has expired, the
    # comparison must switch to today's observation. Reusing the cached
    # forecast_today_max file after the cutoff would make the evening view
    # "tomorrow forecast - today forecast" instead of the required
    # "tomorrow forecast - today observation".
    return bool(previous_slot and previous_slot.get("status") == "available")


def load_observed_station_reference(
    out_dir: Path,
    target_date,
    element: str,
) -> list[StationNormal]:
    path = out_dir / f"observed_{target_date.strftime('%Y%m%d')}_{element}_station_values.json"
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("target_date") != target_date.isoformat() or payload.get("element") != element:
        return []
    return [
        StationNormal(
            station_key=str(row.get("station_key", "")),
            name=str(row.get("name", "")),
            region=str(row.get("region", "")),
            lon=float(row["longitude"]),
            lat=float(row["latitude"]),
            normal_c=float(row["value_c"]),
        )
        for row in payload.get("stations", [])
        if row.get("longitude") is not None and row.get("latitude") is not None and row.get("value_c") is not None
    ]


def observed_daily_station_reference_ready(
    out_dir: Path,
    target_date,
    element: str,
) -> bool:
    path = out_dir / f"observed_{target_date.strftime('%Y%m%d')}_{element}_station_values.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return False
    stations = payload.get("stations") or []
    try:
        declared_count = int(payload.get("station_count") or len(stations))
    except (TypeError, ValueError):
        return False
    return (
        payload.get("source") == "daily"
        and payload.get("target_date") == target_date.isoformat()
        and payload.get("element") == element
        and min(declared_count, len(stations)) >= MIN_DAILY_REFERENCE_STATIONS
    )


def make_slot(slot_id: str, label: str, element: str, target_date, target: dict[str, str] | None, now: datetime, out_dir: Path) -> dict[str, object]:
    past = is_past_slot(slot_id, now)
    if target is None:
        if cached_slot_matches(out_dir, slot_id, target_date) or raw_cache_exists(slot_id, element, target_date, RAW_FORECAST_DIR):
            return {
                "id": slot_id,
                "label": label,
                "element": element,
                "target_date": target_date.isoformat(),
                "status": "stale",
                "message": stale_message(slot_id),
            }
        return {
            "id": slot_id,
            "label": label,
            "element": element,
            "target_date": target_date.isoformat(),
            "status": "unavailable",
            "message": missing_message(slot_id),
        }
    return {
        "id": slot_id,
        "label": label,
        "element": element,
        "target_date": target_date.isoformat(),
        "basetime": target["basetime"],
        "validtime": target["validtime"],
        "status": "stale" if past else "available",
        "message": stale_message(slot_id) if past else "",
    }


def write_forecast_points(
    slot: dict[str, object],
    forecast_points: list[tuple[float, float, float]],
    validtime: str,
    args: argparse.Namespace,
    use_previous_forecast: bool = False,
) -> None:
    index = load_index(args.index)
    observed_latest = datetime.strptime(index["current_year"]["latest_date"], "%Y-%m-%d").date()
    target_date = parse_jma_time(validtime).date()
    previous_date = target_date - timedelta(days=1)
    previous_forecast_grid = None
    previous_forecast_reason = "not_requested"
    if use_previous_forecast:
        previous_forecast_grid, previous_forecast_reason = load_previous_forecast_grid(
            args.out_dir,
            [f"today_{slot['element']}", f"tomorrow_{slot['element']}"],
            previous_date,
            forecast_points,
        )
    if previous_forecast_grid is not None:
        previous_grid = previous_forecast_grid
        previous_diff_grid = np.array([point[2] for point in forecast_points]) - previous_grid
        slot["previous_comparison_source"] = "forecast"
        slot["previous_comparison_fallback_reason"] = ""
    elif previous_date <= observed_latest or observed_daily_station_reference_ready(
        args.out_dir, previous_date, str(slot["element"])
    ):
        previous_station_values = load_observed_station_reference(
            args.out_dir, previous_date, str(slot["element"])
        ) or load_station_values(args.index, args.station_dir, str(slot["element"]), previous_date)
        previous_differences = station_difference_values(forecast_points, previous_station_values)
        previous_diff_grid = idw_values(forecast_points, previous_differences)
        previous_grid = np.array([point[2] for point in forecast_points]) - previous_diff_grid
        slot["previous_comparison_source"] = "observed_daily"
        slot["previous_comparison_fallback_reason"] = previous_forecast_reason
    else:
        realtime_station_values = load_observed_station_reference(
            args.out_dir, previous_date, str(slot["element"])
        )
        if realtime_station_values:
            previous_differences = station_difference_values(forecast_points, realtime_station_values)
            previous_diff_grid = idw_values(forecast_points, previous_differences)
            previous_grid = np.array([point[2] for point in forecast_points]) - previous_diff_grid
        else:
            previous_path = args.out_dir / f"observed_{previous_date.strftime('%Y%m%d')}_{slot['element']}_anomaly_30y.csv"
            if not previous_path.exists():
                previous_path = args.out_dir / f"observed_{slot['element']}_anomaly_30y.csv"
            previous_values = []
            with previous_path.open("r", encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    previous_values.append(float(row["observed_c"]))
            previous_grid = np.array(previous_values)
            previous_diff_grid = np.array([point[2] for point in forecast_points]) - previous_grid
        slot["previous_comparison_source"] = "observed_realtime"
        slot["previous_comparison_fallback_reason"] = previous_forecast_reason
    slot["previous_comparison_date"] = previous_date.isoformat()

    for period in PERIODS:
        normals = load_station_normals(
            args.index,
            args.station_dir,
            day_key_from_validtime(validtime),
            period,
            str(slot["element"]),
        )
        normal_differences = station_difference_values(forecast_points, normals)
        anomaly_grid = idw_normals_for_points(forecast_points, normal_differences)
        average_grid = np.array([point[2] for point in forecast_points]) - anomaly_grid
        anomaly_rows = []
        for (lon, lat, forecast), average, previous, anomaly_value, previous_value in zip(
            forecast_points, average_grid, previous_grid, anomaly_grid, previous_diff_grid
        ):
            average_f = float(average)
            previous_f = float(previous)
            anomaly = float(anomaly_value)
            previous_diff = float(previous_value)
            common = {
                "longitude": f"{lon:.5f}",
                "latitude": f"{lat:.5f}",
                "forecast_c": f"{forecast:.2f}",
                "observed_c": "",
                "average_c": f"{average_f:.2f}",
                "anomaly_c": f"{anomaly:+.2f}",
                "previous_day_c": f"{previous_f:.2f}",
                "previous_diff_c": f"{previous_diff:+.2f}",
                "source_date": "",
                "target_date": target_date.isoformat(),
            }
            anomaly_rows.append({**common, "display_c": f"{anomaly:+.2f}"})
        write_csv(args.out_dir / f"forecast_{slot['id']}_anomaly_{period_suffix(period)}.csv", anomaly_rows)


def write_forecast_slot(
    slot: dict[str, object],
    target: dict[str, str],
    args: argparse.Namespace,
    use_previous_forecast: bool = False,
) -> None:
    forecast_url = WDIST_GEOJSON_URL.format(**target)
    forecast_payload = fetch_json_fresh(forecast_url)
    forecast_points = load_forecast_points(forecast_payload)
    if not forecast_points:
        raise RuntimeError(f"No forecast grid points found: {forecast_url}")
    write_forecast_points(slot, forecast_points, target["validtime"], args, use_previous_forecast)


def write_cached_raw_slot(slot: dict[str, object], target_date, args: argparse.Namespace) -> bool:
    period_path = RAW_FORECAST_DIR / f"jma_wdist_{slot['element']}_temp_value_{target_date.isoformat()}_30y.csv"
    if not period_path.exists():
        return False
    with period_path.open("r", encoding="utf-8-sig", newline="") as handle:
        points = [
            (float(row["longitude"]), float(row["latitude"]), float(row["forecast_c"]))
            for row in csv.DictReader(handle)
        ]
    validtime = f"{target_date.strftime('%Y%m%d')}{'000000' if slot['element'] == 'min' else '090000'}"
    write_forecast_points(slot, points, validtime, args)
    return True


def slot_time_label(validtime: str) -> str:
    dt = parse_jma_time(validtime)
    return f"{dt.day}日{dt.hour:02d}時"


def weather_interval_label(validtime: str) -> str:
    end = parse_jma_time(validtime)
    start = end - timedelta(hours=3)
    if start.date() == end.date():
        return f"{end.month}月{end.day}日{start.hour:02d}時〜{end.hour:02d}時"
    return f"{start.month}月{start.day}日{start.hour:02d}時〜{end.day}日{end.hour:02d}時"


def find_three_hour_targets(target_times: list[dict[str, object]], element: str, url_element: str | None = None) -> list[dict[str, str]]:
    targets = [
        {
            "basetime": str(item["basetime"]),
            "validtime": str(item["validtime"]),
            "member": str(item.get("member", "none")),
            "element": url_element or element,
        }
        for item in target_times
        if element in item.get("elements", [])
    ]
    return sorted(targets, key=lambda item: item["validtime"])


def write_three_hour_temp_slots(target_times: list[dict[str, object]], now: datetime, args: argparse.Namespace) -> list[dict[str, object]]:
    slots: list[dict[str, object]] = []
    for index, target in enumerate(find_three_hour_targets(target_times, "temp_point", "temp")):
        slot_id = f"temp3h_{target['validtime']}"
        slot = {
            "id": slot_id,
            "label": slot_time_label(target["validtime"]),
            "element": "temp",
            "target_date": parse_jma_time(target["validtime"]).date().isoformat(),
            "basetime": target["basetime"],
            "validtime": target["validtime"],
            "status": "stale" if parse_jma_time(target["validtime"]) < now else "available",
            "message": "予測対象時刻を過ぎています。必要に応じて実況も確認してください。" if parse_jma_time(target["validtime"]) < now else "",
        }
        url = WDIST_GEOJSON_URL.format(**target)
        payload = fetch_json_fresh(url)
        rows = []
        for lon, lat, value in load_forecast_points(payload):
            rows.append({
                "longitude": f"{lon:.5f}",
                "latitude": f"{lat:.5f}",
                "display_c": f"{value:.2f}",
                "forecast_c": f"{value:.2f}",
                "observed_c": "",
                "average_c": "",
                "anomaly_c": "",
                "previous_day_c": "",
                "previous_diff_c": "",
                "source_date": "",
                "target_date": slot["target_date"],
            })
        write_csv(args.out_dir / f"forecast_{slot_id}_value.csv", rows)
        slots.append(slot)
        print(f"wrote {slot_id} {slot['label']}")
    return slots


def write_three_hour_weather_slots(target_times: list[dict[str, object]], now: datetime, args: argparse.Namespace) -> list[dict[str, object]]:
    slots: list[dict[str, object]] = []
    for target in find_three_hour_targets(target_times, "wm"):
        slot_id = f"weather3h_{target['validtime']}"
        slot = {
            "id": slot_id,
            "label": slot_time_label(target["validtime"]),
            "element": "weather",
            "target_date": parse_jma_time(target["validtime"]).date().isoformat(),
            "basetime": target["basetime"],
            "validtime": target["validtime"],
            "interval_label": weather_interval_label(target["validtime"]),
            "status": "stale" if parse_jma_time(target["validtime"]) < now else "available",
            "message": "予測対象時刻を過ぎています。必要に応じて実況も確認してください。" if parse_jma_time(target["validtime"]) < now else "",
        }
        url = WDIST_SURF_GEOJSON_URL.format(**target)
        payload = fetch_json_fresh(url)
        path = args.out_dir / f"forecast_{slot_id}_value.geojson"
        write_text_atomic(path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        slots.append(slot)
        print(f"wrote {slot_id} {slot['label']}")
    return slots


def write_three_hour_polygon_slots(
    target_times: list[dict[str, object]],
    now: datetime,
    args: argparse.Namespace,
    source_element: str,
    layer_id: str,
    element_label: str,
) -> list[dict[str, object]]:
    slots: list[dict[str, object]] = []
    for target in find_three_hour_targets(target_times, source_element):
        slot_id = f"{layer_id}_{target['validtime']}"
        slot = {
            "id": slot_id,
            "label": slot_time_label(target["validtime"]),
            "element": layer_id,
            "target_date": parse_jma_time(target["validtime"]).date().isoformat(),
            "basetime": target["basetime"],
            "validtime": target["validtime"],
            "interval_label": weather_interval_label(target["validtime"]),
            "status": "stale" if parse_jma_time(target["validtime"]) < now else "available",
            "message": "予測対象時刻を過ぎています。必要に応じて実況も確認してください。" if parse_jma_time(target["validtime"]) < now else "",
        }
        url = WDIST_SURF_GEOJSON_URL.format(**target)
        payload = fetch_json_fresh(url)
        path = args.out_dir / f"forecast_{slot_id}_value.geojson"
        write_text_atomic(path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        slots.append(slot)
        print(f"wrote {slot_id} {slot['label']}")
    return slots


def write_vpfd_timeseries(args: argparse.Namespace) -> dict[str, object]:
    """Cache JMA VPFD regional time-series forecasts for local static use."""
    forecast_area = fetch_json_fresh(FORECAST_AREA_URL)
    area_const = fetch_json_fresh(AREA_CONST_URL)
    amedas_table = fetch_json_fresh(AMEDAS_TABLE_URL)
    class10_meta = area_const.get("class10s", {}) if isinstance(area_const, dict) else {}
    office_meta = area_const.get("offices", {}) if isinstance(area_const, dict) else {}
    station_to_class10: dict[str, str] = {}
    class10_points: list[dict[str, object]] = []
    class10_codes: set[str] = set()

    if isinstance(forecast_area, dict):
        for rows in forecast_area.values():
            if not isinstance(rows, list):
                continue
            for row in rows:
                class10 = str(row.get("class10", ""))
                if not class10:
                    continue
                class10_codes.add(class10)
                for amedas in row.get("amedas", []) or []:
                    amedas_id = str(amedas)
                    station_to_class10[amedas_id] = class10
                    item = amedas_table.get(amedas_id) if isinstance(amedas_table, dict) else None
                    if item and "lat" in item and "lon" in item:
                        class10_points.append({
                            "amedas": amedas_id,
                            "class10": class10,
                            "name": item.get("kjName", "") or item.get("knName", ""),
                            "latitude": latlon_decimal(item["lat"]),
                            "longitude": latlon_decimal(item["lon"]),
                        })

    cached = []
    for class10 in sorted(class10_codes):
        payload = fetch_json_fresh(VPFD_URL.format(class10=class10))
        write_text_atomic(args.out_dir / f"vpfd_{class10}.json", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        cached.append(class10)

    index = {
        "source": "JMA wdist VPFD regional time-series JSON",
        "station_to_class10": station_to_class10,
        "class10_points": class10_points,
        "class10": {
            code: {
                "name": class10_meta.get(code, {}).get("name", ""),
                "parent": class10_meta.get(code, {}).get("parent", ""),
                "parent_name": office_meta.get(class10_meta.get(code, {}).get("parent", ""), {}).get("name", ""),
            }
            for code in sorted(class10_codes)
        },
        "cached_class10": cached,
    }
    write_text_atomic(args.out_dir / "vpfd_index.json", json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote VPFD regional time-series: {len(cached)} areas")
    return index


def refresh(args: argparse.Namespace) -> None:
    now = datetime.now(JST)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    service_today = now.date() if now.hour >= args.rollover_hour else now.date() - timedelta(days=1)
    service_tomorrow = service_today + timedelta(days=1)
    target_times = fetch_json_fresh(TARGET_TIMES_URL)
    slots_plan = [
        ("today_min", f"{service_today.day}日最低", "min", service_today),
        ("today_max", f"{service_today.day}日最高", "max", service_today),
        ("tomorrow_min", f"{service_tomorrow.day}日最低", "min", service_tomorrow),
        ("tomorrow_max", f"{service_tomorrow.day}日最高", "max", service_tomorrow),
    ]
    slots = []
    for slot_id, label, element, target_date in slots_plan:
        target = find_target(target_times, target_date, element)
        slot = make_slot(slot_id, label, element, target_date, target, now, args.out_dir)
        slots.append(slot)
        if target is not None:
            previous_slot = next(
                (
                    candidate for candidate in reversed(slots[:-1])
                    if candidate.get("element") == element
                    and candidate.get("target_date") == (target_date - timedelta(days=1)).isoformat()
                ),
                None,
            )
            use_previous_forecast = should_use_previous_forecast(slot_id, previous_slot)
            write_forecast_slot(slot, target, args, use_previous_forecast)
            print(f"wrote {slot_id} {label}")
        elif slot["status"] == "stale" and write_cached_raw_slot(slot, target_date, args):
            print(f"wrote cached {slot_id} {label}")
        else:
            print(f"skipped {slot_id}: {slot['message']}")

    temp3h_slots = write_three_hour_temp_slots(target_times, now, args)
    weather3h_slots = write_three_hour_weather_slots(target_times, now, args)
    precip3h_slots = write_three_hour_polygon_slots(target_times, now, args, "r3", "precip3h", "3時間降水量")
    snow3h_slots = write_three_hour_polygon_slots(target_times, now, args, "s3", "snow3h", "3時間降雪量")
    vpfd_index = write_vpfd_timeseries(args)

    manifest = {
        "generated_at": now.isoformat(timespec="seconds"),
        "source": "JMA天気分布予報 targetTimes.json / *_temp_point / wm / r3 / s3 GeoJSON / VPFD地域時系列予報",
        "service_date": service_today.isoformat(),
        "daily_rollover_hour_jst": args.rollover_hour,
        "today_max_cutoff_hour_jst": 14,
        "slots": slots,
        "vpfd": {
            "index": "vpfd_index.json",
            "cached_class10_count": len(vpfd_index.get("cached_class10", [])),
        },
        "layers": {
            "daily": {
                "label": "日最低/最高",
                "data_type": "temperature",
                "slots": slots,
            },
            "temp3h": {
                "label": "3時間気温",
                "data_type": "temperature",
                "slots": temp3h_slots,
            },
            "weather3h": {
                "label": "3時間天気",
                "data_type": "weather",
                "slots": weather3h_slots,
            },
            "precip3h": {
                "label": "3時間降水量",
                "data_type": "precipitation",
                "slots": precip3h_slots,
            },
            "snow3h": {
                "label": "3時間降雪量",
                "data_type": "snowfall",
                "slots": snow3h_slots,
            },
        },
    }
    write_text_atomic(args.out_dir / "forecast_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    parser.add_argument("--station-dir", type=Path, default=STATION_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--rollover-hour", type=int, default=6, help="JST hour when the four-slot forecast day rolls over.")
    return parser.parse_args()


def main() -> None:
    refresh(parse_args())


if __name__ == "__main__":
    main()
