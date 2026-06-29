const DATA_ROOT = "./data/temperature_distribution_tool";
const BOUNDARY_URL = "./data/geography_japan_prefectures.geojson";
const WORLD_BOUNDARY_URL = "./data/geography_world_countries.geojson";
const PLACE_LABEL_URL = "./data/station_inventory_current_temperature.csv";
const TEMPERATURE_EXTREMES_URL = `${DATA_ROOT}/temperature_extremes.json`;
const FORECAST_MANIFEST_POLL_MS = 10 * 60 * 1000;
const OBSERVED_DATA_POLL_MS = 10 * 60 * 1000;
const SUIKEI_MANIFEST_URL = `${DATA_ROOT}/suikei_realtime_manifest.json`;
const MAX_INTERPOLATION_ELEVATION_M = 1500;
const MAJOR_PLACE_NAMES = new Set([
  "稚内", "旭川", "札幌", "釧路", "青森", "盛岡", "秋田", "仙台", "山形", "福島",
  "新潟", "富山", "金沢", "福井", "宇都宮", "前橋", "水戸", "熊谷", "東京", "千葉",
  "横浜", "甲府", "長野", "岐阜", "静岡", "名古屋", "津", "彦根", "京都", "大阪",
  "神戸", "奈良", "和歌山", "鳥取", "松江", "岡山", "広島", "山口", "徳島", "高松",
  "松山", "高知", "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "那覇",
  "名瀬", "石垣島", "父島"
]);
const state = {
  source: "forecast",
  observedLayer: "daily",
  forecastLayer: "daily",
  element: "max",
  mode: "value",
  period: "30",
  target: "tomorrow",
  slotIndex: 0,
  forecastManifestGeneratedAt: null,
  forecastSlots: [
    { id: "tomorrow_max", label: "18日最高", element: "max", status: "available", target_date: "2026-06-18", message: "" },
  ],
  observedSlots: [
    { id: "today_min", element: "min", label: "今日最低", target_date: "" },
    { id: "today_max", element: "max", label: "今日最高", target_date: "" },
  ],
  observedManifestGeneratedAt: null,
  observedRealtimeLayers: {},
  realtimeStations: [],
  realtimeStationMeta: null,
  suikeiManifest: null,
  suikeiManifestGeneratedAt: null,
  suikeiSlotIndex: null,
  suikeiTileCache: new Map(),
  suikeiTemperatureLabels: null,
  forecastLayers: null,
  points: [],
  weatherFeatures: [],
  observedDate: null,
  showPlaceLabels: true,
  placeLabels: [],
  chartStations: [],
  observedDataSignature: null,
  boundaries: null,
  worldBoundaries: null,
  hoverPoint: null,
  selectedPoint: null,
  pointChartSource: "observed",
  pointChartType: "realtime",
  pointChartDays: 7,
  pointChartShowAverage: true,
  realtimeStationSeries: null,
  vpfdIndex: null,
  vpfdCache: new Map(),
  pointChartRows: [],
  pointChartPlotPoints: [],
  temperatureExtremes: null,
  showRecordMarkers: false,
  showRankingPanel: false,
  rankingPanelPosition: null,
  rankingPanelDragging: false,
  rankingPanelDragStart: null,
  bounds: [122, 146.5, 23.4, 46.2],
  view: null,
  minScale: null,
  dragging: false,
  dragStart: null,
  dragMoved: false,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[character]));
}

const els = {
  canvas: document.getElementById("mapCanvas"),
  tooltip: document.getElementById("tooltip"),
  elementSelect: document.getElementById("elementSelect"),
  forecastLayerSelect: document.getElementById("forecastLayerSelect"),
  forecastLayerButtons: document.getElementById("forecastLayerButtons"),
  timelineRange: document.getElementById("timelineRange"),
  timelinePrevButton: document.getElementById("timelinePrevButton"),
  timelineNextButton: document.getElementById("timelineNextButton"),
  timelineMinLabel: document.getElementById("timelineMinLabel"),
  timelineMaxLabel: document.getElementById("timelineMaxLabel"),
  timelineTicks: document.getElementById("timelineTicks"),
  timelineBottom: document.querySelector(".timeline-labels.bottom"),
  layerControlHeading: document.getElementById("layerControlHeading"),
  observedLayerButtons: document.getElementById("observedLayerButtons"),
  dataNotice: document.getElementById("dataNotice"),
  modeSelect: document.getElementById("modeSelect"),
  modeButtons: document.getElementById("modeButtons"),
  periodSelect: document.getElementById("periodSelect"),
  targetSelect: document.getElementById("targetSelect"),
  placeLabelsToggle: document.getElementById("placeLabelsToggle"),
  statusText: document.getElementById("statusText"),
  mapTitle: document.getElementById("mapTitle"),
  mapSubtitle: document.getElementById("mapSubtitle"),
  timestampBadge: document.getElementById("timestampBadge"),
  mapStampMain: document.getElementById("mapStampMain"),
  mapStampSub: document.getElementById("mapStampSub"),
  lonValue: document.getElementById("lonValue"),
  latValue: document.getElementById("latValue"),
  mapValue: document.getElementById("mapValue"),
  baseValueRow: document.getElementById("baseValueRow"),
  forecastValue: document.getElementById("forecastValue"),
  anomalyValue: document.getElementById("anomalyValue"),
  fitButton: document.getElementById("fitButton"),
  zoomInButton: document.getElementById("zoomInButton"),
  zoomOutButton: document.getElementById("zoomOutButton"),
  downloadButton: document.getElementById("downloadButton"),
  copyLinkButton: document.getElementById("copyLinkButton"),
  copyLinkStatus: document.getElementById("copyLinkStatus"),
  canvasWrap: document.querySelector(".canvas-wrap"),
  zoomThumb: document.querySelector(".zoom-thumb"),
  pointChartPanel: document.getElementById("pointChartPanel"),
  pointChartTitle: document.getElementById("pointChartTitle"),
  pointChartMeta: document.getElementById("pointChartMeta"),
  pointChartCloseButton: document.getElementById("pointChartCloseButton"),
  pointChartSourceButtons: document.getElementById("pointChartSourceButtons"),
  pointChartTypeButtons: document.getElementById("pointChartTypeButtons"),
  pointChartRangeButtons: document.getElementById("pointChartRangeButtons"),
  pointChartAverageToggle: document.getElementById("pointChartAverageToggle"),
  pointChartCanvas: document.getElementById("pointChartCanvas"),
  pointChartStations: document.getElementById("pointChartStations"),
  pointChartTooltip: document.getElementById("pointChartTooltip"),
  pointChartLegend: document.getElementById("pointChartLegend"),
  recordMarkersButton: document.getElementById("recordMarkersButton"),
  rankingPanelButton: document.getElementById("rankingPanelButton"),
  rankingPanel: document.getElementById("rankingPanel"),
};

const ctx = els.canvas.getContext("2d");
const chartCtx = els.pointChartCanvas?.getContext("2d");

function resizeCanvasToDisplay() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(900, Math.round(rect.width * dpr));
  const height = Math.max(620, Math.round(rect.height * dpr));
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
    fitView();
  }
}

function csvPath() {
  const suffix = periodSuffix(state.period);
  if (state.source === "forecast") {
    const slot = currentForecastSlot();
    if (state.forecastLayer === "temp3h") return `${DATA_ROOT}/forecast_${slot.id}_value.csv`;
    return `${DATA_ROOT}/forecast_${slot.id}_anomaly_${suffix}.csv`;
  }
  if (state.element !== "temp") {
    const slot = currentObservedSlot();
    if (slot?.id) return `${DATA_ROOT}/observed_${slot.id}_anomaly_${suffix}.csv`;
  }
  if (state.element === "temp") return `${DATA_ROOT}/observed_temp_value_30y.csv`;
  return `${DATA_ROOT}/${state.source}_${state.element}_anomaly_${suffix}.csv`;
}

function periodSuffix(period) {
  return period === "normal" ? "normal" : `${period}y`;
}

function currentForecastSlot() {
  const slots = currentForecastSlots();
  return slots[Math.max(0, Math.min(state.slotIndex, slots.length - 1))] || slots[0] || state.forecastSlots[0];
}

function currentForecastSlots() {
  if (state.forecastLayers?.[state.forecastLayer]?.slots?.length) {
    return state.forecastLayers[state.forecastLayer].slots;
  }
  return state.forecastSlots;
}

function currentObservedSlot() {
  const slots = state.observedSlots;
  return slots[Math.max(0, Math.min(state.slotIndex, slots.length - 1))] || slots[0];
}

function suikeiSlots() {
  const slots = state.suikeiManifest?.slots;
  if (Array.isArray(slots) && slots.length) return slots;
  if (state.suikeiManifest?.validtime && state.suikeiManifest?.layers) {
    return [{
      basetime: state.suikeiManifest.basetime,
      validtime: state.suikeiManifest.validtime,
      layers: state.suikeiManifest.layers,
    }];
  }
  return [];
}

function currentSuikeiSlot() {
  const slots = suikeiSlots();
  if (!slots.length) return null;
  const index = Number.isInteger(state.suikeiSlotIndex)
    ? Math.max(0, Math.min(state.suikeiSlotIndex, slots.length - 1))
    : slots.length - 1;
  return slots[index];
}

function isSuikeiObservedLayer(layer = state.observedLayer) {
  return ["temp", "weather", "sunshine"].includes(layer);
}

function latestObservedSlotIndex(preferredElement = "max") {
  for (let i = state.observedSlots.length - 1; i >= 0; i -= 1) {
    if (state.observedSlots[i]?.element === preferredElement) return i;
  }
  return Math.max(0, state.observedSlots.length - 1);
}

function firstAvailableSlotIndex(slots) {
  const index = slots.findIndex((slot) => slot.status === "available");
  return index >= 0 ? index : 0;
}

function currentDataType() {
  if (state.source !== "forecast") return { precip1h: "precipitation", wind: "wind", weather: "weather", sunshine: "sunshine" }[state.observedLayer] || "temperature";
  return state.forecastLayers?.[state.forecastLayer]?.data_type || "temperature";
}

function observedTimelineVisible() {
  return state.source !== "observed" || state.observedLayer === "daily" || isSuikeiObservedLayer();
}

function isPolygonDataType(dataType = currentDataType()) {
  return ["weather", "precipitation", "snowfall"].includes(dataType);
}

function shortDateElementLabel(dateText, element) {
  if (!dateText) return element === "min" ? "最低" : "最高";
  const parts = String(dateText).split("-");
  const day = Number(parts[2]);
  const dayLabel = Number.isFinite(day) ? `${day}日` : "";
  return `${dayLabel}${element === "min" ? "最低" : "最高"}`;
}

async function loadForecastManifest() {
  try {
    const response = await fetch(`${DATA_ROOT}/forecast_manifest.json`, { cache: "no-store" });
    if (!response.ok) return;
    const manifest = await response.json();
    applyForecastManifest(manifest);
  } catch {
    // Keep bundled fallback slots when the local refresh has not run yet.
  }
}

function applyForecastManifest(manifest) {
  state.forecastManifestGeneratedAt = manifest.generated_at || null;
  if (manifest.layers && typeof manifest.layers === "object") {
    state.forecastLayers = manifest.layers;
    if (!state.forecastLayers[state.forecastLayer]) state.forecastLayer = "daily";
    els.forecastLayerSelect.value = state.forecastLayer;
    state.forecastSlots = state.forecastLayers.daily?.slots || manifest.slots || state.forecastSlots;
  } else if (Array.isArray(manifest.slots) && manifest.slots.length) {
    state.forecastSlots = manifest.slots;
  }
  const slots = currentForecastSlots();
  state.slotIndex = Math.min(state.slotIndex, slots.length - 1);
  if (state.slotIndex <= 0 && slots[state.slotIndex]?.status !== "available") {
    state.slotIndex = firstAvailableSlotIndex(slots);
  }
  state.element = currentForecastSlot().element;
  els.elementSelect.value = state.element === "min" ? "min" : "max";
}

async function checkForecastManifestUpdate() {
  if (state.source !== "forecast") return;
  try {
    const response = await fetch(`${DATA_ROOT}/forecast_manifest.json`, { cache: "no-store" });
    if (!response.ok) return;
    const manifest = await response.json();
    const generatedAt = manifest.generated_at || null;
    if (!generatedAt || generatedAt === state.forecastManifestGeneratedAt) return;
    applyForecastManifest(manifest);
    syncTimelineFromElement();
    await loadData();
  } catch {
    // Keep the current display if the local updater is writing files or offline.
  }
}

async function checkObservedDataUpdate() {
  if (state.source !== "observed") return;
  try {
    const manifestResponse = await fetch(`${DATA_ROOT}/observed_realtime_manifest.json`, { cache: "no-store" });
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json();
      applyObservedManifest(manifest);
    }
    const suikeiResponse = await fetch(SUIKEI_MANIFEST_URL, { cache: "no-store" });
    if (suikeiResponse.ok) {
      const suikeiManifest = await suikeiResponse.json();
      if (suikeiManifest.generated_at && suikeiManifest.generated_at !== state.suikeiManifestGeneratedAt) {
        applySuikeiManifest(suikeiManifest);
        await loadSuikeiTemperatureLabels();
        if (isSuikeiObservedLayer()) {
          syncTimelineFromElement();
          await loadData();
          return;
        }
      }
    }
    const dataResponse = await fetch(csvPath(), { method: "HEAD", cache: "no-store" });
    if (!dataResponse.ok) return;
    const signature = dataResponse.headers.get("last-modified") || dataResponse.headers.get("etag") || state.observedManifestGeneratedAt;
    if (!signature || signature === state.observedDataSignature) return;
    state.observedDataSignature = signature;
    await loadData();
  } catch {
    // Keep the current display if observed CSVs are being regenerated.
  }
}

async function loadObservedManifest() {
  try {
    const response = await fetch(`${DATA_ROOT}/observed_realtime_manifest.json`, { cache: "no-store" });
    if (!response.ok) return;
    applyObservedManifest(await response.json());
  } catch {
    // Keep fallback observed slots until realtime observations are generated.
  }
}

