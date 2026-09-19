#!/usr/bin/env python3
"""Update current-year daily observations for the public static site.

The public site stores current-year observations inside each split station JSON
file. This updater fetches JMA monthly daily-value pages directly and updates
only the current-year max/min arrays, without needing the private SQLite DB or
local cache used to build the historical climatology.
"""

from __future__ import annotations

import argparse
import calendar
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX = ROOT / "data/climatology_index_1996_2025_s_stations.json"
DEFAULT_STATION_DIR = ROOT / "data/stations"
BASE_URL = "https://www.data.jma.go.jp/stats/etrn/view/{daily_page}.php"
USER_AGENT = "NatureWxLab-TemperatureRiskNavi/1.0 (+https://note.com/nature_wx_lab)"
JST = ZoneInfo("Asia/Tokyo")


@dataclass(frozen=True)
class Station:
    station_key: str
    prec_no: str
    block_no: str
    name: str
    daily_page: str = "daily_s1"


@dataclass(frozen=True)
class FetchResult:
    station_key: str
    month: int
    values: dict[int, dict[str, float | None]]
    error: str | None = None


class TableTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._in_tr = False
        self._in_cell = False
        self._current_row: list[str] = []
        self._current_cell: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._in_tr = True
            self._current_row = []
        elif self._in_tr and tag in {"td", "th"}:
            self._in_cell = True
            self._current_cell = []

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._in_cell:
            self._current_row.append(normalize_text("".join(self._current_cell)))
            self._current_cell = []
            self._in_cell = False
        elif tag == "tr" and self._in_tr:
            if self._current_row:
                self.rows.append(self._current_row)
            self._current_row = []
            self._in_tr = False


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", "", text.replace("\xa0", " ")).strip()


def parse_number(raw: str) -> float | None:
    value = normalize_text(raw)
    if not value or value in {"--", "///", "×", "××"}:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", value)
    if not match:
        return None
    return round(float(match.group(0)), 1)


def source_url(station: Station, year: int, month: int) -> str:
    return (
        f"{BASE_URL.format(daily_page=station.daily_page)}"
        f"?prec_no={station.prec_no}&block_no={station.block_no}"
        f"&year={year}&month={month:02d}&day=&view="
    )


def temp_indexes(daily_page: str) -> tuple[int, int, int]:
    # daily_s1: day, pressure(2), precip(3), temperature avg/max/min...
    # daily_a1: day, precip(3), temperature avg/max/min...
    return (6, 7, 8) if daily_page == "daily_s1" else (4, 5, 6)


def parse_month(station: Station, year: int, month: int, html: str) -> dict[int, dict[str, float | None]]:
    parser = TableTextParser()
    parser.feed(html)
    days_in_month = calendar.monthrange(year, month)[1]
    avg_idx, max_idx, min_idx = temp_indexes(station.daily_page)
    values: dict[int, dict[str, float | None]] = {}

    for cells in parser.rows:
        if len(cells) <= min_idx:
            continue
        if not re.fullmatch(r"\d{1,2}", cells[0]):
            continue
        day = int(cells[0])
        if not 1 <= day <= days_in_month:
            continue
        values[day] = {
            "max": parse_number(cells[max_idx]),
            "min": parse_number(cells[min_idx]),
        }
    return values


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def load_index(path: Path) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload.get("stations"), list):
        raise ValueError(f"invalid station index: {path}")
    return payload


def load_stations(index_payload: dict[str, Any], station_limit: int | None) -> list[Station]:
    stations: list[Station] = []
    for row in index_payload["stations"]:
        station_key = str(row.get("station_key") or "")
        prec_no = str(row.get("prec_no") or "")
        block_no = str(row.get("block_no") or "")
        if not station_key or not prec_no or not block_no:
            continue
        stations.append(
            Station(
                station_key=station_key,
                prec_no=prec_no,
                block_no=block_no,
                name=str(row.get("name") or station_key),
            )
        )
        if station_limit and len(stations) >= station_limit:
            break
    return stations


def months_to_fetch(current_month: int, months_back: int, full_year_to_date: bool) -> list[int]:
    if full_year_to_date:
        return list(range(1, current_month + 1))
    start = max(1, current_month - max(0, months_back))
    return list(range(start, current_month + 1))


def fetch_month(
    station: Station,
    year: int,
    month: int,
    timeout: float,
    user_agent: str,
    retries: int,
) -> FetchResult:
    url = source_url(station, year, month)
    last_error = ""
    for _attempt in range(max(1, retries + 1)):
        request = Request(url, headers={"User-Agent": user_agent})
        try:
            with urlopen(request, timeout=timeout) as response:
                status = getattr(response, "status", 200)
                if status != 200:
                    last_error = f"HTTP {status}"
                    continue
                html = response.read().decode("utf-8", errors="replace")
            return FetchResult(station.station_key, month, parse_month(station, year, month, html))
        except (HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError) as error:
            last_error = str(error)
    return FetchResult(station.station_key, month, {}, last_error or "fetch failed")


def fetch_all(
    stations: list[Station],
    year: int,
    months: list[int],
    max_workers: int,
    timeout: float,
    user_agent: str,
    retries: int,
) -> tuple[dict[str, dict[int, dict[int, dict[str, float | None]]]], dict[str, str]]:
    fetched: dict[str, dict[int, dict[int, dict[str, float | None]]]] = {station.station_key: {} for station in stations}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as executor:
        futures = [
            executor.submit(fetch_month, station, year, month, timeout, user_agent, retries)
            for station in stations
            for month in months
        ]
        for future in as_completed(futures):
            result = future.result()
            if result.error:
                errors[f"{result.station_key}:{result.month:02d}"] = result.error
                continue
            fetched.setdefault(result.station_key, {})[result.month] = result.values
    return fetched, errors


