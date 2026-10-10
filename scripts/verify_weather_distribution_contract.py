#!/usr/bin/env python3
"""Fail a public refresh when any user-visible weather data contract is broken."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path


REQUIRED_FORECAST_LAYERS = {"daily", "temp3h", "weather3h", "precip3h", "snow3h"}
REQUIRED_SUIKEI_LAYERS = {"temperature", "weather", "sunshine"}
REQUIRED_RANKING_KEYS = {"max_high", "max_low", "min_low", "min_high"}
REQUIRED_PRIMARY_RECORD_UPDATE_KEYS = {
    "max_high_all_time",
    "max_high_monthly",
    "min_low_all_time",
    "min_low_monthly",
}
MIN_DAILY_REFERENCE_STATIONS = 800


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def observed_daily_reference_ready(data_dir: Path, slot: dict) -> bool:
    if slot.get("status") not in {"available", "stale"}:
        return False
    if str(slot.get("previous_comparison_source") or "") != "observed_realtime":
        return False
    element = str(slot.get("element") or "")
    if element not in {"max", "min"}:
        return False
    try:
        previous_date = datetime.fromisoformat(str(slot["target_date"])).date() - timedelta(days=1)
        payload = read(
            data_dir / f"observed_{previous_date.strftime('%Y%m%d')}_{element}_station_values.json"
        )
    except (KeyError, TypeError, ValueError, FileNotFoundError, json.JSONDecodeError, OSError):
        return False
    stations = payload.get("stations") or []
    try:
        declared_count = int(payload.get("station_count") or len(stations))
    except (TypeError, ValueError):
        return False
    return (
        payload.get("source") == "daily"
        and payload.get("target_date") == previous_date.isoformat()
        and payload.get("element") == element
        and min(declared_count, len(stations)) >= MIN_DAILY_REFERENCE_STATIONS
    )


def parse_time(value: str) -> datetime:
    if len(value) == 14 and value.isdigit():
        return datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def age_minutes(value: str) -> float:
    return (datetime.now(timezone.utc) - parse_time(value).astimezone(timezone.utc)).total_seconds() / 60


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def forecast_daily_record_months(forecast: dict) -> set[int]:
    """Historical record data is required only by usable daily ranking slots."""
    slots = (((forecast.get("layers") or {}).get("daily") or {}).get("slots") or [])
    months: set[int] = set()
    for slot in slots:
        if slot.get("status") not in {"available", "stale"}:
            continue
        try:
            months.add(datetime.fromisoformat(str(slot.get("target_date") or "")).month)
        except ValueError:
            continue
    return months


def station_record_coverage(station_records: dict, month: int) -> tuple[int, int]:
    stations = station_records.get("stations") or {}
    all_time_count = 0
    month_count = 0
    for station in stations.values():
        if not isinstance(station, dict):
            continue
        all_time = station.get("all_time") or {}
        monthly = (station.get("months") or {}).get(str(month)) or {}
        if all(
            bool(((all_time.get(element) or {}).get("records") or []))
            for element in ("max", "min")
        ):
            all_time_count += 1
        if all(
            bool(((monthly.get(element) or {}).get("records") or []))
            for element in ("max", "min")
        ):
            month_count += 1
    return all_time_count, month_count


def validate_forecast_previous_comparison_sources(
    forecast: dict,
    errors: list[str],
    data_dir: Path | None = None,
) -> None:
    slots = ((forecast.get("layers") or {}).get("daily") or {}).get("slots") or forecast.get("slots") or []
    if data_dir is not None:
        for slot in slots:
            if observed_daily_reference_ready(data_dir, slot):
                errors.append(
                    f"forecast {slot.get('id') or 'daily'} comparison source must promote to "
                    "observed_daily when daily reference is ready: observed_realtime"
                )
    today_max = next((slot for slot in slots if slot.get("id") == "today_max"), None)
    tomorrow_max = next((slot for slot in slots if slot.get("id") == "tomorrow_max"), None)
    if not tomorrow_max or tomorrow_max.get("status") not in {"available", "stale"}:
        return
    if today_max and today_max.get("status") == "available":
        return
    source = str(tomorrow_max.get("previous_comparison_source") or "")
    require(
        source in {"observed_daily", "observed_realtime"},
        f"tomorrow_max comparison source must be observed after today_max cutoff: {source or 'missing'}",
        errors,
    )
    try:
        expected_date = (datetime.fromisoformat(str(tomorrow_max["target_date"])).date() - timedelta(days=1)).isoformat()
    except (KeyError, TypeError, ValueError):
        expected_date = ""
    require(
        bool(expected_date) and tomorrow_max.get("previous_comparison_date") == expected_date,
        "tomorrow_max observed comparison date mismatch",
        errors,
    )


def ranking_occurrence_time(target_date: str, value: str) -> datetime | None:
    match = re.search(r"(\d{1,2}):(\d{2})", value or "")
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 24 or minute > 59:
        return None
    base = datetime.fromisoformat(f"{target_date}T00:00:00+09:00")
    return base + timedelta(days=1 if hour == 24 else 0, hours=hour % 24, minutes=minute)


def race_station_key_for_ranking(row: dict, race_stations: dict) -> str:
    station_name = str(row.get("station") or "")
    prefecture = str(row.get("prefecture") or "")
    named = [
        str(key)
        for key, station in race_stations.items()
        if str(station.get("name") or "") == station_name
        and str(station.get("prefecture") or "") == prefecture
    ]
    if len(named) == 1:
        return named[0]
    try:
        latitude = float(row["latitude"])
        longitude = float(row["longitude"])
    except (KeyError, TypeError, ValueError):
        return ""
    nearest_key = ""
    nearest_distance = math.inf
    for key, station in race_stations.items():
        try:
            dy = float(station["latitude"]) - latitude
            dx = (float(station["longitude"]) - longitude) * math.cos(math.radians(latitude))
        except (KeyError, TypeError, ValueError):
            continue
        distance = dx * dx + dy * dy
        if distance < nearest_distance:
            nearest_key = str(key)
            nearest_distance = distance
    return nearest_key if nearest_distance < 0.0001 else ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data/temperature_distribution_tool"))
    parser.add_argument("--observed-max-age-minutes", type=float, default=35)
    parser.add_argument("--forecast-max-age-hours", type=float, default=12)
    parser.add_argument("--suikei-max-age-hours", type=float, default=3)
    args = parser.parse_args()
    root = args.data_dir
    errors: list[str] = []

    observed = read(root / "observed_realtime_manifest.json")
    require(int(observed.get("generator_version") or 0) >= 11, "observed generator_version < 11", errors)
    require(int(observed.get("grid_count") or 0) == 31296, "observed grid_count != 31296", errors)
    require(int(observed.get("days") or 0) >= 7, "observed history days < 7", errors)
    require(len(observed.get("slots") or []) >= 14, "observed min/max slots < 14", errors)
    latest = str(observed.get("latest_time") or "")
    require(bool(latest) and age_minutes(latest) <= args.observed_max_age_minutes, "observed latest_time is stale", errors)
    temp_count = int((((observed.get("realtime_layers") or {}).get("station_observations") or {}).get("elements") or {}).get("temperature", {}).get("station_count") or 0)
    require(temp_count >= 900, "observed temperature stations < 900", errors)
    for slot in observed.get("slots") or []:
        slot_id = str(slot.get("id") or "")
        reference = str(slot.get("station_reference") or "")
        require(bool(reference), f"missing observed station reference: {slot_id}", errors)
        if not reference:
            continue
        reference_path = root / reference
        require(reference_path.is_file(), f"missing observed station reference file: {reference}", errors)
        if not reference_path.is_file():
            continue
        payload = read(reference_path)
        declared_count = int(payload.get("station_count") or 0)
        actual_count = len(payload.get("stations") or [])
        manifest_count = int(slot.get("station_reference_count") or 0)
        require(declared_count == actual_count, f"station reference count mismatch in file: {reference}", errors)
        require(manifest_count == actual_count, f"station reference count mismatch in manifest: {slot_id}", errors)
        require(actual_count >= 800, f"observed daily station reference < 800: {slot_id} ({actual_count})", errors)

    series = read(root / "observed_realtime_station_timeseries.json")
    station_spans = []
    for station in series.get("stations") or []:
        times = [str(item[0]) for item in station.get("series") or []]
        if not times:
            continue
        require(times == sorted(times), f"unsorted station series: {station.get('station_key')}", errors)
        require(len(times) == len(set(times)), f"duplicate station timestamps: {station.get('station_key')}", errors)
        station_spans.append((parse_time(times[-1]) - parse_time(times[0])).total_seconds() / 86400)
    full_span_count = sum(span >= 6.9 for span in station_spans)
    require(full_span_count >= 800, "station series with >= 6.9 days < 800", errors)

    race_meta = (observed.get("realtime_layers") or {}).get("temperature_races") or {}
    race_file = str(race_meta.get("json") or "")
    require(race_file == "observed_daily_max_race.json", "temperature race manifest file mismatch", errors)
    race_path = root / race_file if race_file else root / "observed_daily_max_race.json"
    require(race_path.is_file(), "temperature race file missing", errors)
    race = read(race_path) if race_path.is_file() else {}
    station_records_path = root / "temperature_station_records.json"
    require(station_records_path.is_file(), "temperature station record cache missing", errors)
    station_records = read(station_records_path) if station_records_path.is_file() else {}
    require(int(station_records.get("schema_version") or 0) == 1, "temperature station record schema_version != 1", errors)
    require(int(station_records.get("station_count") or 0) >= 900, "temperature station record count < 900", errors)
    require(int(race.get("schema_version") or 0) == 5, "temperature race schema_version != 5", errors)
    require(int(race.get("frame_interval_minutes") or 0) == 10, "temperature race interval != 10", errors)
    require(int(race.get("top_n") or 0) == 100, "temperature race top_n != 100", errors)
    require(int(race.get("station_population") or 0) >= 900, "temperature race station population < 900", errors)
    require(
        str(race_meta.get("method") or "") == "hybrid_10minute_running_extreme_plus_jma_published_daily_extreme",
        "temperature race hybrid method missing",
        errors,
    )
    require(str(race.get("latest_time") or "") == latest, "temperature race latest_time mismatch", errors)
    race_dates = [str(value) for value in race.get("dates") or []]
    require(len(race_dates) == 7, "temperature race date count != 7", errors)
    require(race_dates == sorted(race_dates) and len(set(race_dates)) == 7, "temperature race dates invalid", errors)
    latest_local_date = latest[:10] if latest else ""
    require(bool(race_dates) and race_dates[-1] == latest_local_date, "temperature race latest date mismatch", errors)
    require([str(value) for value in race_meta.get("dates") or []] == race_dates, "temperature race manifest dates mismatch", errors)
    race_stations = race.get("stations") or {}
    days_by_date = {str(day.get("date") or ""): day for day in race.get("days") or []}
    require(set(days_by_date) == set(race_dates), "temperature race day payload mismatch", errors)
    delivery_schema = int(race_meta.get("delivery_schema") or 0)
    require(delivery_schema == 1, "temperature race delivery_schema != 1", errors)
    race_index_file = str(race_meta.get("index_json") or "")
    race_index_path = root / race_index_file if race_index_file else root / "__missing_race_index__"
    require(bool(race_index_file) and race_index_path.is_file(), "temperature race index missing", errors)
    race_index = read(race_index_path) if race_index_path.is_file() else {}
    if race_index_path.is_file():
        index_bytes = race_index_path.read_bytes()
        require(
            len(index_bytes) == int(race_meta.get("index_bytes") or 0),
            "temperature race index byte count mismatch",
            errors,
        )
        require(
            hashlib.sha256(index_bytes).hexdigest() == str(race_meta.get("index_sha256") or ""),
            "temperature race index sha256 mismatch",
            errors,
        )
    require(int(race_index.get("schema_version") or 0) == 1, "temperature race index schema_version != 1", errors)
    require(str(race_index.get("latest_time") or "") == latest, "temperature race index latest_time mismatch", errors)
    require([str(value) for value in race_index.get("dates") or []] == race_dates, "temperature race index dates mismatch", errors)
    require([str(value) for value in race_index.get("elements") or []] == ["max", "min"], "temperature race index elements mismatch", errors)
    require(int(race_index.get("station_population") or 0) == len(race_stations), "temperature race index station count mismatch", errors)
    station_delivery = race_index.get("stations") or {}
    station_delivery_file = str(station_delivery.get("json") or "")
    station_delivery_path = root / station_delivery_file if station_delivery_file else root / "__missing_race_stations__"
    require(station_delivery_path.is_file(), "temperature race delivery stations missing", errors)
    station_delivery_payload = read(station_delivery_path) if station_delivery_path.is_file() else {}
    if station_delivery_path.is_file():
        station_delivery_bytes = station_delivery_path.read_bytes()
        require(
            len(station_delivery_bytes) == int(station_delivery.get("bytes") or 0),
            "temperature race delivery stations byte count mismatch",
            errors,
        )
        require(
            hashlib.sha256(station_delivery_bytes).hexdigest() == str(station_delivery.get("sha256") or ""),
            "temperature race delivery stations sha256 mismatch",
            errors,
        )
    require(
        station_delivery_payload.get("stations") == race_stations,
        "temperature race delivery stations differ from archive",
        errors,
    )
    index_history = [str(value) for value in race_meta.get("index_history") or []]
    require(bool(index_history) and index_history[0] == race_index_file, "temperature race index history current mismatch", errors)
    require(len(index_history) <= 3, "temperature race index history exceeds 3", errors)
    for history_file in index_history:
        require((root / history_file).is_file(), f"temperature race retained index missing: {history_file}", errors)
    delivery_slice_count = 0
    maximum_slice_bytes = 0
    for target_date in race_dates:
        for element in ("max", "min"):
            metadata = ((race_index.get("files") or {}).get(target_date) or {}).get(element) or {}
            slice_file = str(metadata.get("json") or "")
            slice_path = root / slice_file if slice_file else root / "__missing_race_slice__"
            prefix = f"{target_date} {element} delivery"
            require(slice_path.is_file(), f"{prefix} file missing", errors)
            if not slice_path.is_file():
                continue
            slice_bytes = slice_path.read_bytes()
            maximum_slice_bytes = max(maximum_slice_bytes, len(slice_bytes))
            require(len(slice_bytes) == int(metadata.get("bytes") or 0), f"{prefix} byte count mismatch", errors)
            require(
                hashlib.sha256(slice_bytes).hexdigest() == str(metadata.get("sha256") or ""),
                f"{prefix} sha256 mismatch",
                errors,
            )
            slice_payload = json.loads(slice_bytes)
            require(int(slice_payload.get("schema_version") or 0) == 1, f"{prefix} schema_version != 1", errors)
            require(str(slice_payload.get("date") or "") == target_date, f"{prefix} date mismatch", errors)
            require(str(slice_payload.get("element") or "") == element, f"{prefix} element mismatch", errors)
            require(
                slice_payload.get("race") == (days_by_date.get(target_date) or {}).get(element),
                f"{prefix} differs from archive",
                errors,
            )
            delivery_slice_count += 1
    require(delivery_slice_count == 14, "temperature race delivery slice count != 14", errors)
    require(int(race_meta.get("slice_count") or 0) == delivery_slice_count, "temperature race manifest slice count mismatch", errors)
    require(maximum_slice_bytes < 1_000_000, "temperature race delivery slice >= 1MB", errors)
    require(
        maximum_slice_bytes == int(race_meta.get("maximum_slice_bytes") or 0),
        "temperature race maximum slice byte count mismatch",
        errors,
    )
    race_frame_count = 0
    for target_date in race_dates:
        day = days_by_date.get(target_date) or {}
        for element in ("max", "min"):
            race_payload = day.get(element) or {}
            frames = race_payload.get("frames") or []
            race_frame_count += len(frames)
            frame_times = [str(frame.get("time") or "") for frame in frames]
            prefix = f"{target_date} {element} race"
            require(str(race_payload.get("date") or "") == target_date, f"{prefix} date mismatch", errors)
            require(str(race_payload.get("element") or "") == element, f"{prefix} element mismatch", errors)
            require(int(race_payload.get("frame_interval_minutes") or 0) == 10, f"{prefix} interval != 10", errors)
            require(int(race_payload.get("eligible_station_count") or 0) >= 800, f"{prefix} eligible stations < 800", errors)
            require(bool(frame_times) and frame_times == sorted(frame_times), f"{prefix} frames missing or unsorted", errors)
            require(len(frame_times) == len(set(frame_times)), f"{prefix} duplicate frame times", errors)
            require(bool(frame_times) and frame_times[0] == str(race_payload.get("window_start") or ""), f"{prefix} start mismatch", errors)
            require(bool(frame_times) and frame_times[-1] == str(race_payload.get("window_end") or ""), f"{prefix} end mismatch", errors)
            if frame_times:
                expected_frame_count = int((parse_time(frame_times[-1]) - parse_time(frame_times[0])).total_seconds() // 600) + 1
                require(len(frames) == expected_frame_count, f"{prefix} frame count mismatch", errors)
            official_events = race_payload.get("official_events") or []
            require(
                int(race_payload.get("official_correction_event_count") or 0) == len(official_events),
                f"{prefix} official correction count mismatch",
                errors,
            )
            frame_time_set = set(frame_times)
            for event_index, event in enumerate(official_events):
                station_key = str(event.get("station_key") or "")
                observed_time = str(event.get("observed_time") or "")
                correction_frame = str(event.get("frame_time") or "")
                require(station_key in race_stations, f"{prefix} official station missing: {event_index}", errors)
                require(bool(observed_time), f"{prefix} official observed time missing: {event_index}", errors)
                require(correction_frame in frame_time_set, f"{prefix} official frame missing: {event_index}", errors)
                if observed_time and correction_frame:
                    delay_seconds = (parse_time(correction_frame) - parse_time(observed_time)).total_seconds()
                    require(0 <= delay_seconds < 600, f"{prefix} official frame delay invalid: {event_index}", errors)
            final_rankings = race_payload.get("final_rankings") or []
            require(
                len(final_rankings) == int(race_payload.get("eligible_station_count") or 0),
                f"{prefix} full ranking count mismatch",
                errors,
            )
            final_keys = [
                str(row[0])
                for row in final_rankings
                if isinstance(row, list) and len(row) >= 11
            ]
            final_values = [
                float(row[1])
                for row in final_rankings
                if isinstance(row, list) and len(row) >= 11
            ]
            require(len(final_keys) == len(final_rankings), f"{prefix} malformed full ranking row", errors)
            require(len(final_keys) == len(set(final_keys)), f"{prefix} duplicate station in full ranking", errors)
            require(all(key in race_stations for key in final_keys), f"{prefix} full ranking station metadata missing", errors)
            require(
                final_values == sorted(final_values, reverse=element == "max"),
                f"{prefix} full ranking values unsorted",
                errors,
            )
            require(
                all(bool(str(row[2] or "")) for row in final_rankings if isinstance(row, list) and len(row) >= 4),
                f"{prefix} full ranking observed time missing",
                errors,
            )
            normal_difference_count = sum(
                bool(str(row[4] or ""))
                for row in final_rankings
                if isinstance(row, list) and len(row) >= 11
            )
            previous_difference_count = sum(
                bool(str(row[5] or ""))
                for row in final_rankings
                if isinstance(row, list) and len(row) >= 11
            )
            record_count = sum(
                bool(str(row[6] or "") and str(row[7] or "") and str(row[8] or "") and str(row[9] or ""))
                for row in final_rankings
                if isinstance(row, list) and len(row) >= 11
            )
            statistics_start_count = sum(
                bool(re.fullmatch(r"\d{4}", str(row[10] or "")))
                for row in final_rankings
                if isinstance(row, list) and len(row) >= 11
            )
            if target_date != latest_local_date:
                require(normal_difference_count >= 800, f"{prefix} normal difference coverage < 800", errors)
                require(previous_difference_count >= 800, f"{prefix} previous difference coverage < 800", errors)
            require(record_count >= 800, f"{prefix} historical record coverage < 800", errors)
            require(statistics_start_count >= 800, f"{prefix} statistics start coverage < 800", errors)
            target_day = datetime.strptime(target_date, "%Y-%m-%d").date()
            for row_index, row in enumerate(final_rankings):
                if not isinstance(row, list) or len(row) < 11:
                    continue
                for value_index, date_index, label in ((6, 7, "all-time"), (8, 9, "monthly")):
                    if not str(row[value_index] or "") and not str(row[date_index] or ""):
                        continue
                    try:
                        record_date = datetime.strptime(str(row[date_index]), "%Y-%m-%d").date()
                        float(row[value_index])
                    except (TypeError, ValueError):
                        require(False, f"{prefix} {label} record malformed: {row_index}", errors)
                        continue
                    require(record_date < target_day, f"{prefix} {label} record is not prior: {row_index}", errors)
                    if label == "monthly":
                        require(record_date.month == target_day.month, f"{prefix} monthly record month mismatch: {row_index}", errors)
            municipality_count = sum(
                bool(
                    str(row[3] or "")
                    or str((race_stations.get(str(row[0])) or {}).get("municipality") or "")
                )
                for row in final_rankings
                if isinstance(row, list) and len(row) >= 4
            )
            require(municipality_count >= 800, f"{prefix} full ranking municipality count < 800", errors)
            last_seen_values: dict[str, float] = {}
            for frame_index, frame in enumerate(frames):
                rows = frame.get("rows") or []
                require(len(rows) == 100, f"{prefix} rows != 100 at frame {frame_index}", errors)
                keys = [str(row[0]) for row in rows if isinstance(row, list) and len(row) >= 2]
                values = [float(row[1]) for row in rows if isinstance(row, list) and len(row) >= 2]
                require(len(keys) == len(rows), f"{prefix} malformed row at frame {frame_index}", errors)
                require(len(keys) == len(set(keys)), f"{prefix} duplicate station at frame {frame_index}", errors)
                expected_values = sorted(values, reverse=element == "max")
                require(values == expected_values, f"{prefix} values unsorted at frame {frame_index}", errors)
                require(all(key in race_stations for key in keys), f"{prefix} station metadata missing at frame {frame_index}", errors)
                for key, value in zip(keys, values):
                    previous_value = last_seen_values.get(key, value)
                    monotonic = value >= previous_value if element == "max" else value <= previous_value
                    require(monotonic, f"{prefix} running extreme reversed: {key}", errors)
                    last_seen_values[key] = value

    forecast = read(root / "forecast_manifest.json")
    layers = forecast.get("layers") or {}
    require(REQUIRED_FORECAST_LAYERS.issubset(layers), "forecast layer missing", errors)
    forecast_times = []
    for name in REQUIRED_FORECAST_LAYERS:
        slots = (layers.get(name) or {}).get("slots") or []
        require(any(slot.get("status") in {"available", "stale"} for slot in slots), f"forecast {name} has no usable slot", errors)
        layer_times = [
            str(slot.get("basetime") or "")
            for slot in slots
            if slot.get("basetime") and slot.get("status") in {"available", "stale"}
        ]
        forecast_times.extend(layer_times)
        require(
            bool(layer_times)
            and age_minutes(max(layer_times)) <= args.forecast_max_age_hours * 60,
            f"forecast {name} basetime is stale",
            errors,
        )
    daily_elements = {
        str(slot.get("element") or "")
        for slot in ((layers.get("daily") or {}).get("slots") or [])
        if slot.get("status") in {"available", "stale"}
    }
    require({"min", "max"}.issubset(daily_elements), "forecast daily min/max usable slots missing", errors)
    validate_forecast_previous_comparison_sources(forecast, errors, root)
    forecast_target_months = forecast_daily_record_months(forecast)
    available_record_months = {
        int(value)
        for value in station_records.get("months") or []
        if str(value).isdigit()
    }
    require(
        forecast_target_months.issubset(available_record_months),
        f"temperature station record months missing for forecast: "
        f"{sorted(forecast_target_months - available_record_months)}",
        errors,
    )
    for month in sorted(forecast_target_months):
        all_time_count, month_count = station_record_coverage(station_records, month)
        require(
            all_time_count >= 800,
            f"temperature station all-time record coverage < 800 for month {month}: {all_time_count}",
            errors,
        )
        require(
            month_count >= 800,
            f"temperature station monthly record coverage < 800 for month {month}: {month_count}",
            errors,
        )

    suikei = read(root / "suikei_realtime_manifest.json")
    require(int(suikei.get("slot_count") or 0) >= 48, "suikei slot_count < 48", errors)
    require(suikei.get("availability") is True, "suikei availability is false", errors)
    require(REQUIRED_SUIKEI_LAYERS.issubset(suikei.get("layers") or {}), "suikei layer missing", errors)
    require(age_minutes(str(suikei.get("validtime") or "")) <= args.suikei_max_age_hours * 60, "suikei validtime is stale", errors)
    for slot in suikei.get("slots") or []:
        for layer in (slot.get("layers") or {}).values():
            overview = layer.get("overview_file")
            require(bool(overview) and (root / overview).is_file(), f"missing suikei overview: {overview}", errors)

    extremes = read(root / "temperature_extremes.json")
    days = extremes.get("days") or []
    require(bool(days), "temperature_extremes days missing", errors)
    latest_extreme_day = days[0] if days else {}
    rankings = latest_extreme_day.get("rankings") or {}
    require(REQUIRED_RANKING_KEYS.issubset(rankings), "temperature ranking key missing", errors)
    for key in REQUIRED_RANKING_KEYS:
        rows = rankings.get(key) or []
        require(len(rows) >= 10, f"temperature ranking rows < 10: {key}", errors)
        for index, row in enumerate(rows[:10], 1):
            require(bool(str(row.get("value") or "")), f"blank temperature ranking value: {key} #{index}", errors)
            require(bool(str(row.get("station") or "")), f"blank temperature ranking station: {key} #{index}", errors)
    for day in days:
        updates = day.get("updates") or {}
        day_label = str(day.get("date") or "unknown")
        require(
            REQUIRED_PRIMARY_RECORD_UPDATE_KEYS.issubset(updates),
            f"temperature record update key missing: {day_label}",
            errors,
        )
        for key in REQUIRED_PRIMARY_RECORD_UPDATE_KEYS:
            for index, row in enumerate(updates.get(key) or [], 1):
                prefix = f"temperature record update malformed: {day_label} {key} #{index}"
                require(bool(str(row.get("station") or "")), f"{prefix} station", errors)
                require(bool(str(row.get("municipality") or "")), f"{prefix} municipality", errors)
                require(bool(str(row.get("value") or "")), f"{prefix} value", errors)
                require(bool(str(row.get("time") or "")), f"{prefix} time", errors)
                require(bool(str(row.get("previous_record") or "")), f"{prefix} previous record", errors)
                require(bool(str(row.get("previous_record_date") or "")), f"{prefix} previous record date", errors)

    if str(latest_extreme_day.get("date") or "") == latest_local_date:
        latest_race_day = days_by_date.get(latest_local_date) or {}
        for element, ranking_key in (("max", "max_high"), ("min", "min_low")):
            race_payload = latest_race_day.get(element) or {}
            frames_by_time = {
                str(frame.get("time") or ""): dict(frame.get("rows") or [])
                for frame in race_payload.get("frames") or []
            }
            window_end = parse_time(str(race_payload.get("window_end") or ""))
            events = race_payload.get("official_events") or []
            for index, row in enumerate((rankings.get(ranking_key) or [])[:10], 1):
                station_key = race_station_key_for_ranking(row, race_stations)
                require(bool(station_key), f"ranking station missing from race: {ranking_key} #{index}", errors)
                observed_time = ranking_occurrence_time(latest_local_date, str(row.get("time") or ""))
                try:
                    ranking_value = float(row.get("value"))
                except (TypeError, ValueError):
                    continue
                if not station_key or observed_time is None or observed_time > window_end:
                    continue
                correction_frame = observed_time.replace(second=0, microsecond=0)
                if correction_frame.minute % 10:
                    correction_frame += timedelta(minutes=10 - correction_frame.minute % 10)
                frame_rows = frames_by_time.get(correction_frame.isoformat()) or {}
                race_value = frame_rows.get(station_key)
                require(race_value is not None, f"ranking station absent at correction frame: {ranking_key} #{index}", errors)
                if race_value is not None:
                    consistent = (
                        float(race_value) >= ranking_value - 0.05
                        if element == "max"
                        else float(race_value) <= ranking_value + 0.05
                    )
                    require(consistent, f"ranking value missing from race: {ranking_key} #{index}", errors)
                matching_event = any(
                    str(event.get("station_key") or "") == station_key
                    and abs(float(event.get("value_c")) - ranking_value) < 0.05
                    and parse_time(str(event.get("observed_time") or "")) <= observed_time
                    for event in events
                )
                require(matching_event, f"ranking correction event missing: {ranking_key} #{index}", errors)

    if errors:
        raise SystemExit("public data contract failed:\n- " + "\n- ".join(errors[:30]))
    print(json.dumps({
        "observed_latest_time": latest,
        "observed_station_count": temp_count,
        "series_station_count": len(station_spans),
        "series_full_span_count": full_span_count,
        "temperature_race_days": len(race_dates),
        "temperature_race_frames": race_frame_count,
        "temperature_race_latest_time": race.get("latest_time"),
        "forecast_latest_basetime": max(forecast_times),
        "suikei_validtime": suikei.get("validtime"),
        "suikei_slot_count": suikei.get("slot_count"),
        "temperature_ranking_date": latest_extreme_day.get("date"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