async function loadSuikeiManifest() {
  try {
    const response = await fetch(SUIKEI_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    applySuikeiManifest(await response.json());
    await loadSuikeiTemperatureLabels();
  } catch {
    state.suikeiManifest = null;
  }
}

async function loadSuikeiTemperatureLabels() {
  const file = state.suikeiManifest?.temperature_labels?.file;
  if (!file) {
    state.suikeiTemperatureLabels = null;
    return;
  }
  try {
    const response = await fetch(`${DATA_ROOT}/${file}`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    state.suikeiTemperatureLabels = await response.json();
  } catch {
    state.suikeiTemperatureLabels = null;
  }
}

function applySuikeiManifest(manifest) {
  const previousSlots = suikeiSlots();
  const requestedIndex = state.suikeiSlotIndex;
  const previousIndex = Number.isInteger(state.suikeiSlotIndex) ? state.suikeiSlotIndex : previousSlots.length - 1;
  const previousValidtime = previousSlots[previousIndex]?.validtime;
  const wasLatest = previousSlots.length === 0
    ? !Number.isInteger(requestedIndex)
    : previousIndex >= previousSlots.length - 1;
  state.suikeiManifest = manifest;
  state.suikeiManifestGeneratedAt = manifest.generated_at || null;
  const slots = suikeiSlots();
  const preservedIndex = slots.findIndex((slot) => slot.validtime === previousValidtime);
  state.suikeiSlotIndex = previousSlots.length === 0 && Number.isInteger(requestedIndex)
    ? Math.max(0, Math.min(requestedIndex, slots.length - 1))
    : wasLatest
      ? Math.max(0, slots.length - 1)
      : preservedIndex >= 0 ? preservedIndex : Math.max(0, slots.length - 1);
  ["temperature", "weather", "sunshine"].forEach((name) => {
    const layer = currentSuikeiSlot()?.layers?.[name];
    const observedName = name === "temperature" ? "temp" : name;
    if (layer && manifest.availability !== false) {
      layer.availability = true;
      state.observedRealtimeLayers[observedName] = { available: true };
    }
  });
}

function applyObservedManifest(manifest) {
  state.observedManifestGeneratedAt = manifest.generated_at || state.observedManifestGeneratedAt;
  const realtime = manifest.realtime_layers && typeof manifest.realtime_layers === "object" ? manifest.realtime_layers : {};
  const station = realtime.station_observations || {};
  const elements = station.elements || {};
  state.observedRealtimeLayers = {
    temp: realtime.temp || { available: true },
    precip1h: realtime.precip1h || (elements.precipitation_1h ? { available: true } : null),
    wind: realtime.wind || (elements.wind_speed || elements.wind_direction ? { available: true } : null),
    weather: realtime.weather || null,
    sunshine: realtime.sunshine || null,
  };
  state.realtimeStationMeta = station;
  if (["precip1h", "wind"].includes(state.observedLayer) && !state.observedRealtimeLayers[state.observedLayer]?.available) {
    state.observedLayer = "temp";
  }
  if (Array.isArray(manifest.slots) && manifest.slots.length) {
    const previousSlot = currentObservedSlot();
    state.observedSlots = manifest.slots;
    if (state.element !== "temp") {
      const nextIndex = state.observedSlots.findIndex((slot) => slot.id === previousSlot?.id);
      state.slotIndex = nextIndex >= 0 ? nextIndex : Math.max(0, state.observedSlots.length - 1);
      state.element = currentObservedSlot()?.element || state.element;
    }
  }
  syncTimelineFromElement();
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().replace(/^\uFEFF/, "").split(",");
  return lines.map((line, index) => {
    const cols = line.split(",");
    const row = Object.fromEntries(header.map((name, i) => [name, cols[i]]));
    return {
      lon: Number(row.longitude),
      lat: Number(row.latitude),
      index,
      display: Number(row.display_c),
      forecast: row.forecast_c === "" ? null : Number(row.forecast_c),
      observed: row.observed_c === "" ? null : Number(row.observed_c),
      average: row.average_c === "" ? null : Number(row.average_c),
      anomaly: row.anomaly_c === "" ? null : Number(row.anomaly_c),
      previous: row.previous_day_c === "" ? null : Number(row.previous_day_c),
      previousDiff: row.previous_diff_c === "" ? null : Number(row.previous_diff_c),
      sourceDate: row.source_date,
      targetDate: row.target_date,
    };
  }).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

function applyDisplayMode(points) {
  points.forEach((point) => {
    if (state.mode === "anomaly") point.display = point.anomaly;
    else if (state.mode === "previous") point.display = point.previousDiff;
    else point.display = point.forecast ?? point.observed;
  });
  return points.filter((point) => Number.isFinite(point.display));
}

function parseTable(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().replace(/^\uFEFF/, "").split(",");
  return lines.map((line) => {
    const cols = line.split(",");
    return Object.fromEntries(header.map((name, i) => [name, cols[i] ?? ""]));
  });
}

function buildPlaceLabel(row) {
  const lon = Number(row.longitude);
  const lat = Number(row.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (row.is_current !== "True" || row.has_temperature !== "True") return null;
  const name = row.jma_name || row.name;
  if (!name) return null;
  const rank = MAJOR_PLACE_NAMES.has(name) ? 0 : row.kind === "s" ? 1 : 2;
  return {
    name,
    lon,
    lat,
    rank,
    minZoom: rank === 0 ? 0.9 : rank === 1 ? 1.9 : 3.8,
  };
}

function buildChartStation(row) {
  if (row.is_current !== "True" || row.has_temperature !== "True") return null;
  const lon = Number(row.longitude);
  const lat = Number(row.latitude);
  const elevation = row.elevation_m === "" ? null : Number(row.elevation_m);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Number.isFinite(elevation) && elevation > MAX_INTERPOLATION_ELEVATION_M) return null;
  const name = row.jma_name || row.name;
  if (!name) return null;
  return {
    name,
    prefecture: row.prefecture || "",
    blockNo: row.block_no || "",
    lon,
    lat,
    elevation,
  };
}

async function loadPlaceLabels() {
  try {
    const response = await fetch(PLACE_LABEL_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const stationRows = parseTable(await response.text());
    const stationLabels = stationRows.map(buildPlaceLabel).filter(Boolean);
    state.chartStations = stationRows.map(buildChartStation).filter(Boolean);
    const regionalLabels = [
      { name: "中国", lon: 116.4, lat: 39.9, rank: 0, minZoom: 0.9 },
      { name: "韓国", lon: 127.8, lat: 36.5, rank: 0, minZoom: 0.9 },
      { name: "北朝鮮", lon: 127.1, lat: 40.2, rank: 0, minZoom: 0.9 },
      { name: "ロシア", lon: 142.1, lat: 46.2, rank: 0, minZoom: 0.9 },
      { name: "台湾", lon: 121.0, lat: 23.8, rank: 0, minZoom: 0.9 },
    ];
    state.placeLabels = [...regionalLabels, ...stationLabels].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "ja"));
  } catch {
    state.placeLabels = [];
    state.chartStations = [];
  }
}

async function loadTemperatureExtremes() {
  try {
    const response = await fetch(TEMPERATURE_EXTREMES_URL, { cache: "no-store" });
    if (!response.ok) return;
    state.temperatureExtremes = await response.json();
  } catch {
    state.temperatureExtremes = null;
  }
}

async function loadData() {
  els.statusText.textContent = "読み込み中";
  els.dataNotice.hidden = true;
  els.dataNotice.textContent = "";
  state.weatherFeatures = [];
  updateControlAvailability();
  if (state.source === "observed" && ["precip1h", "wind"].includes(state.observedLayer)) {
    const file = state.realtimeStationMeta?.json;
    try {
      if (!file) throw new Error("missing realtime station file");
      const response = await fetch(`${DATA_ROOT}/${file}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      state.realtimeStations = (payload.stations || []).filter((row) => {
        if (!Number.isFinite(Number(row.longitude)) || !Number.isFinite(Number(row.latitude))) return false;
        if (state.observedLayer === "precip1h") {
          return row.precipitation_1h_mm != null && Number.isFinite(Number(row.precipitation_1h_mm));
        }
        return row.wind_speed_ms != null && row.wind_direction_deg != null
          && Number.isFinite(Number(row.wind_speed_ms)) && Number.isFinite(Number(row.wind_direction_deg));
      });
      state.points = [];
      els.statusText.textContent = `${state.realtimeStations.length.toLocaleString()}地点の公式観測値を表示中。観測時刻 ${state.realtimeStationMeta.latest_time || "--"}`;
    } catch {
      state.points = [];
      state.realtimeStations = [];
      els.statusText.textContent = "リアルタイム実況データを読み込めませんでした。";
    }
    updateHeadings();
    draw();
    return;
  }
  if (state.source === "observed" && isSuikeiObservedLayer()) {
    state.points = [];
    state.realtimeStations = [];
    const slot = currentSuikeiSlot();
    const layerKey = state.observedLayer === "temp" ? "temperature" : state.observedLayer;
    const layer = slot?.layers?.[layerKey];
    const targetParts = parseSuikeiTime(slot?.validtime);
    const targetLabel = targetParts ? formatDateTimeJa(targetParts) : slot?.validtime || "--";
    els.statusText.textContent = layer?.tile_template && state.suikeiManifest?.availability !== false
      ? `気象庁「推計気象分布」を表示中。対象時刻 ${targetLabel}`
      : "推計気象分布のデータがありません。";
    updateHeadings();
    draw();
    return;
  }
  state.realtimeStations = [];
  if (state.source === "forecast") {
    const slot = currentForecastSlot();
    state.element = slot.element;
    els.elementSelect.value = state.element === "min" ? "min" : "max";
    if (slot.status !== "available") {
      if (slot.status === "stale") {
        els.dataNotice.hidden = false;
        els.dataNotice.textContent = "予測対象時刻を過ぎています。必要に応じて実況も確認してください。";
      } else {
        els.dataNotice.hidden = false;
        els.dataNotice.textContent = slot.message || "この予測値は現在データなしです。";
      }
    }
    if (slot.status === "unavailable") {
      state.points = [];
      els.statusText.textContent = slot.message || "この予測値は現在データなしです。";
      updateHeadings();
      draw();
      return;
    }
    if (isPolygonDataType()) {
      const path = `${DATA_ROOT}/forecast_${slot.id}_value.geojson`;
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const payload = await response.json();
        state.weatherFeatures = payload.features || [];
        state.points = [];
        els.statusText.textContent = `${state.weatherFeatures.length.toLocaleString()}分類ポリゴンを表示中。予測対象 ${slot.interval_label || slot.label}`;
      } catch (error) {
        state.weatherFeatures = [];
        state.points = [];
        els.statusText.textContent = `未生成のデータです: ${path}`;
      }
      setReadout(null);
      draw();
      return;
    }
  }
  const path = csvPath();
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    state.observedDataSignature = state.source === "observed"
      ? response.headers.get("last-modified") || response.headers.get("etag") || state.observedDataSignature
      : state.observedDataSignature;
    state.points = applyDisplayMode(parseCsv(await response.text()));
    const first = state.points[0];
    if (state.source === "observed") {
      state.observedDate = first?.sourceDate || state.observedDate;
    }
    const slot = state.source === "forecast" ? currentForecastSlot() : null;
    const dateText = state.source === "forecast"
      ? `予測対象 ${state.forecastLayer === "temp3h" ? slot?.label : first?.targetDate || slot?.target_date || "--"}`
      : `実況 ${first?.sourceDate || "--"}`;
    const comparisonText = activeComparisonLabel();
    els.statusText.textContent = `${state.points.length.toLocaleString()}格子点を表示中。${dateText}${comparisonText ? `、${comparisonText}` : ""}`;
    if (state.source === "observed") {
      syncTimelineFromElement();
    }
  } catch (error) {
    state.points = [];
    els.statusText.textContent = `未生成のデータです: ${path}`;
  }
  setReadout(state.hoverPoint);
  draw();
  if (state.selectedPoint && state.points[state.selectedPoint.index]) {
    state.selectedPoint = state.points[state.selectedPoint.index];
    openPointChart(state.selectedPoint);
  }
}

async function loadBoundaries() {
  try {
    const [japanResponse, worldResponse] = await Promise.all([
      fetch(BOUNDARY_URL),
      fetch(WORLD_BOUNDARY_URL),
    ]);
    state.boundaries = japanResponse.ok ? await japanResponse.json() : null;
    state.worldBoundaries = worldResponse.ok ? await worldResponse.json() : null;
  } catch {
    state.boundaries = null;
    state.worldBoundaries = null;
  }
}

function valueForPoint(point) {
  if (!point) return null;
  return point.display;
}

function weatherStyle(level) {
  const styles = {
    Clear: { label: "晴れ", color: "#f6ae3d" },
    Cloudy: { label: "くもり", color: "#b9b9b9" },
    Rain: { label: "雨", color: "#3f6df6" },
    "Rain/snow": { label: "雨または雪", color: "#bfe4ff" },
    Snow: { label: "雪", color: "#ffffff" },
    NoData: { label: "データなし", color: "rgba(255,255,255,0)" },
  };
  return styles[level] || { label: level || "--", color: "#ddd" };
}

function precipitationStyle(level) {
  const styles = {
    "0<=mm": { label: "0mm以上", color: "#d8eefb" },
    "1<=mm": { label: "1mm以上", color: "#8fd0f1" },
    "5<=mm": { label: "5mm以上", color: "#4f9fe6" },
    "10<=mm": { label: "10mm以上", color: "#3167d6" },
    "20<=mm": { label: "20mm以上", color: "#6f45c9" },
    "30<=mm": { label: "30mm以上", color: "#c13a93" },
    "50<=mm": { label: "50mm以上", color: "#7f1d1d" },
    NoData: { label: "データなし", color: "rgba(255,255,255,0)" },
  };
  return styles[level] || { label: level || "--", color: "#9ecae1" };
}

function snowfallStyle(level) {
  const styles = {
    "0<=cm": { label: "0cm以上", color: "#eef7ff" },
    "1<=cm": { label: "1cm以上", color: "#bfe3ff" },
    "3<=cm": { label: "3cm以上", color: "#73b7ee" },
    "6<=cm": { label: "6cm以上", color: "#4b77d8" },
    "12<=cm": { label: "12cm以上", color: "#6d3fb8" },
    "20<=cm": { label: "20cm以上", color: "#b21f6b" },
    NoData: { label: "データなし", color: "rgba(255,255,255,0)" },
  };
  return styles[level] || { label: level || "--", color: "#bfe3ff" };
}

function polygonStyle(level) {
  const dataType = currentDataType();
  if (dataType === "precipitation") return precipitationStyle(level);
  if (dataType === "snowfall") return snowfallStyle(level);
  return weatherStyle(level);
}

function mercatorY(lat) {
  const clamped = Math.max(-85, Math.min(85, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function inverseMercatorY(y) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}

function project(lon, lat) {
  return [lon, mercatorY(lat) * 180 / Math.PI];
}

function unproject(x, y) {
  return [x, inverseMercatorY(y * Math.PI / 180)];
}

function fullProjectedBounds() {
  const [lonMin, lonMax, latMin, latMax] = state.bounds;
  const [x0, y0] = project(lonMin, latMin);
  const [x1, y1] = project(lonMax, latMax);
  return [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
}

function fitView() {
  const [xMin, xMax, yMin, yMax] = fullProjectedBounds();
  const scaleX = els.canvas.width / (xMax - xMin);
  const scaleY = els.canvas.height / (yMax - yMin);
  const scale = Math.min(scaleX, scaleY) * 0.97;
  state.minScale = scale;
  state.view = {
    centerX: (xMin + xMax) / 2,
    centerY: (yMin + yMax) / 2,
    scale,
  };
}

function ensureView() {
  if (!state.view) fitView();
}

function lonLatToPixel(lon, lat) {
  ensureView();
  const [x, y] = project(lon, lat);
  return [
    els.canvas.width / 2 + (x - state.view.centerX) * state.view.scale,
    els.canvas.height / 2 - (y - state.view.centerY) * state.view.scale,
  ];
}

function pixelToLonLat(x, y) {
  ensureView();
  const projectedX = state.view.centerX + (x - els.canvas.width / 2) / state.view.scale;
  const projectedY = state.view.centerY - (y - els.canvas.height / 2) / state.view.scale;
  const [lon, lat] = unproject(projectedX, projectedY);
  return [lon, lat];
}

function zoomAt(canvasX, canvasY, factor) {
  ensureView();
  const before = pixelToLonLat(canvasX, canvasY);
  const [beforeX, beforeY] = project(before[0], before[1]);
  state.view.scale = Math.max(state.minScale || 12, Math.min(5000, state.view.scale * factor));
  state.view.centerX = beforeX - (canvasX - els.canvas.width / 2) / state.view.scale;
  state.view.centerY = beforeY + (canvasY - els.canvas.height / 2) / state.view.scale;
  clampView();
  draw();
}

function updateZoomControl() {
  if (!els.zoomThumb || !state.view || !state.minScale) return;
  const min = state.minScale;
  const max = 5000;
  const ratio = Math.max(0, Math.min(1, Math.log(state.view.scale / min) / Math.log(max / min)));
  const top = 92 - ratio * 80;
  els.zoomThumb.style.setProperty("--zoom-thumb-top", `${top}px`);
}

function panBy(dx, dy) {
  ensureView();
  state.view.centerX -= dx / state.view.scale;
  state.view.centerY += dy / state.view.scale;
  clampView();
  draw();
}

function clampView() {
  ensureView();
  const [xMin, xMax, yMin, yMax] = fullProjectedBounds();
  const halfW = els.canvas.width / (2 * state.view.scale);
  const halfH = els.canvas.height / (2 * state.view.scale);
  const zoomRatio = Math.max(1, state.view.scale / (state.minScale || state.view.scale));
  const panPadFactor = zoomRatio <= 1.02
    ? 0.55
    : Math.min(1.35, 0.38 + Math.log2(zoomRatio) * 0.34);
  const padX = halfW * 2 * panPadFactor;
  const padY = halfH * 2 * panPadFactor;
  const minCenterX = xMin - padX + halfW;
  const maxCenterX = xMax + padX - halfW;
  const minCenterY = yMin - padY + halfH;
  const maxCenterY = yMax + padY - halfH;
  if (minCenterX <= maxCenterX) {
    state.view.centerX = Math.max(minCenterX, Math.min(maxCenterX, state.view.centerX));
  } else {
    state.view.centerX = (xMin + xMax) / 2;
  }
  if (minCenterY <= maxCenterY) {
    state.view.centerY = Math.max(minCenterY, Math.min(maxCenterY, state.view.centerY));
  } else {
    state.view.centerY = (yMin + yMax) / 2;
  }
}

function colorRamp(stops, value) {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [v0, c0] = stops[i];
    const [v1, c1] = stops[i + 1];
    if (value >= v0 && value <= v1) {
      const t = (value - v0) / (v1 - v0);
      return c0.map((v, idx) => Math.round(v + (c1[idx] - v) * t));
    }
  }
  return stops[stops.length - 1][1];
}

function colorForValue(value) {
  return colorRamp([
    [-20, [46, 52, 93]],
    [-10, [65, 105, 225]],
    [0, [103, 169, 207]],
    [10, [222, 235, 247]],
    [20, [255, 255, 191]],
    [25, [254, 224, 139]],
    [30, [244, 109, 67]],
    [35, [197, 27, 125]],
    [40, [94, 0, 106]],
  ], value);
}

function colorForAnomaly(value) {
  return colorRamp([
    [-8, [38, 110, 180]],
    [-4.4, [103, 169, 207]],
    [-1.3, [209, 229, 240]],
    [0, [247, 247, 247]],
    [1.3, [253, 219, 199]],
    [4.4, [239, 138, 98]],
    [8, [178, 24, 43]],
  ], value);
}

function rgb(color) {
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}

function colorFor(point) {
  if (currentDataType() === "weather") return "#d7dde3";
  const value = valueForPoint(point);
  if (value == null) return "#d7dde3";
  return rgb(state.mode === "value" ? colorForValue(value) : colorForAnomaly(value));
}

function formatSigned(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}℃`;
}

function formatPlain(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}℃`;
}

function parseJmaCompactTime(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
  };
}

function parseSuikeiTime(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!match) return parseIsoLikeDateTime(value);
  const [, year, month, day, hour, minute = "00"] = match;
  const jst = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour) + 9, Number(minute),
  ));
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    hour: jst.getUTCHours(),
  };
}

function parseIsoLikeDateTime(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s)?(\d{2})?/);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: hour == null ? null : Number(hour),
  };
}

function formatDateTimeJa(parts, options = {}) {
  if (!parts) return "--";
  const date = options.noYear ? `${parts.month}月${parts.day}日` : `${parts.year}年${parts.month}月${parts.day}日`;
  if (options.dateOnly || parts.hour == null || !Number.isFinite(parts.hour)) return date;
  return `${date}${parts.hour}時`;
}

function slotValidTimeParts(slot) {
  return parseJmaCompactTime(slot?.validtime) || parseIsoLikeDateTime(slot?.valid_time);
}

function slotBaseTimeParts(slot) {
  return parseJmaCompactTime(slot?.basetime) || parseIsoLikeDateTime(slot?.base_time);
}

function targetLabelForStamp(slot, dataType) {
  if (!slot) return "--";
  if (slot.interval_label && isPolygonDataType(dataType)) return slot.interval_label;
  const targetParts = parseIsoLikeDateTime(slot.target_date);
  if (targetParts && (slot.element === "min" || slot.element === "max")) {
    const timeBand = slot.element === "min" ? "明け方" : "日中";
    return `${formatDateTimeJa(targetParts, { dateOnly: true, noYear: true })} ${timeBand}`;
  }
  const validParts = slotValidTimeParts(slot);
  if (validParts) return formatDateTimeJa(validParts);
  if (targetParts) {
    return formatDateTimeJa(targetParts, { dateOnly: true });
  }
  return slot.label || "--";
}

function stampElementClass(dataType) {
  if (dataType === "weather") return "is-weather";
  if (dataType === "precipitation") return "is-precipitation";
  if (dataType === "snowfall") return "is-snowfall";
  if (state.element === "max") return "is-max";
  if (state.element === "min") return "is-min";
  return "is-temp";
}

function updateMapStamp(elementLabel, sourceLabel, dataType) {
  const slot = state.source === "forecast" ? currentForecastSlot() : currentObservedSlot();
  let targetText = "--";
  if (state.source === "forecast") {
    targetText = targetLabelForStamp(slot, dataType);
  } else {
    const realtimeTarget = isSuikeiObservedLayer()
      ? currentSuikeiSlot()?.validtime
      : state.realtimeStationMeta?.latest_time;
    if (isSuikeiObservedLayer() && realtimeTarget) {
      const realtimeParts = parseSuikeiTime(realtimeTarget);
      targetText = realtimeParts ? formatDateTimeJa(realtimeParts) : realtimeTarget;
    } else {
    const sourceDate = state.points[0]?.sourceDate || state.observedDate;
    const observedParts = parseIsoLikeDateTime(sourceDate);
    if (state.element === "temp") {
      const targetParts = parseIsoLikeDateTime(state.points[0]?.targetDate);
      targetText = targetParts ? formatDateTimeJa(targetParts) : "現在";
    } else {
      const timeBand = state.element === "min" ? "明け方" : "日中";
      const updating = slot?.source === "realtime" ? "（更新中）" : "";
      targetText = `${observedParts ? formatDateTimeJa(observedParts, { dateOnly: true, noYear: true }) : sourceDate || "--"} ${timeBand}${updating}`;
    }
    }
  }
  const elementClass = stampElementClass(dataType);
  const sourceClass = state.source === "forecast" ? "is-forecast" : "is-observed";
  const comparisonText = activeComparisonLabel();
  els.mapStampMain.innerHTML = `<span class="map-stamp-source ${sourceClass}">${sourceLabel}</span><span class="map-stamp-element ${elementClass}">${elementLabel}</span><span class="map-stamp-target">${targetText}</span>`;
  els.mapStampSub.hidden = !comparisonText;
  els.mapStampSub.innerHTML = comparisonText ? `<span class="map-stamp-origin">${comparisonText}</span>` : "";
}

function iterGeometryLines(geometry, callback) {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach(callback);
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((poly) => poly.forEach(callback));
  }
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const crosses = (yi > lat) !== (yj > lat);
    if (crosses) {
      const xAtLat = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lon < xAtLat) inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lon, lat, polygon) {
  if (!polygon.length || !pointInRing(lon, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(lon, lat, polygon[i])) return false;
  }
  return true;
}

function isLandPoint(lon, lat) {
  if (!state.boundaries) return true;
  return state.boundaries.features.some((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return false;
    if (geometry.type === "Polygon") return pointInPolygon(lon, lat, geometry.coordinates);
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.some((polygon) => pointInPolygon(lon, lat, polygon));
    }
    return false;
  });
}

function drawBoundaries() {
  if (!state.boundaries) return;
  ctx.save();
  ctx.strokeStyle = "rgba(30,35,40,0.72)";
  ctx.lineWidth = 1.15;
  state.boundaries.features.forEach((feature) => {
    iterGeometryLines(feature.geometry, (ring) => {
      ctx.beginPath();
      let started = false;
      ring.forEach(([lon, lat]) => {
        if (lon < 119 || lon > 149 || lat < 20 || lat > 48) return;
        const [x, y] = lonLatToPixel(lon, lat);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });
  });
  ctx.restore();
}

function drawWorldBoundaries() {
  if (!state.worldBoundaries) return;
  ctx.save();
  ctx.fillStyle = "rgba(248, 249, 246, 0.78)";
  ctx.strokeStyle = "rgba(90, 98, 106, 0.32)";
  ctx.lineWidth = 1;
  state.worldBoundaries.features.forEach((feature) => {
    iterGeometryLines(feature.geometry, (ring) => {
      const inView = ring.some(([lon, lat]) => lon >= 110 && lon <= 155 && lat >= 18 && lat <= 55);
      if (!inView) return;
      ctx.beginPath();
      let started = false;
      ring.forEach(([lon, lat]) => {
        const [x, y] = lonLatToPixel(lon, lat);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.fill();
      ctx.stroke();
    });
  });
  ctx.restore();
}

function drawWeatherPolygons() {
  if (!isPolygonDataType() || !state.weatherFeatures.length) return;
  ctx.save();
  state.weatherFeatures.forEach((feature) => {
    const level = feature.properties?.level;
    if (level === "NoData") return;
    const style = polygonStyle(level);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = 0.9;
    iterGeometryLines(feature.geometry, (ring) => {
      if (!ring.length) return;
      ctx.beginPath();
      let started = false;
      ring.forEach(([lon, lat]) => {
        if (lon < 119 || lon > 150 || lat < 20 || lat > 48) return;
        const [x, y] = lonLatToPixel(lon, lat);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      if (started) ctx.fill();
    });
  });
  ctx.restore();
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.fillStyle = "rgba(40,48,56,0.76)";
  ctx.font = "700 15px -apple-system, BlinkMacSystemFont, sans-serif";
  for (let lon = 124; lon <= 146; lon += 4) {
    const [x] = lonLatToPixel(lon, 35);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, els.canvas.height);
    ctx.stroke();
    ctx.fillText(`${lon}E`, x + 5, els.canvas.height - 16);
  }
  for (let lat = 24; lat <= 46; lat += 4) {
    const [, y] = lonLatToPixel(135, lat);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(els.canvas.width, y);
    ctx.stroke();
    ctx.fillText(`${lat}N`, 8, y - 8);
  }
  ctx.restore();
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawPlaceLabels() {
  if (!state.showPlaceLabels || !state.placeLabels.length) return;
  ensureView();
  const zoomRatio = Math.max(1, state.view.scale / (state.minScale || state.view.scale));
  const maxLabels = zoomRatio < 1.6 ? 38 : zoomRatio < 2.8 ? 82 : 220;
  const fontSize = zoomRatio < 1.5 ? 13 : zoomRatio < 3 ? 14 : 15;
  const visibleRects = [];
  let drawn = 0;

  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, fontSize * 0.28);
  ctx.strokeStyle = "rgba(255,255,255,0.66)";
  ctx.fillStyle = "rgba(34,42,50,0.72)";

  for (const label of state.placeLabels) {
    if (label.minZoom > zoomRatio) continue;
    const [x, y] = lonLatToPixel(label.lon, label.lat);
    if (x < -80 || x > els.canvas.width + 80 || y < -40 || y > els.canvas.height + 40) continue;
    const textWidth = ctx.measureText(label.name).width;
    const dotSize = label.rank === 0 ? 3.2 : 2.2;
    const textX = x + 5;
    const rect = {
      x: textX - 3,
      y: y - fontSize * 0.68,
      w: textWidth + 8,
      h: fontSize * 1.35,
    };
    if (visibleRects.some((item) => rectsOverlap(rect, item))) continue;
    visibleRects.push(rect);

    ctx.globalAlpha = label.rank === 0 ? 0.86 : 0.64;
    ctx.beginPath();
    ctx.arc(x, y, dotSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeText(label.name, textX, y);
    ctx.fillText(label.name, textX, y);
    drawn += 1;
    if (drawn >= maxLabels) break;
  }
  ctx.restore();
}

function selectedObservedDateKey() {
  if (state.source !== "observed") return "";
  if (isSuikeiObservedLayer()) {
    const parts = parseSuikeiTime(currentSuikeiSlot()?.validtime);
    if (parts) return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }
  const slot = currentObservedSlot();
  return dateKey(slot?.target_date || state.points?.[0]?.sourceDate || state.observedDate || "");
}

function selectedExtremeDay() {
  const days = state.temperatureExtremes?.days || [];
  if (!days.length) return null;
  const key = selectedObservedDateKey();
  return days.find((day) => day.date === key) || days[0];
}

function primaryRecordKeysForElement() {
  if (state.element === "min") return ["min_low_all_time", "min_low_monthly"];
  return ["max_high_all_time", "max_high_monthly"];
}

function activeRecordMarkers() {
  const day = selectedExtremeDay();
  if (!day?.updates) return [];
  const keys = primaryRecordKeysForElement();
  const seen = new Set();
  const markers = [];
  for (const key of keys) {
    const type = key.endsWith("_all_time") ? "all_time" : "monthly";
    for (const item of day.updates[key] || []) {
      if (!item?.matched || !Number.isFinite(Number(item.longitude)) || !Number.isFinite(Number(item.latitude))) continue;
      const id = `${item.station_key || item.station}-${type}`;
      if (seen.has(id)) continue;
      seen.add(id);
      markers.push({ ...item, record_type: type });
    }
  }
  return markers;
}

function recordUpdateRows(day, recordType) {
  if (!day?.updates) return [];
  const prefix = state.element === "temp" ? "" : state.element === "min" ? "min_" : "max_";
  const suffix = recordType === "all_time" ? "_all_time" : "_monthly";
  return Object.entries(day.updates)
    .filter(([key]) => (!prefix || key.startsWith(prefix)) && key.endsWith(suffix))
    .flatMap(([, rows]) => rows || [])
    .filter((row) => row?.matched !== false);
}

function renderRecordList(day, recordType) {
  const month = Number(String(day?.date || "").slice(5, 7));
  const title = recordType === "all_time"
    ? "観測史上1位"
    : `${Number.isFinite(month) && month > 0 ? month : "その月"}月としての1位`;
  const rows = recordUpdateRows(day, recordType);
  if (!rows.length) {
    return `<section class="record-list"><h4>${escapeHtml(title)}</h4><p class="ranking-empty">更新記録なし</p></section>`;
  }
  return `<section class="record-list"><h4>${escapeHtml(title)}</h4><div class="record-table-wrap"><table class="record-table"><thead><tr><th>地点</th><th>更新値</th><th>従来記録</th><th>時刻</th></tr></thead><tbody>${rows.map((row) => (
    `<tr><td>${escapeHtml(`${row.prefecture || ""} ${row.station || ""}`.trim())}</td><td>${escapeHtml(row.value)}℃</td><td>${escapeHtml(row.previous_record || "--")}℃${row.previous_record_date ? `<small>${escapeHtml(row.previous_record_date)}</small>` : ""}</td><td>${escapeHtml(row.time || "--")}</td></tr>`
  )).join("")}</tbody></table></div></section>`;
}

function drawRecordMarkers() {
  if (!state.showRecordMarkers || state.source !== "observed") return;
  const markers = activeRecordMarkers();
  ctx.save();
  if (markers.length) {
    ctx.lineWidth = 2.5;
    ctx.font = "900 13px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const marker of markers) {
      const [x, y] = lonLatToPixel(Number(marker.longitude), Number(marker.latitude));
      if (x < -30 || x > els.canvas.width + 30 || y < -30 || y > els.canvas.height + 30) continue;
      const allTime = marker.record_type === "all_time";
      ctx.fillStyle = allTime ? "#b00078" : "#f15a24";
      ctx.strokeStyle = allTime ? "#101820" : "#ffffff";
      ctx.beginPath();
      ctx.rect(x - 6, y - 6, 12, 12);
      ctx.fill();
      ctx.stroke();
      if ((state.view.scale / (state.minScale || state.view.scale)) > 2.2) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.fillStyle = "#202932";
        ctx.strokeText(marker.station, x + 9, y);
        ctx.fillText(marker.station, x + 9, y);
        ctx.lineWidth = 2.5;
      }
    }
  }
  drawRecordMarkerLegend();
  ctx.restore();
}

function drawRecordMarkerLegend() {
  const day = selectedExtremeDay();
  const month = Number(String(day?.date || "").slice(5, 7));
  const monthLabel = Number.isFinite(month) && month > 0 ? `${month}月` : "月";
  const x = els.canvas.width - 330;
  const y = els.canvas.height - 154;
  const w = 292;
  const h = 118;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.strokeStyle = "rgba(92,106,120,0.5)";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#202932";
  ctx.font = "900 15px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("記録更新マーカー", x + 14, y + 20);
  [
    { color: "#b00078", text: "観測史上 1位を更新" },
    { color: "#f15a24", text: `${monthLabel}としての 1位を更新` },
  ].forEach((line, index) => {
    const yy = y + 52 + index * 34;
    const sx = x + 30;
    const tx = x + 104;
    ctx.strokeStyle = "rgba(34,42,50,0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + 9, yy);
    ctx.lineTo(tx - 10, yy);
    ctx.stroke();
    ctx.fillStyle = line.color;
    ctx.strokeStyle = "#111820";
    ctx.lineWidth = 2;
    ctx.fillRect(sx, yy - 8, 16, 16);
    ctx.strokeRect(sx, yy - 8, 16, 16);
    ctx.fillStyle = "#202932";
    ctx.font = "850 15px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(line.text, tx, yy);
  });
  ctx.restore();
}

function rankingMeta(kind) {
  const meta = {
    max_high: { title: "高い方 TOP10", group: "max", direction: "hot", badge: "MAX" },
    max_low: { title: "低い方 TOP10", group: "max", direction: "cold", badge: "MIN" },
    min_low: { title: "低い方 TOP10", group: "min", direction: "cold", badge: "MIN" },
    min_high: { title: "高い方 TOP10", group: "min", direction: "hot", badge: "MAX" },
  };
  return meta[kind] || { title: kind, group: "", direction: "", badge: "" };
}

function rankingTitle(kind) {
  return {
    max_high: "高い方 TOP10",
    max_low: "低い方 TOP10",
    min_low: "低い方 TOP10",
    min_high: "高い方 TOP10",
  }[kind] || kind;
}

function renderRankingList(day, kind) {
  const meta = rankingMeta(kind);
  const rows = (day?.rankings?.[kind] || []).slice(0, 10);
  if (!rows.length) return `<section class="ranking-list ${meta.group} ${meta.direction}"><h4><span>${rankingTitle(kind)}</span><b>${meta.badge}</b></h4><p class="ranking-empty">データなし</p></section>`;
  return `<section class="ranking-list ${meta.group} ${meta.direction}"><h4><span>${rankingTitle(kind)}</span><b>${meta.badge}</b></h4><ol>${rows.map((row) => (
    `<li><span class="rank-order">${escapeHtml(row.rank)}</span><span class="rank-place">${escapeHtml(`${row.prefecture || ""} ${row.station || ""}`.trim())}</span><span class="rank-value">${escapeHtml(row.value)}℃</span></li>`
  )).join("")}</ol></section>`;
}

function forecastRankingRows(direction = "high", limit = 10) {
  const sorted = state.points
    .map((point) => ({
      point,
      value: point.forecast ?? point.observed ?? point.display,
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => direction === "high" ? b.value - a.value : a.value - b.value);
  const rows = [];
  const seenCells = new Set();
  for (const item of sorted) {
    const cellKey = `${Math.round(item.point.lon * 2) / 2},${Math.round(item.point.lat * 2) / 2}`;
    if (seenCells.has(cellKey)) continue;
    seenCells.add(cellKey);
    rows.push({
      rank: String(rows.length + 1),
      prefecture: "",
      station: pointLocationLabel(item.point) || `${item.point.lat.toFixed(2)}N ${item.point.lon.toFixed(2)}E`,
      value: item.value.toFixed(1),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

function forecastRankingData() {
  const slot = currentForecastSlot();
  const label = targetLabelForStamp(slot, currentDataType()) || slot?.label || "予測";
  const group = state.element === "min" ? "min" : "max";
  const rankings = group === "min"
    ? { min_low: forecastRankingRows("low"), min_high: forecastRankingRows("high") }
    : { max_high: forecastRankingRows("high"), max_low: forecastRankingRows("low") };
  return {
    date: slot?.target_date || "",
    label,
    rankings,
    forecastGroup: group,
  };
}

function rankingSourceTimeText(day) {
  const title = String(day?.ranking_title || day?.title || "");
  const match = title.match(/(\d{1,2})時(\d{2})分現在/);
  return match ? `${match[1]}:${match[2]}現在` : "";
}

function rankingStatusInfo(day) {
  if (state.source === "forecast") {
    return {
      className: "forecast",
      label: "予測",
      text: "表示中の格子値",
    };
  }
  const slot = currentObservedSlot();
  const sourceTime = rankingSourceTimeText(day);
  if (slot?.source === "realtime") {
    return {
      className: "updating",
      label: "更新中",
      text: sourceTime || "速報値",
    };
  }
  if (slot?.source === "daily") {
    return {
      className: "fixed",
      label: "確定値",
      text: "日別値反映済み",
    };
  }
  if (slot?.source === "saved_realtime") {
    return {
      className: "saved",
      label: "保存済み速報値",
      text: "当時の速報値",
    };
  }
  return {
    className: "reference",
    label: "参考表示",
    text: sourceTime || "速報値",
  };
}

function updateRankingPanel() {
  if (!els.rankingPanel) return;
  const dataType = currentDataType();
  const forecastRankable = state.source === "forecast" && dataType === "temperature" && state.forecastLayer === "daily";
  const observedRankable = state.source === "observed" && ["daily", "temp"].includes(state.observedLayer);
  const day = forecastRankable ? forecastRankingData() : selectedExtremeDay();
  const recordPanelOpen = state.showRecordMarkers && observedRankable;
  els.rankingPanel.hidden = !(state.showRankingPanel || recordPanelOpen) || !(forecastRankable || observedRankable);
  els.rankingPanelButton?.classList.toggle("active", state.showRankingPanel);
  els.rankingPanelButton?.setAttribute("aria-pressed", state.showRankingPanel ? "true" : "false");
  els.recordMarkersButton?.classList.toggle("active", recordPanelOpen);
  els.recordMarkersButton?.setAttribute("aria-pressed", recordPanelOpen ? "true" : "false");
  if (els.rankingPanel.hidden) return;
  applyRankingPanelPosition();
  if (!day) {
    els.rankingPanel.innerHTML = `<div class="ranking-head"><strong>${recordPanelOpen ? "記録更新" : "気温ランキング"}</strong></div><p class="ranking-empty">データを読み込めません。</p>`;
    return;
  }
  const status = rankingStatusInfo(day);
  if (recordPanelOpen) {
    const elementName = state.element === "temp" ? "気温" : state.element === "min" ? "最低気温" : "最高気温";
    els.rankingPanel.innerHTML = `
      <div class="ranking-head">
        <div><div class="ranking-title-row"><strong>${escapeHtml(day.label || day.date)} ${elementName}の記録更新</strong><span class="ranking-status ${status.className}"><b>${status.label}</b><span>${status.text}</span></span></div><span>気象庁「観測史上1位の値 更新状況」</span></div>
        <button type="button" id="rankingPanelCloseButton" aria-label="閉じる">×</button>
      </div>
      <div class="record-grid">${renderRecordList(day, "all_time")}${renderRecordList(day, "monthly")}</div>`;
    wireRankingPanelDrag();
    document.getElementById("rankingPanelCloseButton")?.addEventListener("click", () => {
      state.showRecordMarkers = false;
      updateRankingPanel();
    }, { once: true });
    return;
  }
  els.rankingPanel.innerHTML = `
    <div class="ranking-head">
      <div>
        <div class="ranking-title-row">
          <strong>${escapeHtml(day.label || day.date)} 気温ランキング</strong>
          <span class="ranking-status ${status.className}"><b>${status.label}</b><span>${status.text}</span></span>
        </div>
        <span>${state.source === "forecast" ? "表示中の予測格子から作成した上位10地点 / 下位10地点" : "最高気温と最低気温の全国上位10地点 / 下位10地点"}</span>
      </div>
      <button type="button" id="rankingPanelCloseButton" aria-label="閉じる">×</button>
    </div>
    <div class="ranking-grid">
      ${day.rankings?.max_high || day.rankings?.max_low ? `<section class="ranking-group max">
        <div class="ranking-group-title"><span>最高気温</span><small>日中の暑さ</small></div>
        <div class="ranking-pair">
          ${renderRankingList(day, "max_high")}
          ${renderRankingList(day, "max_low")}
        </div>
      </section>` : ""}
      ${day.rankings?.min_low || day.rankings?.min_high ? `<section class="ranking-group min">
        <div class="ranking-group-title"><span>最低気温</span><small>明け方の冷え込み/寝苦しさ</small></div>
        <div class="ranking-pair">
          ${renderRankingList(day, "min_low")}
          ${renderRankingList(day, "min_high")}
        </div>
      </section>` : ""}
    </div>
  `;
  wireRankingPanelDrag();
  document.getElementById("rankingPanelCloseButton")?.addEventListener("click", () => {
    state.showRankingPanel = false;
    updateRankingPanel();
  }, { once: true });
}

function defaultRankingPanelPosition() {
  const wrapRect = els.canvasWrap?.getBoundingClientRect();
  const panelWidth = Math.min(580, Math.max(460, Math.round((wrapRect?.width || window.innerWidth) * 0.42)));
  return {
    left: Math.max(12, (wrapRect?.width || window.innerWidth) - panelWidth - 18),
    top: 16,
  };
}

function clampRankingPanelPosition(position) {
  const wrapRect = els.canvasWrap?.getBoundingClientRect();
  const panelRect = els.rankingPanel?.getBoundingClientRect();
  const wrapWidth = wrapRect?.width || window.innerWidth;
  const wrapHeight = wrapRect?.height || window.innerHeight;
  const panelWidth = panelRect?.width || 560;
  const panelHeight = panelRect?.height || Math.min(760, wrapHeight - 32);
  return {
    left: Math.max(10, Math.min(wrapWidth - panelWidth - 10, position.left)),
    top: Math.max(10, Math.min(wrapHeight - panelHeight - 10, position.top)),
  };
}

function applyRankingPanelPosition() {
  if (!els.rankingPanel) return;
  if (!state.rankingPanelPosition) state.rankingPanelPosition = defaultRankingPanelPosition();
  const position = clampRankingPanelPosition(state.rankingPanelPosition);
  state.rankingPanelPosition = position;
  els.rankingPanel.style.left = `${position.left}px`;
  els.rankingPanel.style.top = `${position.top}px`;
}

function wireRankingPanelDrag() {
  const head = els.rankingPanel?.querySelector(".ranking-head");
  if (!head) return;
  head.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    state.rankingPanelDragging = true;
    const current = state.rankingPanelPosition || defaultRankingPanelPosition();
    state.rankingPanelDragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: current.left,
      top: current.top,
    };
    head.setPointerCapture?.(event.pointerId);
    els.rankingPanel?.classList.add("dragging");
  });
  head.addEventListener("pointermove", (event) => {
    if (!state.rankingPanelDragging || !state.rankingPanelDragStart) return;
    state.rankingPanelPosition = clampRankingPanelPosition({
      left: state.rankingPanelDragStart.left + event.clientX - state.rankingPanelDragStart.x,
      top: state.rankingPanelDragStart.top + event.clientY - state.rankingPanelDragStart.y,
    });
    applyRankingPanelPosition();
  });
  const endDrag = (event) => {
    if (!state.rankingPanelDragging) return;
    state.rankingPanelDragging = false;
    state.rankingPanelDragStart = null;
    try {
      head.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    els.rankingPanel?.classList.remove("dragging");
  };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
}

function haversineKm(lon1, lat1, lon2, lat2) {
  const toRad = (value) => value * Math.PI / 180;
  const r = 6371.0088;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function drawScaleBar() {
  const y = els.canvas.height - 42;
  const x = 28;
  const [lon0, lat0] = pixelToLonLat(x, y);
  const [lon1, lat1] = pixelToLonLat(x + 160, y);
  const km160 = haversineKm(lon0, lat0, lon1, lat1);
  const candidates = [1, 2, 3, 5, 10, 20, 50, 100, 200, 300, 500, 800];
  const targetKm = candidates.reduce((best, value) => Math.abs(value - km160) < Math.abs(best - km160) ? value : best, candidates[0]);
  const px = Math.max(40, Math.min(240, 160 * targetKm / km160));
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.strokeStyle = "rgba(40,48,56,0.8)";
  ctx.lineWidth = 2;
  ctx.fillRect(x - 10, y - 25, px + 30, 38);
  ctx.strokeRect(x, y, px, 8);
  ctx.fillStyle = "#26313b";
  ctx.font = "700 15px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`${targetKm} km`, x, y - 7);
  ctx.restore();
}

function drawZoomBadge() {
  ensureView();
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.strokeStyle = "rgba(120,132,145,0.8)";
  ctx.lineWidth = 1;
  const zoom = Math.max(1, Math.round((state.view.scale / 18) * 10) / 10);
  const left = els.canvas.width - 190;
  ctx.fillRect(left, 18, 100, 32);
  ctx.strokeRect(left, 18, 100, 32);
  ctx.fillStyle = "#26313b";
  ctx.font = "700 14px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`zoom x${zoom}`, left + 14, 39);
  ctx.restore();
}

function legendConfig() {
  const dataType = currentDataType();
  if (state.source === "observed" && state.observedLayer === "temp") {
    return {
      type: "weather",
      title: "気温",
      items: [
        ["40℃以上", "#8c3e65"], ["35℃", "#cf4381"], ["30℃", "#ff6252"],
        ["25℃", "#ffb75e"], ["20℃", "#fff568"], ["15℃", "#ffffb2"],
        ["10℃", "#fffef0"], ["5℃", "#cceef4"], ["0℃", "#82c7ef"],
        ["-5℃", "#4d8cf5"], ["-10℃", "#3f53b6"], ["-15℃", "#706c9f"],
        ["-20℃", "#9893b7"], ["-25℃以下", "#c8c4d5"],
      ].map(([label, color]) => ({ label, color })),
    };
  }
  if (dataType === "weather") {
    return {
      type: "weather",
      title: state.source === "observed" ? "推定天気" : "天気",
      items: ["Clear", "Cloudy", "Rain", "Rain/snow", "Snow"].map((level) => ({ level, ...weatherStyle(level) })),
    };
  }
  if (dataType === "sunshine") {
    return {
      type: "weather",
      title: "日照時間",
      items: [
        { label: "1.0 h", color: "#f15b4a" },
        { label: "0.8 h", color: "#ffc85a" },
        { label: "0.6 h", color: "#fff3b0" },
        { label: "0.4 h", color: "#c7c7c7" },
        { label: "0.2 h", color: "#9d9d9d" },
        { label: "0.0 h", color: "#737373" },
      ],
    };
  }
  if (dataType === "wind") {
    return {
      type: "weather",
      title: "風向・風速",
      items: [
        { label: "矢印: 風向", color: "#174a68" },
        { label: "長さ: 風速", color: "#174a68" },
      ],
    };
  }
  if (dataType === "precipitation") {
    return {
      type: "weather",
      title: state.source === "observed" ? "1時間降水量" : "3時間降水量",
      items: ["0<=mm", "1<=mm", "5<=mm", "10<=mm", "20<=mm", "30<=mm", "50<=mm"].map((level) => ({ level, ...precipitationStyle(level) })),
    };
  }
  if (dataType === "snowfall") {
    return {
      type: "weather",
      title: "3時間降雪量",
      items: ["0<=cm", "1<=cm", "3<=cm", "6<=cm", "12<=cm", "20<=cm"].map((level) => ({ level, ...snowfallStyle(level) })),
    };
  }
  if (state.mode === "value") {
    return {
      title: "気温",
      labels: [40, 35, 30, 25, 20, 10, 0, -10, -20],
      min: -20,
      max: 40,
      color: colorForValue,
      signed: false,
    };
  }
  return {
    title: state.mode === "anomaly" ? "平均との差" : "前日差",
    labels: [8, 4, 0, -4, -8],
    min: -8,
    max: 8,
    color: colorForAnomaly,
    signed: true,
  };
}

function drawMapLegend() {
  const cfg = legendConfig();
  if (cfg.type === "weather") {
    const boxW = 190;
    const rowH = 44;
    const boxH = 86 + cfg.items.length * rowH;
    const left = els.canvas.width - boxW - 28;
    const top = 78;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.93)";
    ctx.strokeStyle = "rgba(80,92,104,0.55)";
    ctx.lineWidth = 1;
    ctx.fillRect(left, top, boxW, boxH);
    ctx.strokeRect(left, top, boxW, boxH);
    ctx.fillStyle = "#202932";
    ctx.font = "900 28px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(cfg.title, left + 24, top + 44);
    ctx.font = "800 20px -apple-system, BlinkMacSystemFont, sans-serif";
    cfg.items.forEach((item, i) => {
      const y = top + 72 + i * rowH;
      ctx.fillStyle = item.color;
      ctx.fillRect(left + 26, y, 36, 28);
      ctx.strokeStyle = "#4d5862";
      ctx.strokeRect(left + 26, y, 36, 28);
      ctx.fillStyle = "#202932";
      ctx.fillText(item.label, left + 74, y + 21);
    });
    ctx.restore();
    return;
  }
  const boxW = 190;
  const boxH = Math.min(610, Math.max(500, els.canvas.height - 150));
  const left = els.canvas.width - boxW - 28;
  const top = 64;
  const barLeft = left + 34;
  const barTop = top + 92;
  const barW = 58;
  const barH = boxH - 160;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.93)";
  ctx.strokeStyle = "rgba(80,92,104,0.55)";
  ctx.lineWidth = 1;
  ctx.fillRect(left, top, boxW, boxH);
  ctx.strokeRect(left, top, boxW, boxH);
  ctx.fillStyle = "#202932";
  const titleFontSize = cfg.signed ? 23 : 28;
  ctx.font = `900 ${titleFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(cfg.title, left + 24, top + 44);
  ctx.font = "900 22px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("℃", left + boxW - 22, top + 42);
  ctx.textAlign = "left";
  for (let i = 0; i < barH; i += 1) {
    const value = cfg.max - (i / (barH - 1)) * (cfg.max - cfg.min);
    ctx.fillStyle = rgb(cfg.color(value));
    ctx.fillRect(barLeft, barTop + i, barW, 1);
  }
  ctx.strokeStyle = "#4d5862";
  ctx.strokeRect(barLeft, barTop, barW, barH);
  ctx.fillStyle = "#202932";
  ctx.font = "900 25px -apple-system, BlinkMacSystemFont, sans-serif";
  cfg.labels.forEach((value) => {
    const y = barTop + ((cfg.max - value) / (cfg.max - cfg.min)) * barH;
    ctx.beginPath();
    ctx.moveTo(barLeft + barW, y);
    ctx.lineTo(barLeft + barW + 15, y);
    ctx.stroke();
    const label = cfg.signed && value > 0 ? `+${value}` : String(value);
    ctx.fillText(label, barLeft + barW + 22, y + 9);
  });
  ctx.restore();
}

function drawPoints() {
  if (currentDataType() !== "temperature" || !state.points.length) return;
  const lons = [...new Set(state.points.map((p) => p.lon.toFixed(5)))].map(Number).sort((a, b) => a - b);
  const lats = [...new Set(state.points.map((p) => p.lat.toFixed(5)))].map(Number).sort((a, b) => a - b);
  const dLon = lons.length > 1 ? lons[1] - lons[0] : 0.0625;
  const dLat = lats.length > 1 ? lats[1] - lats[0] : 0.05;
  state.points.forEach((point) => {
    const [x0, y0] = lonLatToPixel(point.lon - dLon / 2, point.lat + dLat / 2);
    const [x1, y1] = lonLatToPixel(point.lon + dLon / 2, point.lat - dLat / 2);
    ctx.fillStyle = colorFor(point);
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0) + 0.7;
    const height = Math.abs(y1 - y0) + 0.7;
    if (left > els.canvas.width || left + width < 0 || top > els.canvas.height || top + height < 0) return;
    ctx.fillRect(left, top, Math.max(1, width), Math.max(1, height));
  });
}

function drawRealtimeStations() {
  if (state.source !== "observed") return;
  ctx.save();
  state.realtimeStations.forEach((station) => {
    const [x, y] = lonLatToPixel(Number(station.longitude), Number(station.latitude));
    if (state.observedLayer === "precip1h") {
      if (station.precipitation_1h_mm == null) return;
      const value = Number(station.precipitation_1h_mm);
      if (!Number.isFinite(value)) return;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, Math.min(13, 3 + Math.sqrt(Math.max(0, value)) * 2)), 0, Math.PI * 2);
      ctx.fillStyle = value >= 20 ? "#7f1d1d" : value >= 10 ? "#6f45c9" : value >= 5 ? "#3167d6" : value >= 1 ? "#4f9fe6" : "#8fd0f1";
      ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (state.observedLayer === "wind") {
      if (station.wind_speed_ms == null || station.wind_direction_deg == null) return;
      const speed = Number(station.wind_speed_ms), direction = Number(station.wind_direction_deg);
      if (!Number.isFinite(speed) || !Number.isFinite(direction)) return;
      const angle = (direction - 90) * Math.PI / 180, length = Math.max(10, Math.min(27, 10 + speed * 1.5));
      const x2 = x + Math.cos(angle) * length, y2 = y + Math.sin(angle) * length;
      ctx.strokeStyle = "#174a68"; ctx.fillStyle = "#174a68"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(angle - .55) * 6, y2 - Math.sin(angle - .55) * 6); ctx.lineTo(x2 - Math.cos(angle + .55) * 6, y2 - Math.sin(angle + .55) * 6); ctx.closePath(); ctx.fill();
    }
  });
  ctx.restore();
}

function tileLon(x, z) {
  return x / (2 ** z) * 360 - 180;
}

function tileLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (2 ** z);
  return 180 / Math.PI * Math.atan(Math.sinh(n));
}

function suikeiTileUrl(template, z, x, y) {
  return `${DATA_ROOT}/${template.replace("{z}", z).replace("{x}", x).replace("{y}", y)}`;
}

function drawSuikeiTiles() {
  if (state.source !== "observed" || !isSuikeiObservedLayer()) return;
  const layerKey = state.observedLayer === "temp" ? "temperature" : state.observedLayer;
  const layer = currentSuikeiSlot()?.layers?.[layerKey];
  if (!layer?.tile_template || state.suikeiManifest?.availability === false) return;
  const z = Number(layer.native_zoom ?? state.suikeiManifest.native_zoom ?? 8);
  const coordinateZoom = z - 1; // JMA uses 512 px tiles, so x/y follow the preceding XYZ zoom.
  const boundsValue = layer.bounds || state.suikeiManifest.bounds || [122, 20, 150, 48];
  const bounds = Array.isArray(boundsValue)
    ? boundsValue
    : [boundsValue.west, boundsValue.south, boundsValue.east, boundsValue.north];
  const n = 2 ** coordinateZoom;
  const xMin = Math.max(0, Math.floor((Number(bounds[0]) + 180) / 360 * n));
  const xMax = Math.min(n - 1, Math.floor((Number(bounds[2]) + 180) / 360 * n));
  const latToY = (lat) => Math.floor((1 - Math.asinh(Math.tan(Number(lat) * Math.PI / 180)) / Math.PI) / 2 * n);
  const yMin = Math.max(0, latToY(bounds[3]));
  const yMax = Math.min(n - 1, latToY(bounds[1]));
  let loaded = 0, loading = 0, missing = 0;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (let x = xMin; x <= xMax; x += 1) for (let y = yMin; y <= yMax; y += 1) {
    const url = suikeiTileUrl(layer.tile_template, z, x, y);
    let entry = state.suikeiTileCache.get(url);
    if (!entry) {
      const image = new Image();
      entry = { image, status: "loading" };
      state.suikeiTileCache.set(url, entry);
      image.onload = () => { entry.status = "loaded"; draw(); };
      image.onerror = () => { entry.status = "missing"; draw(); };
      image.src = url;
    }
    if (entry.status === "loading") loading += 1;
    if (entry.status === "missing") missing += 1;
    if (entry.status !== "loaded") continue;
    loaded += 1;
    const [x0, y0] = lonLatToPixel(tileLon(x, coordinateZoom), tileLat(y, coordinateZoom));
    const [x1, y1] = lonLatToPixel(tileLon(x + 1, coordinateZoom), tileLat(y + 1, coordinateZoom));
    ctx.drawImage(entry.image, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1);
  }
  ctx.restore();
  if (loading && !loaded) {
    els.dataNotice.hidden = false;
    els.dataNotice.textContent = "推計気象分布を読み込み中です。";
  } else if (missing && !loaded) {
    els.dataNotice.hidden = false;
    els.dataNotice.textContent = "この時刻の推計気象分布タイルがありません。";
  } else if (loaded) {
    els.dataNotice.hidden = true;
    els.dataNotice.textContent = "";
  }
}

function drawValueLabel(text, x, y) {
  ctx.save();
  ctx.font = "900 17px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.fillStyle = "rgba(25,35,44,0.92)";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawPointValueLabels() {
  if (currentDataType() !== "temperature" || !state.points.length) return;
  const zoomRatio = state.view?.scale / (state.minScale || state.view?.scale || 1);
  if (zoomRatio < 10) return;
  const spacing = 140;
  const buckets = new Map();
  state.points.forEach((point) => {
    const value = valueForPoint(point);
    if (!Number.isFinite(value)) return;
    const [x, y] = lonLatToPixel(point.lon, point.lat);
    if (x < 24 || x > els.canvas.width - 24 || y < 24 || y > els.canvas.height - 24) return;
    const bx = Math.floor(x / spacing), by = Math.floor(y / spacing), key = `${bx},${by}`;
    const cx = (bx + 0.5) * spacing, cy = (by + 0.5) * spacing;
    const score = (x - cx) ** 2 + (y - cy) ** 2;
    if (!buckets.has(key) || score < buckets.get(key).score) buckets.set(key, { point, x, y, score });
  });
  buckets.forEach(({ point, x, y }) => {
    const value = valueForPoint(point);
    drawValueLabel(Number.isInteger(value) ? String(value) : value.toFixed(1), x, y);
  });
}

function suikeiPalette() {
  if (state.observedLayer === "sunshine") return [
    [[120,120,120], "0.0"], [[154,154,154], "0.2"], [[188,188,188], "0.4"],
    [[224,224,224], "0.6"], [[240,230,136], "0.8"], [[248,176,0], "0.9"], [[244,80,56], "1.0"],
  ];
  return [];
}

function nearestPaletteLabel(rgb, palette) {
  let best = null;
  palette.forEach(([color, label]) => {
    const distance = color.reduce((sum, value, index) => sum + (value - rgb[index]) ** 2, 0);
    if (!best || distance < best.distance) best = { label, distance };
  });
  return best && best.distance < 5000 ? best.label : null;
}

function drawSuikeiValueLabels() {
  if (state.source !== "observed" || !isSuikeiObservedLayer()) return;
  const zoomRatio = state.view?.scale / (state.minScale || state.view?.scale || 1);
  if (zoomRatio < 10) return;
  if (state.observedLayer === "temp") {
    const payload = state.suikeiTemperatureLabels;
    if (!payload || String(payload.validtime) !== String(currentSuikeiSlot()?.validtime)) return;
    const spacing = 140;
    const buckets = new Map();
    for (const label of payload.labels || []) {
      const [x, y] = lonLatToPixel(Number(label.longitude), Number(label.latitude));
      if (x < 24 || x > els.canvas.width - 24 || y < 24 || y > els.canvas.height - 24) continue;
      const value = Number(label.temperature_c);
      if (!Number.isFinite(value)) continue;
      const bx = Math.floor(x / spacing), by = Math.floor(y / spacing), key = `${bx},${by}`;
      const cx = (bx + 0.5) * spacing, cy = (by + 0.5) * spacing;
      const score = (x - cx) ** 2 + (y - cy) ** 2;
      if (!buckets.has(key) || score < buckets.get(key).score) buckets.set(key, { value, x, y, score });
    }
    buckets.forEach(({ value, x, y }) => drawValueLabel(Number.isInteger(value) ? String(value) : value.toFixed(1), x, y));
    return;
  }
  const palette = suikeiPalette();
  if (!palette.length) return;
  const spacing = 150;
  for (let y = spacing / 2; y < els.canvas.height; y += spacing) {
    for (let x = spacing / 2; x < els.canvas.width; x += spacing) {
      const [lon, lat] = pixelToLonLat(x, y);
      if (!isLandPoint(lon, lat)) continue;
      const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      if (pixel[3] < 80) continue;
      const label = nearestPaletteLabel(pixel, palette);
      if (label) drawValueLabel(label, x, y);
    }
  }
}

function polygonLabel(level) {
  if (currentDataType() === "weather") return "";
  const match = String(level || "").match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function drawPolygonValueLabels() {
  if (!isPolygonDataType() || !state.weatherFeatures.length) return;
  const zoomRatio = state.view?.scale / (state.minScale || state.view?.scale || 1);
  if (zoomRatio < 10) return;
  const occupied = [];
  state.weatherFeatures.forEach((feature) => {
    const label = polygonLabel(feature.properties?.level);
    if (!label) return;
    const rings = feature.geometry?.type === "MultiPolygon"
      ? feature.geometry.coordinates.flatMap((polygon) => polygon.slice(0, 1))
      : (feature.geometry?.coordinates || []).slice(0, 24);
    rings.forEach((ring) => {
      if (!ring?.length) return;
      const pixels = ring.map(([lon, lat]) => lonLatToPixel(lon, lat));
      const xs = pixels.map((point) => point[0]), ys = pixels.map((point) => point[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      if (maxX - minX < 55 || maxY - minY < 38) return;
      const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
      if (x < 30 || x > els.canvas.width - 30 || y < 30 || y > els.canvas.height - 30) return;
      if (occupied.some((point) => Math.hypot(point.x - x, point.y - y) < 100)) return;
      occupied.push({ x, y });
      drawValueLabel(label, x, y);
    });
  });
}

function updateHeadings() {
  const dataType = currentDataType();
  const elementLabel = state.source === "observed" && state.observedLayer === "precip1h" ? "1時間降水量" : state.source === "observed" && state.observedLayer === "wind" ? "風向・風速" : dataType === "weather" ? (state.source === "observed" ? "推定天気" : "天気") : dataType === "sunshine" ? "日照時間" : dataType === "precipitation" ? "3時間降水量" : dataType === "snowfall" ? "3時間降雪量" : state.element === "temp" ? "実況気温" : state.element === "max" ? "最高気温" : "最低気温";
  const modeLabel = state.mode === "anomaly" ? "平均との差" : "前日差";
  const sourceLabel = state.source === "forecast" ? "予測" : "実況";
  const slot = state.source === "forecast" ? currentForecastSlot() : null;
  const dateLabel = state.source === "forecast"
      ? isPolygonDataType(dataType)
      ? `予測対象 ${slot?.interval_label || slot?.label || "--"}`
      : `予測対象 ${state.forecastLayer === "temp3h" ? slot?.label : state.points[0]?.targetDate || slot?.target_date || "--"}`
    : `実況 ${state.points[0]?.sourceDate || "--"}`;
  const statusText = state.source === "forecast"
    ? slot?.status === "stale"
      ? "対象時刻経過"
      : slot?.status === "available"
        ? "JMA天気分布格子"
        : "データなし"
    : state.points.length
      ? "観測値補間"
      : "データなし";
  const modeClass = state.mode === "value" ? "value" : state.mode;
  const displayChip = isPolygonDataType(dataType)
    ? `<span class="mode-chip value">${elementLabel}</span>`
    : state.mode === "value"
      ? ""
      : `<span class="mode-chip ${modeClass}">${modeLabel}</span>`;
  const comparisonPart = dataType === "temperature" && state.mode !== "value" ? `<span>${activeComparisonLabel()}</span>` : "";
  if (els.mapTitle) els.mapTitle.textContent = `${sourceLabel}${elementLabel}`;
  if (els.mapSubtitle) els.mapSubtitle.innerHTML = `${displayChip}<span>${dateLabel}</span>${comparisonPart}<span>${statusText}</span>`;
  if (els.timestampBadge) els.timestampBadge.textContent = dateLabel;
  updateMapStamp(elementLabel, sourceLabel, dataType);
}

function syncSuikeiTimeline() {
  const slots = suikeiSlots();
  const timeline = document.querySelector(".map-timeline");
  if (!slots.length) {
    if (timeline) timeline.hidden = true;
    return;
  }
  if (timeline) timeline.hidden = false;
  const max = Math.max(0, slots.length - 1);
  const value = Number.isInteger(state.suikeiSlotIndex)
    ? Math.max(0, Math.min(state.suikeiSlotIndex, max))
    : max;
  state.suikeiSlotIndex = value;
  const labels = slots.map((slot) => {
    const parts = parseSuikeiTime(slot.validtime);
    return parts ? `${parts.day}日${String(parts.hour).padStart(2, "0")}時` : slot.validtime || "--";
  });
  els.timelineRange.max = String(max);
  els.timelineRange.value = String(value);
  els.timelineRange.disabled = slots.length < 2;
  const percent = max === 0 ? 50 : (value / max) * 100;
  els.timelineRange.style.setProperty("--timeline-value", `${percent}%`);
  els.timelineTicks.innerHTML = labels.map((_label, index) => {
    const p = max === 0 ? 50 : (index / max) * 100;
    const active = index === value ? " active" : "";
    const parts = parseSuikeiTime(slots[index]?.validtime);
    const major = index === 0 || index === max || index === value || parts?.hour % 6 === 0 ? " major" : "";
    return `<span class="timeline-tick${active}${major}" style="left:${p}%"></span>`;
  }).join("");
  els.timelineBottom.innerHTML = labels.map((label, index) => {
    const p = max === 0 ? 50 : (index / max) * 100;
    const active = index === value ? " active" : "";
    const parts = parseSuikeiTime(slots[index]?.validtime);
    const show = index === 0 || index === max || index === value || parts?.hour % 6 === 0;
    const hidden = show ? "" : " hidden-label";
    return `<button type="button" class="timeline-label dense${active}${hidden}" data-timeline-index="${index}" style="left:${p}%;" aria-label="${label}へ移動"><span class="timeline-label-text">${label}</span></button>`;
  }).join("");
  els.timelinePrevButton.disabled = value === 0;
  els.timelineNextButton.disabled = value === max;
}

function syncTimelineFromElement() {
  const timeline = document.querySelector(".map-timeline");
  if (timeline) timeline.hidden = !observedTimelineVisible();
  if (state.source === "observed" && isSuikeiObservedLayer()) {
    syncSuikeiTimeline();
    return;
  }
  const slots = state.source === "forecast" ? currentForecastSlots() : state.observedSlots;
  const labels = state.source === "forecast"
    ? slots.map((slot) => slot.label)
    : state.observedSlots.map((slot) => slot.label);
  const max = Math.max(0, labels.length - 1);
  const currentObservedActive = state.source === "observed" && state.element === "temp";
  const value = state.source === "forecast"
    ? Math.min(state.slotIndex, max)
    : currentObservedActive
      ? Math.min(state.slotIndex, max)
      : Math.max(0, Math.min(state.slotIndex, max));
  const labelDates = slots.map((slot) => String(slot.valid_time || slot.target_date || "").slice(0, 10));
  const labelHours = slots.map((slot) => {
    const time = String(slot.valid_time || slot.validtime || "");
    const isoMatch = time.match(/T(\d{2}):/);
    if (isoMatch) return Number(isoMatch[1]);
    const compactMatch = time.match(/^\d{8}(\d{2})/);
    return compactMatch ? Number(compactMatch[1]) : null;
  });
  const showAllForecastStepLabels = state.source === "forecast"
    && (state.forecastLayer === "temp3h" || isPolygonDataType(currentDataType()));
  const isDenseTimeline = state.source === "forecast" && labels.length > 8 && !showAllForecastStepLabels;
  const shouldShowDenseLabel = (index) => {
    if (showAllForecastStepLabels) return true;
    if (!isDenseTimeline) return true;
    if (index === value || index === 0 || index === max) return true;
    if (labelDates[index] && labelDates[index] !== labelDates[index - 1]) return true;
    const hour = labelHours[index];
    return Number.isFinite(hour) && hour % 6 === 0;
  };
  const isMajorTick = (index) => {
    if (showAllForecastStepLabels) return true;
    if (!isDenseTimeline) return true;
    if (index === 0 || index === max) return true;
    if (labelDates[index] && labelDates[index] !== labelDates[index - 1]) return true;
    const hour = labelHours[index];
    return Number.isFinite(hour) && hour % 6 === 0;
  };
  els.timelineRange.max = String(max);
  els.timelineRange.value = String(value);
  els.timelineRange.disabled = false;
  document.querySelector(".map-timeline")?.classList.remove("has-current-button");
  const percent = max === 0 ? 50 : (value / max) * 100;
  els.timelineRange.style.setProperty("--timeline-value", `${percent}%`);
  els.timelineTicks.innerHTML = labels.map((label, index) => {
    const p = max === 0 ? 50 : (index / max) * 100;
    const active = !currentObservedActive && index === value ? " active" : "";
    const major = isMajorTick(index) ? " major" : "";
    const statusClass = state.source === "observed" && slots[index]?.source === "realtime" ? " updating" : "";
    return `<span class="timeline-tick${active}${major}${statusClass}" style="left:${p}%"></span>`;
  }).join("");
  els.timelineBottom.innerHTML = labels.map((label, index) => {
    const p = max === 0 ? 50 : (index / max) * 100;
    const active = !currentObservedActive && index === value ? " active" : "";
    const dense = labels.length > 8 ? " dense" : "";
    const hidden = shouldShowDenseLabel(index) ? "" : " hidden-label";
    const slotSource = slots[index]?.source;
    const statusClass = state.source === "observed" && slotSource === "realtime" ? " updating" : " fixed";
    const statusLabel = state.source !== "observed"
      ? ""
      : slotSource === "realtime"
        ? "更新中"
        : slotSource === "saved_realtime"
          ? "気象庁アメダス10分値から作成"
          : "日別値反映済み";
    return `<button type="button" class="timeline-label${active}${dense}${hidden}${state.source === "observed" ? statusClass : ""}" data-timeline-index="${index}" style="left:${p}%;" aria-label="${label}へ移動 ${statusLabel}"><span class="timeline-label-text">${label}</span></button>`;
  }).join("");
  els.timelinePrevButton.disabled = value === 0;
  els.timelineNextButton.disabled = value === max;
}

function setElementFromTimeline(value) {
  if (state.source === "forecast") {
    state.slotIndex = Number(value);
    state.element = currentForecastSlot().element;
    els.elementSelect.value = state.element === "min" ? "min" : "max";
    syncTimelineFromElement();
    loadData();
    return;
  }
  if (isSuikeiObservedLayer()) {
    state.suikeiSlotIndex = Math.max(0, Math.min(Number(value), suikeiSlots().length - 1));
    syncTimelineFromElement();
    loadData();
    return;
  }
  const slot = state.observedSlots[Number(value)] || state.observedSlots[0];
  const previousIndex = state.slotIndex;
  state.slotIndex = Number(value);
  const nextElement = slot.element;
  if (state.element === nextElement && previousIndex === state.slotIndex) {
    syncTimelineFromElement();
    return;
  }
  state.element = nextElement;
  els.elementSelect.value = nextElement;
  syncTimelineFromElement();
  loadData();
}

function draw() {
  resizeCanvasToDisplay();
  updateZoomControl();
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = "#e4eef5";
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  drawWorldBoundaries();
  drawGrid();
  drawPoints();
  drawRealtimeStations();
  drawSuikeiTiles();
  drawWeatherPolygons();
  drawBoundaries();
  drawPointValueLabels();
  drawSuikeiValueLabels();
  drawPolygonValueLabels();
  drawPlaceLabels();
  const suikeiLayerKey = state.observedLayer === "temp" ? "temperature" : state.observedLayer;
  const hasSuikei = state.source === "observed" && isSuikeiObservedLayer()
    && Boolean(currentSuikeiSlot()?.layers?.[suikeiLayerKey]?.tile_template)
    && state.suikeiManifest?.availability !== false;
  if (!state.points.length && !state.weatherFeatures.length && !state.realtimeStations.length && !hasSuikei) {
    const slot = state.source === "forecast" ? currentForecastSlot() : null;
    const message = slot?.message || "表示できるデータがありません。";
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "rgba(120,132,145,0.6)";
    ctx.lineWidth = 1;
    const w = Math.min(760, els.canvas.width - 120);
    const h = 112;
    const x = (els.canvas.width - w) / 2;
    const y = Math.max(90, els.canvas.height * 0.34);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#202932";
    ctx.font = "900 28px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("データなし", els.canvas.width / 2, y + 44);
    ctx.font = "800 20px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(message, els.canvas.width / 2, y + 80);
    ctx.restore();
  }
  drawScaleBar();
  drawMapLegend();
  if (state.hoverPoint) {
    const [x, y] = lonLatToPixel(state.hoverPoint.lon, state.hoverPoint.lat);
    ctx.save();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  updateHeadings();
  updateRankingPanel();
}

function nearestPoint(lon, lat) {
  if (currentDataType() !== "temperature") return null;
  if (!state.points.length) return null;
  let best = null;
  let bestDist = Infinity;
  state.points.forEach((point) => {
    const dx = (point.lon - lon) * Math.cos((lat * Math.PI) / 180);
    const dy = point.lat - lat;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  });
  return best && bestDist < 0.006 ? best : null;
}

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

function addDaysToDateKey(value, days) {
  const key = dateKey(value);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function shortDayElementLabel(dateText, element) {
  const parts = dateKey(dateText).split("-");
  if (parts.length !== 3) return "";
  const day = Number(parts[2]);
  if (!Number.isFinite(day)) return "";
  const elementText = element === "min" ? "最低" : element === "max" ? "最高" : "気温";
  return `${day}日${elementText}`;
}

function previousComparisonLabel() {
  if (state.mode !== "previous" || currentDataType() !== "temperature") return "";
  const pointDate = state.points[0]?.targetDate || state.points[0]?.sourceDate;
  const slot = state.source === "forecast" ? currentForecastSlot() : currentObservedSlot();
  const targetDate = pointDate || slot?.target_date;
  const previousDate = addDaysToDateKey(targetDate, -1);
  if (!previousDate) return "";
  const baseLabel = shortDayElementLabel(previousDate, state.element);
  if (state.source !== "forecast") return `${baseLabel}実況との比較`;
  const comparisonSource = slot?.previous_comparison_source;
  if (comparisonSource === "forecast") return `${baseLabel}予測との比較`;
  if (comparisonSource === "observed_realtime") {
    const parts = dateKey(previousDate).split("-");
    const day = Number(parts[2]);
    const elementText = state.element === "min" ? "最低気温" : "最高気温";
    return `${day}日実況${elementText}（推定値）との比較`;
  }
  if (comparisonSource === "observed_daily") return `${baseLabel}実況との比較`;
  return `${baseLabel}との比較`;
}

function averageComparisonLabel() {
  if (state.mode !== "anomaly" || currentDataType() !== "temperature") return "";
  const option = els.periodSelect?.selectedOptions?.[0];
  const optionText = option?.textContent?.trim();
  if (state.period === "normal") return "気象庁平年値 1991-2020との比較";
  if (optionText) return `${optionText}平均との比較`;
  return `過去${state.period}年平均との比較`;
}

function activeComparisonLabel() {
  if (state.mode === "previous") return previousComparisonLabel();
  if (state.mode === "anomaly") return averageComparisonLabel();
  return "";
}

function shortChartDate(value) {
  const parts = dateKey(value).split("-");
  if (parts.length !== 3) return value || "--";
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function slotPath(prefix, slot, mode = "value") {
  return `${DATA_ROOT}/${prefix}_${slot.id}_anomaly_${periodSuffix(state.period)}.csv`;
}

async function loadCsvPoint(path, index) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const rows = parseCsv(await response.text());
  return rows[index] || null;
}

async function loadCsvNearestPoint(path, point) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const rows = parseCsv(await response.text());
  let best = null;
  let bestDist = Infinity;
  rows.forEach((row) => {
    const dx = (row.lon - point.lon) * Math.cos((point.lat * Math.PI) / 180);
    const dy = row.lat - point.lat;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  });
  return best;
}

function recentObservedDates(days) {
  const dates = [...new Set(state.observedSlots.map((slot) => dateKey(slot.target_date)).filter(Boolean))];
  return dates.slice(Math.max(0, dates.length - days));
}

function forecastSlotsForPointChart() {
  if (state.pointChartSource !== "forecast" && state.source !== "forecast") return [];
  return (state.forecastLayers?.daily?.slots || state.forecastSlots)
    .filter((slot) => (
      slot.status === "available"
      && ["min", "max"].includes(slot.element)
    ));
}

async function loadVpfdIndex() {
  if (state.vpfdIndex) return state.vpfdIndex;
  const response = await fetch(`${DATA_ROOT}/vpfd_index.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  state.vpfdIndex = await response.json();
  return state.vpfdIndex;
}

function nearestVpfdClass(point, index) {
  const stationMap = index?.station_to_class10 || {};
  const nearest = nearestChartStations(point, 12);
  for (const station of nearest) {
    const blockNo = String(station.blockNo || "").padStart(5, "0");
    if (stationMap[blockNo]) return {
      class10: stationMap[blockNo],
      station,
      areaName: index?.class10?.[stationMap[blockNo]]?.name || "",
    };
  }
  const points = Array.isArray(index?.class10_points) ? index.class10_points : [];
  const prefecture = prefectureForPoint(point).replace(/都|道|府|県$/, "");
  const candidates = prefecture
    ? points.filter((item) => {
      const parentName = String(index?.class10?.[item.class10]?.parent_name || "").replace(/都|道|府|県$/, "");
      return parentName === prefecture || parentName.includes(prefecture) || prefecture.includes(parentName);
    })
    : points;
  let best = null;
  let bestDist = Infinity;
  (candidates.length ? candidates : points).forEach((item) => {
    const lon = Number(item.longitude);
    const lat = Number(item.latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !item.class10) return;
    const dx = (lon - point.lon) * Math.cos((point.lat * Math.PI) / 180);
    const dy = lat - point.lat;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  });
  if (!best?.class10) return null;
  return {
    class10: best.class10,
    station: { name: best.name || "", lon: Number(best.longitude), lat: Number(best.latitude) },
    areaName: index?.class10?.[best.class10]?.name || "",
  };
}

async function loadVpfdForPoint(point) {
  const index = await loadVpfdIndex();
  const match = nearestVpfdClass(point, index);
  if (!match?.class10) return null;
  if (!state.vpfdCache.has(match.class10)) {
    const response = await fetch(`${DATA_ROOT}/vpfd_${match.class10}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    state.vpfdCache.set(match.class10, await response.json());
  }
  return { ...match, data: state.vpfdCache.get(match.class10) };
}

function vpfdPointForecast(vpfd) {
  const pointSeries = vpfd?.data?.pointTimeSeries;
  if (!pointSeries?.timeDefines?.length) return null;
  const rows = pointSeries.timeDefines.map((timeDef, index) => ({
    time: timeDef.dateTime,
    label: formatChartTime(timeDef.dateTime, true),
    value: Number(pointSeries.temperature?.[index]),
    status: "available",
  })).filter((row) => Number.isFinite(row.value));
  const buildMarkers = (values, element, label) => {
    const markers = [];
    let startIndex = null;
    let currentValue = null;
    const flush = (endIndex) => {
      if (startIndex === null || currentValue === null) return;
      const start = pointSeries.timeDefines[startIndex]?.dateTime;
      const end = pointSeries.timeDefines[endIndex + 1]?.dateTime
        || new Date(new Date(pointSeries.timeDefines[endIndex]?.dateTime).getTime() + 3 * 60 * 60 * 1000).toISOString();
      markers.push({
        start,
        end,
        element,
        label,
        value: Number(currentValue),
      });
    };
    (values || []).forEach((value, index) => {
      const hasValue = String(value ?? "").trim() !== "";
      if (hasValue && startIndex === null) {
        startIndex = index;
        currentValue = value;
      } else if ((!hasValue || String(value) !== String(currentValue)) && startIndex !== null) {
        flush(index - 1);
        startIndex = hasValue ? index : null;
        currentValue = hasValue ? value : null;
      }
    });
    if (startIndex !== null) flush((values || []).length - 1);
    return markers.filter((marker) => Number.isFinite(marker.value) && marker.start && marker.end);
  };
  return {
    rows,
    markers: [
      ...buildMarkers(pointSeries.maxTemperature, "max", "予測最高"),
      ...buildMarkers(pointSeries.minTemperature, "min", "予測最低"),
    ],
  };
}

async function collectPointForecastRows(point) {
  if (!point) return { rows: [], markers: [] };
  const vpfd = await loadVpfdForPoint(point).catch(() => null);
  const vpfdForecast = vpfdPointForecast(vpfd);
  if (vpfdForecast?.rows?.length) {
    return {
      rows: vpfdForecast.rows,
      markers: vpfdForecast.markers,
      vpfd,
    };
  }
  const tempSlots = (state.forecastLayers?.temp3h?.slots || [])
    .filter((slot) => slot.status === "available" || slot.status === "stale")
    .sort((a, b) => String(a.validtime).localeCompare(String(b.validtime)));
  const rows = await Promise.all(tempSlots.map(async (slot) => {
    const forecastPoint = await loadCsvNearestPoint(`${DATA_ROOT}/forecast_${slot.id}_value.csv`, point).catch(() => null);
    return {
      time: slot.validtime || slot.target_date,
      label: slot.label,
      value: forecastPoint?.forecast ?? forecastPoint?.display ?? null,
      status: slot.status,
    };
  }));
  const validRows = rows.filter((row) => Number.isFinite(row.value));
  const markerSlots = forecastSlotsForPointChart();
  const markerRows = await Promise.all(markerSlots.map(async (slot) => {
    const forecastPoint = await loadCsvNearestPoint(slotPath("forecast", slot), point).catch(() => null);
    return {
      time: slot.validtime || slot.target_date,
      targetDate: slot.target_date,
      element: slot.element,
      label: slot.element === "min" ? "予測最低" : "予測最高",
      value: forecastPoint?.forecast ?? forecastPoint?.display ?? null,
    };
  }));
  return {
    rows: validRows,
    markers: markerRows.filter((row) => Number.isFinite(row.value)),
    vpfd,
  };
}

async function loadRealtimeStationSeries() {
  if (state.realtimeStationSeries) return state.realtimeStationSeries;
  const response = await fetch(`${DATA_ROOT}/observed_realtime_station_timeseries.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  state.realtimeStationSeries = await response.json();
  return state.realtimeStationSeries;
}

function nearestSeriesStations(point, stations, limit = 3) {
  return stations
    .map((station) => {
      const lon = Number(station.longitude);
      const lat = Number(station.latitude);
      const dx = (lon - point.lon) * Math.cos((point.lat * Math.PI) / 180);
      const dy = lat - point.lat;
      const dist2 = dx * dx + dy * dy;
      return { station, dist2: Math.max(dist2, 1e-8) };
    })
    .sort((a, b) => a.dist2 - b.dist2)
    .slice(0, limit);
}

function filterSeriesByDays(seriesRows, days) {
  if (!seriesRows.length) return [];
  const latest = new Date(seriesRows[seriesRows.length - 1].time).getTime();
  const start = latest - Math.max(1, days) * 24 * 60 * 60 * 1000;
  return seriesRows.filter((row) => new Date(row.time).getTime() >= start);
}

async function collectPointRealtimeRows(point) {
  const payload = await loadRealtimeStationSeries();
  const nearest = nearestSeriesStations(point, payload.stations || []);
  if (!nearest.length) return [];
  const byTime = new Map();
  nearest.forEach(({ station, dist2 }) => {
    const weight = 1 / dist2;
    (station.series || []).forEach(([time, value]) => {
      const temp = Number(value);
      if (!time || !Number.isFinite(temp)) return;
      const item = byTime.get(time) || { time, weighted: 0, weight: 0 };
      item.weighted += temp * weight;
      item.weight += weight;
      byTime.set(time, item);
    });
  });
  const rows = [...byTime.values()]
    .filter((item) => item.weight > 0)
    .map((item) => ({ time: item.time, value: item.weighted / item.weight }))
    .sort((a, b) => a.time.localeCompare(b.time));
  return filterSeriesByDays(rows, state.pointChartDays);
}

async function collectPointChartRows(point) {
  if (!point) return [];
  const rows = [];
  const dates = recentObservedDates(point.chartDaysOverride || state.pointChartDays);
  for (const date of dates) {
    const minSlot = state.observedSlots.find((slot) => dateKey(slot.target_date) === date && slot.element === "min");
    const maxSlot = state.observedSlots.find((slot) => dateKey(slot.target_date) === date && slot.element === "max");
    const [minPoint, maxPoint] = await Promise.all([
      minSlot ? loadCsvNearestPoint(slotPath("observed", minSlot), point).catch(() => null) : null,
      maxSlot ? loadCsvNearestPoint(slotPath("observed", maxSlot), point).catch(() => null) : null,
    ]);
    rows.push({
      date,
      observedMin: minPoint?.observed ?? null,
      observedMax: maxPoint?.observed ?? null,
      averageMin: minPoint?.average ?? null,
      averageMax: maxPoint?.average ?? null,
      minUpdating: minSlot?.source === "realtime",
      maxUpdating: maxSlot?.source === "realtime",
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function chartValues(rows) {
  return rows.flatMap((row) => [
    row.observedMin,
    row.observedMax,
    state.pointChartShowAverage ? row.averageMin : null,
    state.pointChartShowAverage ? row.averageMax : null,
  ]).filter(Number.isFinite);
}

function drawLine(points, color, dashed = false) {
  if (!points.length || !chartCtx) return;
  chartCtx.save();
  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = dashed ? 2 : 3;
  chartCtx.setLineDash(dashed ? [5, 5] : []);
  chartCtx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) chartCtx.moveTo(point.x, point.y);
    else chartCtx.lineTo(point.x, point.y);
  });
  chartCtx.stroke();
  points.forEach((point) => {
    chartCtx.beginPath();
    chartCtx.arc(point.x, point.y, dashed ? 3 : 4, 0, Math.PI * 2);
    chartCtx.fillStyle = color;
    chartCtx.fill();
  });
  chartCtx.restore();
}

function drawPointChart(rows) {
  if (!chartCtx || !els.pointChartCanvas) return;
  const rect = els.pointChartCanvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(420, Math.round(rect.width * dpr));
  const height = Math.max(220, Math.round(rect.height * dpr));
  if (els.pointChartCanvas.width !== width || els.pointChartCanvas.height !== height) {
    els.pointChartCanvas.width = width;
    els.pointChartCanvas.height = height;
  }
  chartCtx.clearRect(0, 0, width, height);
  chartCtx.fillStyle = "#fff";
  chartCtx.fillRect(0, 0, width, height);
  const margin = { top: 14 * dpr, right: 18 * dpr, bottom: 42 * dpr, left: 46 * dpr };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = chartValues(rows);
  if (!values.length || !rows.length) {
    chartCtx.fillStyle = "#647180";
    chartCtx.font = `${13 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
    chartCtx.textAlign = "center";
    chartCtx.fillText("この地点の時系列データを表示できません", width / 2, height / 2);
    return;
  }
  const minValue = Math.floor(Math.min(...values) - 1);
  const maxValue = Math.ceil(Math.max(...values) + 1);
  const ySpan = Math.max(2, maxValue - minValue);
  const xFor = (index) => margin.left + (rows.length === 1 ? plotW / 2 : (plotW * index) / (rows.length - 1));
  const yFor = (value) => margin.top + plotH - ((value - minValue) / ySpan) * plotH;

  chartCtx.strokeStyle = "#e0e6ec";
  chartCtx.lineWidth = 1 * dpr;
  chartCtx.fillStyle = "#607080";
  chartCtx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
  chartCtx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = minValue + (ySpan * i) / 4;
    const y = yFor(value);
    chartCtx.beginPath();
    chartCtx.moveTo(margin.left, y);
    chartCtx.lineTo(width - margin.right, y);
    chartCtx.stroke();
    chartCtx.fillText(`${value.toFixed(0)}℃`, margin.left - 6 * dpr, y + 3 * dpr);
  }
  chartCtx.textAlign = "center";
  rows.forEach((row, index) => {
    const x = xFor(index);
    chartCtx.fillText(shortChartDate(row.date), x, height - 12 * dpr);
  });

  const series = (key) => rows
    .map((row, index) => Number.isFinite(row[key]) ? { x: xFor(index), y: yFor(row[key]), row } : null)
    .filter(Boolean);
  drawLine(series("observedMax"), "#d15c36");
  drawLine(series("observedMin"), "#2d75bd");
  if (state.pointChartShowAverage) {
    drawLine(series("averageMax"), "#f0a078", true);
    drawLine(series("averageMin"), "#7fb2df", true);
  }
}

function drawRealtimePointChart(rows) {
  if (!chartCtx || !els.pointChartCanvas) return;
  state.pointChartRows = rows;
  state.pointChartPlotPoints = [];
  const rect = els.pointChartCanvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(420, Math.round(rect.width * dpr));
  const height = Math.max(220, Math.round(rect.height * dpr));
  if (els.pointChartCanvas.width !== width || els.pointChartCanvas.height !== height) {
    els.pointChartCanvas.width = width;
    els.pointChartCanvas.height = height;
  }
  chartCtx.clearRect(0, 0, width, height);
  chartCtx.fillStyle = "#fff";
  chartCtx.fillRect(0, 0, width, height);
  const margin = { top: 14 * dpr, right: 18 * dpr, bottom: 42 * dpr, left: 46 * dpr };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = rows.map((row) => row.value).filter(Number.isFinite);
  if (!values.length) {
    chartCtx.fillStyle = "#647180";
    chartCtx.font = `${13 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
    chartCtx.textAlign = "center";
    chartCtx.fillText("表示できる実況気温データがありません", width / 2, height / 2);
    return;
  }
  const minValue = Math.floor(Math.min(...values) - 1);
  const maxValue = Math.ceil(Math.max(...values) + 1);
  const ySpan = Math.max(2, maxValue - minValue);
  const yFor = (value) => margin.top + plotH - ((value - minValue) / ySpan) * plotH;
  const xFor = (index) => margin.left + (rows.length === 1 ? plotW / 2 : (plotW * index) / (rows.length - 1));
  const xForTimeMs = (timeMs) => {
    const firstMs = new Date(rows[0]?.time).getTime();
    const lastMs = new Date(rows[rows.length - 1]?.time).getTime();
    if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs) || firstMs === lastMs) return margin.left + plotW / 2;
    return margin.left + ((timeMs - firstMs) / (lastMs - firstMs)) * plotW;
  };

  chartCtx.strokeStyle = "#e0e6ec";
  chartCtx.lineWidth = 1 * dpr;
  chartCtx.fillStyle = "#607080";
  chartCtx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
  chartCtx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = minValue + (ySpan * i) / 4;
    const y = yFor(value);
    chartCtx.beginPath();
    chartCtx.moveTo(margin.left, y);
    chartCtx.lineTo(width - margin.right, y);
    chartCtx.stroke();
    chartCtx.fillText(`${value.toFixed(0)}℃`, margin.left - 6 * dpr, y + 3 * dpr);
  }

  drawTimeAxisGuides({
    ctx: chartCtx,
    dpr,
    rows,
    xForTimeMs,
    top: margin.top,
    bottom: margin.top + plotH,
    labelY: height - 12 * dpr,
    left: margin.left,
    right: width - margin.right,
    mode: "realtime",
  });

  chartCtx.save();
  chartCtx.strokeStyle = "#2d75bd";
  chartCtx.lineWidth = 3 * dpr;
  chartCtx.lineJoin = "round";
  chartCtx.lineCap = "round";
  chartCtx.beginPath();
  rows.forEach((row, index) => {
    const x = xFor(index);
    const y = yFor(row.value);
    state.pointChartPlotPoints.push({ x: x / dpr, y: y / dpr, row });
    if (index === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();
  chartCtx.restore();

  chartCtx.save();
  chartCtx.fillStyle = "#2d75bd";
  rows.forEach((row, index) => {
    if (index % Math.max(1, Math.floor(rows.length / 24)) !== 0 && index !== rows.length - 1) return;
    chartCtx.beginPath();
    chartCtx.arc(xFor(index), yFor(row.value), 2.4 * dpr, 0, Math.PI * 2);
    chartCtx.fill();
  });
  chartCtx.restore();

}

function weatherSymbolForVpfd(weather) {
  const text = String(weather || "");
  if (text.includes("雪")) return "❄";
  if (text.includes("雨")) return "☂";
  if (text.includes("晴")) return "☀";
  return "☁";
}

function windArrowForDirection(direction) {
  return {
    北: "↓",
    北東: "↙",
    東: "←",
    南東: "↖",
    南: "↑",
    南西: "↗",
    西: "→",
    北西: "↘",
  }[direction] || "↓";
}

function drawForecastWeatherRows({ vpfd, xForTimeMs, minTime, maxTime, margin, width, dpr }) {
  const area = vpfd?.data?.areaTimeSeries;
  if (!area?.timeDefines?.length) return;
  const rowYWeather = 18 * dpr;
  const rowYWind = 42 * dpr;
  chartCtx.save();
  chartCtx.textAlign = "right";
  chartCtx.fillStyle = "#5f6e7d";
  chartCtx.font = `900 ${9 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
  chartCtx.fillText("天気", margin.left - 16 * dpr, rowYWeather + 4 * dpr);
  chartCtx.fillText("風", margin.left - 16 * dpr, rowYWind + 4 * dpr);

  area.timeDefines.forEach((timeDef, index) => {
    const date = new Date(timeDef.dateTime);
    const timeMs = date.getTime();
    if (!Number.isFinite(timeMs) || timeMs < minTime - 1 || timeMs > maxTime + 1) return;
    const x = xForTimeMs(timeMs);
    if (x < margin.left - 1 || x > width - margin.right + 1) return;
    const weather = area.weather?.[index] || "";
    const wind = area.wind?.[index] || {};
    chartCtx.textAlign = "center";
    chartCtx.font = `${15 * dpr}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif`;
    chartCtx.fillStyle = weather.includes("晴") ? "#e85b2a" : weather.includes("雨") ? "#2d75bd" : "#9aa3aa";
    chartCtx.fillText(weatherSymbolForVpfd(weather), x, rowYWeather + 5 * dpr);
    chartCtx.font = `900 ${14 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
    chartCtx.fillStyle = "#7fb2df";
    chartCtx.fillText(windArrowForDirection(wind.direction), x, rowYWind + 2 * dpr);
    chartCtx.font = `${7 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
    chartCtx.fillStyle = "#3f4b57";
    chartCtx.fillText(String(wind.range || "").replace(" ", "〜"), x, rowYWind + 11 * dpr);
  });
  chartCtx.restore();
}

function drawForecastPointChart(payload) {
  const rows = payload?.rows || [];
  const markers = payload?.markers || [];
  const vpfd = payload?.vpfd || null;
  if (!chartCtx || !els.pointChartCanvas) return;
  state.pointChartRows = rows;
  state.pointChartPlotPoints = [];
  const rect = els.pointChartCanvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(420, Math.round(rect.width * dpr));
  const height = Math.max(220, Math.round(rect.height * dpr));
  if (els.pointChartCanvas.width !== width || els.pointChartCanvas.height !== height) {
    els.pointChartCanvas.width = width;
    els.pointChartCanvas.height = height;
  }
  chartCtx.clearRect(0, 0, width, height);
  chartCtx.fillStyle = "#fff";
  chartCtx.fillRect(0, 0, width, height);
  const margin = { top: (vpfd ? 58 : 14) * dpr, right: 18 * dpr, bottom: 42 * dpr, left: (vpfd ? 74 : 46) * dpr };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = [...rows.map((row) => row.value), ...markers.map((row) => row.value)].filter(Number.isFinite);
  if (!values.length) {
    chartCtx.fillStyle = "#647180";
    chartCtx.font = `${13 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
    chartCtx.textAlign = "center";
    chartCtx.fillText("この地点の3時間予測を表示できません", width / 2, height / 2);
    return;
  }
  const minValue = Math.floor(Math.min(...values) - 1);
  const maxValue = Math.ceil(Math.max(...values) + (vpfd ? 5 : 1));
  const ySpan = Math.max(2, maxValue - minValue);
  const yFor = (value) => margin.top + plotH - ((value - minValue) / ySpan) * plotH;
  const timeMs = rows.map((row) => jmaTimeToDate(row.time).getTime()).filter(Number.isFinite);
  const minTime = Math.min(...timeMs);
  const maxTime = Math.max(...timeMs);
  const xForTime = (time) => {
    const value = jmaTimeToDate(time).getTime();
    if (!Number.isFinite(value) || minTime === maxTime) return margin.left + plotW / 2;
    return margin.left + ((value - minTime) / (maxTime - minTime)) * plotW;
  };
  const xForTimeMs = (timeMs) => margin.left + ((timeMs - minTime) / (maxTime - minTime || 1)) * plotW;

  drawForecastWeatherRows({ vpfd, xForTimeMs, minTime, maxTime, margin, width, dpr });

  chartCtx.strokeStyle = "#e0e6ec";
  chartCtx.lineWidth = 1 * dpr;
  chartCtx.fillStyle = "#607080";
  chartCtx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
  chartCtx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = minValue + (ySpan * i) / 4;
    const y = yFor(value);
    chartCtx.beginPath();
    chartCtx.moveTo(margin.left, y);
    chartCtx.lineTo(width - margin.right, y);
    chartCtx.stroke();
    chartCtx.fillText(`${value.toFixed(0)}℃`, margin.left - 6 * dpr, y + 3 * dpr);
  }

  drawTimeAxisGuides({
    ctx: chartCtx,
    dpr,
    rows: rows.map((row) => ({ time: jmaTimeToIso(row.time) })),
    xForTimeMs,
    top: margin.top,
    bottom: margin.top + plotH,
    labelY: height - 12 * dpr,
    left: margin.left,
    right: width - margin.right,
    mode: "forecast",
  });

  chartCtx.save();
  chartCtx.strokeStyle = "#d59b1f";
  chartCtx.lineWidth = 3 * dpr;
  chartCtx.lineJoin = "round";
  chartCtx.lineCap = "round";
  chartCtx.beginPath();
  rows.forEach((row, index) => {
    const x = xForTime(row.time);
    const y = yFor(row.value);
    state.pointChartPlotPoints.push({ x: x / dpr, y: y / dpr, row: { time: jmaTimeToIso(row.time), value: row.value } });
    if (index === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();
  chartCtx.restore();

  chartCtx.save();
  markers.forEach((marker) => {
    const band = forecastDailyBand(marker);
    if (!band) return;
    const bandX1 = Math.max(margin.left, Math.min(width - margin.right, xForTime(band.start)));
    const bandX2 = Math.max(margin.left, Math.min(width - margin.right, xForTime(band.end)));
    if (Math.abs(bandX2 - bandX1) < 4 * dpr) return;
    const bandCenter = (bandX1 + bandX2) / 2;
    const visibleHalfWidth = Math.abs(bandX2 - bandX1) / 3;
    const x1 = bandCenter - visibleHalfWidth;
    const x2 = bandCenter + visibleHalfWidth;
    const y = yFor(marker.value);
    const color = marker.element === "min" ? "#2d75bd" : "#d15c36";
    chartCtx.strokeStyle = color;
    chartCtx.lineWidth = 3 * dpr;
    chartCtx.lineCap = "round";
    chartCtx.beginPath();
    chartCtx.moveTo(x1, y);
    chartCtx.lineTo(x2, y);
    chartCtx.stroke();
    chartCtx.fillStyle = color;
    chartCtx.font = `900 ${10 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
    chartCtx.textAlign = "right";
    chartCtx.fillText(`${marker.value.toFixed(0)}℃`, x2 - 4 * dpr, y - 7 * dpr);
  });
  chartCtx.restore();

}

function drawTimeAxisGuides({ ctx, dpr, rows, xForTimeMs, top, bottom, labelY, left, right, mode }) {
  if (!rows?.length) return;
  const times = rows
    .map((row) => new Date(row.time))
    .filter((date) => Number.isFinite(date.getTime()));
  if (!times.length) return;
  const first = times[0];
  const last = times[times.length - 1];
  const labels = [];
  const makeAxisLabel = (date, includeDate = false, exactTime = false) => ({
    date: includeDate ? `${date.getMonth() + 1}/${date.getDate()}` : "",
    time: exactTime
      ? `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`
      : `${date.getHours()}時`,
  });
  const pushLabel = (date, label, force = false) => {
    const x = xForTimeMs(date.getTime());
    if (!Number.isFinite(x) || x < left - 1 || x > right + 1) return;
    if (labels.some((item) => Math.abs(item.x - x) < (force ? 28 : 54) * dpr)) return;
    labels.push({ x, label });
  };
  pushLabel(first, makeAxisLabel(first, true, first.getMinutes() !== 0), true);
  const cursor = new Date(first);
  cursor.setMinutes(0, 0, 0);
  if (cursor < first) cursor.setHours(cursor.getHours() + 1);
  while (cursor <= last) {
    const hour = cursor.getHours();
    if (hour === 0) {
      const x = xForTimeMs(cursor.getTime());
      ctx.save();
      ctx.strokeStyle = "rgba(93, 108, 122, 0.55)";
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
      if (Math.abs(cursor.getTime() - first.getTime()) > 30 * 60 * 1000) {
        pushLabel(new Date(cursor), makeAxisLabel(cursor, true), true);
      }
    } else if (mode === "forecast" && hour % 6 === 0) {
      pushLabel(new Date(cursor), makeAxisLabel(cursor));
    } else if (mode === "realtime" && hour % 6 === 0) {
      pushLabel(new Date(cursor), makeAxisLabel(cursor));
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  pushLabel(last, makeAxisLabel(last, true, last.getMinutes() !== 0), true);
  ctx.save();
  ctx.fillStyle = "#607080";
  ctx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
  labels.sort((a, b) => a.x - b.x).forEach((label, index) => {
    ctx.textAlign = index === 0 ? "left" : index === labels.length - 1 ? "right" : "center";
    if (label.label.date) ctx.fillText(label.label.date, label.x, labelY - 12 * dpr);
    ctx.fillText(label.label.time, label.x, labelY + 1 * dpr);
  });
  ctx.restore();
}

function forecastDailyBand(marker) {
  if (marker?.start && marker?.end) {
    return { start: marker.start, end: marker.end };
  }
  const dateText = marker?.targetDate;
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const base = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0);
  const start = new Date(base);
  const end = new Date(base);
  if (marker.element === "max") {
    start.setHours(9, 0, 0, 0);
    end.setHours(18, 0, 0, 0);
  } else {
    start.setHours(0, 0, 0, 0);
    end.setHours(9, 0, 0, 0);
  }
  return {
    start: `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}${String(start.getDate()).padStart(2, "0")}${String(start.getHours()).padStart(2, "0")}0000`,
    end: `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, "0")}${String(end.getDate()).padStart(2, "0")}${String(end.getHours()).padStart(2, "0")}0000`,
  };
}

function jmaTimeToDate(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})/);
  if (match) {
    const [, year, month, day, hour] = match;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), 0, 0));
  }
  return new Date(text);
}

function jmaTimeToIso(value) {
  const date = jmaTimeToDate(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value || "");
}

function formatChartTime(value, withDate = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return withDate ? `${month}/${day} ${hour}:${minute}` : `${hour}:${minute}`;
}

function formatChartDateTimeJa(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hour}:${minute}`;
}

function nearestChartStations(point, limit = 3) {
  if (!point || !state.chartStations.length) return [];
  return state.chartStations
    .map((station) => {
      const dx = (station.lon - point.lon) * Math.cos((point.lat * Math.PI) / 180);
      const dy = station.lat - point.lat;
      const km = Math.sqrt(dx * dx + dy * dy) * 111.32;
      return { ...station, km };
    })
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, polygon) {
  if (!polygon?.length || !pointInRing(lon, lat, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(lon, lat, hole));
}

function pointInGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(lon, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => pointInPolygon(lon, lat, polygon));
  }
  return false;
}

function prefectureForPoint(point) {
  if (!point || !state.boundaries?.features) return "";
  const feature = state.boundaries.features.find((item) => pointInGeometry(point.lon, point.lat, item.geometry));
  return feature?.properties?.nam_ja || "";
}

function municipalityLikeName(name) {
  if (!name) return "";
  if (/[市区町村]$/.test(name)) return `${name}付近`;
  return `${name}付近`;
}

function pointLocationLabel(point) {
  const prefecture = prefectureForPoint(point);
  const nearest = nearestChartStations(point, 1)[0];
  if (!prefecture && !nearest) {
    return "";
  }
  return [
    prefecture || nearest?.prefecture || "",
    nearest ? municipalityLikeName(nearest.name) : "",
  ].filter(Boolean).join(" ");
}

function updatePointChartLegend(rows, type = "realtime") {
  if (!els.pointChartLegend) return;
  if (type === "forecast") {
    const areaName = rows?.vpfd?.areaName ? `（${rows.vpfd.areaName}）` : "";
    const weatherItem = rows?.vpfd ? `<span><i style="background:#9aa3aa"></i>天気・風 ${areaName}</span>` : "";
    els.pointChartLegend.innerHTML = `<span><i style="background:#d59b1f"></i>3時間気温予測</span><span><i style="background:#d15c36"></i>日中の最高予測</span><span><i style="background:#2d75bd"></i>明け方の最低予測</span>${weatherItem}`;
    return;
  }
  if (type === "realtime") {
    els.pointChartLegend.innerHTML = `<span><i style="background:#2d75bd"></i>実況気温</span>`;
    return;
  }
  const averageItems = state.pointChartShowAverage
    ? `<span><i style="background:#f0a078"></i>平均最高</span><span><i style="background:#7fb2df"></i>平均最低</span>`
    : "";
  els.pointChartLegend.innerHTML = `
    <span><i style="background:#d15c36"></i>実況最高</span>
    <span><i style="background:#2d75bd"></i>実況最低</span>
    ${averageItems}
  `;
}

function updatePointChartControls() {
  els.pointChartSourceButtons?.querySelectorAll("[data-chart-source]").forEach((button) => {
    button.classList.toggle("active", state.pointChartSource === button.dataset.chartSource);
  });
  els.pointChartTypeButtons?.querySelectorAll("[data-chart-type]").forEach((button) => {
    button.classList.toggle("active", state.pointChartType === button.dataset.chartType);
  });
  els.pointChartRangeButtons?.querySelectorAll("[data-days]").forEach((button) => {
    button.classList.toggle("active", state.pointChartDays === Number(button.dataset.days));
  });
  const averageLabel = els.pointChartAverageToggle?.closest("label");
  if (els.pointChartTypeButtons) {
    els.pointChartTypeButtons.hidden = state.pointChartSource !== "observed";
    els.pointChartTypeButtons.style.display = state.pointChartSource === "observed" ? "" : "none";
  }
  if (els.pointChartRangeButtons) {
    const showRangeButtons = state.pointChartSource === "observed" && state.pointChartType === "realtime";
    els.pointChartRangeButtons.hidden = !showRangeButtons;
    els.pointChartRangeButtons.style.display = showRangeButtons ? "" : "none";
  }
  if (averageLabel) averageLabel.hidden = !(state.pointChartSource === "observed" && state.pointChartType === "daily");
}

async function openPointChart(point) {
  if (!point || !els.pointChartPanel) return;
  state.selectedPoint = point;
  els.pointChartPanel.hidden = false;
  const location = pointLocationLabel(point);
  const chartTitle = state.pointChartSource === "forecast"
    ? "3時間ごとの気温予測"
    : state.pointChartType === "daily" ? "最低・最高気温" : "10分ごとの気温変化";
  const effectiveDays = state.pointChartType === "daily" ? 7 : state.pointChartDays;
  els.pointChartTitle.innerHTML = `${chartTitle}${location ? `<small>地点: ${location}</small>` : ""}`;
  if (els.pointChartMeta) els.pointChartMeta.hidden = true;
  updatePointChartControls();
  els.pointChartLegend.textContent = "読み込み中...";
  try {
    const rows = state.pointChartSource === "forecast"
      ? await collectPointForecastRows(point)
      : state.pointChartType === "daily"
        ? await collectPointChartRows({ ...point, chartDaysOverride: effectiveDays })
        : await collectPointRealtimeRows(point);
    if (state.selectedPoint !== point) return;
    if (state.pointChartSource === "forecast") {
      drawForecastPointChart(rows);
      updatePointChartLegend(rows, "forecast");
    } else if (state.pointChartType === "daily") {
      state.pointChartPlotPoints = [];
      if (els.pointChartTooltip) els.pointChartTooltip.hidden = true;
      drawPointChart(rows);
      updatePointChartLegend(rows, "daily");
    } else {
      drawRealtimePointChart(rows);
      updatePointChartLegend(rows, "realtime");
    }
  } catch {
    if (state.pointChartSource === "forecast") drawForecastPointChart({ rows: [], markers: [] });
    else if (state.pointChartType === "daily") drawPointChart([]);
    else drawRealtimePointChart([]);
    els.pointChartLegend.textContent = "グラフの読み込みに失敗しました。";
  }
}

function setReadout(point) {
  state.hoverPoint = point;
  if (!point) {
    els.lonValue.textContent = "--";
    els.latValue.textContent = "--";
    els.mapValue.textContent = "--";
    els.baseValueRow.hidden = state.mode === "value";
    els.forecastValue.textContent = "--";
    els.anomalyValue.textContent = "--";
    return;
  }
  const display = valueForPoint(point);
  els.lonValue.textContent = point.lon.toFixed(3);
  els.latValue.textContent = point.lat.toFixed(3);
  els.mapValue.textContent = state.mode === "value" ? formatPlain(display) : formatSigned(display);
  const baseValue = state.source === "forecast" ? point.forecast : point.observed;
  els.baseValueRow.hidden = state.mode === "value";
  els.forecastValue.textContent = formatPlain(baseValue);
  els.anomalyValue.textContent = formatSigned(point.anomaly);
}

function updateControlAvailability() {
  const forecast = state.source === "forecast";
  const dataType = currentDataType();
  const rawOnly = state.source === "observed" && state.element === "temp";
  const forecastRankable = forecast && dataType === "temperature" && state.forecastLayer === "daily";
  const observedTemperatureLayer = state.source === "observed" && ["daily", "temp"].includes(state.observedLayer);
  const rankingAvailable = observedTemperatureLayer || forecastRankable;
  els.forecastLayerSelect.disabled = !forecast;
  els.modeSelect.disabled = dataType !== "temperature" || state.forecastLayer === "temp3h" || rawOnly;
  els.periodSelect.disabled = dataType !== "temperature" || state.mode !== "anomaly" || state.forecastLayer === "temp3h" || rawOnly;
  if (dataType !== "temperature" || state.forecastLayer === "temp3h" || rawOnly) {
    state.mode = "value";
    els.modeSelect.value = "value";
  }
  if (els.recordMarkersButton) {
    els.recordMarkersButton.disabled = !observedTemperatureLayer;
    if (els.recordMarkersButton.disabled && state.showRecordMarkers) {
      state.showRecordMarkers = false;
      els.recordMarkersButton.classList.remove("active");
      els.recordMarkersButton.setAttribute("aria-pressed", "false");
    }
  }
  if (els.rankingPanelButton) {
    els.rankingPanelButton.disabled = !rankingAvailable;
    if (!rankingAvailable && state.showRankingPanel) {
      state.showRankingPanel = false;
      els.rankingPanelButton.classList.remove("active");
      els.rankingPanelButton.setAttribute("aria-pressed", "false");
      updateRankingPanel();
    }
  }
  updateForecastLayerButtons();
  if (els.layerControlHeading) els.layerControlHeading.textContent = forecast ? "予測レイヤ" : "実況レイヤ";
  els.forecastLayerButtons.hidden = !forecast;
  if (els.observedLayerButtons) {
    els.observedLayerButtons.hidden = forecast;
    els.observedLayerButtons.querySelectorAll("[data-observed-layer]").forEach((button) => {
      const layer = button.dataset.observedLayer;
      button.disabled = !["daily", "temp"].includes(layer) && !state.observedRealtimeLayers[layer]?.available;
      button.classList.toggle("active", state.observedLayer === layer);
      button.title = button.disabled ? "データ準備中" : "";
    });
  }
  updateModeButtons();
}

function updateForecastLayerButtons() {
  if (!els.forecastLayerButtons) return;
  const disabled = state.source !== "forecast";
  els.forecastLayerButtons.querySelectorAll("[data-layer]").forEach((button) => {
    button.disabled = disabled;
    button.classList.toggle("active", state.forecastLayer === button.dataset.layer);
    button.setAttribute("aria-pressed", state.forecastLayer === button.dataset.layer ? "true" : "false");
  });
}

function updateModeButtons() {
  if (!els.modeButtons) return;
  const disabled = els.modeSelect.disabled;
  els.modeButtons.querySelectorAll("[data-mode]").forEach((button) => {
    button.disabled = disabled;
    button.classList.toggle("active", state.mode === button.dataset.mode);
    const selected = state.mode === button.dataset.mode;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function canvasPosition(event) {
  const rect = els.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * els.canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * els.canvas.height;
  return [x, y, rect];
}

els.canvas.addEventListener("mousemove", (event) => {
  const [x, y, rect] = canvasPosition(event);
  if (state.dragging && state.dragStart) {
    const dx = x - state.dragStart.x;
    const dy = y - state.dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) state.dragMoved = true;
    state.dragStart = { x, y };
    panBy(dx, dy);
    return;
  }
  const [lon, lat] = pixelToLonLat(x, y);
  const point = nearestPoint(lon, lat);
  setReadout(point);
  if (point) {
    const display = valueForPoint(point);
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${event.clientX - rect.left + 14}px`;
    els.tooltip.style.top = `${event.clientY - rect.top + 14}px`;
    const baseValue = state.source === "forecast" ? point.forecast : point.observed;
    const comparisonText = activeComparisonLabel();
    const valueLines = state.mode === "value"
      ? `表示値 ${formatPlain(display)}`
      : `表示値 ${formatSigned(display)}<br>${state.source === "forecast" ? "予測" : "実況"} ${formatPlain(baseValue)}`;
    els.tooltip.innerHTML = `経度 ${point.lon.toFixed(3)}<br>緯度 ${point.lat.toFixed(3)}<br>${valueLines}<br>平均との差${state.mode === "anomaly" && comparisonText ? `（${comparisonText}）` : ""} ${formatSigned(point.anomaly)}<br>前日差${state.mode === "previous" && comparisonText ? `（${comparisonText}）` : ""} ${formatSigned(point.previousDiff)}`;
  } else {
    els.tooltip.hidden = true;
  }
  draw();
});