def blank_series(day_count: int) -> list[float | None]:
    return [None] * day_count


def ensure_current_year(payload: dict[str, Any], year: int, day_count: int) -> tuple[dict[str, Any], bool]:
    current = payload.setdefault("current_year", {})
    changed = False
    has_existing_series = any(isinstance(current.get(element), list) for element in ("max", "min"))
    if current.get("year") not in (None, year):
        current.clear()
        current["year"] = year
        current["max"] = blank_series(day_count)
        current["min"] = blank_series(day_count)
        return current, True
    if current.get("year") is None and has_existing_series:
        current["year"] = year
        changed = True
    for element in ("max", "min"):
        series = current.get(element)
        if not isinstance(series, list):
            current[element] = blank_series(day_count)
            changed = True
        elif len(series) < day_count:
            series.extend([None] * (day_count - len(series)))
            changed = True
        elif len(series) > day_count:
            current[element] = series[:day_count]
            changed = True
    return current, changed


def date_for_day(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def latest_series_date(current: dict[str, Any], days: list[dict[str, Any]], year: int) -> str | None:
    latest: date | None = None
    for index, day_info in enumerate(days):
        day_date = date_for_day(year, int(day_info["month"]), int(day_info["day"]))
        if day_date is None:
            continue
        has_value = False
        for element in ("max", "min"):
            series = current.get(element)
            if isinstance(series, list) and index < len(series) and series[index] is not None:
                has_value = True
                break
        if has_value and (latest is None or day_date > latest):
            latest = day_date
    return latest.isoformat() if latest else None


def update_station_file(
    station: Station,
    station_dir: Path,
    fetched: dict[int, dict[int, dict[str, float | None]]],
    days: list[dict[str, Any]],
    day_index: dict[tuple[int, int], int],
    year: int,
    today: date,
    dry_run: bool,
) -> tuple[bool, str | None]:
    path = station_dir / f"{station.station_key}.json"
    if not path.exists():
        return False, None
    payload = load_json(path)
    current, changed = ensure_current_year(payload, year, len(days))

    for month, month_values in fetched.items():
        for day, values in month_values.items():
            day_date = date_for_day(year, month, day)
            if day_date is None or day_date > today:
                continue
            index = day_index.get((month, day))
            if index is None:
                continue
            for element in ("max", "min"):
                value = values.get(element)
                if value is None:
                    continue
                if current[element][index] != value:
                    current[element][index] = value
                    changed = True

    latest_date = latest_series_date(current, days, year)
    if latest_date and current.get("latest_date") != latest_date:
        current["latest_date"] = latest_date
        changed = True

    if changed and not dry_run:
        dump_json(path, payload)
    return changed, latest_date


def update_index(
    index_path: Path,
    index_payload: dict[str, Any],
    year: int,
    latest_date: str | None,
    fetched_months: list[int],
    changed_station_count: int,
    dry_run: bool,
) -> bool:
    current = index_payload.setdefault("current_year", {})
    changed = False
    updates = {
        "year": year,
        "latest_date": latest_date,
        "updated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "updater": "scripts/update_current_observations.py",
        "fetch_months": fetched_months,
    }
    for key, value in updates.items():
        if key == "updated_at" and changed_station_count == 0 and current.get("latest_date") == latest_date:
            continue
        if current.get(key) != value:
            current[key] = value
            changed = True
    if changed and not dry_run:
        dump_json(index_path, index_payload)
    return changed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--station-dir", type=Path, default=DEFAULT_STATION_DIR)
    parser.add_argument("--year", type=int)
    parser.add_argument("--month", type=int)
    parser.add_argument("--months-back", type=int, default=1)
    parser.add_argument("--full-year-to-date", action="store_true")
    parser.add_argument("--station-limit", type=int)
    parser.add_argument("--max-workers", type=int, default=6)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--user-agent", default=USER_AGENT)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    now = datetime.now(JST)
    year = args.year or now.year
    month = args.month or now.month
    today = date(year, month, now.day) if year == now.year and month == now.month else date(year, month, calendar.monthrange(year, month)[1])
    months = months_to_fetch(month, args.months_back, args.full_year_to_date)

    index_payload = load_index(args.index)
    days = list(index_payload.get("days", []))
    day_index = {(int(day["month"]), int(day["day"])): index for index, day in enumerate(days)}
    stations = load_stations(index_payload, args.station_limit)
    fetched, errors = fetch_all(
        stations=stations,
        year=year,
        months=months,
        max_workers=args.max_workers,
        timeout=args.timeout,
        user_agent=args.user_agent,
        retries=args.retries,
    )

    changed_station_count = 0
    latest_dates: list[str] = []
    for station in stations:
        changed, latest_date = update_station_file(
            station=station,
            station_dir=args.station_dir,
            fetched=fetched.get(station.station_key, {}),
            days=days,
            day_index=day_index,
            year=year,
            today=today,
            dry_run=args.dry_run,
        )
        if changed:
            changed_station_count += 1
        if latest_date:
            latest_dates.append(latest_date)

    latest_date = max(latest_dates) if latest_dates else None
    index_changed = update_index(
        index_path=args.index,
        index_payload=index_payload,
        year=year,
        latest_date=latest_date,
        fetched_months=months,
        changed_station_count=changed_station_count,
        dry_run=args.dry_run,
    )

    summary = {
        "year": year,
        "months": months,
        "station_count": len(stations),
        "changed_station_count": changed_station_count,
        "index_changed": index_changed,
        "latest_date": latest_date,
        "error_count": len(errors),
        "errors": errors,
        "dry_run": args.dry_run,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
