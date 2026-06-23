#!/usr/bin/env python3
"""Refresh public data for 天気分布予報プラス.

This runner is intentionally close to the local development server's refresh
sequence. It writes directly to the GitHub Pages data directory so the public
site keeps fetching, updating, and accumulating data after deployment.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "temperature_distribution_tool"
STATION_INDEX = ROOT / "public" / "weather-climatology" / "data" / "climatology_index_1996_2025_s_stations.json"
STATION_DIR = ROOT / "public" / "weather-climatology" / "data" / "stations"
STATION_INVENTORY = ROOT / "data" / "weather" / "japan_all_stations" / "station_inventory_current_temperature.csv"


def run(args: list[str]) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def forecast_service_date() -> str:
    manifest_path = DATA_DIR / "forecast_manifest.json"
    if not manifest_path.exists():
        return ""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    return str(manifest.get("service_date") or "")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    py = sys.executable
    run([
        py,
        "scripts/update_temperature_distribution_forecast.py",
        "--index",
        str(STATION_INDEX),
        "--station-dir",
        str(STATION_DIR),
        "--out-dir",
        str(DATA_DIR),
    ])

    service_date = forecast_service_date()
    if not service_date:
        raise SystemExit("forecast_manifest.json did not contain service_date")

    run([
        py,
        "public/weather-climatology/scripts/update_current_observations.py",
        "--index",
        str(STATION_INDEX),
        "--station-dir",
        str(STATION_DIR),
        "--months-back",
        "0",
        "--max-workers",
        "6",
        "--retries",
        "2",
    ])

    run([
        py,
        "scripts/build_temperature_distribution_tool_data.py",
        "--forecast-date",
        service_date,
        "--index",
        str(STATION_INDEX),
        "--station-dir",
        str(STATION_DIR),
        "--out-dir",
        str(DATA_DIR),
    ])

    run([
        py,
        "scripts/update_temperature_distribution_realtime_observations.py",
        "--index",
        str(STATION_INDEX),
        "--station-dir",
        str(STATION_DIR),
        "--out-dir",
        str(DATA_DIR),
        "--days",
        "7",
    ])

    run([
        py,
        "scripts/update_temperature_distribution_extremes.py",
        "--days",
        "8",
        "--out-dir",
        str(DATA_DIR),
        "--station-inventory",
        str(STATION_INVENTORY),
    ])

    # Match the local server order: refresh forecast again after observation
    # updates so the time axis and point chart files stay current together.
    run([
        py,
        "scripts/update_temperature_distribution_forecast.py",
        "--index",
        str(STATION_INDEX),
        "--station-dir",
        str(STATION_DIR),
        "--out-dir",
        str(DATA_DIR),
    ])


if __name__ == "__main__":
    main()