els.canvas.addEventListener("mouseleave", () => {
  state.dragging = false;
  state.dragStart = null;
  els.canvasWrap.classList.remove("dragging");
  els.tooltip.hidden = true;
  state.hoverPoint = null;
  setReadout(null);
  draw();
});

els.canvas.addEventListener("mousedown", (event) => {
  const [x, y] = canvasPosition(event);
  state.dragging = true;
  state.dragStart = { x, y };
  state.dragMoved = false;
  els.canvasWrap.classList.add("dragging");
});

window.addEventListener("mouseup", () => {
  state.dragging = false;
  state.dragStart = null;
  els.canvasWrap.classList.remove("dragging");
});

els.canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const [x, y] = canvasPosition(event);
  zoomAt(x, y, event.deltaY < 0 ? 1.22 : 1 / 1.22);
}, { passive: false });

els.canvas.addEventListener("click", (event) => {
  if (state.dragMoved || currentDataType() !== "temperature") return;
  const [x, y] = canvasPosition(event);
  const [lon, lat] = pixelToLonLat(x, y);
  const point = nearestPoint(lon, lat);
  if (point) {
    state.pointChartSource = state.source === "forecast" ? "forecast" : "observed";
    openPointChart(point);
  }
});

els.pointChartCloseButton?.addEventListener("click", () => {
  state.selectedPoint = null;
  if (els.pointChartPanel) els.pointChartPanel.hidden = true;
});

