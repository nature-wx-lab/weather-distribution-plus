#!/usr/bin/env python3
"""Build local CSV data for the temperature distribution prototype.

This is intentionally pragmatic: it reuses the latest saved JMA forecast-grid CSVs,
interpolates station current-year observations onto the same grid, and writes
browser-friendly CSVs for value, anomaly, and previous-day difference modes.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from create_jma_wdist_max_temp_anomaly_map import (
    INDEX_PATH,
    MAX_INTERPOLATION_ELEVATION_M,
    STATION_DIR,
    day_key_to_ordinal,
    idw_normals_for_points,
    load_station_normals,
)


OUT_DIR = Path("outputs/weather/temperature_distribution_tool")


@dataclass
class StationValue:
    station_key: str
    name: str
    region: str
    lon: float
    lat: float
    normal_c: float


def read_grid_csv(path: Path) -> list[dict[str, float]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [
            {
                "lon": float(row["longitude"]),
                "lat": float(row["latitude"]),
            }
            for row in csv.DictReader(handle)
        ]


def load_forecast_manifest(out_dir: Path) -> dict:
    path = out_dir / "forecast_manifest.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def find_grid_csv(out_dir: Path, element: str) -> Path:
    manifest = load_forecast_manifest(out_dir)
    daily_slots = (manifest.get("layers") or {}).get("daily", {}).get("slots") or manifest.get("slots") or []
    for slot in daily_slots:
        if slot.get("element") != element:
            continue
        if slot.get("status") not in {"available", "stale"}:
            continue
        path = out_dir / f"forecast_{slot.get('id')}_anomaly_30y.csv"
        if path.exists():
            return path
    for path in sorted(out_dir.glob("forecast_*_anomaly_30y.csv")):
        return path
    raise FileNotFoundError(f"no saved forecast grid CSV found in {out_dir}")


def write_csv(path: Path, rows: list[dict[str, float | str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        with tmp.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "longitude",
                    "latitude",
                    "display_c",
                    "forecast_c",
                    "observed_c",
                    "average_c",
                    "anomaly_c",
                    "previous_day_c",
                    "previous_diff_c",
                    "source_date",
                    "target_date",
                ],
            )
            writer.writeheader()
            writer.writerows(rows)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def load_index(index_path: Path) -> dict:
    return json.loads(index_path.read_text(encoding="utf-8"))


def parse_iso_date(value: str) -> date:
    year, month, day = (int(part) for part in value.split("-"))
    return date(year, month, day)


def day_key_from_date(value: date) -> str:
    return value.strftime("%m-%d")


def period_suffix(period: str) -> str:
    return "normal" if period == "normal" else f"{period}y"


def load_station_values(
    index_path: Path,
    station_dir: Path,
    element: str,
    target_date: date,
) -> list[StationValue]:
    index = load_index(index_path)
    ordinal = day_key_to_ordinal(day_key_from_date(target_date))
    values: list[StationValue] = []
    for station in index["stations"]:
        elevation = station.get("elevation_m")
        if elevation is not None and float(elevation) > MAX_INTERPOLATION_ELEVATION_M:
            continue
        station_key = station["station_key"]
        path = station_dir / f"{station_key}.json"
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        series = payload.get("current_year", {}).get(element, [])
        if ordinal < 1 or ordinal > len(series):
            continue
        value = series[ordinal - 1]
        if value is None:
            continue
        values.append(
            StationValue(
                station_key=station_key,
                name=str(station["name"]),
                region=str(station["region"]),
                lon=float(station["longitude"]),
                lat=float(station["latitude"]),
                normal_c=float(value),
            )
        )
    return values


def idw_values(points: list[tuple[float, float, float]], values: list[StationValue]) -> np.ndarray:
    return idw_normals_for_points(points, values)  # Same dataclass shape: lon, lat, normal_c.


def build(args: argparse.Namespace) -> None:
    index = load_index(args.index)
    observed_latest = parse_iso_date(index["current_year"]["latest_date"])
    observed_previous = observed_latest - timedelta(days=1)
    forecast_date = args.forecast_date
    periods = ["normal", "30", "20", "10", "5", "3"]
    elements = ["max", "min"]

    for element in elements:
        current_station_values = load_station_values(args.index, args.station_dir, element, observed_latest)
        previous_station_values = load_station_values(args.index, args.station_dir, element, observed_previous)
        for period in periods:
            grid_rows = read_grid_csv(find_grid_csv(args.out_dir, element))
            points = [(row["lon"], row["lat"], 0.0) for row in grid_rows]
            current_grid = idw_values(points, current_station_values)
            previous_grid = idw_values(points, previous_station_values)

            normals = load_station_normals(args.index, args.station_dir, day_key_from_date(observed_latest), period, element)
            average_grid = idw_normals_for_points(points, normals)
            observed_value_rows = []
            observed_anomaly_rows = []
            observed_previous_rows = []
            for row, current, previous, average in zip(grid_rows, current_grid, previous_grid, average_grid):
                current_f = float(current)
                previous_f = float(previous)
                average_f = float(average)
                anomaly = current_f - average_f
                previous_diff = current_f - previous_f
                common = {
                    "longitude": f"{row['lon']:.5f}",
                    "latitude": f"{row['lat']:.5f}",
                    "forecast_c": "",
                    "observed_c": f"{current_f:.2f}",
                    "average_c": f"{average_f:.2f}",
                    "anomaly_c": f"{anomaly:+.2f}",
                    "previous_day_c": f"{previous_f:.2f}",
                    "previous_diff_c": f"{previous_diff:+.2f}",
                    "source_date": observed_latest.isoformat(),
                    "target_date": observed_latest.isoformat(),
                }
                observed_value_rows.append({**common, "display_c": f"{current_f:.2f}"})
                observed_anomaly_rows.append({**common, "display_c": f"{anomaly:+.2f}"})
                observed_previous_rows.append({**common, "display_c": f"{previous_diff:+.2f}"})

            for source, mode, rows in [
                ("observed", "value", observed_value_rows),
                ("observed", "anomaly", observed_anomaly_rows),
                ("observed", "previous", observed_previous_rows),
            ]:
                write_csv(
                    args.out_dir / f"{source}_{element}_{mode}_{period_suffix(period)}.csv",
                    rows,
                )

            print(f"wrote observed {element} {period}y")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--forecast-date", default="2026-06-18")
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    parser.add_argument("--station-dir", type=Path, default=STATION_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    return parser.parse_args()


def main() -> None:
    build(parse_args())


if __name__ == "__main__":
    main()
