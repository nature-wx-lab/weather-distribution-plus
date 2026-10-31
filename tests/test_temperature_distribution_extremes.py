import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime
from http.client import IncompleteRead
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo


SCRIPT = Path(__file__).parents[1] / "scripts" / "update_temperature_distribution_extremes.py"
SPEC = importlib.util.spec_from_file_location("temperature_distribution_extremes", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)

SCRIPTS_DIR = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import update_temperature_distribution_realtime_observations as REALTIME_MODULE  # noqa: E402
import update_temperature_station_records as RECORD_MODULE  # noqa: E402


class NumericTextTests(unittest.TestCase):
    def test_accepts_normal_values(self) -> None:
        self.assertEqual(MODULE.numeric_text("35.2"), "35.2")
        self.assertEqual(MODULE.numeric_text("-4.8"), "-4.8")

    def test_extracts_quality_marked_values(self) -> None:
        self.assertEqual(MODULE.numeric_text("35.2]"), "35.2")
        self.assertEqual(MODULE.numeric_text("35.2 )"), "35.2")
        self.assertEqual(MODULE.numeric_text("-4.8)"), "-4.8")

    def test_keeps_quality_marker_separate(self) -> None:
        self.assertEqual(MODULE.quality_marker("35.2]"), "]")
        self.assertEqual(MODULE.quality_marker("35.2 )"), ")")
        self.assertEqual(MODULE.quality_marker("-4.8"), "")


class RecordUpdateTableTests(unittest.TestCase):
    def test_keeps_official_tied_record_remark(self) -> None:
        table = {
            "rows": [
                ["都道府県", "市町村", "地点", "更新した値", "", "これまでの1位", "", "統計開始年", "備考"],
                ["", "", "", "℃", "時分", "℃", "年月日", "", ""],
                ["長野県", "飯田市", "南信濃（ミナミシナノ）", "39.5", "14:27", "39.5", "2020/08/17", "1978年", "[タイ記録]"],
            ]
        }
        parsed = MODULE.parse_update_table(table, "max_high", "all_time", {})

        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["station"], "南信濃")
        self.assertEqual(parsed[0]["remarks"], "[タイ記録]")


class FetchTextTests(unittest.TestCase):
    def test_retries_incomplete_http_body(self) -> None:
        broken_response = mock.MagicMock()
        broken_response.__enter__.return_value.read.side_effect = IncompleteRead(b"partial", 4)
        healthy_response = mock.MagicMock()
        healthy_response.__enter__.return_value.read.return_value = "正常".encode("utf-8")

        with mock.patch.object(MODULE, "urlopen", side_effect=[broken_response, healthy_response]), \
                mock.patch.object(MODULE.time, "sleep") as sleep:
            self.assertEqual(MODULE.fetch_text("https://example.invalid/mdrr"), "正常")

        sleep.assert_called_once_with(1)


class StationRecordTests(unittest.TestCase):
    def test_parses_temperature_top_ten_and_statistics_period(self) -> None:
        html = """
        <table>
          <tr><th>要素名／順位</th><th>1位</th><th>2位</th><th>3位</th><th>4位</th><th>5位</th><th>6位</th><th>7位</th><th>8位</th><th>9位</th><th>10位</th><th>統計期間</th></tr>
          <tr><td>日最高気温の高い方から(℃)</td><td>41.1(2026/7/23)</td><td>40.2(2001/7/24)</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>1979/1 2026/7</td></tr>
          <tr><td>日最低気温の低い方から(℃)</td><td>-16.3(1984/2/7)</td><td>-15.2(1994/1/31)</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>1979/1 2026/7</td></tr>
        </table>
        """
        parsed = RECORD_MODULE.parse_record_page(html)
        self.assertEqual(parsed["max"]["records"][0], [41.1, "2026-07-23"])
        self.assertEqual(parsed["min"]["records"][0], [-16.3, "1984-02-07"])
        self.assertEqual(parsed["max"]["statistics_start"], "1979-01")

    def test_selects_record_before_ranking_date(self) -> None:
        station_record = {
            "all_time": {
                "max": {
                    "records": [[41.1, "2026-07-23"], [40.2, "2001-07-24"]],
                    "statistics_start": "1979-01",
                }
            },
            "months": {
                "7": {
                    "max": {
                        "records": [[41.1, "2026-07-23"], [40.2, "2001-07-24"]],
                    }
                }
            },
        }
        metrics = REALTIME_MODULE.station_record_metrics(
            station_record,
            datetime(2026, 7, 23).date(),
            "max",
        )
        self.assertEqual(metrics, ("40.2", "2001-07-24", "40.2", "2001-07-24", "1979"))