els.pointChartRangeButtons?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-days]");
  if (!button) return;
  state.pointChartDays = Number(button.dataset.days) || 7;
  updatePointChartControls();
  if (state.selectedPoint) openPointChart(state.selectedPoint);
});

els.pointChartSourceButtons?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chart-source]");
  if (!button) return;
  state.pointChartSource = button.dataset.chartSource || "observed";
  updatePointChartControls();
  if (state.selectedPoint) openPointChart(state.selectedPoint);
});

els.pointChartTypeButtons?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chart-type]");
  if (!button) return;
  state.pointChartType = button.dataset.chartType || "realtime";
  updatePointChartControls();
  if (state.selectedPoint) openPointChart(state.selectedPoint);
});

els.pointChartAverageToggle?.addEventListener("change", () => {
  state.pointChartShowAverage = els.pointChartAverageToggle.checked;
  if (state.selectedPoint) openPointChart(state.selectedPoint);
});

els.pointChartCanvas?.addEventListener("mousemove", (event) => {
  if (!(state.pointChartSource === "forecast" || state.pointChartType === "realtime")) {
    if (els.pointChartTooltip) els.pointChartTooltip.hidden = true;
    return;
  }
  if (!state.pointChartPlotPoints.length || !els.pointChartTooltip) return;
  const rect = els.pointChartCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  let best = null;
  let bestDist = Infinity;
  state.pointChartPlotPoints.forEach((point) => {
    const dist = Math.abs(point.x - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  });
  if (!best || bestDist > 18) {
    els.pointChartTooltip.hidden = true;
    return;
  }
  els.pointChartTooltip.hidden = false;
  els.pointChartTooltip.textContent = `${formatChartDateTimeJa(best.row.time)}  ${best.row.value.toFixed(1)}℃`;
  const panelRect = els.pointChartPanel.getBoundingClientRect();
  const tooltipX = Math.min(panelRect.width - 148, Math.max(8, rect.left - panelRect.left + best.x + 10));
  const tooltipY = Math.min(panelRect.height - 30, Math.max(8, rect.top - panelRect.top + best.y - 30));
  els.pointChartTooltip.style.left = `${tooltipX}px`;
  els.pointChartTooltip.style.top = `${tooltipY}px`;
});

els.pointChartCanvas?.addEventListener("mouseleave", () => {
  if (els.pointChartTooltip) els.pointChartTooltip.hidden = true;
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("active", item === button));
    state.source = button.dataset.source;
    if (state.source === "forecast") {
      state.element = currentForecastSlot().element;
      els.elementSelect.value = state.element;
    } else {
      state.observedLayer = "daily";
      state.slotIndex = latestObservedSlotIndex("max");
      state.element = currentObservedSlot()?.element || "max";
      els.elementSelect.value = state.element;
    }
    syncTimelineFromElement();
    loadData();
  });
});

