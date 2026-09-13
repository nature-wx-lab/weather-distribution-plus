from __future__ import annotations

import csv
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


forecast = load_module(
    "update_temperature_distribution_forecast",
    ROOT / "scripts" / "update_temperature_distribution_forecast.py",
)
suikei = load_module(
    "update_suikei_realtime_tiles",
    ROOT / "scripts" / "update_suikei_realtime_tiles.py",
)
public_update = load_module(
    "update_weather_distribution_public",
    ROOT / "scripts" / "update_weather_distribution_public.py",
)
contract = load_module(
    "verify_weather_distribution_contract",
    ROOT / "scripts" / "verify_weather_distribution_contract.py",
)
station_records = load_module(
    "update_temperature_station_records",
    ROOT / "scripts" / "update_temperature_station_records.py",
)


def write_daily_reference(
    data_dir: Path,
    target_date: str,
    element: str = "max",
    station_count: int = 800,
) -> None:
    payload = {
        "target_date": target_date,
        "element": element,
        "source": "daily",
        "station_count": station_count,
        "stations": [{"station_key": f"station-{index}"} for index in range(station_count)],
    }
    path = data_dir / f"observed_{target_date.replace('-', '')}_{element}_station_values.json"
    path.write_text(json.dumps(payload), encoding="utf-8")


