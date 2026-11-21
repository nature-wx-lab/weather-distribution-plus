#!/usr/bin/env python3
"""Mirror the latest JMA estimated-weather tiles for same-origin web use.

JMA's 推計気象分布 is an hourly analysis.  Its raster tiles are 512 px and are
published only at even zoom levels.  Keeping a small, explicit mirror avoids a
cross-origin canvas when the web app exports a PNG.
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import math
import socket
import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image

try:
    import mapbox_vector_tile
except ImportError:  # Installed by the public workflow requirements.
    mapbox_vector_tile = None


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "temperature_distribution_tool"
SOURCE_ROOT = "https://www.jma.go.jp/bosai/jmatile/data/suikeikishou"
TARGET_TIMES_URL = f"{SOURCE_ROOT}/targetTimes.json"
AMEDAS_TABLE_URL = "https://www.jma.go.jp/bosai/amedas/const/amedastable.json"
USER_AGENT = "NatureWxLab-WeatherDistributionPlus/1.0"
ELEMENTS = {"temperature": "temp", "weather": "wthr", "sunshine": "suns1h"}
# The official data extent. A tighter Japan extent would omit remote islands.
DATA_BOUNDS = (118.0, 20.0, 150.0, 48.0)  # west, south, east, north
LABEL_ZOOM = 10
OVERVIEW_TILE_SIZE = 128


def fetch(url: str, timeout: int = 30, attempts: int = 3) -> bytes:
    """Fetch bytes, retrying transient transport errors and HTTP 5xx."""
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except HTTPError as error:
            if error.code < 500 or attempt + 1 >= attempts:
                raise
        except (TimeoutError, socket.timeout, URLError, ConnectionError):
            if attempt + 1 >= attempts:
                raise
        time.sleep(2**attempt)
    raise RuntimeError(f"unreachable fetch retry state: {url}")


def lon_to_x(lon: float, zoom: int) -> int:
    return max(0, min((1 << zoom) - 1, int((lon + 180.0) / 360.0 * (1 << zoom))))


def lat_to_y(lat: float, zoom: int) -> int:
    lat = max(-85.05112878, min(85.05112878, lat))
    value = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0
    return max(0, min((1 << zoom) - 1, int(value * (1 << zoom))))


def tile_coordinates(zoom: int) -> list[tuple[int, int, int]]:
    # JMA serves 512 px tiles. Their x/y indices therefore match 256 px XYZ at
    # zoom-1 (e.g. Tokyo is z8/x113/y50, not x227/y100).
    coordinate_zoom = zoom - 1
    west, south, east, north = DATA_BOUNDS
    return [
        (zoom, x, y)
        for x in range(lon_to_x(west, coordinate_zoom), lon_to_x(east, coordinate_zoom) + 1)
        for y in range(lat_to_y(north, coordinate_zoom), lat_to_y(south, coordinate_zoom) + 1)
    ]


def tile_x_to_lon(x: int, zoom: int) -> float:
    return x / (1 << zoom) * 360.0 - 180.0


def tile_y_to_lat(y: int, zoom: int) -> float:
    n = math.pi - 2.0 * math.pi * y / (1 << zoom)
    return math.degrees(math.atan(math.sinh(n)))


def overview_is_intact(out_dir: Path, slot: dict) -> bool:
    for layer in (slot.get("layers") or {}).values():
        overview = layer.get("overview_file")
        if not overview or not (out_dir / overview).is_file():
            return False
    return True


def ensure_slot_overviews(out_dir: Path, slot: dict, zoom: int) -> dict:
    """Build one screen-sized PNG per layer for near-instant nationwide display."""
    validtime = str(slot["validtime"])
    coords = tile_coordinates(zoom)
    coordinate_zoom = zoom - 1
    xs = sorted({x for _, x, _ in coords})
    ys = sorted({y for _, _, y in coords})
    x_index = {value: index for index, value in enumerate(xs)}
    y_index = {value: index for index, value in enumerate(ys)}
    overview_root = out_dir / "suikei_overviews" / validtime
    overview_root.mkdir(parents=True, exist_ok=True)
    bounds = [
        tile_x_to_lon(xs[0], coordinate_zoom),
        tile_y_to_lat(ys[-1] + 1, coordinate_zoom),
        tile_x_to_lon(xs[-1] + 1, coordinate_zoom),
        tile_y_to_lat(ys[0], coordinate_zoom),
    ]
    for key, layer in (slot.get("layers") or {}).items():
        destination = overview_root / f"{key}.png"
        if not destination.is_file():
            mosaic = Image.new(
                "RGBA",
                (len(xs) * OVERVIEW_TILE_SIZE, len(ys) * OVERVIEW_TILE_SIZE),
                (0, 0, 0, 0),
            )
            for _, x, y in coords:
                source = out_dir / "suikei_tiles" / validtime / key / str(zoom) / str(x) / f"{y}.png"
                if not source.is_file():
                    continue
                with Image.open(source) as tile:
                    reduced = tile.convert("RGBA").resize(
                        (OVERVIEW_TILE_SIZE, OVERVIEW_TILE_SIZE),
                        Image.Resampling.NEAREST,
                    )
                    mosaic.paste(reduced, (x_index[x] * OVERVIEW_TILE_SIZE, y_index[y] * OVERVIEW_TILE_SIZE))
            temporary = destination.with_suffix(".png.tmp")
            mosaic.save(temporary, format="PNG", optimize=True, compress_level=9)
            temporary.replace(destination)
        layer["overview_file"] = f"suikei_overviews/{validtime}/{key}.png"
        layer["overview_bounds"] = [round(value, 8) for value in bounds]
        layer["overview_width"] = len(xs) * OVERVIEW_TILE_SIZE
        layer["overview_height"] = len(ys) * OVERVIEW_TILE_SIZE
        layer["overview_source_zoom"] = zoom
    return slot


def amedas_label_tiles() -> list[tuple[int, int]]:
    table = json.loads(fetch(AMEDAS_TABLE_URL).decode("utf-8"))
    tiles: set[tuple[int, int]] = set()
    for station in table.values():
        try:
            lat = float(station["lat"][0]) + float(station["lat"][1]) / 60.0
            lon = float(station["lon"][0]) + float(station["lon"][1]) / 60.0
        except (KeyError, TypeError, ValueError, IndexError):
            continue
        x = lon_to_x(lon, LABEL_ZOOM)
        y = lat_to_y(lat, LABEL_ZOOM)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                tiles.add((x + dx, y + dy))
    return sorted(tiles)


def label_lonlat(x: int, y: int, px: float, py: float, extent: int) -> tuple[float, float]:
    n = 1 << LABEL_ZOOM
    lon = (x + px / extent) / n * 360.0 - 180.0
    mercator_y = y + (extent - py) / extent
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * mercator_y / n))))
    return lon, lat


def download_temperature_label_tile(task: tuple[str, str, int, int]) -> list[dict]:
    basetime, validtime, x, y = task
    url = f"{SOURCE_ROOT}/{basetime}/none/{validtime}/surf/temp_pbfs/{LABEL_ZOOM}/{x}/{y}.pbf"
    payload = fetch(url)
    if not payload:
        return []
    if payload[:2] == b"\x1f\x8b":
        payload = gzip.decompress(payload)
    decoded = mapbox_vector_tile.decode(payload)
    layer = decoded.get("grid") or {}
    extent = int(layer.get("extent") or 4096)
    labels = []
    for feature in layer.get("features") or []:
        props = feature.get("properties") or {}
        try:
            visible_zooms = json.loads(props.get("vzoom") or "[]")
            value = float(props["temp"])
            px, py = feature["geometry"]["coordinates"]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            continue
        if LABEL_ZOOM not in visible_zooms:
            continue
        lon, lat = label_lonlat(x, y, float(px), float(py), extent)
        if DATA_BOUNDS[0] <= lon <= DATA_BOUNDS[2] and DATA_BOUNDS[1] <= lat <= DATA_BOUNDS[3]:
            labels.append({"longitude": round(lon, 5), "latitude": round(lat, 5), "temperature_c": value})
    return labels


def update_temperature_labels(out_dir: Path, target: dict, workers: int) -> dict:
    if mapbox_vector_tile is None:
        raise RuntimeError("mapbox-vector-tile is required for official temperature labels")
    basetime, validtime = str(target["basetime"]), str(target["validtime"])
    tasks = [(basetime, validtime, x, y) for x, y in amedas_label_tiles()]
    labels: list[dict] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(download_temperature_label_tile, task) for task in tasks]
        for future in as_completed(futures):
            labels.extend(future.result())
    deduped = {
        (row["longitude"], row["latitude"], row["temperature_c"]): row
        for row in labels
    }
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "JMA estimated weather distribution temp_pbfs",
        "basetime": basetime,
        "validtime": validtime,
        "label_zoom": LABEL_ZOOM,
        "label_count": len(deduped),
        "labels": sorted(deduped.values(), key=lambda row: (row["latitude"], row["longitude"])),
    }
    path = out_dir / "suikei_temperature_labels.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)
    return payload


def has_visible_pixels(payload: bytes) -> bool:
    """Reject JMA's small all-transparent placeholder PNGs."""
    with Image.open(io.BytesIO(payload)) as image:
        rgba = image.convert("RGBA")
        alpha_min, alpha_max = rgba.getchannel("A").getextrema()
        return alpha_max > 0


