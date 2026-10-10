#!/usr/bin/env python3
"""Fail when the generated public realtime manifest is too old."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "data" / "temperature_distribution_tool" / "observed_realtime_manifest.json"
DEFAULT_TIMESERIES = ROOT / "data" / "temperature_distribution_tool" / "observed_realtime_station_timeseries.json"
JST = ZoneInfo("Asia/Tokyo")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--max-age-minutes", type=float, default=35.0)
    parser.add_argument("--timeseries", type=Path, default=DEFAULT_TIMESERIES)
    parser.add_argument("--min-timeseries-days", type=float, default=6.9)
    parser.add_argument("--min-timeseries-stations", type=int, default=800)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    latest_text = str(payload.get("latest_time") or "")
    if not latest_text:
        raise SystemExit("freshness check failed: latest_time is missing")

    latest = datetime.fromisoformat(latest_text)
    if latest.tzinfo is None:
        raise SystemExit("freshness check failed: latest_time has no timezone")
    now = datetime.now(JST)
    age_minutes = (now - latest.astimezone(JST)).total_seconds() / 60
    print(
        f"latest_time={latest.isoformat()} now={now.isoformat()} "
        f"age_minutes={age_minutes:.1f} max_age_minutes={args.max_age_minutes:.1f}"
    )
    if age_minutes < -5:
        raise SystemExit("freshness check failed: latest_time is unexpectedly in the future")
    if age_minutes > args.max_age_minutes:
        raise SystemExit(
            f"freshness check failed: realtime data is {age_minutes:.1f} minutes old "
            f"(limit {args.max_age_minutes:.1f})"
        )

    series_payload = json.loads(args.timeseries.read_text(encoding="utf-8"))
    stations = series_payload.get("stations") or []
    if len(stations) < args.min_timeseries_stations:
        raise SystemExit(
            f"timeseries check failed: only {len(stations)} stations "
            f"(minimum {args.min_timeseries_stations})"
        )
    earliest = None
    series_latest = None
    duplicate_count = 0
    unsorted_count = 0
    for station in stations:
        rows = station.get("series") or []
        stamps = [datetime.fromisoformat(str(row[0])) for row in rows if row]
        if not stamps:
            continue
        if stamps != sorted(stamps):
            unsorted_count += 1
        duplicate_count += len(stamps) - len(set(stamps))
        earliest = min(earliest, stamps[0]) if earliest else stamps[0]
        series_latest = max(series_latest, stamps[-1]) if series_latest else stamps[-1]
    if earliest is None or series_latest is None:
        raise SystemExit("timeseries check failed: no observations")
    span_days = (series_latest - earliest).total_seconds() / 86400
    print(
        f"timeseries_stations={len(stations)} earliest={earliest.isoformat()} "
        f"latest={series_latest.isoformat()} span_days={span_days:.3f} "
        f"duplicates={duplicate_count} unsorted_stations={unsorted_count}"
    )
    if span_days < args.min_timeseries_days:
        raise SystemExit(
            f"timeseries check failed: only {span_days:.3f} days "
            f"(minimum {args.min_timeseries_days:.3f})"
        )
    if duplicate_count or unsorted_count:
        raise SystemExit(
            f"timeseries check failed: duplicates={duplicate_count}, "
            f"unsorted_stations={unsorted_count}"
        )


if __name__ == "__main__":
    main()