els.observedLayerButtons?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-observed-layer]");
  if (!button || button.disabled) return;
  const previousLayer = state.observedLayer;
  state.observedLayer = button.dataset.observedLayer;
  if (state.observedLayer === "daily") {
    state.slotIndex = latestObservedSlotIndex("max");
    state.element = currentObservedSlot()?.element || "max";
  } else {
    state.element = state.observedLayer === "temp" ? "temp" : state.observedLayer;
    if (isSuikeiObservedLayer() && !isSuikeiObservedLayer(previousLayer)) {
      state.suikeiSlotIndex = Math.max(0, suikeiSlots().length - 1);
    }
  }
  state.mode = "value";
  els.modeSelect.value = "value";
  updateControlAvailability();
  syncTimelineFromElement();
  loadData();
});

els.elementSelect.addEventListener("change", () => {
  state.element = els.elementSelect.value;
  syncTimelineFromElement();
  loadData();
});

function setForecastLayer(layer) {
  state.forecastLayer = layer;
  els.forecastLayerSelect.value = layer;
  state.slotIndex = Math.min(state.slotIndex, Math.max(0, currentForecastSlots().length - 1));
  state.element = currentForecastSlot().element;
  updateControlAvailability();
  syncTimelineFromElement();
  loadData();
}

els.forecastLayerSelect.addEventListener("change", () => {
  setForecastLayer(els.forecastLayerSelect.value);
});