def download_tile(task: tuple[str, str, str, str, int, int, int, Path]) -> tuple[bool, bool, str]:
    public_key, source_key, basetime, validtime, zoom, x, y, stage = task
    url = f"{SOURCE_ROOT}/{basetime}/none/{validtime}/surf/{source_key}/{zoom}/{x}/{y}.png"
    destination = stage / public_key / str(zoom) / str(x) / f"{y}.png"
    try:
        payload = fetch(url)
    except HTTPError as error:
        if error.code == 404:  # Ocean/outside-analysis tiles can be absent.
            return False, False, url
        raise
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return True, has_visible_pixels(payload), url


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--zooms",
        default="8",
        help="native official zooms (default 8 preserves the ~1 km source resolution)",
    )
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--keep-slots", type=int, default=48)
    parser.add_argument("--overview-only", action="store_true", help="build overview PNGs from mirrored tiles without network access")
    return parser.parse_args()


def reusable_manifest(out_dir: Path, validtime: str, zooms: list[int]) -> dict | None:
    """Return the current manifest only when its referenced tile slot is intact."""
    path = out_dir / "suikei_realtime_manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    if (
        manifest.get("availability") is not True
        or str(manifest.get("validtime") or "") != validtime
        or sorted(manifest.get("available_zooms") or []) != zooms
    ):
        return None
    layers = manifest.get("layers") or {}
    for key in ELEMENTS:
        layer = layers.get(key) or {}
        expected = int(layer.get("tile_count") or 0)
        visible = int(layer.get("visible_tile_count") or 0)
        slot_dir = out_dir / "suikei_tiles" / validtime / key
        if expected <= 0 or visible <= 0 or not slot_dir.is_dir():
            return None
        # Detect interrupted/manual deletion; extra files are harmless.
        if sum(1 for _ in slot_dir.rglob("*.png")) < expected:
            return None
        template = str(layer.get("tile_template") or "")
        if not template.startswith(f"suikei_tiles/{validtime}/{key}/"):
            return None
    return manifest


