from pathlib import Path
import unittest


APP_JS = Path(__file__).resolve().parents[1] / "app.js"


class TemperatureLegendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = APP_JS.read_text(encoding="utf-8")

    def test_extreme_heat_has_a_hard_40_degree_boundary(self):
        self.assertIn("const TEMPERATURE_EXTREME_HEAT_THRESHOLD_C = 40;", self.source)
        self.assertIn("const TEMPERATURE_EXTREME_HEAT_COLOR = [80, 0, 46];", self.source)
        self.assertIn("if (value >= TEMPERATURE_EXTREME_HEAT_THRESHOLD_C)", self.source)
        self.assertIn("[40, [180, 0, 104]]", self.source)

    def test_numeric_temperature_legend_reserves_a_40_plus_band(self):
        self.assertIn("const TEMPERATURE_LEGEND_MAX_C = 45;", self.source)
        self.assertIn("max: TEMPERATURE_LEGEND_MAX_C", self.source)
        self.assertIn("emphasizedThreshold: TEMPERATURE_EXTREME_HEAT_THRESHOLD_C", self.source)
        self.assertNotIn('"40以上"', self.source)

    def test_jma_tile_temperature_legend_uses_the_same_40_plus_color(self):
        self.assertIn('["40℃", rgb(TEMPERATURE_EXTREME_HEAT_COLOR)]', self.source)
        self.assertNotIn('"40℃以上"', self.source)


if __name__ == "__main__":
    unittest.main()
