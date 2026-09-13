from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


refresh_gate = load_module(
    "run_weather_distribution_refresh",
    ROOT / "scripts" / "run_weather_distribution_refresh.py",
)


class RefreshPolicyTests(unittest.TestCase):
    def execute(self):
        return refresh_gate.execute_refresh_policy(35.0, 12.0, 13.0)

    def test_valid_candidate_uses_strict_contract_without_restore(self):
        with (
            mock.patch.object(refresh_gate, "ensure_clean_publish_paths") as clean,
            mock.patch.object(refresh_gate, "run_stage") as run_stage,
            mock.patch.object(refresh_gate, "restore_paths") as restore,
        ):
            self.assertEqual(self.execute(), "candidate")

        clean.assert_called_once_with()
        self.assertEqual(
            [call.args[0] for call in run_stage.call_args_list],
            ["candidate-update", "candidate-freshness", "candidate-contract"],
        )
        self.assertIn("12.0", run_stage.call_args_list[-1].args[1])
        restore.assert_not_called()

    def test_contract_failure_keeps_fresh_observations_with_retained_forecast(self):
        def stage(stage, _command):
            if stage == "candidate-contract":
                raise refresh_gate.StageFailure(stage, 1)

        with (
            mock.patch.object(refresh_gate, "ensure_clean_publish_paths"),
            mock.patch.object(refresh_gate, "run_stage", side_effect=stage) as run_stage,
            mock.patch.object(refresh_gate, "restore_paths") as restore,
            mock.patch.object(refresh_gate, "emit_warning") as warning,
        ):
            self.assertEqual(self.execute(), "retained_forecast")

        restore.assert_called_once_with(refresh_gate.FORECAST_PATHS)
        self.assertEqual(run_stage.call_args_list[-1].args[0], "retained-forecast-contract")
        self.assertIn("13.0", run_stage.call_args_list[-1].args[1])
        warning.assert_called_once()

    def test_update_failure_retains_complete_last_known_good_snapshot(self):
        def stage(stage, _command):
            if stage == "candidate-update":
                raise refresh_gate.StageFailure(stage, 1)

        with (
            mock.patch.object(refresh_gate, "ensure_clean_publish_paths"),
            mock.patch.object(refresh_gate, "run_stage", side_effect=stage),
            mock.patch.object(refresh_gate, "restore_paths") as restore,
            mock.patch.object(refresh_gate, "emit_warning") as warning,
        ):
            self.assertEqual(self.execute(), "retained_snapshot")

        restore.assert_called_once_with(refresh_gate.PUBLISH_PATHS)
        warning.assert_called_once()

    def test_stale_retained_snapshot_still_fails_the_workflow(self):
        def stage(stage, _command):
            if stage in {"candidate-update", "retained-snapshot-freshness"}:
                raise refresh_gate.StageFailure(stage, 1)

        with (
            mock.patch.object(refresh_gate, "ensure_clean_publish_paths"),
            mock.patch.object(refresh_gate, "run_stage", side_effect=stage),
            mock.patch.object(refresh_gate, "restore_paths") as restore,
        ):
            with self.assertRaises(refresh_gate.RefreshGateFailure):
                self.execute()

        restore.assert_called_once_with(refresh_gate.PUBLISH_PATHS)

    def test_forecast_recovery_failure_falls_back_to_complete_snapshot(self):
        def stage(stage, _command):
            if stage in {"candidate-contract", "retained-forecast-contract"}:
                raise refresh_gate.StageFailure(stage, 1)

        with (
            mock.patch.object(refresh_gate, "ensure_clean_publish_paths"),
            mock.patch.object(refresh_gate, "run_stage", side_effect=stage),
            mock.patch.object(refresh_gate, "restore_paths") as restore,
            mock.patch.object(refresh_gate, "emit_warning"),
        ):
            self.assertEqual(self.execute(), "retained_snapshot")

        self.assertEqual(
            [call.args[0] for call in restore.call_args_list],
            [refresh_gate.FORECAST_PATHS, refresh_gate.PUBLISH_PATHS],
        )


if __name__ == "__main__":
    unittest.main()