class DailyMaxRaceTests(unittest.TestCase):
    def test_writes_small_immutable_delivery_and_retains_previous_index(self) -> None:
        archive = {
            "schema_version": 5,
            "generated_at": "2026-07-24T17:20:00+09:00",
            "latest_time": "2026-07-24T17:10:00+09:00",
            "dates": ["2026-07-24"],
            "elements": ["max", "min"],
            "frame_interval_minutes": 10,
            "top_n": 100,
            "station_population": 1,
            "stations": {
                "47662": {
                    "name": "東京",
                    "prefecture": "東京都",
                    "municipality": "千代田区",
                    "longitude": 139.75,
                    "latitude": 35.69,
                },
            },
            "days": [{
                "date": "2026-07-24",
                "max": {
                    "date": "2026-07-24",
                    "element": "max",
                    "frames": [{"time": "2026-07-24T17:10:00+09:00", "rows": [["47662", 36.2]]}],
                    "final_rankings": [["47662", 36.2, "2026-07-24T13:10:00+09:00", "千代田区", 3.1, 0.5, 39.5, "2004-07-20", 39.5, "2004-07-20", "1875"]],
                },
                "min": {
                    "date": "2026-07-24",
                    "element": "min",
                    "frames": [{"time": "2026-07-24T09:00:00+09:00", "rows": [["47662", 26.1]]}],
                    "final_rankings": [["47662", 26.1, "2026-07-24T04:50:00+09:00", "千代田区", 2.4, 0.3, -9.2, "1876-01-13", 17.0, "1913-07-11", "1875"]],
                },
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory)
            first = REALTIME_MODULE.write_temperature_race_delivery(out_dir, archive)
            first_index = json.loads((out_dir / first["index_json"]).read_text(encoding="utf-8"))
            self.assertEqual(first["slice_count"], 2)
            self.assertEqual(first["index_history"], [first["index_json"]])
            self.assertLess(first["maximum_slice_bytes"], 1_000_000)
            self.assertEqual(
                json.loads((out_dir / first_index["stations"]["json"]).read_text(encoding="utf-8"))["stations"],
                archive["stations"],
            )
            self.assertEqual(
                json.loads((out_dir / first_index["files"]["2026-07-24"]["max"]["json"]).read_text(encoding="utf-8"))["race"],
                archive["days"][0]["max"],
            )

            archive["generated_at"] = "2026-07-24T17:30:00+09:00"
            archive["latest_time"] = "2026-07-24T17:20:00+09:00"
            archive["days"][0]["max"]["frames"][0]["time"] = "2026-07-24T17:20:00+09:00"
            archive["days"][0]["max"]["frames"][0]["rows"][0][1] = 36.4
            archive["days"][0]["max"]["final_rankings"][0][1] = 36.4
            second = REALTIME_MODULE.write_temperature_race_delivery(out_dir, archive)

            self.assertNotEqual(first["index_json"], second["index_json"])
            self.assertEqual(second["index_history"][:2], [second["index_json"], first["index_json"]])
            self.assertTrue((out_dir / first["index_json"]).exists())
            self.assertTrue((out_dir / second["index_json"]).exists())
            first_references = REALTIME_MODULE.temperature_race_delivery_references(first_index)
            self.assertTrue(all((out_dir / filename).exists() for filename in first_references))

    def test_builds_top_100_running_maximum_frames_from_midnight(self) -> None:
        jst = ZoneInfo("Asia/Tokyo")
        stations = []
        for index in range(105):
            station_key = f"{index:05d}"
            stations.append({
                "station_key": station_key,
                "name": f"地点{index:03d}",
                "region": "試験県",
                "longitude": 130.0 + index / 100,
                "latitude": 30.0 + index / 100,
                "series": [
                    ["2026-07-21T00:00:00+09:00", float(index) / 10],
                    ["2026-07-21T00:10:00+09:00", float(index) / 10 - 1],
                    ["2026-07-21T00:20:00+09:00", float(index) / 10 + 1],
                ],
            })
        payload = REALTIME_MODULE.build_daily_max_race_payload(
            {"stations": stations},
            datetime(2026, 7, 21, 0, 20, tzinfo=jst),
        )

        self.assertEqual(payload["date"], "2026-07-21")
        self.assertEqual(payload["schema_version"], 2)
        self.assertEqual(len(payload["frames"]), 3)
        self.assertTrue(all(len(frame["rows"]) == 100 for frame in payload["frames"]))
        first_values = dict(payload["frames"][0]["rows"])
        second_values = dict(payload["frames"][1]["rows"])
        self.assertEqual(first_values, second_values)
        self.assertEqual(payload["frames"][-1]["rows"][0], ["00104", 11.4])
        self.assertEqual(payload["eligible_station_count"], 105)
        self.assertEqual(len(payload["final_rankings"]), 105)
        self.assertEqual(payload["final_rankings"][0][:3], ["00104", 11.4, "2026-07-21T00:20:00+09:00"])

    def test_applies_official_maximum_from_next_10_minute_frame(self) -> None:
        jst = ZoneInfo("Asia/Tokyo")
        station_series = {
            "stations": [{
                "station_key": "52606",
                "name": "多治見",
                "region": "岐阜県",
                "longitude": 137.1083,
                "latitude": 35.3467,
                "series": [
                    ["2026-07-21T14:00:00+09:00", 39.8],
                    ["2026-07-21T14:10:00+09:00", 39.9],
                    ["2026-07-21T14:20:00+09:00", 39.7],
                ],
            }],
        }
        payload = REALTIME_MODULE.build_daily_max_race_payload(
            station_series,
            datetime(2026, 7, 21, 14, 20, tzinfo=jst),
            official_maxima={
                "52606": {
                    "value_c": 40.3,
                    "observed_time": "2026-07-21T14:09:00+09:00",
                    "quality_marker": "]",
                },
            },
        )

        frames = {frame["time"]: dict(frame["rows"]) for frame in payload["frames"]}
        self.assertEqual(frames["2026-07-21T14:00:00+09:00"]["52606"], 39.8)
        self.assertEqual(frames["2026-07-21T14:10:00+09:00"]["52606"], 40.3)
        self.assertEqual(frames["2026-07-21T14:20:00+09:00"]["52606"], 40.3)
        self.assertEqual(payload["official_correction_event_count"], 1)
        self.assertEqual(payload["official_max_events"][0]["frame_time"], "2026-07-21T14:10:00+09:00")
        self.assertEqual(payload["final_rankings"][0][:3], ["52606", 40.3, "2026-07-21T14:09:00+09:00"])

    def test_parses_provisional_official_value_and_occurrence_minute(self) -> None:
        value, marker = REALTIME_MODULE.official_daily_maximum_number("40.3 ]")
        observed = REALTIME_MODULE.official_daily_maximum_time(
            datetime(2026, 7, 21).date(),
            "14:09]",
        )
        self.assertEqual(value, 40.3)
        self.assertEqual(marker, "]")
        self.assertEqual(observed.isoformat(), "2026-07-21T14:09:00+09:00")

    def test_overlays_rank_daily_when_its_publication_is_newer(self) -> None:
        jst = ZoneInfo("Asia/Tokyo")
        html = """
        <h1>今日の全国観測値ランキング（7月23日）15時00分現在</h1>
        <table>
          <caption>日最高気温の高い方から</caption>
          <tr><th>順位</th><th>都道府県</th><th>市町村</th><th>地点</th><th>観測値</th><th>時分</th></tr>
          <tr><th>順位</th><th>都道府県</th><th>市町村</th><th>地点</th><th>℃</th><th>時分</th></tr>
          <tr><td>1</td><td>静岡県</td><td>浜松市天竜区</td><td>佐久間（サクマ）</td><td>41.1 ]</td><td>14:17]</td></tr>
        </table>
        """
        inventory = {
            ("佐久間", "静岡県"): [{
                "block_no": "0986",
                "latitude": "35.0566666667",
                "longitude": "137.7616666667",
            }],
        }
        amedas_table = {
            "50226": {
                "lat": [35, 3.4],
                "lon": [137, 45.7],
            },
        }
        extrema = {
            "50226": {
                "station_key": "50226",
                "value_c": 40.8,
                "observed_time": "2026-07-23T13:49:00+09:00",
                "quality_marker": "]",
                "source_page": "mdrr_alltable",
            },
        }

        overlays = REALTIME_MODULE.overlay_newer_rank_daily_extrema(
            extrema,
            datetime(2026, 7, 23).date(),
            "max",
            html,
            datetime(2026, 7, 23, 14, 0, tzinfo=jst),
            inventory,
            amedas_table,
        )

        self.assertEqual(overlays, 1)
        self.assertEqual(extrema["50226"]["value_c"], 41.1)
        self.assertEqual(extrema["50226"]["observed_time"], "2026-07-23T14:17:00+09:00")
        self.assertEqual(extrema["50226"]["municipality"], "浜松市天竜区")
        self.assertEqual(extrema["50226"]["source_page"], "mdrr_rank_daily")
        self.assertEqual(extrema["50226"]["prior_events"][0]["value_c"], 40.8)

        station_series = {
            "stations": [{
                "station_key": "50226",
                "name": "佐久間",
                "region": "静岡県",
                "longitude": 137.7616666667,
                "latitude": 35.0566666667,
                "series": [
                    ["2026-07-23T13:40:00+09:00", 40.2],
                    ["2026-07-23T13:50:00+09:00", 40.2],
                    ["2026-07-23T14:10:00+09:00", 40.2],
                    ["2026-07-23T14:20:00+09:00", 40.2],
                ],
            }],
        }
        payload = REALTIME_MODULE.build_temperature_race_payload(
            station_series,
            datetime(2026, 7, 23).date(),
            "max",
            datetime(2026, 7, 23, 14, 20, tzinfo=jst),
            official_extrema=extrema,
        )
        frames = {frame["time"]: dict(frame["rows"]) for frame in payload["frames"]}
        self.assertEqual(frames["2026-07-23T13:50:00+09:00"]["50226"], 40.8)
        self.assertEqual(frames["2026-07-23T14:10:00+09:00"]["50226"], 40.8)
        self.assertEqual(frames["2026-07-23T14:20:00+09:00"]["50226"], 41.1)
        self.assertEqual(
            [(event["value_c"], event["source_page"]) for event in payload["official_events"]],
            [(40.8, "mdrr_alltable"), (41.1, "mdrr_rank_daily")],
        )
        self.assertEqual(
            payload["final_rankings"][0][:4],
            ["50226", 41.1, "2026-07-23T14:17:00+09:00", "浜松市天竜区"],
        )

    def test_builds_rank_only_extrema_before_all_station_table_is_published(self) -> None:
        html = """
        <h1>今日の全国観測値ランキング（8月30日）00時10分現在</h1>
        <table>
          <caption>日最高気温の高い方から</caption>
          <tr><th>順位</th><th>都道府県</th><th>市町村</th><th>地点</th><th>観測値</th><th>時分</th></tr>
          <tr><th>順位</th><th>都道府県</th><th>市町村</th><th>地点</th><th>℃</th><th>時分</th></tr>
          <tr><td>1</td><td>静岡県</td><td>浜松市天竜区</td><td>佐久間（サクマ）</td><td>27.4</td><td>00:09</td></tr>
        </table>
        """
        inventory = {
            ("佐久間", "静岡県"): [{
                "block_no": "0986",
                "latitude": "35.0566666667",
                "longitude": "137.7616666667",
            }],
        }
        amedas_table = {
            "50226": {
                "lat": [35, 3.4],
                "lon": [137, 45.7],
            },
        }

        extrema, count = REALTIME_MODULE.rank_daily_only_extrema(
            datetime(2026, 8, 30).date(),
            "max",
            html,
            inventory,
            amedas_table,
        )

        self.assertEqual(count, 1)
        self.assertEqual(extrema["50226"]["value_c"], 27.4)
        self.assertEqual(extrema["50226"]["observed_time"], "2026-08-30T00:09:00+09:00")
        self.assertEqual(extrema["50226"]["source_page"], "mdrr_rank_daily")

    def test_does_not_overlay_an_older_rank_daily_publication(self) -> None:
        jst = ZoneInfo("Asia/Tokyo")
        html = """
        <h1>今日の全国観測値ランキング（7月23日）13時50分現在</h1>
        <table>
          <caption>日最高気温の高い方から</caption>
          <tr><th>順位</th><th>都道府県</th><th>市町村</th><th>地点</th><th>観測値</th><th>時分</th></tr>
          <tr><th>順位</th><th>都道府県</th><th>市町村</th><th>地点</th><th>℃</th><th>時分</th></tr>
          <tr><td>1</td><td>静岡県</td><td>浜松市天竜区</td><td>佐久間（サクマ）</td><td>41.1 ]</td><td>14:17]</td></tr>
        </table>
        """
        extrema = {
            "50226": {
                "station_key": "50226",
                "value_c": 40.8,
                "observed_time": "2026-07-23T13:49:00+09:00",
                "quality_marker": "]",
                "source_page": "mdrr_alltable",
            },
        }

        overlays = REALTIME_MODULE.overlay_newer_rank_daily_extrema(
            extrema,
            datetime(2026, 7, 23).date(),
            "max",
            html,
            datetime(2026, 7, 23, 14, 0, tzinfo=jst),
            {},
            {},
        )

        self.assertEqual(overlays, 0)
        self.assertEqual(extrema["50226"]["value_c"], 40.8)

    def test_builds_minimum_race_from_previous_18_to_target_09(self) -> None:
        jst = ZoneInfo("Asia/Tokyo")
        station_series = {
            "stations": [{
                "station_key": "44132",
                "name": "東京",
                "region": "東京都",
                "longitude": 139.75,
                "latitude": 35.69,
                "series": [
                    ["2026-07-20T18:00:00+09:00", 27.5],
                    ["2026-07-21T05:00:00+09:00", 24.2],
                    ["2026-07-21T05:10:00+09:00", 24.4],
                    ["2026-07-21T09:00:00+09:00", 26.8],
                ],
            }],
        }
        payload = REALTIME_MODULE.build_temperature_race_payload(
            station_series,
            datetime(2026, 7, 21).date(),
            "min",
            datetime(2026, 7, 21, 19, 0, tzinfo=jst),
            official_extrema={
                "44132": {
                    "value_c": 23.9,
                    "observed_time": "2026-07-21T05:03:00+09:00",
                    "quality_marker": "",
                },
            },
        )

        self.assertEqual(payload["window_start"], "2026-07-20T18:00:00+09:00")
        self.assertEqual(payload["window_end"], "2026-07-21T09:00:00+09:00")
        self.assertEqual(len(payload["frames"]), 91)
        frames = {frame["time"]: dict(frame["rows"]) for frame in payload["frames"]}
        self.assertEqual(frames["2026-07-21T05:00:00+09:00"]["44132"], 24.2)
        self.assertEqual(frames["2026-07-21T05:10:00+09:00"]["44132"], 23.9)
        self.assertEqual(frames["2026-07-21T09:00:00+09:00"]["44132"], 23.9)


if __name__ == "__main__":
    unittest.main()
