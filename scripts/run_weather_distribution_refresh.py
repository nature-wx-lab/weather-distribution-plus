#!/usr/bin/env python3
"""Publish a valid weather snapshot and suppress transient candidate failures.

The normal candidate must pass the strict public contract.  When only the
newly generated forecast is temporarily incoherent, keep the fresh observation
candidate but restore the last published forecast and validate the combined
snapshot.  Otherwise restore the complete last-known-good public snapshot.

A retained snapshot is successful only while observations remain within the
normal freshness limit and the retained forecast is inside the explicit
rollover grace period.  Once either limit is exceeded, the workflow fails so a
real stale-data incident still raises an Actions notification.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


ROOT = Path(__file__).resolve().parents[1]
PUBLISH_PATHS = (
    "data/temperature_distribution_tool",
    "public/weather-climatology/data/stations",
    "public/weather-climatology/data/climatology_index_1996_2025_s_stations.json",
)
FORECAST_PATHS = (
    ":(glob)data/temperature_distribution_tool/forecast_*",
)
ALLOWED_UNTRACKED_DIRS = (
    ROOT / "data" / "temperature_distribution_tool",
    ROOT / "public" / "weather-climatology" / "data" / "stations",
)
ALLOWED_UNTRACKED_FILES = (
    ROOT / "public" / "weather-climatology" / "data" / "climatology_index_1996_2025_s_stations.json",
)


@dataclass
class StageFailure(RuntimeError):
    stage: str
    returncode: int

    def __str__(self) -> str:
        return f"{self.stage} failed with exit code {self.returncode}"


class RefreshGateFailure(RuntimeError):
    pass


def command_label(command: Sequence[str]) -> str:
    return " ".join(str(value) for value in command)


def run_stage(stage: str, command: Sequence[str]) -> None:
    print(f"+ [{stage}] {command_label(command)}", flush=True)
    completed = subprocess.run(list(command), cwd=ROOT, check=False)
    if completed.returncode:
        raise StageFailure(stage, completed.returncode)


def git_output(command: Sequence[str]) -> bytes:
    completed = subprocess.run(
        ["git", *command],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    return completed.stdout


def status_bytes(pathspecs: Sequence[str]) -> bytes:
    return git_output([
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        *pathspecs,
    ])


def ensure_clean_publish_paths() -> None:
    status = status_bytes(PUBLISH_PATHS)
    if status:
        rendered = status.replace(b"\0", b"\n").decode("utf-8", errors="replace").strip()
        raise RefreshGateFailure(
            "refresh gate requires a clean checkout for the public data paths; "
            f"refusing a destructive fallback:\n{rendered}"
        )


def allowed_untracked_path(relative: Path) -> Path:
    if relative.is_absolute() or ".." in relative.parts:
        raise RefreshGateFailure(f"unsafe untracked path returned by git: {relative}")
    target = (ROOT / relative).resolve()
    if target in (path.resolve() for path in ALLOWED_UNTRACKED_FILES):
        return target
    if any(target == directory.resolve() or directory.resolve() in target.parents for directory in ALLOWED_UNTRACKED_DIRS):
        return target
    raise RefreshGateFailure(f"untracked path escaped the public allowlist: {relative}")


def remove_untracked(pathspecs: Sequence[str]) -> None:
    output = git_output([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        *pathspecs,
    ])
    for raw in output.split(b"\0"):
        if not raw:
            continue
        relative = Path(raw.decode("utf-8"))
        target = allowed_untracked_path(relative)
        if target.is_symlink() or target.is_file():
            target.unlink()
        elif target.exists():
            raise RefreshGateFailure(f"unexpected untracked directory from git: {relative}")


def restore_paths(pathspecs: Sequence[str]) -> None:
    print(f"restoring last-known-good paths: {', '.join(pathspecs)}", flush=True)
    subprocess.run(
        ["git", "restore", "--source=HEAD", "--worktree", "--", *pathspecs],
        cwd=ROOT,
        check=True,
    )
    remove_untracked(pathspecs)
    remaining = status_bytes(pathspecs)
    if remaining:
        rendered = remaining.replace(b"\0", b"\n").decode("utf-8", errors="replace").strip()
        raise RefreshGateFailure(f"last-known-good restore left residual changes:\n{rendered}")


def freshness_command(max_age_minutes: float) -> list[str]:
    return [
        sys.executable,
        "scripts/verify_realtime_manifest_freshness.py",
        "--max-age-minutes",
        str(max_age_minutes),
    ]


def contract_command(forecast_max_age_hours: float) -> list[str]:
    return [
        sys.executable,
        "scripts/verify_weather_distribution_contract.py",
        "--forecast-max-age-hours",
        str(forecast_max_age_hours),
    ]


def validate_snapshot(stage_prefix: str, max_age_minutes: float, forecast_max_age_hours: float) -> None:
    run_stage(f"{stage_prefix}-freshness", freshness_command(max_age_minutes))
    run_stage(f"{stage_prefix}-contract", contract_command(forecast_max_age_hours))


def emit_warning(title: str, message: str) -> None:
    print(f"::warning title={title}::{message}", flush=True)


def execute_refresh_policy(
    max_age_minutes: float,
    candidate_forecast_max_age_hours: float,
    retained_forecast_max_age_hours: float,
) -> str:
    ensure_clean_publish_paths()
    candidate_failure: StageFailure | None = None
    try:
        run_stage(
            "candidate-update",
            [sys.executable, "scripts/update_weather_distribution_public.py"],
        )
        validate_snapshot(
            "candidate",
            max_age_minutes,
            candidate_forecast_max_age_hours,
        )
        return "candidate"
    except StageFailure as error:
        candidate_failure = error
        print(f"new public candidate rejected: {error}", flush=True)

    assert candidate_failure is not None
    if candidate_failure.stage == "candidate-contract":
        try:
            restore_paths(FORECAST_PATHS)
            validate_snapshot(
                "retained-forecast",
                max_age_minutes,
                retained_forecast_max_age_hours,
            )
            emit_warning(
                "Weather forecast candidate retained",
                "Latest observations passed with the last-known-good forecast; "
                "the transient candidate did not replace validated public data.",
            )
            return "retained_forecast"
        except (StageFailure, RefreshGateFailure, subprocess.CalledProcessError) as forecast_failure:
            print(f"forecast-only recovery rejected: {forecast_failure}", flush=True)

    try:
        restore_paths(PUBLISH_PATHS)
        validate_snapshot(
            "retained-snapshot",
            max_age_minutes,
            retained_forecast_max_age_hours,
        )
        emit_warning(
            "Weather refresh candidate retained",
            "The complete last-known-good public snapshot remains inside the "
            "freshness contract; no invalid candidate was published.",
        )
        return "retained_snapshot"
    except (StageFailure, RefreshGateFailure, subprocess.CalledProcessError) as retained_failure:
        raise RefreshGateFailure(
            "new candidate failed and the retained public snapshot is no longer "
            f"inside the recovery contract: {retained_failure}"
        ) from retained_failure


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-age-minutes", type=float, default=35.0)
    parser.add_argument("--candidate-forecast-max-age-hours", type=float, default=12.0)
    parser.add_argument("--retained-forecast-max-age-hours", type=float, default=13.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        outcome = execute_refresh_policy(
            args.max_age_minutes,
            args.candidate_forecast_max_age_hours,
            args.retained_forecast_max_age_hours,
        )
    except RefreshGateFailure as error:
        print(f"::error title=Weather distribution refresh stale::{error}", flush=True)
        raise SystemExit(str(error)) from error
    print(f"weather distribution refresh outcome={outcome}", flush=True)


if __name__ == "__main__":
    main()