class ForecastRolloverTests(unittest.TestCase):
    def test_daily_reference_beats_lagging_climatology_index_date(self):
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary)
            target_date = date.fromisoformat("2026-07-31")
            self.assertFalse(
                forecast.observed_daily_station_reference_ready(data_dir, target_date, "max")
            )
            write_daily_reference(data_dir, target_date.isoformat())
            self.assertTrue(
                forecast.observed_daily_station_reference_ready(data_dir, target_date, "max")
            )

    def test_record_months_cover_month_and_year_seams(self):
        self.assertEqual(
            public_update.record_months_for_refresh(
                datetime.fromisoformat("2026-07-31T05:00:00+09:00")
            ),
            [7, 8],
        )
        self.assertEqual(
            public_update.record_months_for_refresh(
                datetime.fromisoformat("2026-12-31T05:00:00+09:00")
            ),
            [1, 12],
        )

    def test_contract_record_months_ignore_three_hour_month_seam(self):
        manifest = {
            "layers": {
                "daily": {
                    "slots": [
                        {
                            "status": "available",
                            "target_date": "2026-07-30",
                        },
                        {
                            "status": "available",
                            "target_date": "2026-07-31",
                        },
                    ]
                },
                "temp3h": {
                    "slots": [
                        {
                            "status": "available",
                            "target_date": "2026-08-01",
                        }
                    ]
                },
            }
        }
        self.assertEqual(contract.forecast_daily_record_months(manifest), {7})

    def test_contract_record_months_include_daily_month_seam(self):
        manifest = {
            "layers": {
                "daily": {
                    "slots": [
                        {
                            "status": "available",
                            "target_date": "2026-07-31",
                        },
                        {
                            "status": "available",
                            "target_date": "2026-08-01",
                        },
                    ]
                }
            }
        }
        self.assertEqual(contract.forecast_daily_record_months(manifest), {7, 8})

    def test_forecast_source_states_detect_one_layer_advancing(self):
        manifest = {
            "layers": {
                "daily": {
                    "slots": [
                        {"element": "min", "basetime": "20260729080000"},
                        {"element": "max", "basetime": "20260729200000"},
                    ]
                },
                "temp3h": {"slots": [{"basetime": "20260729200000"}]},
                "weather3h": {"slots": [{"basetime": "20260729200000"}]},
                "precip3h": {"slots": [{"basetime": "20260729200000"}]},
                "snow3h": {"slots": [{"basetime": "20260729200000"}]},
            }
        }
        target_times = [
            {
                "basetime": "20260729200000",
                "elements": [
                    "min_temp_point",
                    "max_temp_point",
                    "temp_point",
                    "wm",
                    "r3",
                    "s3",
                ],
            }
        ]
        states = public_update.forecast_source_states(manifest, target_times)
        self.assertEqual(
            states["daily_min"],
            ("20260729080000", "20260729200000"),
        )
        self.assertTrue(
            all(local == remote for name, (local, remote) in states.items() if name != "daily_min")
        )

    def test_statistics_period_parser_keeps_one_digit_month_boundaries(self):
        self.assertEqual(
            station_records.parse_statistics_period("1978/72026/7"),
            ("1978-07", "2026-07"),
        )
        self.assertEqual(
            station_records.parse_statistics_period("1942/9 2026/7"),
            ("1942-09", "2026-07"),
        )

    def test_tomorrow_slot_checks_previous_cycle_even_if_today_is_unavailable(self):
        self.assertTrue(
            forecast.should_use_previous_forecast(
                "tomorrow_min",
                {"id": "today_min", "status": "unavailable"},
            )
        )

    def test_previous_cycle_tomorrow_file_is_valid_fallback(self):
        points = [(130.0, 35.0, 20.0), (131.0, 36.0, 21.0)]
        with tempfile.TemporaryDirectory() as temporary:
            out_dir = Path(temporary)
            path = out_dir / "forecast_tomorrow_min_anomaly_30y.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=["longitude", "latitude", "forecast_c", "target_date"],
                )
                writer.writeheader()
                writer.writerows(
                    [
                        {
                            "longitude": "130.00000",
                            "latitude": "35.00000",
                            "forecast_c": "19.0",
                            "target_date": "2026-07-28",
                        },
                        {
                            "longitude": "131.00000",
                            "latitude": "36.00000",
                            "forecast_c": "20.0",
                            "target_date": "2026-07-28",
                        },
                    ]
                )
            values, reason = forecast.load_previous_forecast_grid(
                out_dir,
                ["today_min", "tomorrow_min"],
                date(2026, 7, 28),
                points,
            )
        self.assertEqual(reason, "matched:tomorrow_min")
        self.assertEqual(values.tolist(), [19.0, 20.0])

    def test_tomorrow_max_uses_forecast_only_while_today_max_is_available(self):
        self.assertTrue(
            forecast.should_use_previous_forecast(
                "tomorrow_max",
                {"id": "today_max", "status": "available"},
            )
        )
        self.assertFalse(
            forecast.should_use_previous_forecast(
                "tomorrow_max",
                {"id": "today_max", "status": "unavailable"},
            )
        )
        self.assertFalse(forecast.should_use_previous_forecast("tomorrow_max", None))

    def test_public_contract_rejects_forecast_comparison_after_max_cutoff(self):
        manifest = {
            "layers": {
                "daily": {
                    "slots": [
                        {"id": "today_max", "status": "unavailable", "target_date": "2026-07-29"},
                        {
                            "id": "tomorrow_max",
                            "status": "available",
                            "target_date": "2026-07-30",
                            "previous_comparison_source": "forecast",
                            "previous_comparison_date": "2026-07-29",
                        },
                    ]
                }
            }
        }
        errors: list[str] = []
        contract.validate_forecast_previous_comparison_sources(manifest, errors)
        self.assertEqual(
            errors,
            ["tomorrow_max comparison source must be observed after today_max cutoff: forecast"],
        )

    def test_public_contract_accepts_observed_comparison_after_max_cutoff(self):
        manifest = {
            "layers": {
                "daily": {
                    "slots": [
                        {"id": "today_max", "status": "unavailable", "target_date": "2026-07-29"},
                        {
                            "id": "tomorrow_max",
                            "status": "available",
                            "target_date": "2026-07-30",
                            "previous_comparison_source": "observed_realtime",
                            "previous_comparison_date": "2026-07-29",
                        },
                    ]
                }
            }
        }
        errors: list[str] = []
        with tempfile.TemporaryDirectory() as temporary:
            contract.validate_forecast_previous_comparison_sources(
                manifest,
                errors,
                Path(temporary),
            )
            self.assertEqual(errors, [])

    def test_public_contract_rejects_realtime_when_daily_reference_is_ready(self):
        manifest = {
            "layers": {
                "daily": {
                    "slots": [
                        {
                            "id": "today_max",
                            "element": "max",
                            "status": "available",
                            "target_date": "2026-08-01",
                            "previous_comparison_source": "observed_realtime",
                            "previous_comparison_date": "2026-07-31",
                        }
                    ]
                }
            }
        }
        errors: list[str] = []
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary)
            write_daily_reference(data_dir, "2026-07-31")
            contract.validate_forecast_previous_comparison_sources(manifest, errors, data_dir)
        self.assertEqual(
            errors,
            [
                "forecast today_max comparison source must promote to observed_daily "
                "when daily reference is ready: observed_realtime"
            ],
        )


class SuikeiRetentionTests(unittest.TestCase):
    def test_partial_upstream_window_retains_last_good_slot(self):
        remote = [f"20260728{hour:02d}0000" for hour in range(47)]
        existing = ["20260726080000", *remote[:4]]
        selected = suikei.select_retained_slot_ids(remote, existing, 48)
        self.assertEqual(len(selected), 48)
        self.assertIn("20260726080000", selected)
        self.assertEqual(len(selected), len(set(selected)))