els.forecastLayerButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-layer]");
  if (!button || button.disabled) return;
  setForecastLayer(button.dataset.layer);
});

els.timelineRange.addEventListener("input", () => {
  setElementFromTimeline(els.timelineRange.value);
});

els.timelineBottom.addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeline-index]");
  if (!button) return;
  setElementFromTimeline(button.dataset.timelineIndex);
});

els.timelinePrevButton.addEventListener("click", () => {
  const nextValue = Math.max(0, Number(els.timelineRange.value) - 1);
  setElementFromTimeline(nextValue);
});

els.timelineNextButton.addEventListener("click", () => {
  const nextValue = Math.min(Number(els.timelineRange.max), Number(els.timelineRange.value) + 1);
  setElementFromTimeline(nextValue);
});

els.modeSelect.addEventListener("change", () => {
  state.mode = els.modeSelect.value;
  updateControlAvailability();
  loadData();
});

els.modeButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button || button.disabled) return;
  state.mode = state.mode === button.dataset.mode ? "value" : button.dataset.mode;
  els.modeSelect.value = state.mode;
  updateControlAvailability();
  loadData();
});

els.periodSelect.addEventListener("change", () => {
  state.period = els.periodSelect.value;
  loadData();
});

els.targetSelect.addEventListener("change", () => {
  state.target = els.targetSelect.value;
  loadData();
});

