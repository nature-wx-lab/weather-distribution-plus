#!/usr/bin/env python3
"""Refresh and prune the public data for 天気分布予報プラス."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "temperature_distribution_tool"
STATION_INDEX = ROOT / "public" / "weather-climatology" / "data" / "climatology_index_1996_2025_s_stations.json"
STATION_DIR = ROOT / "public" / "weather-climatology" / "data" / "stations"
STATION_INVENTORY = ROOT / "data" / "weather" / "japan_all_stations" / "station_inventory_current_temperature.csv"
JST = ZoneInfo("Asia/Tokyo")
USER_AGENT = "NatureWxLab-WeatherDistributionPlus/1.1"
WDIST_TARGET_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/wdist/targetTimes.json"
SUIKEI_TARGET_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/suikeikishou/targetTimes.json"
AMEDAS_LATEST_TIME_URL = "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt"
FORECAST_SOURCE_SPECS = {
    "daily_min": ({"min_temp_point"}, "daily", "min"),
    "daily_max": ({"max_temp_point"}, "daily", "max"),
    "temp3h": ({"temp_point"}, "temp3h", None),
    "weather3h": ({"wm"}, "weather3h", None),
    "precip3h": ({"r3"}, "precip3h", None),
    "snow3h": ({"s3"}, "snow3h", None),
}
MIN_DAILY_REFERENCE_STATIONS = 800
RETRYABLE_HTTP_STATUS = {404, 408, 425, 429, 500, 502, 503, 504}


def run(args: list[str]) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def fetch_bytes(url: str, accept: str, attempts: int = 5) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(request, timeout=30) as response:
                return response.read()
        except HTTPError as error:
            if error.code not in RETRYABLE_HTTP_STATUS or attempt == attempts:
                raise
            reason = f"HTTP {error.code}"
        except (URLError, TimeoutError, ConnectionError, OSError) as error:
            if attempt == attempts:
                raise
            reason = error.__class__.__name__
        delay = 2 ** (attempt - 1)
        print(
            f"JMA source probe retry {attempt}/{attempts} after {reason}: "
            f"{url} (sleep {delay}s)",
            flush=True,
        )
        time.sleep(delay)
    raise RuntimeError(f"unreachable fetch retry state: {url}")


def fetch_json(url: str) -> object:
    return json.loads(fetch_bytes(url, "application/json").decode("utf-8"))


def fetch_text(url: str) -> str:
    return fetch_bytes(url, "text/plain").decode("utf-8").strip()


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


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
    except (KeyError, TypeError, ValueError):
        return False
    payload = read_json(
        data_dir / f"observed_{previous_date.strftime('%Y%m%d')}_{element}_station_values.json"
    )
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


def latest_source_time_in_payload(
    payload: object,
    required_elements: set[str],
    source: str = "targetTimes payload",
) -> str:
    if not isinstance(payload, list):
        raise RuntimeError(f"unexpected targetTimes payload: {source}")
    matches = [
        str(item.get("basetime") or item.get("validtime") or "")
        for item in payload
        if required_elements.issubset(set(item.get("elements") or []))
    ]
    return max((value for value in matches if value), default="")


def latest_source_time(url: str, required_elements: set[str]) -> str:
    return latest_source_time_in_payload(fetch_json(url), required_elements, url)


def local_forecast_source_time(
    manifest: dict,
    layer_name: str,
    element: str | None,
) -> str:
    slots = (((manifest.get("layers") or {}).get(layer_name) or {}).get("slots") or [])
    return max(
        (
            str(slot.get("basetime") or "")
            for slot in slots
            if slot.get("basetime")
            and (element is None or str(slot.get("element") or "") == element)
        ),
        default="",
    )


def forecast_source_states(manifest: dict, target_times: object) -> dict[str, tuple[str, str]]:
    return {
        name: (
            local_forecast_source_time(manifest, layer_name, element),
            latest_source_time_in_payload(target_times, required_elements),
        )
        for name, (required_elements, layer_name, element) in FORECAST_SOURCE_SPECS.items()
    }


def record_months_for_refresh(now: datetime) -> list[int]:
    """Return the months needed by today's and tomorrow's daily rankings."""
    return sorted({now.month, (now + timedelta(days=1)).month})


def forecast_comparison_refresh_required(manifest: dict, data_dir: Path = DATA_DIR) -> bool:
    slots = ((manifest.get("layers") or {}).get("daily") or {}).get("slots") or manifest.get("slots") or []
    if any(observed_daily_reference_ready(data_dir, slot) for slot in slots):
        return True
    today_max = next((slot for slot in slots if slot.get("id") == "today_max"), None)
    tomorrow_max = next((slot for slot in slots if slot.get("id") == "tomorrow_max"), None)
    if not tomorrow_max or tomorrow_max.get("status") not in {"available", "stale"}:
        return False
    if today_max and today_max.get("status") == "available":
        return False
    source = str(tomorrow_max.get("previous_comparison_source") or "")
    try:
        expected_date = (datetime.fromisoformat(str(tomorrow_max["target_date"])).date() - timedelta(days=1)).isoformat()
    except (KeyError, TypeError, ValueError):
        return True
    return (
        source not in {"observed_daily", "observed_realtime"}
        or tomorrow_max.get("previous_comparison_date") != expected_date
    )


def forecast_refresh_due() -> bool:
    manifest = read_json(DATA_DIR / "forecast_manifest.json")
    source_states = forecast_source_states(manifest, fetch_json(WDIST_TARGET_TIMES_URL))
    advanced_sources = [
        name
        for name, (local, remote) in source_states.items()
        if remote and (not local or remote > local)
    ]
    generated_at = str(manifest.get("generated_at") or "")
    correction_refresh_due = True
    if generated_at:
        try:
            correction_refresh_due = datetime.now(JST) - datetime.fromisoformat(generated_at).astimezone(JST) >= timedelta(hours=6)
        except ValueError:
            correction_refresh_due = True
    comparison_refresh_due = forecast_comparison_refresh_required(manifest)
    due = bool(advanced_sources) or correction_refresh_due or comparison_refresh_due
    state_label = " ".join(
        f"{name}={local or '--'}->{remote or '--'}"
        for name, (local, remote) in source_states.items()
    )
    print(
        f"forecast source probe: {state_label} advanced={advanced_sources or '--'} "
        f"correction_refresh_due={correction_refresh_due} "
        f"comparison_refresh_due={comparison_refresh_due} due={due}"
    )
    return due


def suikei_refresh_due() -> bool:
    manifest = read_json(DATA_DIR / "suikei_realtime_manifest.json")
    local = str(manifest.get("basetime") or manifest.get("validtime") or "")
    remote = latest_source_time(SUIKEI_TARGET_TIMES_URL, {"temp", "wthr", "suns1h"})
    due = not local or bool(remote and remote > local)
    print(f"suikei source probe: local={local or '--'} remote={remote or '--'} due={due}")
    return due


def daily_observations_are_current() -> bool:
    index = json.loads(STATION_INDEX.read_text(encoding="utf-8"))
    latest = str((index.get("current_year") or {}).get("latest_date") or "")
    expected = (datetime.now(JST).date() - timedelta(days=1)).isoformat()
    return latest >= expected


def realtime_backfill_required(saved_latest: str, source_latest: str, max_gap_minutes: int = 20) -> bool:
    try:
        saved = datetime.fromisoformat(saved_latest).astimezone(JST)
        source = datetime.fromisoformat(source_latest).astimezone(JST)
    except (TypeError, ValueError):
        return True
    return source - saved > timedelta(minutes=max_gap_minutes)


def refresh_realtime_observations(py: str) -> None:
    """Publish today's observation state before slower forecast products.

    Forecast rollover comparisons can depend on today's observed extrema. Keep
    this step ahead of forecast/Suikei refreshes so an ancillary day-boundary
    dependency cannot leave the public observation manifest on yesterday.
    """
    series = read_json(DATA_DIR / "observed_realtime_station_timeseries.json")
    source_latest = fetch_text(AMEDAS_LATEST_TIME_URL)
    if realtime_backfill_required(str(series.get("latest_time") or ""), source_latest):
        print(
            "AMeDAS series gap detected; backfilling the retained seven-day window before normal refresh: "
            f"saved={series.get('latest_time') or '--'} source={source_latest}",
            flush=True,
        )
        run([
            py,
            "scripts/update_temperature_distribution_realtime_observations.py",
            "--index", str(STATION_INDEX),
            "--station-dir", str(STATION_DIR),
            "--out-dir", str(DATA_DIR),
            "--station-inventory", str(STATION_INVENTORY),
            "--days", "7",
            "--backfill-series-only",
            "--backfill-workers", "8",
        ])
    run([
        py,
        "scripts/update_temperature_distribution_realtime_observations.py",
        "--index", str(STATION_INDEX),
        "--station-dir", str(STATION_DIR),
        "--out-dir", str(DATA_DIR),
        "--station-inventory", str(STATION_INVENTORY),
        "--days", "7",
    ])
    # Refresh the official ranking/record snapshot after the newest 10-minute
    # observations. JMA's record-update page can lag the AMeDAS feed briefly;
    # fetching it last prevents a newly published race value from being paired
    # with an older record-update snapshot in the same public run.
    run([
        py,
        "scripts/update_temperature_distribution_extremes.py",
        "--days", "8",
        "--out-dir", str(DATA_DIR),
        "--station-inventory", str(STATION_INVENTORY),
    ])


def prune_unreferenced_data() -> None:
    forecast = json.loads((DATA_DIR / "forecast_manifest.json").read_text(encoding="utf-8"))
    keep_forecast: set[str] = set()
    periods = ["normal", "30y", "20y", "10y", "5y", "3y"]
    for layer_name, layer in (forecast.get("layers") or {}).items():
        for slot in layer.get("slots") or []:
            if slot.get("status") not in {"available", "stale"}:
                continue
            slot_id = str(slot.get("id") or "")
            if layer_name == "daily":
                for suffix in periods:
                    keep_forecast.add(f"forecast_{slot_id}_anomaly_{suffix}.csv")
            elif layer_name == "temp3h":
                keep_forecast.add(f"forecast_{slot_id}_value.csv")
            else:
                keep_forecast.add(f"forecast_{slot_id}_value.geojson")

    removed = 0
    for path in DATA_DIR.glob("forecast_*"):
        if path.name == "forecast_manifest.json" or path.name in keep_forecast:
            continue
        if path.suffix in {".csv", ".geojson"}:
            path.unlink()
            removed += 1

    observed = json.loads((DATA_DIR / "observed_realtime_manifest.json").read_text(encoding="utf-8"))
    keep_slots = {str(slot.get("id")) for slot in observed.get("slots") or []}
    keep_observed = {"observed_temp_value_30y.csv"}
    for slot_id in keep_slots:
        for suffix in periods:
            keep_observed.add(f"observed_{slot_id}_anomaly_{suffix}.csv")
        keep_observed.add(f"observed_{slot_id}_station_values.json")
    dated = re.compile(r"observed_(\d{8}_(?:min|max))_")
    for path in DATA_DIR.glob("observed_*.csv"):
        match = dated.match(path.name)
        if path.name not in keep_observed and (match or path.name.startswith(("observed_temp_", "observed_min_", "observed_max_"))):
            path.unlink()
            removed += 1
    for path in DATA_DIR.glob("observed_*_station_values.json"):
        if path.name not in keep_observed:
            path.unlink()
            removed += 1
    print(f"pruned unreferenced public data files: {removed}")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    py = sys.executable
    now = datetime.now(JST)
    for month in record_months_for_refresh(now):
        run([
            py,
            "scripts/update_temperature_station_records.py",
            "--out-dir", str(DATA_DIR),
            "--station-inventory", str(STATION_INVENTORY),
            "--month", str(month),
            "--workers", "8",
        ])

    if not daily_observations_are_current():
        run([
            py,
            "public/weather-climatology/scripts/update_current_observations.py",
            "--index", str(STATION_INDEX),
            "--station-dir", str(STATION_DIR),
            "--months-back", "0",
            "--max-workers", "6",
            "--retries", "2",
        ])

    # Observation freshness is the 10-minute public contract. Generate it
    # before lower-frequency forecast and Suikei work, especially at rollover.
    refresh_realtime_observations(py)

    try:
        update_forecast = forecast_refresh_due()
    except Exception as error:
        # A failed probe must not make an actually new forecast wait forever.
        print(f"forecast source probe failed; running safe fallback: {error}")
        update_forecast = True
    if update_forecast:
        run([
            py,
            "scripts/update_temperature_distribution_forecast.py",
            "--index", str(STATION_INDEX),
            "--station-dir", str(STATION_DIR),
            "--out-dir", str(DATA_DIR),
        ])

    try:
        update_suikei = suikei_refresh_due()
    except Exception as error:
        print(f"suikei source probe failed; running safe fallback: {error}")
        update_suikei = True
    if update_suikei:
        run([
            py,
            "scripts/update_suikei_realtime_tiles.py",
            "--out-dir", str(DATA_DIR),
            "--workers", "4",
            "--keep-slots", "48",
        ])
    prune_unreferenced_data()


if __name__ == "__main__":
    main()