class UpdateOrderTests(unittest.TestCase):
    def test_latest_time_probe_retries_transient_404(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b"2026-08-08T19:20:00+09:00\n"
        with (
            mock.patch.object(
                public_update,
                "urlopen",
                side_effect=[
                    HTTPError(
                        public_update.AMEDAS_LATEST_TIME_URL,
                        404,
                        "Not Found",
                        {},
                        None,
                    ),
                    response,
                ],
            ),
            mock.patch.object(public_update.time, "sleep") as sleep,
        ):
            self.assertEqual(
                public_update.fetch_text(public_update.AMEDAS_LATEST_TIME_URL),
                "2026-08-08T19:20:00+09:00",
            )

        sleep.assert_called_once_with(1)

    def test_latest_time_probe_does_not_retry_non_transient_403(self):
        with (
            mock.patch.object(
                public_update,
                "urlopen",
                side_effect=HTTPError(
                    public_update.AMEDAS_LATEST_TIME_URL,
                    403,
                    "Forbidden",
                    {},
                    None,
                ),
            ),
            mock.patch.object(public_update.time, "sleep") as sleep,
        ):
            with self.assertRaises(HTTPError):
                public_update.fetch_text(public_update.AMEDAS_LATEST_TIME_URL)

        sleep.assert_not_called()

    def test_invalid_evening_max_comparison_forces_forecast_refresh(self):
        manifest = {
            "layers": {
                "daily": {
                    "slots": [
                        {"id": "today_max", "status": "unavailable", "target_date": "2026-07-29"},
                        {
                            "id": "tomorrow_max",
                            "status": "available",
                            "target_date": "2026-07-30",
                            "previous_comparison_source": "forecast",
                            "previous_comparison_date": "2026-07-29",
                        },
                    ]
                }
            }
        }
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary)
            self.assertTrue(public_update.forecast_comparison_refresh_required(manifest, data_dir))
            manifest["layers"]["daily"]["slots"][1]["previous_comparison_source"] = "observed_realtime"
            self.assertFalse(public_update.forecast_comparison_refresh_required(manifest, data_dir))

    def test_daily_reference_forces_realtime_comparison_promotion(self):
        manifest = {
            "layers": {
                "daily": {
                    "slots": [
                        {
                            "id": "today_max",
                            "element": "max",
                            "status": "available",
                            "target_date": "2026-08-01",
                            "previous_comparison_source": "observed_realtime",
                            "previous_comparison_date": "2026-07-31",
                        }
                    ]
                }
            }
        }
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary)
            self.assertFalse(public_update.forecast_comparison_refresh_required(manifest, data_dir))
            write_daily_reference(data_dir, "2026-07-31")
            self.assertTrue(public_update.forecast_comparison_refresh_required(manifest, data_dir))

    def test_long_observation_gap_requires_backfill(self):
        self.assertTrue(
            public_update.realtime_backfill_required(
                "2026-07-27T16:00:00+09:00",
                "2026-07-28T12:10:00+09:00",
            )
        )
        self.assertFalse(
            public_update.realtime_backfill_required(
                "2026-07-28T12:00:00+09:00",
                "2026-07-28T12:10:00+09:00",
            )
        )

    def test_gap_backfill_preserves_full_retention_window(self):
        calls: list[list[str]] = []
        with (
            mock.patch.object(
                public_update,
                "read_json",
                return_value={"latest_time": "2026-07-27T16:00:00+09:00"},
            ),
            mock.patch.object(
                public_update,
                "fetch_text",
                return_value="2026-07-28T12:10:00+09:00",
            ),
            mock.patch.object(public_update, "run", side_effect=lambda args: calls.append(args)),
        ):
            public_update.refresh_realtime_observations("/usr/bin/python3")

        backfill = calls[0]
        self.assertIn("--backfill-series-only", backfill)
        self.assertEqual(backfill[backfill.index("--days") + 1], "7")

    def test_observations_then_extremes_run_before_forecast_probe(self):
        events: list[str] = []

        def record_run(args):
            events.append(Path(args[1]).name)

        with (
            mock.patch.object(public_update, "run", side_effect=record_run),
            mock.patch.object(public_update, "daily_observations_are_current", return_value=True),
            mock.patch.object(public_update, "fetch_text", return_value="2026-07-28T12:10:00+09:00"),
            mock.patch.object(
                public_update,
                "read_json",
                return_value={"latest_time": "2026-07-28T12:00:00+09:00"},
            ),
            mock.patch.object(
                public_update,
                "forecast_refresh_due",
                side_effect=lambda: events.append("forecast_probe") or False,
            ),
            mock.patch.object(
                public_update,
                "suikei_refresh_due",
                side_effect=lambda: events.append("suikei_probe") or False,
            ),
            mock.patch.object(public_update, "prune_unreferenced_data"),
        ):
            public_update.main()

        extremes_index = events.index("update_temperature_distribution_extremes.py")
        realtime_index = events.index("update_temperature_distribution_realtime_observations.py")
        forecast_index = events.index("forecast_probe")
        self.assertLess(realtime_index, extremes_index)
        self.assertLess(extremes_index, forecast_index)


if __name__ == "__main__":
    unittest.main()