els.placeLabelsToggle.addEventListener("change", () => {
  state.showPlaceLabels = els.placeLabelsToggle.checked;
  draw();
});

els.recordMarkersButton?.addEventListener("click", () => {
  if (els.recordMarkersButton.disabled) return;
  state.showRecordMarkers = !state.showRecordMarkers;
  if (state.showRecordMarkers) state.showRankingPanel = false;
  updateRankingPanel();
});

els.rankingPanelButton?.addEventListener("click", () => {
  if (els.rankingPanelButton.disabled) return;
  state.showRankingPanel = !state.showRankingPanel;
  if (state.showRankingPanel) state.showRecordMarkers = false;
  updateRankingPanel();
});

els.fitButton.addEventListener("click", () => {
  fitView();
  draw();
});

els.zoomInButton.addEventListener("click", () => {
  zoomAt(els.canvas.width / 2, els.canvas.height / 2, 1.35);
});

els.zoomOutButton.addEventListener("click", () => {
  zoomAt(els.canvas.width / 2, els.canvas.height / 2, 1 / 1.35);
});

els.downloadButton.addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = `temperature_distribution_${state.source}_${state.element}_${state.mode}_${periodSuffix(state.period)}.png`;
  a.href = els.canvas.toDataURL("image/png");
  a.click();
});

function shareUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("source", state.source);
  if (state.source === "forecast") url.searchParams.set("layer", state.forecastLayer);
  else url.searchParams.set("layer", state.observedLayer);
  url.searchParams.set("slot", String(state.slotIndex));
  if (state.source === "observed" && isSuikeiObservedLayer()) {
    url.searchParams.set("suikei", String(state.suikeiSlotIndex ?? Math.max(0, suikeiSlots().length - 1)));
  }
  url.searchParams.set("mode", state.mode);
  url.searchParams.set("period", state.period);
  url.searchParams.set("labels", state.showPlaceLabels ? "1" : "0");
  return url.toString();
}

async function copyShareLink() {
  const url = shareUrl();
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(url);
    els.copyLinkStatus.textContent = "URLをコピーしました";
    els.copyLinkButton.classList.add("copied");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    els.copyLinkStatus.textContent = copied ? "URLをコピーしました" : `コピーできませんでした: ${url}`;
    els.copyLinkButton.classList.toggle("copied", copied);
  }
  window.setTimeout(() => {
    els.copyLinkStatus.textContent = "";
    els.copyLinkButton.classList.remove("copied");
  }, 2500);
}

els.copyLinkButton?.addEventListener("click", copyShareLink);

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("source");
  if (source === "forecast" || source === "observed") state.source = source;
  const layer = params.get("layer");
  if (state.source === "forecast" && layer) state.forecastLayer = layer;
  if (state.source === "observed" && layer) state.observedLayer = layer;
  const slot = Number(params.get("slot"));
  if (Number.isInteger(slot) && slot >= 0) state.slotIndex = slot;
  const suikeiParam = params.get("suikei");
  const suikei = Number(suikeiParam);
  if (suikeiParam !== null && Number.isInteger(suikei) && suikei >= 0) state.suikeiSlotIndex = suikei;
  const mode = params.get("mode");
  if (["value", "anomaly", "previous"].includes(mode)) state.mode = mode;
  const period = params.get("period");
  if (["normal", "30", "20", "10", "5", "3"].includes(period)) state.period = period;
  if (params.get("labels") === "0") state.showPlaceLabels = false;
}

window.addEventListener("resize", () => {
  resizeCanvasToDisplay();
  draw();
});

async function init() {
  applyUrlState();
  await Promise.all([loadBoundaries(), loadPlaceLabels(), loadTemperatureExtremes()]);
  await Promise.all([loadForecastManifest(), loadObservedManifest()]);
  await loadSuikeiManifest();
  if (state.source === "observed") {
    if (state.observedLayer === "daily") {
      state.element = currentObservedSlot()?.element || "max";
    } else {
      state.element = state.observedLayer === "temp" ? "temp" : state.observedLayer;
    }
  }
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.source === state.source));
  els.forecastLayerSelect.value = state.forecastLayer;
  els.modeSelect.value = state.mode;
  els.periodSelect.value = state.period;
  els.placeLabelsToggle.checked = state.showPlaceLabels;
  syncTimelineFromElement();
  await loadData();
  window.setInterval(checkForecastManifestUpdate, FORECAST_MANIFEST_POLL_MS);
  window.setInterval(checkObservedDataUpdate, OBSERVED_DATA_POLL_MS);
}

init();
