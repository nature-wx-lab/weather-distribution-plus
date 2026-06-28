#!/usr/bin/env python3
"""Refresh and prune the public data for 天気分布予報プラス."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "temperature_distribution_tool"
STATION_INDEX = ROOT / "public" / "weather-climatology" / "data" / "climatology_index_1996_2025_s_stations.json"
STATION_DIR = ROOT / "public" / "weather-climatology" / "data" / "stations"
STATION_INVENTORY = ROOT / "data" / "weather" / "japan_all_stations" / "station_inventory_current_temperature.csv"
JST = ZoneInfo("Asia/Tokyo")


def run(args: list[str]) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def daily_observations_are_current() -> bool:
    index = json.loads(STATION_INDEX.read_text(encoding="utf-8"))
    latest = str((index.get("current_year") or {}).get("latest_date") or "")
    expected = (datetime.now(JST).date() - timedelta(days=1)).isoformat()
    return latest >= expected


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
    for element in ["min", "max"]:
        for suffix in periods:
            keep_observed.add(f"observed_{element}_anomaly_{suffix}.csv")
    dated = re.compile(r"observed_(\d{8}_(?:min|max))_")
    for path in DATA_DIR.glob("observed_*.csv"):
        match = dated.match(path.name)
        if path.name not in keep_observed and (match or path.name.startswith(("observed_temp_", "observed_min_", "observed_max_"))):
            path.unlink()
            removed += 1
    print(f"pruned unreferenced public data files: {removed}")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    py = sys.executable

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

    run([
        py,
        "scripts/update_temperature_distribution_forecast.py",
        "--index", str(STATION_INDEX),
        "--station-dir", str(STATION_DIR),
        "--out-dir", str(DATA_DIR),
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
    run([
        py,
        "scripts/update_suikei_realtime_tiles.py",
        "--out-dir", str(DATA_DIR),
        "--workers", "4",
        "--keep-slots", "48",
    ])
    run([
        py,
        "scripts/update_temperature_distribution_extremes.py",
        "--days", "8",
        "--out-dir", str(DATA_DIR),
        "--station-inventory", str(STATION_INVENTORY),
    ])
    prune_unreferenced_data()


if __name__ == "__main__":
    main()
