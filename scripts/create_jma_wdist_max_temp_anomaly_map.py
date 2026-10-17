#!/usr/bin/env python3
"""Create high-resolution JMA weather-distribution temperature anomaly maps.

Forecast source:
    JMA weather distribution max_temp_point / min_temp_point GeoJSON.

Normal source:
    Local 1996-2025 station climatology under public/weather-climatology.

The forecast grid is used directly. The normal field is estimated on the same
grid from station climatology with inverse-distance weighting. This is not a
mesh-normal replacement, but it preserves the JMA forecast field resolution and
keeps the normal-estimation step explicit.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import numpy as np
from PIL import Image, ImageDraw, ImageFont


INDEX_PATH = Path("public/weather-climatology/data/climatology_index_1996_2025_s_stations.json")
STATION_DIR = Path("public/weather-climatology/data/stations")
PREFECTURES_GEOJSON = Path("data/geography_japan_prefectures.geojson")
OUT_DIR = Path("outputs/weather/jma_wdist_temperature_maps")
TARGET_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/wdist/targetTimes.json"
WDIST_GEOJSON_URL = (
    "https://www.jma.go.jp/bosai/jmatile/data/wdist/"
    "{basetime}/{member}/{validtime}/surf/{element}_point/data.geojson?id={element}_point"
)
USER_AGENT = "NatureWxLab-TemperatureAnomalyMap/0.1"
FONT_CANDIDATES = (
    "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
)
MAX_INTERPOLATION_ELEVATION_M = 1500.0
JMA_NORMAL_SURFACE_ZIP = Path("data/weather/jma_normals_2020_v5/normal_surface.zip")
JMA_DAILY_NORMAL_CODES = {
    "min": "0700",
    "max": "0600",
}


@dataclass
class StationNormal:
    station_key: str
    name: str
    region: str
    lon: float
    lat: float
    normal_c: float


@dataclass
class GridPoint:
    lon: float
    lat: float
    value_c: float
    average_c: float
    anomaly_c: float


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        candidate = Path(path)
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def fetch_json(url: str) -> object:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    with urlopen(request, timeout=30) as response:
        payload = response.read()
        if response.headers.get("Content-Encoding") == "gzip" or payload[:2] == b"\x1f\x8b":
            payload = gzip.decompress(payload)
    return json.loads(payload.decode("utf-8"))


def parse_jma_time(value: str) -> datetime:
    return (
        datetime.strptime(value, "%Y%m%d%H%M%S")
        .replace(tzinfo=ZoneInfo("UTC"))
        .astimezone(ZoneInfo("Asia/Tokyo"))
    )


def element_point_name(element: str) -> str:
    return f"{element}_temp_point"


def element_label(element: str) -> str:
    return {"max": "最高気温", "min": "最低気温"}[element]


def select_target(target_times: list[dict[str, object]], mode: str, element: str) -> dict[str, str]:
    point_name = element_point_name(element)
    candidates = [
        item
        for item in target_times
        if point_name in item.get("elements", [])
    ]
    if not candidates:
        raise RuntimeError(f"targetTimes.json has no {point_name} candidate.")
    today = datetime.now(ZoneInfo("Asia/Tokyo")).date()
    if mode == "latest":
        selected = max(candidates, key=lambda item: str(item["validtime"]))
    else:
        wanted = today
        if mode == "tomorrow":
            wanted = today + timedelta(days=1)
        matches = [
            item
            for item in candidates
            if parse_jma_time(str(item["validtime"])).date() == wanted
        ]
        if not matches:
            available = ", ".join(parse_jma_time(str(item["validtime"])).strftime("%Y-%m-%d %H:%M") for item in candidates)
            raise RuntimeError(f"No {point_name} target for {wanted}. Available: {available}")
        selected = max(matches, key=lambda item: str(item["validtime"]))
    return {
        "basetime": str(selected["basetime"]),
        "validtime": str(selected["validtime"]),
        "member": str(selected.get("member", "none")),
    }


def day_key_from_validtime(validtime: str) -> str:
    dt = parse_jma_time(validtime)
    return dt.strftime("%m-%d")


def day_key_to_ordinal(day_key: str) -> int:
    month = int(day_key[:2])
    day = int(day_key[3:5])
    month_lengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return sum(month_lengths[: month - 1]) + day


def load_station_normals(index_path: Path, station_dir: Path, day_key: str, period: str, element: str) -> list[StationNormal]:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    ordinal = day_key_to_ordinal(day_key)
    normals: list[StationNormal] = []
    if period == "normal":
        return load_jma_station_normals(index, day_key, element)
    for station in index["stations"]:
        elevation = station.get("elevation_m")
        if elevation is not None and float(elevation) > MAX_INTERPOLATION_ELEVATION_M:
            continue
        station_key = station["station_key"]
        path = station_dir / f"{station_key}.json"
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        values = payload.get("stats", {}).get(period, {}).get(element, {}).get("mean", [])
        if ordinal < 1 or ordinal > len(values):
            continue
        value = values[ordinal - 1]
        if value is None:
            continue
        normals.append(
            StationNormal(
                station_key=station_key,
                name=str(station["name"]),
                region=str(station["region"]),
                lon=float(station["longitude"]),
                lat=float(station["latitude"]),
                normal_c=float(value),
            )
        )
    return normals


def load_jma_station_normals(index: dict, day_key: str, element: str) -> list[StationNormal]:
    code = JMA_DAILY_NORMAL_CODES.get(element)
    if not code or not JMA_NORMAL_SURFACE_ZIP.exists():
        return []
    month = int(day_key[:2])
    day = int(day_key[3:5])
    normals: list[StationNormal] = []
    with zipfile.ZipFile(JMA_NORMAL_SURFACE_ZIP) as archive:
        for station in index["stations"]:
            elevation = station.get("elevation_m")
            if elevation is not None and float(elevation) > MAX_INTERPOLATION_ELEVATION_M:
                continue
            block_no = str(station.get("block_no") or "").zfill(5)
            if not block_no:
                continue
            member = f"normal_surface/daily/nml_sfc_d_{block_no}.csv"
            try:
                text = archive.read(member).decode("cp932")
            except KeyError:
                continue
            value = jma_daily_normal_value(text, code, month, day)
            if value is None:
                continue
            normals.append(
                StationNormal(
                    station_key=str(station["station_key"]),
                    name=str(station["name"]),
                    region=str(station["region"]),
                    lon=float(station["longitude"]),
                    lat=float(station["latitude"]),
                    normal_c=value,
                )
            )
    return normals


def jma_daily_normal_value(text: str, code: str, month: int, day: int) -> float | None:
    for row in csv.reader(text.splitlines()):
        if len(row) < 7 or row[2].strip() != code:
            continue
        try:
            row_month = int(row[6])
        except ValueError:
            continue
        if row_month != month:
            continue
        value_index = 7 + (day - 1) * 2
        flag_index = value_index + 1
        if flag_index >= len(row):
            return None
        try:
            raw_value = int(row[value_index])
            flag = int(row[flag_index])
        except ValueError:
            return None
        if flag == 0:
            return None
        return raw_value / 10.0
    return None


def load_forecast_points(payload: dict[str, object]) -> list[tuple[float, float, float]]:
    points: list[tuple[float, float, float]] = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry", {})
        props = feature.get("properties", {})
        if geometry.get("type") != "Point":
            continue
        value = props.get("value")
        if value in (None, "", "ND"):
            continue
        lon, lat = geometry["coordinates"]
        lon_f = float(lon)
        lat_f = float(lat)
        if 122.0 <= lon_f <= 146.5 and 23.0 <= lat_f <= 46.5:
            points.append((lon_f, lat_f, float(value)))
    return points


def idw_normals_for_points(points: list[tuple[float, float, float]], normals: list[StationNormal]) -> np.ndarray:
    lon_values = np.array([station.lon for station in normals], dtype=np.float32)
    lat_values = np.array([station.lat for station in normals], dtype=np.float32)
    z_values = np.array([station.normal_c for station in normals], dtype=np.float32)
    out = np.empty((len(points),), dtype=np.float32)
    k = min(3, len(normals))

    for start in range(0, len(points), 2000):
        end = min(len(points), start + 2000)
        chunk = points[start:end]
        lons = np.array([item[0] for item in chunk], dtype=np.float32)[:, None]
        lats = np.array([item[1] for item in chunk], dtype=np.float32)[:, None]
        cos_lat = np.cos(np.deg2rad(lats))
        dx = (lons - lon_values[None, :]) * cos_lat
        dy = lats - lat_values[None, :]
        dist2 = dx * dx + dy * dy + 0.03 * 0.03
        nearest = np.argpartition(dist2, kth=k - 1, axis=1)[:, :k]
        nearest_dist2 = np.take_along_axis(dist2, nearest, axis=1)
        nearest_z = z_values[nearest]
        weights = 1.0 / nearest_dist2
        out[start:end] = np.sum(weights * nearest_z, axis=1) / np.sum(weights, axis=1)
    return out


def color_for_anomaly(value: float, limit: float) -> tuple[int, int, int]:
    stops = [
        (-1.0, (38, 110, 180)),
        (-0.55, (103, 169, 207)),
        (-0.16, (209, 229, 240)),
        (0.0, (247, 247, 247)),
        (0.16, (253, 219, 199)),
        (0.55, (239, 138, 98)),
        (1.0, (178, 24, 43)),
    ]
    t = max(-1.0, min(1.0, value / limit))
    for idx in range(len(stops) - 1):
        t0, c0 = stops[idx]
        t1, c1 = stops[idx + 1]
        if t0 <= t <= t1:
            local = (t - t0) / (t1 - t0)
            return tuple(int(c0[i] + (c1[i] - c0[i]) * local) for i in range(3))
    return stops[-1][1]


def lonlat_to_pixel(lon: float, lat: float, extent: tuple[float, float, float, float], frame: tuple[int, int, int, int]) -> tuple[float, float]:
    lon_min, lon_max, lat_min, lat_max = extent
    left, top, map_w, map_h = frame
    x = left + (lon - lon_min) / (lon_max - lon_min) * map_w
    y = top + (lat_max - lat) / (lat_max - lat_min) * map_h
    return x, y


def iter_lines(geometry: dict[str, object]):
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if geom_type == "Polygon":
        for ring in coords:
            yield ring
    elif geom_type == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                yield ring
    elif geom_type == "LineString":
        yield coords
    elif geom_type == "MultiLineString":
        for line in coords:
            yield line


def draw_boundaries(
    draw: ImageDraw.ImageDraw,
    geojson_path: Path,
    extent: tuple[float, float, float, float],
    frame: tuple[int, int, int, int],
) -> None:
    if not geojson_path.exists():
        return
    data = json.loads(geojson_path.read_text(encoding="utf-8"))
    for feature in data.get("features", []):
        geometry = feature.get("geometry") or {}
        for ring in iter_lines(geometry):
            points = [
                lonlat_to_pixel(float(lon), float(lat), extent, frame)
                for lon, lat, *_ in ring
                if extent[0] - 1 <= float(lon) <= extent[1] + 1 and extent[2] - 1 <= float(lat) <= extent[3] + 1
            ]
            if len(points) >= 2:
                draw.line(points, fill=(30, 30, 30), width=1)


def text_center(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, font: ImageFont.ImageFont, fill: str) -> None:
    left, top, right, bottom = box
    bbox = draw.textbbox((0, 0), text, font=font)
    x = left + (right - left - (bbox[2] - bbox[0])) / 2
    y = top + (bottom - top - (bbox[3] - bbox[1])) / 2
    draw.text((x, y), text, font=font, fill=fill)


def color_for_temperature(value: float) -> tuple[int, int, int]:
    stops = [
        (-20.0, (46, 52, 93)),
        (-10.0, (65, 105, 225)),
        (0.0, (103, 169, 207)),
        (10.0, (222, 235, 247)),
        (20.0, (255, 255, 191)),
        (25.0, (254, 224, 139)),
        (30.0, (244, 109, 67)),
        (35.0, (197, 27, 125)),
        (40.0, (94, 0, 106)),
    ]
    if value <= stops[0][0]:
        return stops[0][1]
    for idx in range(len(stops) - 1):
        v0, c0 = stops[idx]
        v1, c1 = stops[idx + 1]
        if v0 <= value <= v1:
            local = (value - v0) / (v1 - v0)
            return tuple(int(c0[i] + (c1[i] - c0[i]) * local) for i in range(3))
    return stops[-1][1]


def draw_map(
    grid_points: list[GridPoint],
    target: dict[str, str],
    prefectures: Path,
    out_path: Path,
    limit: float,
    period: str,
    element: str,
    mode: str,
) -> None:
    extent = (122.0, 146.5, 23.4, 46.2)
    width, height = 1900, 1360
    frame = (90, 165, 1500, 1025)
    left, top, map_w, map_h = frame
    img = Image.new("RGB", (width, height), "#ffffff")
    draw = ImageDraw.Draw(img)

    metric_label = element_label(element)
    if mode == "value":
        title = f"予想{metric_label}マップ {parse_jma_time(target['validtime']).strftime('%Y-%m-%d')}"
        subtitle = "JMA全国天気分布の気温格子（単位℃）"
    else:
        title = f"予想{metric_label}の平均との差マップ {parse_jma_time(target['validtime']).strftime('%Y-%m-%d')}"
        subtitle = f"JMA全国天気分布の{metric_label}格子 − {period}年統計の地点平均値IDW補間（単位℃）"
    text_center(draw, (0, 28, width, 76), title, load_font(38), "#111111")
    text_center(draw, (0, 94, width, 126), subtitle, load_font(20), "#333333")
    draw.rectangle((left, top, left + map_w, top + map_h), fill="#eef6fb", outline="#cbd7df")

    lons = sorted({round(point.lon, 5) for point in grid_points})
    lats = sorted({round(point.lat, 5) for point in grid_points})
    dlon = np.median(np.diff(lons)) if len(lons) > 1 else 0.0625
    dlat = np.median(np.diff(lats)) if len(lats) > 1 else 0.05

    for point in grid_points:
        x0, y0 = lonlat_to_pixel(point.lon - dlon / 2, point.lat + dlat / 2, extent, frame)
        x1, y1 = lonlat_to_pixel(point.lon + dlon / 2, point.lat - dlat / 2, extent, frame)
        if x1 < left or x0 > left + map_w or y1 < top or y0 > top + map_h:
            continue
        color = color_for_temperature(point.value_c) if mode == "value" else color_for_anomaly(point.anomaly_c, limit)
        draw.rectangle((x0, y0, x1 + 0.8, y1 + 0.8), fill=color)

    # Graticule first, boundaries second.
    for lon in range(124, 147, 4):
        x, _ = lonlat_to_pixel(lon, 35, extent, frame)
        draw.line((x, top, x, top + map_h), fill=(255, 255, 255), width=1)
        draw.text((x + 4, top + map_h - 24), f"{lon}E", font=load_font(13), fill="#555555")
    for lat in range(24, 47, 4):
        _, y = lonlat_to_pixel(135, lat, extent, frame)
        draw.line((left, y, left + map_w, y), fill=(255, 255, 255), width=1)
        draw.text((left + 6, y - 16), f"{lat}N", font=load_font(13), fill="#555555")

    draw_boundaries(draw, prefectures, extent, frame)
    draw.rectangle((left, top, left + map_w, top + map_h), outline="#222222", width=2)

    legend_left = 1635
    legend_top = 230
    draw.text((legend_left, legend_top - 50), "予想値" if mode == "value" else "平均との差", font=load_font(24), fill="#222222")
    draw.text((legend_left, legend_top - 20), "℃", font=load_font(16), fill="#333333")
    if mode == "value":
        legend_values = [40, 35, 30, 25, 20, 10, 0, -10, -20]
        v_max, v_min = 40.0, -20.0
        for i in range(270):
            value = v_max - ((v_max - v_min) * i / 269)
            draw.rectangle((legend_left, legend_top + i, legend_left + 38, legend_top + i), fill=color_for_temperature(value))
    else:
        legend_values = [limit, limit / 2, 0, -limit / 2, -limit]
        v_max, v_min = limit, -limit
        for i in range(270):
            value = limit - (2 * limit * i / 269)
            draw.rectangle((legend_left, legend_top + i, legend_left + 38, legend_top + i), fill=color_for_anomaly(value, limit))
    for value in legend_values:
        y = legend_top + (v_max - value) / (v_max - v_min) * 269
        draw.line((legend_left + 38, y, legend_left + 50, y), fill="#333333", width=1)
        label = f"{value:.0f}" if mode == "value" else f"{value:+.0f}"
        draw.text((legend_left + 60, y - 11), label, font=load_font(16), fill="#333333")

    key = (lambda item: item.value_c) if mode == "value" else (lambda item: item.anomaly_c)
    high = sorted(grid_points, key=key, reverse=True)[:1][0]
    low = sorted(grid_points, key=key)[:1][0]
    stats = [
        f"格子点: {len(grid_points):,}",
        f"最高: {key(high):+.1f}℃" if mode == "anomaly" else f"最高: {key(high):.1f}℃",
        f"最低: {key(low):+.1f}℃" if mode == "anomaly" else f"最低: {key(low):.1f}℃",
        f"基準時刻: {parse_jma_time(target['basetime']).strftime('%m/%d %H:%M')}",
        f"対象時刻: {parse_jma_time(target['validtime']).strftime('%m/%d %H:%M')}",
    ]
    for idx, line in enumerate(stats):
        draw.text((legend_left, legend_top + 345 + idx * 28), line, font=load_font(16), fill="#333333")

    note = (
        f"出典: 気象庁 全国天気分布 {element}_temp_point GeoJSON、"
        "気象庁日別値から作成した1996-2025地点統計。"
        "平均値は地点統計をIDW補間した暫定値。県境データ: dataofjapan/land."
    )
    text_center(draw, (0, height - 56, width, height - 24), note, load_font(14), "#444444")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, quality=95)


def write_grid_csv(points: list[GridPoint], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["longitude", "latitude", "forecast_c", "average_c_idw", "anomaly_c"])
        for point in points:
            writer.writerow([f"{point.lon:.5f}", f"{point.lat:.5f}", f"{point.value_c:.1f}", f"{point.average_c:.2f}", f"{point.anomaly_c:+.2f}"])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["latest", "today", "tomorrow"], default="latest")
    parser.add_argument("--element", choices=["max", "min"], default="max")
    parser.add_argument("--mode", choices=["anomaly", "value"], default="anomaly")
    parser.add_argument("--period", choices=["30", "20", "10", "5", "3"], default="30")
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    parser.add_argument("--station-dir", type=Path, default=STATION_DIR)
    parser.add_argument("--prefectures", type=Path, default=PREFECTURES_GEOJSON)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--limit", type=float, default=8.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    target_times = fetch_json(TARGET_TIMES_URL)
    target = select_target(target_times, args.target, args.element)
    target["element"] = f"{args.element}_temp"
    forecast_url = WDIST_GEOJSON_URL.format(**target)
    forecast_payload = fetch_json(forecast_url)
    forecast_points = load_forecast_points(forecast_payload)
    if not forecast_points:
        raise SystemExit(f"No forecast grid points found: {forecast_url}")

    day_key = day_key_from_validtime(target["validtime"])
    normals = load_station_normals(args.index, args.station_dir, day_key, args.period, args.element)
    if not normals:
        raise SystemExit(f"No station normals found for {day_key}")
    normal_values = idw_normals_for_points(forecast_points, normals)

    grid_points = [
        GridPoint(lon=lon, lat=lat, value_c=forecast, average_c=float(normal), anomaly_c=forecast - float(normal))
        for (lon, lat, forecast), normal in zip(forecast_points, normal_values)
    ]
    valid_date = parse_jma_time(target["validtime"]).strftime("%Y-%m-%d")
    stem = f"jma_wdist_{args.element}_temp_{args.mode}_{valid_date}_{args.period}y"
    png_path = args.out_dir / f"{stem}.png"
    csv_path = args.out_dir / f"{stem}.csv"
    draw_map(grid_points, target, args.prefectures, png_path, args.limit, args.period, args.element, args.mode)
    write_grid_csv(grid_points, csv_path)
    print(f"wrote {png_path}")
    print(f"wrote {csv_path}")
    print(f"forecast_url={forecast_url}")
    print(f"grid_points={len(grid_points):,} normals={len(normals):,}")


if __name__ == "__main__":
    main()