def read_existing_slots(out_dir: Path) -> dict[str, dict]:
    path = out_dir / "suikei_realtime_manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    slots = manifest.get("slots")
    if isinstance(slots, list):
        return {str(slot.get("validtime")): slot for slot in slots if slot.get("validtime")}
    validtime = str(manifest.get("validtime") or "")
    if validtime and isinstance(manifest.get("layers"), dict):
        return {validtime: {
            "basetime": str(manifest.get("basetime") or validtime),
            "validtime": validtime,
            "layers": manifest["layers"],
        }}
    return {}


def slot_is_intact(out_dir: Path, slot: dict, zooms: list[int]) -> bool:
    validtime = str(slot.get("validtime") or "")
    layers = slot.get("layers") or {}
    for key in ELEMENTS:
        layer = layers.get(key) or {}
        expected = int(layer.get("tile_count") or 0)
        visible = int(layer.get("visible_tile_count") or 0)
        slot_dir = out_dir / "suikei_tiles" / validtime / key
        if expected <= 0 or visible <= 0 or not slot_dir.is_dir():
            return False
        if sum(1 for _ in slot_dir.rglob("*.png")) < expected:
            return False
        if not str(layer.get("tile_template") or "").startswith(f"suikei_tiles/{validtime}/{key}/"):
            return False
    return True


def inspect_existing_slot(out_dir: Path, target: dict) -> dict | None:
    validtime = str(target["validtime"])
    layers: dict[str, dict] = {}
    for key, source in ELEMENTS.items():
        slot_dir = out_dir / "suikei_tiles" / validtime / key
        files = list(slot_dir.rglob("*.png")) if slot_dir.is_dir() else []
        if not files:
            return None
        visible = sum(1 for path in files if has_visible_pixels(path.read_bytes()))
        if visible <= 0:
            return None
        layers[key] = {
            "source_element": source,
            "tile_template": f"suikei_tiles/{validtime}/{key}/{{z}}/{{x}}/{{y}}.png",
            "tile_count": len(files),
            "visible_tile_count": visible,
        }
    return {"basetime": str(target["basetime"]), "validtime": validtime, "layers": layers}


