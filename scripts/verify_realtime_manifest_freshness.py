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
JST = ZoneInfo("Asia/Tokyo")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--max-age-minutes", type=float, default=35.0)
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


if __name__ == "__main__":
    main()