def download_slot(out_dir: Path, target: dict, zooms: list[int], workers: int) -> dict:
    basetime, validtime = str(target["basetime"]), str(target["validtime"])
    tile_root = out_dir / "suikei_tiles"
    final_slot = tile_root / validtime
    with tempfile.TemporaryDirectory(prefix="suikei-", dir=out_dir) as temp:
        stage = Path(temp) / validtime
        tasks = [
            (public_key, source_key, basetime, validtime, zoom, x, y, stage)
            for public_key, source_key in ELEMENTS.items()
            for zoom in zooms
            for _, x, y in tile_coordinates(zoom)
        ]
        counts = {key: 0 for key in ELEMENTS}
        visible_counts = {key: 0 for key in ELEMENTS}
        failures: list[str] = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(download_tile, task): task for task in tasks}
            for future in as_completed(futures):
                task = futures[future]
                try:
                    downloaded, visible, _url = future.result()
                    if downloaded:
                        counts[task[0]] += 1
                    if visible:
                        visible_counts[task[0]] += 1
                except Exception as error:
                    _, source_key, task_base, task_valid, zoom, x, y, _ = task
                    url = f"{SOURCE_ROOT}/{task_base}/none/{task_valid}/surf/{source_key}/{zoom}/{x}/{y}.png"
                    failures.append(f"{url}: {type(error).__name__}: {error}")
        if failures:
            preview = "\n".join(failures[:20])
            remainder = f"\n... and {len(failures) - 20} more" if len(failures) > 20 else ""
            raise RuntimeError(f"JMA tile download failures ({len(failures)}):\n{preview}{remainder}")
        if any(count == 0 for count in counts.values()) or any(count == 0 for count in visible_counts.values()):
            raise RuntimeError(f"Incomplete JMA tile download: counts={counts}, visible={visible_counts}")
        if final_slot.exists():
            shutil.rmtree(final_slot)
        stage.replace(final_slot)
    return {
        "basetime": basetime,
        "validtime": validtime,
        "layers": {
            key: {
                "source_element": source,
                "tile_template": f"suikei_tiles/{validtime}/{key}/{{z}}/{{x}}/{{y}}.png",
                "tile_count": counts[key],
                "visible_tile_count": visible_counts[key],
            }
            for key, source in ELEMENTS.items()
        },
    }


def select_retained_slot_ids(
    remote_ids: list[str],
    intact_existing_ids: list[str],
    keep_slots: int,
) -> list[str]:
    """Select a full retained window without inventing an incomplete JMA slot."""
    selected = sorted(set(remote_ids))[-keep_slots:]
    if len(selected) < keep_slots:
        missing = keep_slots - len(selected)
        supplements = [
            validtime
            for validtime in sorted(set(intact_existing_ids), reverse=True)
            if validtime not in selected
        ][:missing]
        selected = sorted([*selected, *supplements])[-keep_slots:]
    return selected


def main() -> None:
    args = parse_args()
    zooms = sorted({int(value) for value in args.zooms.split(",") if value.strip()})
    if not zooms or any(zoom < 4 or zoom > 10 or zoom % 2 for zoom in zooms):
        raise SystemExit("--zooms must contain even official zooms from 4 through 10")
    if args.keep_slots < 1:
        raise SystemExit("--keep-slots must be at least 1")

    if args.overview_only:
        manifest_path = args.out_dir / "suikei_realtime_manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        slots = manifest.get("slots") or []
        if not slots:
            raise RuntimeError("existing manifest has no slots")
        for slot in slots:
            ensure_slot_overviews(args.out_dir, slot, max(zooms))
        manifest["schema_version"] = 3
        manifest["generated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        manifest["layers"] = slots[-1]["layers"]
        temporary_manifest = manifest_path.with_suffix(".json.tmp")
        temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary_manifest.replace(manifest_path)
        print(json.dumps({"schema_version": 3, "slot_count": len(slots), "overview_count": len(slots) * len(ELEMENTS)}, ensure_ascii=False))
        return

    targets = json.loads(fetch(TARGET_TIMES_URL).decode("utf-8"))
    eligible = [item for item in targets if all(key in item.get("elements", []) for key in ELEMENTS.values())]
    if not eligible:
        raise RuntimeError("JMA targetTimes has no slot containing temp, wthr and suns1h")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    tile_root = args.out_dir / "suikei_tiles"
    tile_root.mkdir(exist_ok=True)
    existing_slots = read_existing_slots(args.out_dir)
    target_by_id = {str(target["validtime"]): target for target in eligible}
    intact_existing_ids = [
        validtime
        for validtime, slot in existing_slots.items()
        if validtime not in target_by_id
        and slot_is_intact(args.out_dir, slot, zooms)
        and overview_is_intact(args.out_dir, slot)
    ]
    selected_ids = select_retained_slot_ids(
        list(target_by_id),
        intact_existing_ids,
        args.keep_slots,
    )
    selected_targets = [target_by_id[validtime] for validtime in selected_ids if validtime in target_by_id]
    manifest_path = args.out_dir / "suikei_realtime_manifest.json"
    try:
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        existing_manifest = None
    if (
        isinstance(existing_manifest, dict)
        and existing_manifest.get("schema_version") == 3
        and [str(slot.get("validtime")) for slot in existing_manifest.get("slots", [])] == selected_ids
        and all(
            validtime in existing_slots
            and slot_is_intact(args.out_dir, existing_slots[validtime], zooms)
            and overview_is_intact(args.out_dir, existing_slots[validtime])
            for validtime in selected_ids
        )
    ):
        label_path = args.out_dir / "suikei_temperature_labels.json"
        try:
            label_payload = json.loads(label_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            label_payload = {}
        if str(label_payload.get("validtime") or "") == selected_ids[-1]:
            print(json.dumps(existing_manifest, ensure_ascii=False, indent=2))
            return
    slots: list[dict] = []
    for index, validtime in enumerate(selected_ids, start=1):
        target = target_by_id.get(validtime)
        existing = existing_slots.get(validtime)
        if existing and slot_is_intact(args.out_dir, existing, zooms):
            slots.append(ensure_slot_overviews(args.out_dir, existing, max(zooms)))
            continue
        if target is None:
            raise RuntimeError(f"retained 推計気象分布 slot is incomplete: {validtime}")
        discovered = inspect_existing_slot(args.out_dir, target)
        if discovered and slot_is_intact(args.out_dir, discovered, zooms):
            slots.append(ensure_slot_overviews(args.out_dir, discovered, max(zooms)))
            continue
        print(f"downloading 推計気象分布 {index}/{len(selected_ids)}: {validtime}", flush=True)
        slots.append(ensure_slot_overviews(args.out_dir, download_slot(args.out_dir, target, zooms, args.workers), max(zooms)))

    latest = slots[-1]
    temperature_labels = update_temperature_labels(args.out_dir, selected_targets[-1], args.workers)
    manifest = {
        "schema_version": 3,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "JMA estimated weather distribution (推計気象分布)",
        "source_target_times": TARGET_TIMES_URL,
        "basetime": latest["basetime"],
        "validtime": latest["validtime"],
        "slot_count": len(slots),
        "tile_size": 512,
        "available_zooms": zooms,
        "display_min_zoom": 4,
        "display_max_zoom": 12,
        "native_zoom": max(zooms),
        "availability": True,
        "resolution_note": "Official ~1 km hourly analyses; the latest 48 target times are mirrored. Native z=8 tiles are scaled outside the native zoom.",
        "bounds": {"west": DATA_BOUNDS[0], "south": DATA_BOUNDS[1], "east": DATA_BOUNDS[2], "north": DATA_BOUNDS[3]},
        "layers": latest["layers"],
        "temperature_labels": {
            "file": "suikei_temperature_labels.json",
            "validtime": temperature_labels["validtime"],
            "label_count": temperature_labels["label_count"],
            "precision_c": 0.5,
        },
        "slots": slots,
    }
    temporary_manifest = manifest_path.with_suffix(".json.tmp")
    temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary_manifest.replace(manifest_path)

    keep_ids = {str(slot["validtime"]) for slot in slots}
    for stale in (path for path in tile_root.iterdir() if path.is_dir() and path.name not in keep_ids):
        shutil.rmtree(stale)
    overview_root = args.out_dir / "suikei_overviews"
    if overview_root.is_dir():
        for stale in (path for path in overview_root.iterdir() if path.is_dir() and path.name not in keep_ids):
            shutil.rmtree(stale)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
