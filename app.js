const DATA_ROOT = "./data/temperature_distribution_tool";
const BOUNDARY_URL = "./data/geography_japan_prefectures.geojson";
const WORLD_BOUNDARY_URL = "./data/geography_world_countries.geojson";
const PLACE_LABEL_URL = "./data/weather/japan_all_stations/station_inventory_current_temperature.csv";
const TEMPERATURE_EXTREMES_URL = `${DATA_ROOT}/temperature_extremes.json`;
const TEMPERATURE_STATION_RECORDS_URL = `${DATA_ROOT}/temperature_station_records.json`;
const DAILY_MAX_RACE_URL = `${DATA_ROOT}/observed_daily_max_race.json`;
const DAILY_MAX_RACE_BASE_FRAME_MS = 2000;
const DAILY_MAX_RACE_MOVE_RATIO = 0.4;
const DAILY_MAX_RACE_VIDEO_FPS = 20;
const DAILY_MAX_RACE_VIDEO_FRAME_US = 1_000_000 / DAILY_MAX_RACE_VIDEO_FPS;
const DAILY_MAX_RACE_VIDEO_BITRATE = 6_000_000;
const DAILY_MAX_RACE_VIDEO_FORMATS = Object.freeze({
  landscape: Object.freeze({ id: "landscape", label: "PC横 16:9", width: 1920, height: 1080 }),
  portrait: Object.freeze({ id: "portrait", label: "スマホ縦 9:16", width: 1080, height: 1920 }),
});
const FORECAST_MANIFEST_POLL_MS = 10 * 60 * 1000;
const OBSERVED_DATA_POLL_MS = 10 * 60 * 1000;
const WEATHER_MAP_POLL_MS = 10 * 60 * 1000;
const SUIKEI_MANIFEST_URL = `${DATA_ROOT}/suikei_realtime_manifest.json`;
const JMA_WEATHER_MAP_LIST_URL = "https://www.jma.go.jp/bosai/weather_map/data/list.json";
const JMA_WEATHER_MAP_IMAGE_ROOT = "https://www.jma.go.jp/bosai/weather_map/data/png";
const WEATHER_MAP_BOUNDS = [100, 170, 10, 60];
const WEATHER_MAP_SOURCE_PROJECTION = {
  centerX: 343.73563696,
  centerY: -295.45817118,
  scale: 1114.79637664,
  centralLongitude: 140,
};
const SUIKEI_TILE_CACHE_LIMIT = 240;
const SUIKEI_TIMELINE_DEBOUNCE_MS = 140;
const SUIKEI_OVERVIEW_MAX_ZOOM_RATIO = 2.2;
const GSI_TILE_CACHE_LIMIT = 120;
const MAX_MAP_SCALE = 30000;
let suikeiTimelineLoadTimer = null;
let scheduledMapDraw = null;
let dailyMaxRaceMp4MuxerPromise = null;
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
  observedDailySequence: "both",
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
  showTooltip: true,
  showDetailMap: false,
  detailMapOpacity: 0.7,
  showTerrain: false,
  terrainStyle: "color",
  weatherOpacity: 0.85,
  terrainOpacity: 0.35,
  showWeatherMap: false,
  weatherMapKind: "now",
  weatherMapNowIndex: -1,
  weatherMapOpacity: 0.75,
  weatherMapManifest: null,
  weatherMapImage: null,
  weatherMapImageKey: "",
  weatherMapLoading: false,
  legendOffsetX: 0,
  legendOffsetY: 0,
  legendScale: 1,
  legendCoreBounds: null,
  legendBounds: null,
  legendDragging: false,
  legendDragStart: null,
  legendResizing: false,
  legendResizeStart: null,
  gsiTileCache: new Map(),
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
  dailyMaxRaceArchive: null,
  dailyMaxRaceIndex: null,
  dailyMaxRaceIndexSource: "",
  dailyMaxRaceIndexStale: false,
  dailyMaxRaceSliceCache: new Map(),
  dailyMaxRaceDeliveryRetryTimer: null,
  dailyMaxRaceDeliveryRetryCount: 0,
  dailyMaxRace: null,
  dailyMaxRaceMeta: null,
  dailyMaxRaceDate: "",
  dailyMaxRaceElement: "max",
  dailyMaxRaceFrameIndex: 0,
  dailyMaxRaceVisibleCount: 25,
  dailyMaxRaceSpeed: 1,
  dailyMaxRacePlaying: false,
  dailyMaxRaceTimer: null,
  dailyMaxRaceDeepLink: null,
  dailyMaxRaceRefreshing: false,
  dailyMaxRaceRefreshResetTimer: null,
  dailyMaxRaceVideoStartIndex: 0,
  dailyMaxRaceVideoEndIndex: 0,
  dailyMaxRaceVideoFormat: "landscape",
  dailyMaxRaceVideoExporting: false,
  dailyMaxRaceVideoAbortRequested: false,
  dailyMaxRaceRows: new Map(),
  dailyMaxRacePreviousFocus: null,
  fullRankingDate: "",
  fullRankingElement: "max",
  fullRankingSource: "observed",
  fullRankingRows: [],
  fullRankingPreviousFocus: null,
  fullRankingLocatedStationKey: "",
  fullRankingDeepLink: null,
  fullRankingRefreshing: false,
  fullRankingActionResetTimers: new Map(),
  temperatureStationRecords: null,
  forecastFullRankingCache: new Map(),
  showRecordMarkers: false,
  showRankingPanel: false,
  rankingPanelPosition: null,
  rankingPanelDragging: false,
  rankingPanelDragStart: null,
  rankingPanelScale: 1,
  rankingPanelHeight: null,
  recordPanelPosition: null,
  recordPanelDragging: false,
  recordPanelDragStart: null,
  recordPanelScale: 1,
  recordPanelHeight: null,
  pointChartPanelPosition: null,
  pointChartPanelDragging: false,
  pointChartPanelDragStart: null,
  pointChartPanelScale: 1,
  panelResizeStart: null,
  panelHeightResizeStart: null,
  bounds: [122, 146.5, 23.4, 46.2],
  view: null,
  minScale: null,
  zoomOutMinScale: null,
  dragging: false,
  dragStart: null,
  dragMoved: false,
  mapTouches: new Map(),
  mapTouchGesture: null,
  mapTouchTapStart: null,
  suppressNextMapClick: false,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[character]));
}

function panelResizeHandles(kind) {
  const label = ["ranking", "record"].includes(kind) ? "パネル" : "グラフ";
  const corners = ["nw", "ne", "sw", "se"].map((corner) =>
    `<div class="panel-resize-handle ${corner}" data-panel-resize="${kind}" data-panel-corner="${corner}" role="separator" aria-label="${label}の大きさを変更"></div>`
  ).join("");
  const heightHandle = ["ranking", "record"].includes(kind)
    ? `<div class="panel-height-resize-handle top" data-panel-height-resize="${kind}" data-panel-height-edge="top" role="separator" aria-label="${label}の上辺から表示高さを変更"></div>
       <div class="panel-height-resize-handle bottom" data-panel-height-resize="${kind}" data-panel-height-edge="bottom" role="separator" aria-label="${label}の下辺から表示高さを変更"></div>`
    : "";
  return corners + heightHandle;
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
  observedDailySequenceControl: document.getElementById("observedDailySequenceControl"),
  observedDailySequenceButtons: document.getElementById("observedDailySequenceButtons"),
  dataNotice: document.getElementById("dataNotice"),
  modeSelect: document.getElementById("modeSelect"),
  modeButtons: document.getElementById("modeButtons"),
  periodSelect: document.getElementById("periodSelect"),
  targetSelect: document.getElementById("targetSelect"),
  placeLabelsToggle: document.getElementById("placeLabelsToggle"),
  tooltipToggle: document.getElementById("tooltipToggle"),
  detailMapToggle: document.getElementById("detailMapToggle"),
  detailMapOpacityRange: document.getElementById("detailMapOpacityRange"),
  detailMapOpacityValue: document.getElementById("detailMapOpacityValue"),
  terrainToggle: document.getElementById("terrainToggle"),
  terrainStyleSelect: document.getElementById("terrainStyleSelect"),
  weatherOpacityRange: document.getElementById("weatherOpacityRange"),
  weatherOpacityValue: document.getElementById("weatherOpacityValue"),
  terrainOpacityRange: document.getElementById("terrainOpacityRange"),
  terrainOpacityValue: document.getElementById("terrainOpacityValue"),
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
  weatherMapButton: document.getElementById("weatherMapButton"),
  weatherMapControls: document.getElementById("weatherMapControls"),
  weatherMapKindSelect: document.getElementById("weatherMapKindSelect"),
  weatherMapTimeSelect: document.getElementById("weatherMapTimeSelect"),
  weatherMapOpacityRange: document.getElementById("weatherMapOpacityRange"),
  weatherMapOpacityValue: document.getElementById("weatherMapOpacityValue"),
  weatherMapStatus: document.getElementById("weatherMapStatus"),
  canvasWrap: document.querySelector(".canvas-wrap"),
  legendResizeHandles: document.getElementById("legendResizeHandles"),
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
  recordPanel: document.getElementById("recordPanel"),
  dailyMaxRaceBackdrop: document.getElementById("dailyMaxRaceBackdrop"),
  dailyMaxRaceModal: document.getElementById("dailyMaxRaceModal"),
  dailyMaxRaceTitle: document.getElementById("dailyMaxRaceTitle"),
  dailyMaxRaceTitleText: document.getElementById("dailyMaxRaceTitleText"),
  dailyMaxRaceElementSwitch: document.getElementById("dailyMaxRaceElementSwitch"),
  dailyMaxRaceDateSelect: document.getElementById("dailyMaxRaceDateSelect"),
  dailyMaxRaceSummary: document.getElementById("dailyMaxRaceSummary"),
  dailyMaxRaceCloseButton: document.getElementById("dailyMaxRaceCloseButton"),
  dailyMaxRacePlayButton: document.getElementById("dailyMaxRacePlayButton"),
  dailyMaxRaceRestartButton: document.getElementById("dailyMaxRaceRestartButton"),
  dailyMaxRaceStepBackButton: document.getElementById("dailyMaxRaceStepBackButton"),
  dailyMaxRaceStepForwardButton: document.getElementById("dailyMaxRaceStepForwardButton"),
  dailyMaxRaceLatestButton: document.getElementById("dailyMaxRaceLatestButton"),
  dailyMaxRaceSpeedSelect: document.getElementById("dailyMaxRaceSpeedSelect"),
  dailyMaxRaceCountSelect: document.getElementById("dailyMaxRaceCountSelect"),
  dailyMaxRaceRefreshButton: document.getElementById("dailyMaxRaceRefreshButton"),
  dailyMaxRaceShareUrlButton: document.getElementById("dailyMaxRaceShareUrlButton"),
  dailyMaxRaceShareImageButton: document.getElementById("dailyMaxRaceShareImageButton"),
  dailyMaxRaceVideoButton: document.getElementById("dailyMaxRaceVideoButton"),
  dailyMaxRaceVideoPanel: document.getElementById("dailyMaxRaceVideoPanel"),
  dailyMaxRaceVideoCloseButton: document.getElementById("dailyMaxRaceVideoCloseButton"),
  dailyMaxRaceVideoFormatSelect: document.getElementById("dailyMaxRaceVideoFormatSelect"),
  dailyMaxRaceVideoStartSelect: document.getElementById("dailyMaxRaceVideoStartSelect"),
  dailyMaxRaceVideoEndSelect: document.getElementById("dailyMaxRaceVideoEndSelect"),
  dailyMaxRaceVideoMeta: document.getElementById("dailyMaxRaceVideoMeta"),
  dailyMaxRaceVideoExportButton: document.getElementById("dailyMaxRaceVideoExportButton"),
  dailyMaxRaceRange: document.getElementById("dailyMaxRaceRange"),
  dailyMaxRaceTimeTicks: document.getElementById("dailyMaxRaceTimeTicks"),
  dailyMaxRaceTime: document.getElementById("dailyMaxRaceTime"),
  dailyMaxRaceRegionLegend: document.getElementById("dailyMaxRaceRegionLegend"),
  dailyMaxRaceLoading: document.getElementById("dailyMaxRaceLoading"),
  dailyMaxRaceError: document.getElementById("dailyMaxRaceError"),
  dailyMaxRaceChart: document.getElementById("dailyMaxRaceChart"),
  dailyMaxRaceAxis: document.getElementById("dailyMaxRaceAxis"),
  dailyMaxRaceBars: document.getElementById("dailyMaxRaceBars"),
  dailyMaxRaceClockDate: document.getElementById("dailyMaxRaceClockDate"),
  dailyMaxRaceClockTime: document.getElementById("dailyMaxRaceClockTime"),
  dailyMaxRaceClockHour: document.getElementById("dailyMaxRaceClockHour"),
  dailyMaxRaceClockMinute: document.getElementById("dailyMaxRaceClockMinute"),
  dailyMaxRaceClockPeriod: document.getElementById("dailyMaxRaceClockPeriod"),
  dailyMaxRaceClockFace: document.getElementById("dailyMaxRaceClockFace"),
  dailyMaxRaceClockCaption: document.getElementById("dailyMaxRaceClockCaption"),
  dailyMaxRaceClockRange: document.getElementById("dailyMaxRaceClockRange"),
  dailyMaxRaceMeta: document.getElementById("dailyMaxRaceMeta"),
  dailyMaxRaceFootnote: document.getElementById("dailyMaxRaceFootnote"),
  fullRankingBackdrop: document.getElementById("fullRankingBackdrop"),
  fullRankingModal: document.getElementById("fullRankingModal"),
  fullRankingTitle: document.getElementById("fullRankingTitle"),
  fullRankingTitleText: document.getElementById("fullRankingTitleText"),
  fullRankingSourceLabel: document.getElementById("fullRankingSourceLabel"),
  fullRankingElementSwitch: document.getElementById("fullRankingElementSwitch"),
  fullRankingDateSelect: document.getElementById("fullRankingDateSelect"),
  fullRankingDateNavigation: document.getElementById("fullRankingDateNavigation"),
  fullRankingSummary: document.getElementById("fullRankingSummary"),
  fullRankingForecastContext: document.getElementById("fullRankingForecastContext"),
  fullRankingCloseButton: document.getElementById("fullRankingCloseButton"),
  fullRankingRefreshButton: document.getElementById("fullRankingRefreshButton"),
  fullRankingShareUrlButton: document.getElementById("fullRankingShareUrlButton"),
  fullRankingShareImageButton: document.getElementById("fullRankingShareImageButton"),
  fullRankingRegionLegend: document.getElementById("fullRankingRegionLegend"),
  fullRankingSearchInput: document.getElementById("fullRankingSearchInput"),
  fullRankingSearchClearButton: document.getElementById("fullRankingSearchClearButton"),
  fullRankingSearchSuggestions: document.getElementById("fullRankingSearchSuggestions"),
  fullRankingSearchStatus: document.getElementById("fullRankingSearchStatus"),
  fullRankingLoading: document.getElementById("fullRankingLoading"),
  fullRankingError: document.getElementById("fullRankingError"),
  fullRankingList: document.getElementById("fullRankingList"),
  fullRankingRows: document.getElementById("fullRankingRows"),
  fullRankingReadingHeading: document.getElementById("fullRankingReadingHeading"),
  fullRankingMonthRecordHeading: document.getElementById("fullRankingMonthRecordHeading"),
  fullRankingMeta: document.getElementById("fullRankingMeta"),
  fullRankingFootnote: document.getElementById("fullRankingFootnote"),
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

function scheduleMapDraw() {
  if (scheduledMapDraw != null) return;
  scheduledMapDraw = window.requestAnimationFrame(() => {
    scheduledMapDraw = null;
    draw();
  });
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

function activeObservedDailySlots() {
  if (state.observedDailySequence === "both") return state.observedSlots;
  return state.observedSlots.filter((slot) => slot.element === state.observedDailySequence);
}

function normalizeObservedDailySelection() {
  if (state.observedDailySequence === "both") return;
  const current = currentObservedSlot();
  if (current?.element === state.observedDailySequence) return;
  const sameDateIndex = state.observedSlots.findIndex((slot) => (
    slot.target_date === current?.target_date && slot.element === state.observedDailySequence
  ));
  state.slotIndex = sameDateIndex >= 0 ? sameDateIndex : latestObservedSlotIndex(state.observedDailySequence);
  state.element = currentObservedSlot()?.element || state.observedDailySequence;
}

function syncObservedDailySequenceControl() {
  const visible = state.source === "observed" && state.observedLayer === "daily";
  if (els.observedDailySequenceControl) els.observedDailySequenceControl.hidden = !visible;
  els.observedDailySequenceButtons?.querySelectorAll("[data-daily-sequence]").forEach((button) => {
    const selected = button.dataset.dailySequence === state.observedDailySequence;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
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

function selectLatestObservedDailySlot() {
  const latestSlot = activeObservedDailySlots().at(-1);
  if (!latestSlot) return false;
  const latestIndex = state.observedSlots.findIndex((slot) => slot === latestSlot || slot.id === latestSlot.id);
  if (latestIndex < 0) return false;
  const changed = latestIndex !== state.slotIndex || state.element !== latestSlot.element;
  state.slotIndex = latestIndex;
  state.element = latestSlot.element;
  els.elementSelect.value = latestSlot.element;
  syncTimelineFromElement();
  return changed;
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
      if (!els.dailyMaxRaceBackdrop?.hidden && !state.dailyMaxRace) {
        setDailyMaxRacePlaying(false);
        await loadDailyMaxRace(true);
        state.dailyMaxRaceFrameIndex = Math.max(0, (state.dailyMaxRace?.frames?.length || 1) - 1);
        renderDailyMaxRaceFrame(true);
      }
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
  const previousRaceLatest = state.dailyMaxRaceMeta?.latest_time || null;
  state.observedManifestGeneratedAt = manifest.generated_at || state.observedManifestGeneratedAt;
  const realtime = manifest.realtime_layers && typeof manifest.realtime_layers === "object" ? manifest.realtime_layers : {};
  const station = realtime.station_observations || {};
  const elements = station.elements || {};
  state.observedRealtimeLayers = {
    temp: realtime.temp || { available: true },
    precip1h: realtime.precip1h || (elements.precipitation_1h ? { available: true } : null),
    wind: realtime.wind || (elements.wind_speed || elements.wind_direction ? { available: true } : null),
    weather: realtime.weather || (currentSuikeiSlot()?.layers?.weather?.tile_template ? { available: true } : null),
    sunshine: realtime.sunshine || (currentSuikeiSlot()?.layers?.sunshine?.tile_template ? { available: true } : null),
  };
  state.realtimeStationMeta = station;
  state.dailyMaxRaceMeta = realtime.temperature_races || realtime.daily_max_race || null;
  if (previousRaceLatest && state.dailyMaxRaceMeta?.latest_time !== previousRaceLatest) {
    state.dailyMaxRaceArchive = null;
    state.dailyMaxRaceIndex = null;
    state.dailyMaxRaceIndexSource = "";
    state.dailyMaxRaceIndexStale = false;
    state.dailyMaxRaceSliceCache.clear();
    state.dailyMaxRace = null;
  }
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
    if (state.observedLayer === "daily") normalizeObservedDailySelection();
  }
  syncTimelineFromElement();
  updateControlAvailability();
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
    stationKey: row.station_key || "",
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
    const response = await fetch(PLACE_LABEL_URL);
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

function weatherMapFileName() {
  const files = state.weatherMapManifest?.near?.[state.weatherMapKind];
  if (!Array.isArray(files) || !files.length) return "";
  if (state.weatherMapKind !== "now" || state.weatherMapNowIndex < 0) return files[files.length - 1];
  return files[Math.min(state.weatherMapNowIndex, files.length - 1)] || files[files.length - 1];
}

function weatherMapValidDate(fileName, kind = state.weatherMapKind) {
  const match = String(fileName).match(/_(\d{14})_MET_/);
  if (!match) return null;
  const value = match[1];
  const leadHours = kind === "ft24" ? 24 : kind === "ft48" ? 48 : 0;
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)), Number(value.slice(8, 10)) + 9 + leadHours));
}

function weatherMapTimeLabel(fileName, kind = state.weatherMapKind) {
  const date = weatherMapValidDate(fileName, kind);
  return date ? `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日${date.getUTCHours()}時` : "";
}

function weatherMapTimeLabelNoYear(fileName) {
  const date = weatherMapValidDate(fileName);
  return date ? `${date.getUTCMonth() + 1}月${date.getUTCDate()}日${date.getUTCHours()}時` : "";
}

function syncWeatherMapTimeOptions() {
  if (!els.weatherMapTimeSelect) return;
  const files = state.weatherMapManifest?.near?.now || [];
  const latestTime = Date.parse(String(files.at(-1) || "").match(/_(\d{8})(\d{6})_MET_/)?.slice(1).join("T")
    ?.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6Z") || "");
  const recentFiles = files.map((fileName, originalIndex) => ({ fileName, originalIndex })).filter(({ fileName }) => {
    const match = fileName.match(/_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_MET_/);
    if (!match || !Number.isFinite(latestTime)) return true;
    const time = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
    return latestTime - time <= 48 * 60 * 60 * 1000;
  });
  els.weatherMapTimeSelect.replaceChildren();
  [...recentFiles].reverse().forEach(({ fileName, originalIndex }) => {
    const option = document.createElement("option");
    option.value = String(originalIndex);
    option.textContent = weatherMapTimeLabel(fileName, "now");
    els.weatherMapTimeSelect.append(option);
  });
  const latestIndex = Math.max(0, files.length - 1);
  els.weatherMapTimeSelect.value = String(state.weatherMapNowIndex < 0 ? latestIndex : Math.min(state.weatherMapNowIndex, latestIndex));
  els.weatherMapTimeSelect.disabled = state.weatherMapKind !== "now" || !files.length;
}

function weatherMapKindLabel(compact = false) {
  if (state.weatherMapKind === "now") return compact ? "実況" : "最新実況";
  return state.weatherMapKind === "ft24" ? "24時間予想" : "48時間予想";
}

function syncWeatherMapControls() {
  if (!els.weatherMapButton) return;
  els.weatherMapButton.checked = state.showWeatherMap;
  els.weatherMapControls.hidden = !state.showWeatherMap;
  els.weatherMapKindSelect.value = state.weatherMapKind;
  syncWeatherMapTimeOptions();
  els.weatherMapOpacityRange.value = String(Math.round(state.weatherMapOpacity * 100));
  els.weatherMapOpacityValue.value = `${Math.round(state.weatherMapOpacity * 100)}%`;
  if (!state.showWeatherMap) return;
  const fileName = weatherMapFileName();
  const kindLabel = weatherMapKindLabel();
  els.weatherMapStatus.textContent = state.weatherMapLoading
    ? `${kindLabel}を読み込み中…`
    : fileName
      ? `気象庁 ${kindLabel}（${weatherMapTimeLabel(fileName)}）を投影中`
      : `${kindLabel}を取得できませんでした`;
}

async function loadWeatherMapManifest() {
  try {
    const response = await fetch(`${JMA_WEATHER_MAP_LIST_URL}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    state.weatherMapManifest = await response.json();
  } catch {
    state.weatherMapManifest = null;
  }
  syncWeatherMapControls();
}

async function checkWeatherMapUpdate() {
  const previousFile = weatherMapFileName();
  await loadWeatherMapManifest();
  const nextFile = weatherMapFileName();
  if (!state.showWeatherMap || !nextFile || nextFile === previousFile) return;
  state.weatherMapImage = null;
  state.weatherMapImageKey = "";
  await loadWeatherMapImage();
}

function extractWeatherMapInk(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const imageContext = canvas.getContext("2d", { willReadFrequently: true });
  imageContext.drawImage(image, 0, 0);
  const pixels = imageContext.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  const darkMask = new Uint8Array(canvas.width * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const brightest = Math.max(red, green, blue);
      const isDarkInk = brightest < 178
        && Math.abs(red - green) < 30
        && Math.abs(green - blue) < 30;
      const isRedInk = red > 115 && red > green * 1.45 && red > blue * 1.35;
      const isBlueInk = blue > 105 && blue > red * 1.5 && blue > green * 1.25;
      const insideMap = y >= 28 && y < canvas.height - 22;
      if (!(insideMap && (isDarkInk || isRedInk || isBlueInk))) data[index + 3] = 0;
      else {
        data[index + 3] = Math.min(255, Math.max(110, data[index + 3]));
        if (isDarkInk) darkMask[y * canvas.width + x] = 1;
      }
    }
  }
  // Thin solid isobars lose antialiased edge pixels during reprojection. Add a
  // one-pixel dark fringe; genuine dashed gaps are wider and remain dashed.
  const source = new Uint8ClampedArray(data);
  for (let y = 29; y < canvas.height - 23; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const pixel = y * canvas.width + x;
      const index = pixel * 4;
      if (data[index + 3] || !(
        darkMask[pixel - 1] || darkMask[pixel + 1]
        || darkMask[pixel - canvas.width] || darkMask[pixel + canvas.width]
      )) continue;
      let neighbor = pixel - 1;
      if (!darkMask[neighbor]) neighbor = darkMask[pixel + 1] ? pixel + 1
        : darkMask[pixel - canvas.width] ? pixel - canvas.width : pixel + canvas.width;
      const neighborIndex = neighbor * 4;
      data[index] = source[neighborIndex];
      data[index + 1] = source[neighborIndex + 1];
      data[index + 2] = source[neighborIndex + 2];
      data[index + 3] = 155;
    }
  }
  imageContext.putImageData(pixels, 0, 0);
  return canvas;
}

async function loadWeatherMapImage() {
  if (!state.showWeatherMap) return;
  if (!state.weatherMapManifest) await loadWeatherMapManifest();
  const fileName = weatherMapFileName();
  if (!fileName) {
    state.weatherMapImage = null;
    syncWeatherMapControls();
    draw();
    return;
  }
  if (state.weatherMapImage && state.weatherMapImageKey === fileName) return;
  state.weatherMapLoading = true;
  syncWeatherMapControls();
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = `${JMA_WEATHER_MAP_IMAGE_ROOT}/${fileName}`;
    await image.decode();
    state.weatherMapImage = extractWeatherMapInk(image);
    state.weatherMapImageKey = fileName;
  } catch {
    state.weatherMapImage = null;
    state.weatherMapImageKey = "";
  } finally {
    state.weatherMapLoading = false;
    syncWeatherMapControls();
    draw();
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
  const [weatherWest, weatherEast, weatherSouth, weatherNorth] = WEATHER_MAP_BOUNDS;
  const [weatherX0, weatherY0] = project(weatherWest, weatherSouth);
  const [weatherX1, weatherY1] = project(weatherEast, weatherNorth);
  state.zoomOutMinScale = Math.min(
    els.canvas.width / Math.abs(weatherX1 - weatherX0),
    els.canvas.height / Math.abs(weatherY1 - weatherY0),
  ) * 0.94;
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
  state.view.scale = Math.max(state.zoomOutMinScale || state.minScale || 12, Math.min(MAX_MAP_SCALE, state.view.scale * factor));
  state.view.centerX = beforeX - (canvasX - els.canvas.width / 2) / state.view.scale;
  state.view.centerY = beforeY + (canvasY - els.canvas.height / 2) / state.view.scale;
  clampView();
  draw();
}

function updateZoomControl() {
  if (!els.zoomThumb || !state.view || !state.minScale) return;
  const min = state.zoomOutMinScale || state.minScale;
  const max = MAX_MAP_SCALE;
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
  const useWeatherBounds = state.view.scale < (state.minScale || state.view.scale) * 0.98;
  const [xMin, xMax, yMin, yMax] = useWeatherBounds
    ? (() => {
      const [west, east, south, north] = WEATHER_MAP_BOUNDS;
      const [x0, y0] = project(west, south);
      const [x1, y1] = project(east, north);
      return [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
    })()
    : fullProjectedBounds();
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

const TEMPERATURE_EXTREME_HEAT_THRESHOLD_C = 40;
const TEMPERATURE_LEGEND_MAX_C = 45;
const TEMPERATURE_EXTREME_HEAT_COLOR = [80, 0, 46];

function colorForValue(value) {
  if (value >= TEMPERATURE_EXTREME_HEAT_THRESHOLD_C) {
    return TEMPERATURE_EXTREME_HEAT_COLOR;
  }
  return colorRamp([
    [-20, [46, 52, 93]],
    [-10, [65, 105, 225]],
    [0, [103, 169, 207]],
    [10, [222, 235, 247]],
    [20, [255, 255, 191]],
    [25, [254, 224, 139]],
    [30, [244, 109, 67]],
    [35, [197, 27, 125]],
    [40, [180, 0, 104]],
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
    return `${formatDateTimeJa(targetParts, { dateOnly: true })} ${timeBand}`;
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
      targetText = `${observedParts ? formatDateTimeJa(observedParts, { dateOnly: true }) : sourceDate || "--"} ${timeBand}${updating}`;
    }
    }
  }
  const elementClass = stampElementClass(dataType);
  const sourceClass = state.source === "forecast" ? "is-forecast" : "is-observed";
  const comparisonText = activeComparisonLabel();
  const comparisonMode = dataType === "temperature" && ["anomaly", "previous"].includes(state.mode)
    ? state.mode
    : "";
  const comparisonModeLabel = comparisonMode === "anomaly" ? "平均との差" : comparisonMode === "previous" ? "前日差" : "";
  const comparisonModeMarkup = comparisonModeLabel
    ? `<span class="map-stamp-mode is-${comparisonMode}" aria-label="比較表示：${comparisonModeLabel}">${comparisonModeLabel}</span>`
    : "";
  const shortTargetText = targetText.replace(/^\d{4}年/, "");
  const compactTargetText = shortTargetText.replace(/^(\d{1,2})月(\d{1,2})日/, "$1/$2");
  const targetMarkup = `<span class="map-stamp-target" aria-label="${escapeHtml(targetText)}"><span class="map-stamp-target-full" aria-hidden="true">${escapeHtml(targetText)}</span><span class="map-stamp-target-short" aria-hidden="true">${escapeHtml(shortTargetText)}</span><span class="map-stamp-target-compact" aria-hidden="true">${escapeHtml(compactTargetText)}</span></span>`;
  els.mapStampMain.classList.toggle("has-comparison-mode", Boolean(comparisonModeLabel));
  els.mapStampMain.innerHTML = `<span class="map-stamp-source ${sourceClass}">${sourceLabel}</span><span class="map-stamp-element ${elementClass}">${elementLabel}</span>${comparisonModeMarkup}${targetMarkup}`;
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
    ctx.globalAlpha = 0.9 * state.weatherOpacity;
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

function forecastGridIndex(points) {
  const bucketSize = 0.25;
  const buckets = new Map();
  (points || []).forEach((point) => {
    const value = point.forecast ?? point.observed ?? point.display;
    if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat) || !Number.isFinite(value)) return;
    const key = `${Math.floor(point.lon / bucketSize)},${Math.floor(point.lat / bucketSize)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(point);
  });
  return { bucketSize, buckets };
}

function nearestForecastGridPoint(index, longitude, latitude, maxDistance = 0.2) {
  if (!index || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const baseX = Math.floor(longitude / index.bucketSize);
  const baseY = Math.floor(latitude / index.bucketSize);
  let candidates = [];
  for (let radius = 1; radius <= 5 && !candidates.length; radius += 1) {
    for (let x = baseX - radius; x <= baseX + radius; x += 1) {
      for (let y = baseY - radius; y <= baseY + radius; y += 1) {
        candidates.push(...(index.buckets.get(`${x},${y}`) || []));
      }
    }
  }
  const longitudeScale = Math.cos(latitude * Math.PI / 180);
  let nearest = null;
  let nearestDistance = Infinity;
  candidates.forEach((point) => {
    const dx = (point.lon - longitude) * longitudeScale;
    const dy = point.lat - latitude;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });
  return nearestDistance <= maxDistance ? nearest : null;
}

function forecastStationRankingRows() {
  const index = forecastGridIndex(state.points);
  return state.chartStations.map((station) => {
    const point = nearestForecastGridPoint(index, station.lon, station.lat);
    const value = point?.forecast ?? point?.observed ?? point?.display;
    if (!point || !Number.isFinite(value)) return null;
    return {
      stationKey: station.stationKey,
      prefecture: station.prefecture,
      station: `${station.name}付近`,
      value,
    };
  }).filter(Boolean);
}

function forecastRankingRows(rows, direction = "high", limit = 10) {
  const sorted = rows.slice().sort((a, b) => direction === "high" ? b.value - a.value : a.value - b.value);
  let previousValue = null;
  let rank = 0;
  return sorted.slice(0, limit).map((row, index) => {
    if (previousValue === null || Math.abs(row.value - previousValue) >= 0.05) rank = index + 1;
    previousValue = row.value;
    return {
      rank: String(rank),
      prefecture: row.prefecture,
      station: row.station,
      value: row.value.toFixed(1),
    };
  });
}

function forecastRankingData() {
  const slot = currentForecastSlot();
  const label = targetLabelForStamp(slot, currentDataType()) || slot?.label || "予測";
  const group = state.element === "min" ? "min" : "max";
  const rows = forecastStationRankingRows();
  const rankings = group === "min"
    ? { min_low: forecastRankingRows(rows, "low"), min_high: forecastRankingRows(rows, "high") }
    : { max_high: forecastRankingRows(rows, "high"), max_low: forecastRankingRows(rows, "low") };
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
  updateRecordPanel(observedRankable);
  els.rankingPanel.hidden = !state.showRankingPanel || !(forecastRankable || observedRankable);
  els.rankingPanelButton?.classList.toggle("active", state.showRankingPanel);
  els.rankingPanelButton?.setAttribute("aria-pressed", state.showRankingPanel ? "true" : "false");
  if (els.rankingPanel.hidden) return;
  applyRankingPanelPosition();
  if (!day) {
    els.rankingPanel.innerHTML = `<div class="ranking-head"><strong>気温ランキング</strong></div><p class="ranking-empty">データを読み込めません。</p>${panelResizeHandles("ranking")}`;
    applyPanelScale(els.rankingPanel, state.rankingPanelScale);
    applyPanelHeight(els.rankingPanel, state.rankingPanelHeight);
    wirePanelResize(els.rankingPanel, "ranking");
    return;
  }
  const status = rankingStatusInfo(day);
  const raceDates = Array.isArray(state.dailyMaxRaceMeta?.dates)
    ? state.dailyMaxRaceMeta.dates.map(String)
    : [String(state.dailyMaxRaceMeta?.date || "")];
  const raceAvailable = state.source === "observed"
    && Boolean(state.dailyMaxRaceMeta?.json)
    && raceDates.includes(String(day.date || ""));
  const fullRankingAvailable = raceAvailable || forecastRankable;
  els.rankingPanel.innerHTML = `
    <div class="ranking-head">
      <div class="ranking-head-main">
        <div class="ranking-title-row"><strong>${escapeHtml(day.label || day.date)} 気温ランキング</strong></div>
        <div class="ranking-meta-row">
          <span class="ranking-status ${status.className}"><b>${status.label}</b><span>${status.text}</span></span>
          <span class="ranking-description">${state.source === "forecast" ? "表示中の予測格子を全国のアメダス地点付近へ対応した上位10地点 / 下位10地点" : "最高気温と最低気温の全国上位10地点 / 下位10地点"}</span>
        </div>
      </div>
      ${raceAvailable ? `<button type="button" id="dailyMaxRaceOpenButton" class="ranking-animation-button" data-race-date="${escapeHtml(day.date)}">▶ アニメーションで見る</button>` : ""}
      <button type="button" id="rankingPanelCloseButton" aria-label="閉じる">×</button>
    </div>
    <div class="ranking-grid">
      ${day.rankings?.max_high || day.rankings?.max_low ? `<section class="ranking-group max">
        <div class="ranking-group-title">
          <span>最高気温</span>
          <div><small>日中の暑さ</small>${fullRankingAvailable ? `<button type="button" class="full-ranking-open-button" data-full-ranking-source="${escapeHtml(state.source)}" data-full-ranking-element="max" data-ranking-date="${escapeHtml(day.date)}">全国ランキングをみる</button>` : ""}</div>
        </div>
        <div class="ranking-pair">
          ${renderRankingList(day, "max_high")}
          ${renderRankingList(day, "max_low")}
        </div>
      </section>` : ""}
      ${day.rankings?.min_low || day.rankings?.min_high ? `<section class="ranking-group min">
        <div class="ranking-group-title">
          <span>最低気温</span>
          <div><small>明け方の冷え込み/寝苦しさ</small>${fullRankingAvailable ? `<button type="button" class="full-ranking-open-button" data-full-ranking-source="${escapeHtml(state.source)}" data-full-ranking-element="min" data-ranking-date="${escapeHtml(day.date)}">全国ランキングをみる</button>` : ""}</div>
        </div>
        <div class="ranking-pair">
          ${renderRankingList(day, "min_low")}
          ${renderRankingList(day, "min_high")}
        </div>
      </section>` : ""}
    </div>
    ${panelResizeHandles("ranking")}
  `;
  applyPanelScale(els.rankingPanel, state.rankingPanelScale);
  applyPanelHeight(els.rankingPanel, state.rankingPanelHeight);
  wireRankingPanelDrag();
  wirePanelResize(els.rankingPanel, "ranking");
  document.getElementById("rankingPanelCloseButton")?.addEventListener("click", () => {
    state.showRankingPanel = false;
    updateRankingPanel();
  }, { once: true });
  document.getElementById("dailyMaxRaceOpenButton")?.addEventListener("click", (event) => {
    openDailyMaxRaceModal(event.currentTarget.dataset.raceDate || "");
  }, { once: true });
  els.rankingPanel.querySelectorAll("[data-full-ranking-element]").forEach((button) => {
    button.addEventListener("click", () => {
      openFullRankingModal(
        button.dataset.rankingDate || "",
        button.dataset.fullRankingElement || "max",
        button.dataset.fullRankingSource || state.source,
      );
    }, { once: true });
  });
}

function dailyMaxRaceDateLabel(value) {
  const parts = String(value || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return String(value || "");
  return `${parts[0]}年${parts[1]}月${parts[2]}日`;
}

function dailyMaxRaceTimeLabel(value) {
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "--:--";
}

const DAILY_MAX_RACE_REGIONS = [
  { id: "hokkaido", label: "北海道", hue: 270, saturation: 66, lightness: 35 },
  { id: "tohoku", label: "東北", hue: 204, saturation: 100, lightness: 38 },
  { id: "hokuriku", label: "北陸", hue: 195, saturation: 100, lightness: 47 },
  { id: "kanto", label: "関東甲信", hue: 148, saturation: 100, lightness: 35 },
  { id: "tokai", label: "東海", hue: 60, saturation: 100, lightness: 50 },
  { id: "kinki", label: "近畿", hue: 45, saturation: 100, lightness: 50 },
  { id: "chugoku", label: "中国", hue: 0, saturation: 100, lightness: 50 },
  { id: "shikoku", label: "四国", hue: 31, saturation: 52, lightness: 47 },
  { id: "kyushu", label: "九州", hue: 0, saturation: 0, lightness: 4 },
  { id: "okinawa_amami", label: "沖縄・奄美", hue: 0, saturation: 0, lightness: 100, outline: "#dc2626" },
];

const DAILY_MAX_RACE_PREFECTURES = {
  hokkaido: ["宗谷地方", "上川地方", "留萌地方", "石狩地方", "空知地方", "後志地方", "網走・北見・紋別地方", "根室地方", "釧路地方", "十勝地方", "胆振地方", "日高地方", "渡島地方", "檜山地方"],
  tohoku: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
  kanto: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "山梨県", "長野県"],
  hokuriku: ["新潟県", "富山県", "石川県", "福井県"],
  tokai: ["岐阜県", "静岡県", "愛知県", "三重県"],
  kinki: ["滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"],
  chugoku: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
  shikoku: ["徳島県", "香川県", "愛媛県", "高知県"],
  kyushu: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県"],
  okinawa_amami: ["鹿児島県（奄美）", "沖縄県"],
};

const DAILY_MAX_RACE_AMAMI_STATIONS = new Set([
  "笠利", "名瀬", "喜界島", "古仁屋", "天城", "伊仙", "沖永良部", "与論島",
]);

function dailyMaxRaceRegion(station = {}) {
  const prefecture = String(station.prefecture || "");
  const name = String(station.name || "");
  if (prefecture === "沖縄県" || (prefecture === "鹿児島県" && DAILY_MAX_RACE_AMAMI_STATIONS.has(name))) {
    return DAILY_MAX_RACE_REGIONS.find((region) => region.id === "okinawa_amami");
  }
  if (prefecture.endsWith("地方") || prefecture === "網走・北見・紋別地方") {
    return DAILY_MAX_RACE_REGIONS.find((region) => region.id === "hokkaido");
  }
  const matchedRegionId = Object.entries(DAILY_MAX_RACE_PREFECTURES)
    .find(([, prefectures]) => prefectures.includes(prefecture))?.[0] || "kanto";
  return DAILY_MAX_RACE_REGIONS.find((region) => region.id === matchedRegionId)
    || DAILY_MAX_RACE_REGIONS.find((region) => region.id === "kanto");
}

function dailyMaxRacePrefectureKey(station, region) {
  if (region.id === "okinawa_amami" && station.prefecture === "鹿児島県") return "鹿児島県（奄美）";
  return String(station.prefecture || station.name || region.label);
}

function dailyMaxRaceColor(station) {
  const region = dailyMaxRaceRegion(station);
  const prefectures = DAILY_MAX_RACE_PREFECTURES[region.id] || [];
  const prefectureKey = dailyMaxRacePrefectureKey(station, region);
  const index = Math.max(0, prefectures.indexOf(prefectureKey));
  const center = Math.max(0, (prefectures.length - 1) / 2);
  const hueShift = prefectures.length > 1 ? (index - center) * Math.min(4.2, 21 / (prefectures.length - 1)) : 0;
  const lightnessShift = prefectures.length > 1 ? ((index % 3) - 1) * 3 : 0;
  return `hsl(${region.hue + hueShift} ${region.saturation}% ${region.lightness + lightnessShift}%)`;
}

function dailyMaxRaceOutlineColor(station) {
  const region = dailyMaxRaceRegion(station);
  if (region.id !== "okinawa_amami") return "transparent";
  return dailyMaxRacePrefectureKey(station, region) === "鹿児島県（奄美）" ? "#991b1b" : "#ef4444";
}

function dailyMaxRaceLabelTextColor(station) {
  const regionId = dailyMaxRaceRegion(station).id;
  return ["hokkaido", "tohoku", "chugoku", "shikoku", "kyushu"].includes(regionId) ? "#fff" : "#071018";
}

function renderDailyMaxRaceRegionLegend() {
  if (!els.dailyMaxRaceRegionLegend) return;
  els.dailyMaxRaceRegionLegend.innerHTML = DAILY_MAX_RACE_REGIONS.map((region) => (
    `<span><i style="--region-color:hsl(${region.hue} ${region.saturation}% ${region.lightness}%);--region-outline:${region.outline || "transparent"}"></i>${region.label}</span>`
  )).join("");
}

function renderFullRankingRegionLegend() {
  if (!els.fullRankingRegionLegend) return;
  els.fullRankingRegionLegend.innerHTML = DAILY_MAX_RACE_REGIONS.map((region) => (
    `<span><i style="--region-color:hsl(${region.hue} ${region.saturation}% ${region.lightness}%);--region-outline:${region.outline || "transparent"}"></i>${region.label}</span>`
  )).join("");
}

function validateDailyMaxRacePayload(payload, stations) {
  if (!payload || !Array.isArray(payload.frames) || !payload.frames.length) throw new Error("表示できる時刻データがありません。");
  const framesValid = payload.frames.every((frame) => Array.isArray(frame.rows) && frame.rows.length && frame.rows.every((row) => (
    Array.isArray(row) && row.length >= 2 && stations[String(row[0])] && Number.isFinite(Number(row[1]))
  )));
  if (!framesValid) throw new Error("ランキングデータの一部が不正です。");
  return payload;
}

function normalizeDailyMaxRaceArchive(payload) {
  const schema = Number(payload?.schema_version);
  if (![1, 2, 3, 4, 5].includes(schema)) throw new Error("アニメーションデータの形式が不正です。");
  if (!payload.stations || typeof payload.stations !== "object") throw new Error("地点情報がありません。");
  if (schema < 3) {
    validateDailyMaxRacePayload(payload, payload.stations);
    return {
      schema_version: schema,
      generated_at: payload.generated_at,
      latest_time: payload.latest_time,
      dates: [payload.date],
      elements: ["max"],
      frame_interval_minutes: payload.frame_interval_minutes,
      top_n: payload.top_n,
      station_population: payload.station_population,
      stations: payload.stations,
      days: [{ date: payload.date, max: payload }],
    };
  }
  if (!Array.isArray(payload.days) || !payload.days.length || !Array.isArray(payload.dates)) {
    throw new Error("日付別のアニメーションデータがありません。");
  }
  payload.days.forEach((day) => {
    ["max", "min"].forEach((element) => validateDailyMaxRacePayload(day[element], payload.stations));
  });
  if (schema >= 4) {
    payload.days.forEach((day) => {
      ["max", "min"].forEach((element) => {
        const rows = day[element]?.final_rankings;
        if (!Array.isArray(rows) || rows.length < 1 || rows.some((row) => (
          !Array.isArray(row)
          || row.length < 4
          || !payload.stations[String(row[0])]
          || !Number.isFinite(Number(row[1]))
          || !String(row[2] || "")
        ))) {
          throw new Error("全国ランキングデータの一部が不正です。");
        }
      });
    });
  }
  if (schema >= 5) {
    payload.days.forEach((day) => {
      ["max", "min"].forEach((element) => {
        if (day[element].final_rankings.some((row) => row.length < 11)) {
          throw new Error("全国ランキングの詳細指標が不足しています。");
        }
      });
    });
  }
  return payload;
}

function normalizeDailyMaxRaceDeliveryIndex(payload) {
  if (Number(payload?.schema_version) !== 1) throw new Error("ランキング索引の形式が不正です。");
  if (!Array.isArray(payload.dates) || !payload.dates.length || !Array.isArray(payload.elements)) {
    throw new Error("ランキング索引に日付情報がありません。");
  }
  if (!payload.files || typeof payload.files !== "object") {
    throw new Error("ランキング索引に分割ファイル情報がありません。");
  }
  const stationFile = String(payload.stations?.json || "");
  if (!stationFile) throw new Error("ランキング地点情報の参照先がありません。");
  payload.dates.forEach((date) => {
    payload.elements.forEach((element) => {
      if (!String(payload.files?.[date]?.[element]?.json || "")) {
        throw new Error(`ランキング分割ファイルが不足しています（${date} ${element}）。`);
      }
    });
  });
  return payload;
}

function normalizeDailyMaxRaceDeliveryStations(payload, index) {
  if (Number(payload?.schema_version) !== 1 || !payload.stations || typeof payload.stations !== "object") {
    throw new Error("ランキング地点情報の形式が不正です。");
  }
  const count = Object.keys(payload.stations).length;
  if (count < 800 || count !== Number(payload.station_count || index.station_population)) {
    throw new Error("ランキング地点情報が不足しています。");
  }
  return payload.stations;
}

function dailyMaxRaceDeliveryArchive(index, stations) {
  return {
    schema_version: 5,
    generated_at: index.generated_at,
    latest_time: index.latest_time,
    date_range: {
      start: String(index.dates[0] || ""),
      end: String(index.dates.at(-1) || ""),
    },
    dates: index.dates.map(String),
    elements: index.elements.map(String),
    frame_interval_minutes: Number(index.frame_interval_minutes),
    top_n: Number(index.top_n),
    station_population: Number(index.station_population),
    stations,
    days: index.dates.map((date) => ({ date: String(date), max: null, min: null })),
  };
}

function dailyMaxRaceDeliveryUrl(file) {
  return file.includes("/") ? file : `${DATA_ROOT}/${file}`;
}

async function fetchDailyMaxRaceDeliveryJson(file, force = false) {
  const response = await fetch(dailyMaxRaceDeliveryUrl(file), {
    cache: force ? "reload" : "force-cache",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function dailyMaxRaceDeliveryCandidateFiles({ allowHistory = true } = {}) {
  const currentFile = String(state.dailyMaxRaceMeta?.index_json || "");
  const history = Array.isArray(state.dailyMaxRaceMeta?.index_history)
    ? state.dailyMaxRaceMeta.index_history.map(String)
    : [];
  return [...new Set([currentFile, ...(allowHistory ? history : [])].filter(Boolean))];
}

async function fetchDailyMaxRaceDeliveryCandidate(file, force = false, { requireCurrent = false } = {}) {
  const index = normalizeDailyMaxRaceDeliveryIndex(
    await fetchDailyMaxRaceDeliveryJson(file, force),
  );
  const stations = normalizeDailyMaxRaceDeliveryStations(
    await fetchDailyMaxRaceDeliveryJson(String(index.stations.json), force),
    index,
  );
  const expectedLatest = String(state.dailyMaxRaceMeta?.latest_time || "");
  const stale = Boolean(expectedLatest && String(index.latest_time || "") !== expectedLatest);
  if (requireCurrent && stale) throw new Error("最新ランキング索引の反映待ちです。");
  return { file, index, stations, stale };
}

function activateDailyMaxRaceDeliveryCandidate(candidate) {
  if (state.dailyMaxRaceIndexSource !== candidate.file) state.dailyMaxRaceSliceCache.clear();
  state.dailyMaxRaceIndex = candidate.index;
  state.dailyMaxRaceIndexSource = candidate.file;
  state.dailyMaxRaceIndexStale = candidate.stale;
  state.dailyMaxRaceArchive = dailyMaxRaceDeliveryArchive(candidate.index, candidate.stations);
  if (candidate.stale) {
    scheduleDailyMaxRaceDeliveryRetry();
  } else {
    window.clearTimeout(state.dailyMaxRaceDeliveryRetryTimer);
    state.dailyMaxRaceDeliveryRetryTimer = null;
    state.dailyMaxRaceDeliveryRetryCount = 0;
  }
}

function scheduleDailyMaxRaceDeliveryRetry() {
  if (!state.dailyMaxRaceIndexStale || state.dailyMaxRaceDeliveryRetryTimer) return;
  if (state.dailyMaxRaceDeliveryRetryCount >= 4) return;
  const delay = Math.min(12_000, 2_000 * (2 ** state.dailyMaxRaceDeliveryRetryCount));
  state.dailyMaxRaceDeliveryRetryTimer = window.setTimeout(async () => {
    state.dailyMaxRaceDeliveryRetryTimer = null;
    const raceDate = state.dailyMaxRaceDate;
    const raceElement = state.dailyMaxRaceElement;
    const rankingDate = state.fullRankingDate;
    const rankingElement = state.fullRankingElement;
    try {
      await loadDailyMaxRaceDeliveryIndex(true, { allowHistory: false });
      if (!els.dailyMaxRaceBackdrop?.hidden) {
        await loadDailyMaxRaceSlice(raceDate, raceElement, true, { allowHistory: false });
        state.dailyMaxRaceDate = raceDate;
        state.dailyMaxRaceElement = raceElement;
        activateDailyMaxRaceSelection({ resetFrame: false });
        renderDailyMaxRaceFrame(true);
      }
      if (!els.fullRankingBackdrop?.hidden && state.fullRankingSource === "observed") {
        await loadDailyMaxRaceSlice(rankingDate, rankingElement, true, { allowHistory: false });
        state.fullRankingDate = rankingDate;
        state.fullRankingElement = rankingElement;
        renderFullRankingRows();
      }
      state.dailyMaxRaceDeliveryRetryCount = 0;
    } catch {
      state.dailyMaxRaceDeliveryRetryCount += 1;
      scheduleDailyMaxRaceDeliveryRetry();
    }
  }, delay);
}

async function loadDailyMaxRaceDeliveryIndex(force = false, { allowHistory = true } = {}) {
  if (!force && state.dailyMaxRaceIndex && state.dailyMaxRaceArchive) {
    return state.dailyMaxRaceIndex;
  }
  const candidates = dailyMaxRaceDeliveryCandidateFiles({ allowHistory });
  if (!candidates.length) return null;
  let lastError = null;
  for (const file of candidates) {
    try {
      const candidate = await fetchDailyMaxRaceDeliveryCandidate(file, force, {
        requireCurrent: !allowHistory,
      });
      activateDailyMaxRaceDeliveryCandidate(candidate);
      return candidate.index;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("ランキング索引を取得できませんでした。");
}

function normalizeDailyMaxRaceDeliverySlice(payload, date, element, stations) {
  if (
    Number(payload?.schema_version) !== 1
    || String(payload.date || "") !== String(date)
    || String(payload.element || "") !== String(element)
    || !payload.race
  ) {
    throw new Error("ランキング分割データの形式が不正です。");
  }
  const race = validateDailyMaxRacePayload(payload.race, stations);
  const finalRankings = race.final_rankings;
  if (
    !Array.isArray(finalRankings)
    || finalRankings.length < 800
    || finalRankings.some((row) => (
      !Array.isArray(row)
      || row.length < 11
      || !stations[String(row[0])]
      || !Number.isFinite(Number(row[1]))
      || !String(row[2] || "")
    ))
  ) {
    throw new Error("全国ランキングの詳細指標が不足しています。");
  }
  return race;
}

async function fetchDailyMaxRaceSliceForCandidate(candidate, date, element, force = false) {
  const index = candidate.index;
  const selectedDate = index.dates.map(String).includes(String(date))
    ? String(date)
    : String(index.dates.at(-1) || "");
  const selectedElement = index.elements.map(String).includes(String(element))
    ? String(element)
    : String(index.elements[0] || "max");
  const metadata = index.files?.[selectedDate]?.[selectedElement];
  const file = String(metadata?.json || "");
  if (!file) throw new Error("選択したランキングデータがありません。");
  const cacheKey = `${candidate.file}|${selectedDate}|${selectedElement}`;
  let race = !force ? state.dailyMaxRaceSliceCache.get(cacheKey) : null;
  if (!race) {
    race = normalizeDailyMaxRaceDeliverySlice(
      await fetchDailyMaxRaceDeliveryJson(file, force),
      selectedDate,
      selectedElement,
      candidate.stations,
    );
  }
  return { selectedDate, selectedElement, cacheKey, race };
}

function attachDailyMaxRaceSlice(candidate, selection) {
  activateDailyMaxRaceDeliveryCandidate(candidate);
  state.dailyMaxRaceSliceCache.set(selection.cacheKey, selection.race);
  const day = state.dailyMaxRaceArchive.days.find((item) => item.date === selection.selectedDate);
  if (day) day[selection.selectedElement] = selection.race;
  return selection.race;
}

async function loadDailyMaxRaceSlice(date, element, force = false, { allowHistory = true } = {}) {
  const index = await loadDailyMaxRaceDeliveryIndex(false);
  if (!index) return null;
  const activeCandidate = {
    file: state.dailyMaxRaceIndexSource,
    index,
    stations: state.dailyMaxRaceArchive.stations,
    stale: state.dailyMaxRaceIndexStale,
  };
  let lastError = null;
  try {
    const selection = await fetchDailyMaxRaceSliceForCandidate(activeCandidate, date, element, force);
    return attachDailyMaxRaceSlice(activeCandidate, selection);
  } catch (error) {
    lastError = error;
  }
  if (allowHistory) {
    const candidates = dailyMaxRaceDeliveryCandidateFiles({ allowHistory: true })
      .filter((file) => file !== activeCandidate.file);
    for (const file of candidates) {
      try {
        const candidate = await fetchDailyMaxRaceDeliveryCandidate(file, force);
        const selection = await fetchDailyMaxRaceSliceForCandidate(candidate, date, element, force);
        return attachDailyMaxRaceSlice(candidate, selection);
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError || new Error("ランキング分割データを取得できませんでした。");
}

async function loadDailyMaxRaceLegacyArchive(force = true) {
  const file = String(state.dailyMaxRaceMeta?.json || "observed_daily_max_race.json");
  const url = file.includes("/") ? file : `${DATA_ROOT}/${file}`;
  const cacheSuffix = force ? `${url.includes("?") ? "&" : "?"}_=${Date.now()}` : "";
  const response = await fetch(`${url}${cacheSuffix}`, {
    cache: force ? "no-store" : "force-cache",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const archive = normalizeDailyMaxRaceArchive(await response.json());
  if (Number(archive.schema_version) < 5) {
    throw new Error("全国ランキング詳細データの更新待ちです。");
  }
  state.dailyMaxRaceIndex = null;
  state.dailyMaxRaceIndexSource = "";
  state.dailyMaxRaceIndexStale = Boolean(state.dailyMaxRaceMeta?.index_json);
  state.dailyMaxRaceSliceCache.clear();
  state.dailyMaxRaceArchive = archive;
  if (state.dailyMaxRaceIndexStale) {
    state.dailyMaxRaceDeliveryRetryCount = 0;
    scheduleDailyMaxRaceDeliveryRetry();
  }
  return archive;
}

function fullRankingDateTimeLabel(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return String(value || "--");
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`;
}

function normalizeFullRankingSearch(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, "");
}

function fullRankingRecordUpdateKeys({ municipality, station, stationName, value }) {
  const municipalityKey = normalizeFullRankingSearch(municipality);
  const stationKey = normalizeFullRankingSearch(station || stationName).replace(/[＊*]/g, "");
  const numericValue = Number(value);
  const valueKey = Number.isFinite(numericValue) ? numericValue.toFixed(1) : "";
  return {
    exact: `${municipalityKey}|${stationKey}|${valueKey}`,
    loose: `${stationKey}|${valueKey}`,
  };
}

function fullRankingRecordUpdateIndex(dateValue, element) {
  const day = (state.temperatureExtremes?.days || []).find((item) => String(item.date) === String(dateValue));
  const prefix = element === "min" ? "min_low" : "max_high";
  const makeIndex = (rows) => {
    const exact = new Map();
    const loose = new Map();
    (rows || []).forEach((row) => {
      if (!row || row.matched === false) return;
      const keys = fullRankingRecordUpdateKeys(row);
      exact.set(keys.exact, row);
      loose.set(keys.loose, row);
    });
    return { exact, loose };
  };
  return {
    allTime: makeIndex(day?.updates?.[`${prefix}_all_time`]),
    monthly: makeIndex(day?.updates?.[`${prefix}_monthly`]),
  };
}

function fullRankingRecordUpdateFor(index, row) {
  const keys = fullRankingRecordUpdateKeys({
    municipality: row.municipality,
    stationName: row.stationName,
    value: row.value,
  });
  return index.exact.get(keys.exact) || index.loose.get(keys.loose) || null;
}

function forecastFullRankingSlots() {
  const slots = state.forecastLayers?.daily?.slots || state.forecastSlots || [];
  return slots.filter((slot) => (
    ["available", "stale"].includes(String(slot?.status || ""))
    && ["max", "min"].includes(String(slot?.element || ""))
    && slot?.target_date
    && slot?.id
  ));
}

function forecastFullRankingSlot(requestedDate = state.fullRankingDate, requestedElement = state.fullRankingElement) {
  const slots = forecastFullRankingSlots();
  if (!slots.length) return null;
  const dates = [...new Set(slots.map((slot) => String(slot.target_date)))].sort();
  const date = dates.includes(String(requestedDate)) ? String(requestedDate) : dates.at(-1);
  return slots.find((slot) => (
    String(slot.target_date) === date && String(slot.element) === String(requestedElement)
  )) || slots.find((slot) => String(slot.target_date) === date) || slots.at(-1);
}

function forecastFullRankingCacheKey(slot) {
  return `${slot?.id || ""}|${periodSuffix(state.period)}`;
}

function forecastFullRankingSelection() {
  const slots = forecastFullRankingSlots();
  if (!slots.length) return null;
  const slot = forecastFullRankingSlot();
  if (!slot) return null;
  state.fullRankingDate = String(slot.target_date);
  state.fullRankingElement = String(slot.element);
  const dates = [...new Set(slots.map((item) => String(item.target_date)))].sort();
  const day = { date: state.fullRankingDate };
  slots.filter((item) => String(item.target_date) === state.fullRankingDate).forEach((item) => {
    day[item.element] = state.forecastFullRankingCache.get(forecastFullRankingCacheKey(item)) || null;
  });
  const archive = {
    source: "forecast",
    generated_at: state.forecastManifestGeneratedAt,
    dates,
    elements: [...new Set(slots.map((item) => String(item.element)))],
    days: [day],
    stations: state.dailyMaxRaceArchive?.stations || {},
  };
  return { archive, day, race: day[state.fullRankingElement], element: state.fullRankingElement, slot };
}

function fullRankingSelection() {
  if (state.fullRankingSource === "forecast") return forecastFullRankingSelection();
  const archive = state.dailyMaxRaceArchive;
  if (!archive) return null;
  const dates = (archive.dates || []).map(String);
  if (!dates.includes(state.fullRankingDate)) state.fullRankingDate = dates.at(-1) || "";
  const day = archive.days.find((item) => String(item.date) === state.fullRankingDate) || archive.days.at(-1);
  let element = state.fullRankingElement;
  if (!day?.[element]) element = day?.max ? "max" : "min";
  state.fullRankingElement = element;
  return { archive, day, race: day?.[element], element };
}

function fullRankingRowsForSelection(selection) {
  if (!selection?.race || !selection.archive?.stations) return [];
  let previousValue = null;
  let competitionRank = 0;
  const prefectureRanks = new Map();
  const isForecast = state.fullRankingSource === "forecast";
  const recordUpdates = isForecast ? null : fullRankingRecordUpdateIndex(selection.day?.date, selection.element);
  const rows = (selection.race.final_rankings || []).map((row, index) => {
    const stationKey = String(row[0]);
    const value = Number(row[1]);
    const station = selection.archive.stations[stationKey] || {};
    if (previousValue === null || Math.abs(value - previousValue) >= 0.05) competitionRank = index + 1;
    previousValue = value;
    const municipality = String(row[3] || station.municipality || "");
    const prefecture = String(station.prefecture || "");
    const stationName = String(station.name || stationKey);
    const region = dailyMaxRaceRegion(station);
    const prefectureGroup = region.id === "hokkaido"
      ? "北海道"
      : dailyMaxRacePrefectureKey(station, region);
    const prefectureState = prefectureRanks.get(prefectureGroup) || {
      count: 0,
      rank: 0,
      previousValue: null,
    };
    prefectureState.count += 1;
    if (
      prefectureState.previousValue === null
      || Math.abs(value - prefectureState.previousValue) >= 0.05
    ) {
      prefectureState.rank = prefectureState.count;
    }
    prefectureState.previousValue = value;
    prefectureRanks.set(prefectureGroup, prefectureState);
    const result = {
      stationKey,
      value,
      observedAt: String(row[2] || ""),
      municipality,
      prefecture,
      stationName,
      rank: competitionRank,
      prefectureGroup,
      prefectureRank: prefectureState.rank,
      normalDifference: String(row[4] || "") === "" ? null : Number(row[4]),
      previousDifference: String(row[5] || "") === "" ? null : Number(row[5]),
      allTimeRecordValue: String(row[6] || "") === "" ? null : Number(row[6]),
      allTimeRecordDate: String(row[7] || ""),
      monthRecordValue: String(row[8] || "") === "" ? null : Number(row[8]),
      monthRecordDate: String(row[9] || ""),
      statisticsStartYear: String(row[10] || ""),
      forecastTargetDate: isForecast ? String(row[2] || selection.day?.date || "") : "",
      forecastBaseTime: isForecast ? String(row[13] || selection.slot?.basetime || "") : "",
      station,
      searchText: normalizeFullRankingSearch(`${prefecture} ${municipality} ${stationName}`),
    };
    result.allTimeRecordUpdate = isForecast
      ? (row[11] ? { forecastPossible: true } : null)
      : fullRankingRecordUpdateFor(recordUpdates.allTime, result);
    result.monthRecordUpdate = isForecast
      ? (row[12] ? { forecastPossible: true } : null)
      : fullRankingRecordUpdateFor(recordUpdates.monthly, result);
    return result;
  });
  const values = rows.map((row) => row.value).filter(Number.isFinite);
  let axisMin = Math.floor(Math.min(...values));
  let axisMax = Math.ceil(Math.max(...values));
  if (axisMax - axisMin < 4) {
    const padding = (4 - (axisMax - axisMin)) / 2;
    axisMin = Math.floor(axisMin - padding);
    axisMax = Math.ceil(axisMax + padding);
  }
  const span = Math.max(1, axisMax - axisMin);
  const firstValue = rows[0]?.value ?? 0;
  rows.forEach((row) => {
    row.barPercent = Math.max(2, Math.min(100, ((row.value - axisMin) / span) * 100));
    row.firstDifference = row.value - firstValue;
    row.axisMin = axisMin;
    row.axisMax = axisMax;
  });
  return rows;
}

function fullRankingRecordDateLabel(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "--";
  return `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}`;
}

function fullRankingRecordCell(value, dateValue, update, updateLabel, updateType) {
  if (!Number.isFinite(value) || !dateValue) return '<span class="full-ranking-missing">—</span>';
  const forecastPossible = Boolean(update?.forecastPossible);
  const tied = !forecastPossible && (String(update?.remarks || "").includes("タイ")
    || (
      update
      && Number.isFinite(Number(update.value))
      && Number.isFinite(Number(update.previous_record))
      && Math.abs(Number(update.value) - Number(update.previous_record)) < 0.05
    ));
  const title = forecastPossible
    ? "予測値が既存の記録値を超えるため、記録更新の可能性があります。実際の観測記録の更新を示すものではありません。"
    : "気象庁「毎日の観測史上1位の値 更新状況」に掲載（タイ記録を含む）";
  const badge = update
    ? `<span class="full-ranking-record-update is-${escapeHtml(updateType)}" title="${escapeHtml(title)}">${escapeHtml(updateLabel)}${tied ? "<b>タイ</b>" : ""}</span>`
    : "";
  return `${badge}<strong>${value.toFixed(1)}℃</strong><small>${escapeHtml(fullRankingRecordDateLabel(dateValue))}</small>`;
}

async function loadTemperatureStationRecords(force = false) {
  if (state.temperatureStationRecords && !force) return state.temperatureStationRecords;
  const url = `${TEMPERATURE_STATION_RECORDS_URL}?_=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (!payload?.stations || typeof payload.stations !== "object") {
    throw new Error("観測地点の記録データがありません。");
  }
  state.temperatureStationRecords = payload;
  return payload;
}

function temperatureRecordSpatialIndex(payload) {
  const bucketSize = 0.1;
  const buckets = new Map();
  Object.entries(payload?.stations || {}).forEach(([stationKey, record]) => {
    const longitude = Number(record?.longitude);
    const latitude = Number(record?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    const key = `${Math.floor(longitude / bucketSize)},${Math.floor(latitude / bucketSize)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ stationKey, record, longitude, latitude });
  });
  return { bucketSize, buckets };
}

function temperatureRecordForStation(index, station) {
  const longitude = Number(station?.longitude);
  const latitude = Number(station?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const baseX = Math.floor(longitude / index.bucketSize);
  const baseY = Math.floor(latitude / index.bucketSize);
  const candidates = [];
  for (let x = baseX - 1; x <= baseX + 1; x += 1) {
    for (let y = baseY - 1; y <= baseY + 1; y += 1) {
      candidates.push(...(index.buckets.get(`${x},${y}`) || []));
    }
  }
  const longitudeScale = Math.cos(latitude * Math.PI / 180);
  let nearest = null;
  let nearestDistance = Infinity;
  candidates.forEach((candidate) => {
    const dx = (candidate.longitude - longitude) * longitudeScale;
    const dy = candidate.latitude - latitude;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < nearestDistance) {
      nearest = candidate.record;
      nearestDistance = distance;
    }
  });
  return nearestDistance <= 0.03 ? nearest : null;
}

function forecastRecordBeforeDate(stationRecord, targetDate, element, month = null) {
  const scope = month == null
    ? stationRecord?.all_time
    : stationRecord?.months?.[String(month)];
  const elementRecord = scope?.[element];
  const target = String(targetDate || "");
  const candidates = (elementRecord?.records || []).map((entry) => ({
    value: Number(entry?.[0]),
    date: String(entry?.[1] || ""),
  })).filter((entry) => (
    Number.isFinite(entry.value)
    && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    && entry.date < target
    && (month == null || Number(entry.date.slice(5, 7)) === Number(month))
  ));
  if (!candidates.length) return { value: null, date: "", statisticsStart: "" };
  candidates.sort((a, b) => element === "min" ? a.value - b.value : b.value - a.value);
  return {
    ...candidates[0],
    statisticsStart: String(elementRecord?.statistics_start || "").slice(0, 4),
  };
}

function forecastRecordPossibility(value, recordValue, element) {
  if (!Number.isFinite(value) || !Number.isFinite(recordValue)) return false;
  return element === "min"
    ? value < recordValue - 0.05
    : value > recordValue + 0.05;
}

function compactForecastTimeLabel(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return "発表時刻不明";
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ));
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${Number(part("month"))}月${Number(part("day"))}日${part("hour")}:${part("minute")}発表`;
}

function forecastTargetDateLabel(value) {
  const parts = String(value || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return String(value || "対象日不明");
  return `${parts[1]}月${parts[2]}日の予測`;
}

function buildForecastFullRankingRace(slot, csvRows, stationArchive, recordPayload) {
  const element = String(slot.element) === "min" ? "min" : "max";
  const targetDate = String(slot.target_date || "");
  const targetMonth = Number(targetDate.slice(5, 7));
  const gridPoints = csvRows.map((row) => ({
    lon: Number(row.longitude),
    lat: Number(row.latitude),
    forecast: row.forecast_c === "" ? null : Number(row.forecast_c),
    anomaly: row.anomaly_c === "" ? null : Number(row.anomaly_c),
    previousDifference: row.previous_diff_c === "" ? null : Number(row.previous_diff_c),
  })).filter((point) => (
    Number.isFinite(point.lon) && Number.isFinite(point.lat) && Number.isFinite(point.forecast)
  ));
  const gridIndex = forecastGridIndex(gridPoints);
  const recordIndex = temperatureRecordSpatialIndex(recordPayload);
  const rows = Object.entries(stationArchive?.stations || {}).map(([stationKey, station]) => {
    const point = nearestForecastGridPoint(
      gridIndex,
      Number(station.longitude),
      Number(station.latitude),
    );
    if (!point || !Number.isFinite(point.forecast)) return null;
    const stationRecord = temperatureRecordForStation(recordIndex, station);
    const allTime = forecastRecordBeforeDate(stationRecord, targetDate, element);
    const monthly = forecastRecordBeforeDate(stationRecord, targetDate, element, targetMonth);
    return [
      stationKey,
      point.forecast,
      targetDate,
      String(station.municipality || ""),
      Number.isFinite(point.anomaly) ? point.anomaly : "",
      Number.isFinite(point.previousDifference) ? point.previousDifference : "",
      Number.isFinite(allTime.value) ? allTime.value : "",
      allTime.date,
      Number.isFinite(monthly.value) ? monthly.value : "",
      monthly.date,
      allTime.statisticsStart,
      forecastRecordPossibility(point.forecast, allTime.value, element),
      forecastRecordPossibility(point.forecast, monthly.value, element),
      String(slot.basetime || ""),
    ];
  }).filter(Boolean);
  rows.sort((a, b) => element === "min" ? Number(a[1]) - Number(b[1]) : Number(b[1]) - Number(a[1]));
  return {
    source: "forecast",
    slot_id: String(slot.id),
    target_date: targetDate,
    basetime: String(slot.basetime || ""),
    station_population: rows.length,
    final_rankings: rows,
  };
}

async function loadForecastFullRankingSelection(requestedDate, requestedElement, force = false) {
  state.fullRankingDate = String(requestedDate || state.fullRankingDate);
  state.fullRankingElement = requestedElement === "min" ? "min" : "max";
  const slot = forecastFullRankingSlot(state.fullRankingDate, state.fullRankingElement);
  if (!slot) throw new Error("表示できる日別予測がありません。");
  state.fullRankingDate = String(slot.target_date);
  state.fullRankingElement = String(slot.element);
  const cacheKey = forecastFullRankingCacheKey(slot);
  if (force) state.forecastFullRankingCache.delete(cacheKey);
  if (!state.forecastFullRankingCache.has(cacheKey)) {
    const [stationArchive, recordPayload] = await Promise.all([
      loadFullRankingArchive(),
      loadTemperatureStationRecords(force),
    ]);
    const file = `forecast_${slot.id}_anomaly_${periodSuffix(state.period)}.csv`;
    const response = await fetch(`${DATA_ROOT}/${file}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const csvRows = parseTable(await response.text());
    const race = buildForecastFullRankingRace(slot, csvRows, stationArchive, recordPayload);
    if (race.final_rankings.length < 800) {
      throw new Error(`予測地点の対応数が不足しています（${race.final_rankings.length}地点）。`);
    }
    state.forecastFullRankingCache.set(cacheKey, race);
  }
  return forecastFullRankingSelection();
}

function updateFullRankingSelectionControls(selection) {
  const dates = (selection?.archive?.dates || []).map(String);
  if (els.fullRankingDateSelect) {
    els.fullRankingDateSelect.innerHTML = dates.slice().reverse().map((date) => (
      `<option value="${escapeHtml(date)}">${escapeHtml(dailyMaxRaceDateLabel(date))}</option>`
    )).join("");
    els.fullRankingDateSelect.value = state.fullRankingDate;
  }
  const currentIndex = dates.indexOf(state.fullRankingDate);
  const tokyoToday = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayIndex = dates.includes(tokyoToday) ? dates.indexOf(tokyoToday) : dates.length - 1;
  els.fullRankingDateNavigation?.querySelectorAll("[data-full-ranking-date-action]").forEach((button) => {
    const action = button.dataset.fullRankingDateAction;
    button.disabled = !dates.length
      || (["first", "previous"].includes(action) && currentIndex <= 0)
      || (["next", "last"].includes(action) && currentIndex >= dates.length - 1)
      || (action === "today" && currentIndex === todayIndex);
  });
  const availableElements = state.fullRankingSource === "forecast"
    ? forecastFullRankingSlots()
      .filter((slot) => String(slot.target_date) === String(state.fullRankingDate))
      .map((slot) => String(slot.element))
    : (selection?.archive?.elements || ["max"]);
  els.fullRankingElementSwitch?.querySelectorAll("[data-full-ranking-element]").forEach((button) => {
    const active = button.dataset.fullRankingElement === state.fullRankingElement;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.disabled = !availableElements.includes(button.dataset.fullRankingElement);
  });
  els.fullRankingModal?.classList.toggle("is-minimum", state.fullRankingElement === "min");
  els.fullRankingModal?.classList.toggle("is-forecast", state.fullRankingSource === "forecast");
}

function fullRankingAvailableDates() {
  if (state.fullRankingSource === "forecast") {
    return [...new Set(forecastFullRankingSlots().map((slot) => String(slot.target_date)))].sort();
  }
  return (state.dailyMaxRaceArchive?.dates || []).map(String);
}

async function activateFullRankingSelection(date = state.fullRankingDate, element = state.fullRankingElement) {
  els.fullRankingLoading.hidden = false;
  els.fullRankingList.hidden = true;
  els.fullRankingError.hidden = true;
  try {
    if (state.fullRankingSource === "forecast") {
      await loadForecastFullRankingSelection(date, element);
    } else {
      await loadObservedFullRankingSelection(date, element);
    }
    renderFullRankingRows();
  } catch (error) {
    els.fullRankingLoading.hidden = true;
    els.fullRankingList.hidden = true;
    els.fullRankingError.hidden = false;
    els.fullRankingError.textContent = `表示できませんでした。${error?.message || ""}`;
  }
}

function selectFullRankingDate(date) {
  const dates = fullRankingAvailableDates();
  if (!dates.includes(String(date))) return;
  void activateFullRankingSelection(String(date), state.fullRankingElement);
}

function moveFullRankingDate(action) {
  const dates = fullRankingAvailableDates();
  if (!dates.length) return;
  const currentIndex = Math.max(0, dates.indexOf(state.fullRankingDate));
  const tokyoToday = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayIndex = dates.includes(tokyoToday) ? dates.indexOf(tokyoToday) : dates.length - 1;
  const targetIndex = {
    first: 0,
    previous: Math.max(0, currentIndex - 1),
    today: todayIndex,
    next: Math.min(dates.length - 1, currentIndex + 1),
    last: dates.length - 1,
  }[action];
  if (Number.isInteger(targetIndex)) selectFullRankingDate(dates[targetIndex]);
}

function clearFullRankingSearch({ keepFocus = false } = {}) {
  if (!els.fullRankingSearchInput) return;
  els.fullRankingSearchInput.value = "";
  els.fullRankingSearchInput.setAttribute("aria-expanded", "false");
  els.fullRankingSearchSuggestions.hidden = true;
  els.fullRankingSearchSuggestions.replaceChildren();
  els.fullRankingSearchStatus.textContent = "市町村名や観測地点名を入力すると、該当順位へ移動できます。";
  state.fullRankingLocatedStationKey = "";
  els.fullRankingRows?.querySelector(".is-located")?.classList.remove("is-located");
  if (keepFocus) els.fullRankingSearchInput.focus({ preventScroll: true });
}

function renderFullRankingRows() {
  const selection = fullRankingSelection();
  if (!selection?.race) throw new Error("選択した全国ランキングデータがありません。");
  state.fullRankingRows = fullRankingRowsForSelection(selection);
  if (!state.fullRankingRows.length) throw new Error("表示できる全国ランキングがありません。");
  updateFullRankingSelectionControls(selection);
  clearFullRankingSearch();
  const isForecast = state.fullRankingSource === "forecast";
  const isMinimum = selection.element === "min";
  const elementName = isMinimum ? "最低気温" : "最高気温";
  const selectedMonth = Number(String(state.fullRankingDate).slice(5, 7));
  const sourceName = isForecast ? "予測" : "実況";
  els.fullRankingSourceLabel.textContent = sourceName;
  els.fullRankingTitleText.textContent = `全国${elementName}${isForecast ? "予測" : ""}ランキング`;
  els.fullRankingTitle.setAttribute("aria-label", `${sourceName}・全国${elementName}ランキング`);
  els.fullRankingSummary.textContent = `${dailyMaxRaceDateLabel(state.fullRankingDate)}の1位から最下位まで。横棒で温度差を比較でき、横方向にスクロールすると記録・前年差まで確認できます。`;
  if (els.fullRankingForecastContext) {
    const forecastContext = isForecast
      ? `${forecastTargetDateLabel(state.fullRankingDate)}｜${compactForecastTimeLabel(selection.race.basetime || selection.slot?.basetime)}`
      : "";
    els.fullRankingForecastContext.textContent = forecastContext;
    els.fullRankingForecastContext.hidden = !forecastContext;
  }
  if (els.fullRankingReadingHeading) {
    els.fullRankingReadingHeading.textContent = isForecast ? "気温" : "気温・観測日時";
  }
  if (els.fullRankingFootnote) {
    els.fullRankingFootnote.textContent = isForecast
      ? "予測値は表示中の気象庁予測格子を各アメダス地点付近へ対応。記録超過は可能性表示で、実際の観測記録の更新を示すものではありません。"
      : "記録更新は気象庁「毎日の観測史上1位の値 更新状況」（タイ記録を含む）。資料不足・欠測は「—」とします。";
  }
  if (els.fullRankingMonthRecordHeading) {
    els.fullRankingMonthRecordHeading.textContent = `${selectedMonth}月の1位`;
  }
  els.fullRankingRows.innerHTML = state.fullRankingRows.map((row) => {
    const color = dailyMaxRaceColor(row.station);
    const outline = dailyMaxRaceOutlineColor(row.station);
    const textColor = dailyMaxRaceLabelTextColor(row.station);
    const place = [row.prefecture, row.municipality].filter(Boolean).join(" ");
    const stationLabel = isForecast ? `${row.stationName}付近` : row.stationName;
    const placeName = [place || row.prefecture || "地域情報なし", stationLabel].filter(Boolean).join("｜");
    const placeUpdateBadges = isForecast ? "" : [
      row.allTimeRecordUpdate ? '<em class="is-all-time">史上1位</em>' : "",
      row.monthRecordUpdate ? `<em class="is-monthly">${selectedMonth}月1位</em>` : "",
    ].join("");
    const placeUpdateMarkup = placeUpdateBadges
      ? `<span class="full-ranking-place-updates">${placeUpdateBadges}</span>`
      : "";
    const readingLabel = isForecast
      ? ""
      : fullRankingDateTimeLabel(row.observedAt);
    const readingTime = readingLabel
      ? `<time datetime="${escapeHtml(row.observedAt)}">${escapeHtml(readingLabel)}</time>`
      : "";
    return `
      <div class="full-ranking-row" role="row" data-station-key="${escapeHtml(row.stationKey)}" data-station-name="${escapeHtml(row.stationName)}" data-municipality="${escapeHtml(row.municipality)}" data-all-time-record-update="${row.allTimeRecordUpdate ? "true" : "false"}" data-month-record-update="${row.monthRecordUpdate ? "true" : "false"}" style="--ranking-region-color:${color};--ranking-region-outline:${outline};--ranking-region-text:${textColor}">
        <span class="full-ranking-rank" role="cell"><b>${row.rank.toLocaleString()}</b><small>位</small></span>
        <span class="full-ranking-place" role="cell"><span><i aria-hidden="true"></i><strong><span class="full-ranking-place-name">${escapeHtml(placeName)}</span>${placeUpdateMarkup}</strong></span></span>
        <span class="full-ranking-reading" role="cell"><strong>${row.value.toFixed(1)}℃</strong>${readingTime}</span>
        <span class="full-ranking-bar-cell" role="cell" aria-label="1位との差 ${formatSigned(row.firstDifference)}">
          <span class="full-ranking-bar-axis"><i style="width:${row.barPercent.toFixed(2)}%"></i></span>
          <small><span>${row.axisMin}℃</span><b>1位差 ${formatSigned(row.firstDifference)}</b><span>${row.axisMax}℃</span></small>
        </span>
        <span class="full-ranking-prefecture-rank" role="cell"><strong>${row.prefectureRank.toLocaleString()}位</strong><small>${escapeHtml(row.prefectureGroup)}内</small></span>
        <span class="full-ranking-difference" role="cell">${Number.isFinite(row.normalDifference) ? formatSigned(row.normalDifference) : "—"}</span>
        <span class="full-ranking-difference" role="cell">${Number.isFinite(row.previousDifference) ? formatSigned(row.previousDifference) : "—"}</span>
        <span class="full-ranking-record" role="cell">${fullRankingRecordCell(row.allTimeRecordValue, row.allTimeRecordDate, row.allTimeRecordUpdate, isForecast ? "更新可能性あり" : "観測史上1位更新", "all-time")}</span>
        <span class="full-ranking-record" role="cell">${fullRankingRecordCell(row.monthRecordValue, row.monthRecordDate, row.monthRecordUpdate, isForecast ? "更新可能性あり" : `${selectedMonth}月の1位更新`, "monthly")}</span>
        <span class="full-ranking-statistics-start" role="cell">${row.statisticsStartYear ? `${escapeHtml(row.statisticsStartYear)}年` : "—"}</span>
      </div>
    `;
  }).join("");
  const endLabel = isForecast
    ? `${forecastTargetDateLabel(state.fullRankingDate)} / ${compactForecastTimeLabel(selection.race.basetime || selection.slot?.basetime)}`
    : `${fullRankingDateTimeLabel(selection.race.window_end || selection.race.latest_time || "")}まで`;
  els.fullRankingMeta.textContent = `全国${state.fullRankingRows.length.toLocaleString()}地点${isForecast ? "付近" : ""} / ${elementName}${isForecast ? "予測" : ""} / ${endLabel} / 県内順位は同じ気温なら同順位`;
  els.fullRankingLoading.hidden = true;
  els.fullRankingError.hidden = true;
  els.fullRankingList.hidden = false;
}

function updateFullRankingSearchSuggestions() {
  const query = normalizeFullRankingSearch(els.fullRankingSearchInput?.value);
  if (!query) {
    clearFullRankingSearch();
    return;
  }
  const matches = state.fullRankingRows.filter((row) => row.searchText.includes(query)).slice(0, 12);
  els.fullRankingSearchSuggestions.innerHTML = matches.map((row) => (
    `<button type="button" role="option" data-station-key="${escapeHtml(row.stationKey)}"><span>${escapeHtml([row.prefecture, row.municipality, `${row.stationName}${state.fullRankingSource === "forecast" ? "付近" : ""}`].filter(Boolean).join("｜"))}</span><b>${row.rank.toLocaleString()}位・${row.value.toFixed(1)}℃</b></button>`
  )).join("");
  els.fullRankingSearchSuggestions.hidden = !matches.length;
  els.fullRankingSearchInput.setAttribute("aria-expanded", matches.length ? "true" : "false");
  els.fullRankingSearchStatus.textContent = matches.length
    ? `${matches.length.toLocaleString()}件を候補表示しています。地点を選んでください。`
    : "一致する市町村・観測地点がありません。";
}

function locateFullRankingStation(stationKey) {
  const data = state.fullRankingRows.find((row) => row.stationKey === String(stationKey));
  const rowElement = [...(els.fullRankingRows?.children || [])]
    .find((row) => row.dataset.stationKey === String(stationKey));
  if (!data || !rowElement) return;
  els.fullRankingRows.querySelector(".is-located")?.classList.remove("is-located");
  rowElement.classList.add("is-located");
  rowElement.tabIndex = -1;
  state.fullRankingLocatedStationKey = data.stationKey;
  els.fullRankingSearchSuggestions.hidden = true;
  els.fullRankingSearchInput.setAttribute("aria-expanded", "false");
  const listRect = els.fullRankingList.getBoundingClientRect();
  const rowRect = rowElement.getBoundingClientRect();
  els.fullRankingList.scrollTop += rowRect.top - listRect.top - (listRect.height - rowRect.height) / 2;
  rowElement.focus({ preventScroll: true });
  const stationLabel = `${data.stationName}${state.fullRankingSource === "forecast" ? "付近" : ""}`;
  els.fullRankingSearchStatus.textContent = `${[data.prefecture, data.municipality, stationLabel].filter(Boolean).join("｜")}は全国${data.rank.toLocaleString()}位、${data.prefectureGroup}内${data.prefectureRank.toLocaleString()}位、${data.value.toFixed(1)}℃${state.fullRankingSource === "forecast" ? "の予測" : ""}です。`;
}

async function loadFullRankingArchive(force = false) {
  if (
    !force
    && !state.dailyMaxRaceIndex
    && Number(state.dailyMaxRaceArchive?.schema_version) >= 5
  ) {
    return state.dailyMaxRaceArchive;
  }
  els.fullRankingLoading.hidden = false;
  els.fullRankingError.hidden = true;
  els.fullRankingList.hidden = true;
  let deliveryError = null;
  try {
    const deliveryIndex = await loadDailyMaxRaceDeliveryIndex(force);
    if (deliveryIndex) return state.dailyMaxRaceArchive;
  } catch (error) {
    deliveryError = error;
  }
  try {
    return await loadDailyMaxRaceLegacyArchive(true);
  } catch (error) {
    throw deliveryError || error;
  }
}

async function loadObservedFullRankingSelection(
  requestedDate = state.fullRankingDate,
  requestedElement = state.fullRankingElement,
  force = false,
) {
  const archive = await loadFullRankingArchive(force);
  const dates = (archive?.dates || []).map(String);
  state.fullRankingDate = dates.includes(String(requestedDate))
    ? String(requestedDate)
    : String(dates.at(-1) || "");
  state.fullRankingElement = requestedElement === "min" ? "min" : "max";
  if (state.dailyMaxRaceIndex) {
    try {
      await loadDailyMaxRaceSlice(state.fullRankingDate, state.fullRankingElement, force);
    } catch {
      const fallbackArchive = await loadDailyMaxRaceLegacyArchive(true);
      const fallbackDates = (fallbackArchive?.dates || []).map(String);
      state.fullRankingDate = fallbackDates.includes(String(requestedDate))
        ? String(requestedDate)
        : String(fallbackDates.at(-1) || "");
      state.fullRankingElement = requestedElement === "min" ? "min" : "max";
    }
  }
  return fullRankingSelection();
}

function fullRankingShareUrl() {
  const url = new URL(shareUrl());
  url.searchParams.set("source", state.fullRankingSource);
  url.searchParams.set("layer", "daily");
  url.searchParams.set("view", "fullRanking");
  url.searchParams.set("rankingSource", state.fullRankingSource);
  url.searchParams.set("rankingDate", state.fullRankingDate || "");
  url.searchParams.set("rankingElement", state.fullRankingElement === "min" ? "min" : "max");
  if (state.fullRankingLocatedStationKey) {
    url.searchParams.set("rankingStation", state.fullRankingLocatedStationKey);
  }
  return url.toString();
}

function setFullRankingActionStatus(button, status) {
  if (!button) return;
  const type = button === els.fullRankingRefreshButton
    ? "refresh"
    : button === els.fullRankingShareImageButton ? "image" : "link";
  const labels = {
    refresh: {
      idle: ["更新", "最新データへ更新"],
      loading: ["取得中", "最新データを取得中"],
      current: ["最新", "最新データです"],
      updated: ["更新済", "最新データへ更新しました"],
      error: ["失敗", "最新データを取得できませんでした"],
    },
    link: {
      idle: ["リンク取得", "この全国ランキングへ直接開くURLをコピー"],
      loading: ["コピー中", "共有URLをコピー中"],
      copied: ["コピー済", "共有URLをコピーしました"],
      error: ["失敗", "共有URLをコピーできませんでした"],
    },
    image: {
      idle: ["画像", "表示中の全国ランキングをそのままPNG画像としてコピー"],
      loading: ["生成中", "表示中のランキング画像を生成中"],
      copied: ["コピー済", "表示中のランキング画像をコピーしました"],
      saved: ["PNG保存", "画像コピー非対応のためPNGを保存しました"],
      error: ["失敗", "表示中のランキング画像を生成できませんでした"],
    },
  };
  const [text, label] = labels[type][status] || labels[type].idle;
  window.clearTimeout(state.fullRankingActionResetTimers.get(button));
  button.dataset.status = status;
  button.disabled = status === "loading";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.querySelector(".full-ranking-action-text").textContent = text;
  if (!["idle", "loading"].includes(status)) {
    state.fullRankingActionResetTimers.set(button, window.setTimeout(() => {
      setFullRankingActionStatus(button, "idle");
    }, 2400));
  }
}

async function refreshFullRankingData() {
  if (state.fullRankingRefreshing) return;
  const previousLatest = state.fullRankingSource === "forecast"
    ? state.forecastManifestGeneratedAt || ""
    : state.dailyMaxRaceMeta?.latest_time || state.dailyMaxRaceArchive?.latest_time || "";
  const previousDate = state.fullRankingDate;
  const previousElement = state.fullRankingElement;
  const previousStation = state.fullRankingLocatedStationKey;
  state.fullRankingRefreshing = true;
  setFullRankingActionStatus(els.fullRankingRefreshButton, "loading");
  try {
    const cacheKey = Date.now();
    if (state.fullRankingSource === "forecast") {
      const manifestResponse = await fetch(`${DATA_ROOT}/forecast_manifest.json?_=${cacheKey}`, { cache: "no-store" });
      if (!manifestResponse.ok) throw new Error(`${manifestResponse.status} ${manifestResponse.statusText}`);
      const manifest = await manifestResponse.json();
      applyForecastManifest(manifest);
      state.forecastFullRankingCache.clear();
      await loadForecastFullRankingSelection(previousDate, previousElement, true);
      renderFullRankingRows();
      if (previousStation && state.fullRankingRows.some((row) => row.stationKey === previousStation)) {
        locateFullRankingStation(previousStation);
      }
      await loadData();
      const latest = state.forecastManifestGeneratedAt || "";
      setFullRankingActionStatus(els.fullRankingRefreshButton, previousLatest && latest !== previousLatest ? "updated" : "current");
      return;
    }
    const manifestResponse = await fetch(`${DATA_ROOT}/observed_realtime_manifest.json?_=${cacheKey}`, { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error(`${manifestResponse.status} ${manifestResponse.statusText}`);
    const manifest = await manifestResponse.json();
    const realtime = manifest.realtime_layers && typeof manifest.realtime_layers === "object" ? manifest.realtime_layers : {};
    const raceMeta = realtime.temperature_races || realtime.daily_max_race || state.dailyMaxRaceMeta || {};
    if (raceMeta.index_json) {
      const extremesResponse = await fetch(`${TEMPERATURE_EXTREMES_URL}?_=${cacheKey}`, { cache: "no-store" });
      if (!extremesResponse.ok) throw new Error(`${extremesResponse.status} ${extremesResponse.statusText}`);
      const extremes = await extremesResponse.json();
      if (!(extremes.days || []).some((day) => String(day.date) === String(previousDate))) {
        throw new Error("記録更新データの反映待ちです。");
      }
      applyObservedManifest(manifest);
      state.temperatureExtremes = extremes;
      await loadObservedFullRankingSelection(previousDate, previousElement, true);
      renderFullRankingRows();
      if (previousStation && state.fullRankingRows.some((row) => row.stationKey === previousStation)) {
        locateFullRankingStation(previousStation);
      }
      updateRankingPanel();
      const latest = state.dailyMaxRaceIndex?.latest_time || "";
      setFullRankingActionStatus(
        els.fullRankingRefreshButton,
        previousLatest && latest !== previousLatest ? "updated" : "current",
      );
      return;
    }
    const file = String(raceMeta.json || "observed_daily_max_race.json");
    const url = file.includes("/") ? file : `${DATA_ROOT}/${file}`;
    const raceResponse = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${cacheKey}`, { cache: "no-store" });
    if (!raceResponse.ok) throw new Error(`${raceResponse.status} ${raceResponse.statusText}`);
    const archive = normalizeDailyMaxRaceArchive(await raceResponse.json());
    const extremesResponse = await fetch(`${TEMPERATURE_EXTREMES_URL}?_=${cacheKey}`, { cache: "no-store" });
    if (!extremesResponse.ok) throw new Error(`${extremesResponse.status} ${extremesResponse.statusText}`);
    const extremes = await extremesResponse.json();
    if (!(extremes.days || []).some((day) => String(day.date) === String(previousDate))) {
      throw new Error("記録更新データの反映待ちです。");
    }
    if (Number(archive.schema_version) < 5) throw new Error("全国ランキング詳細データの更新待ちです。");
    if (raceMeta.latest_time && archive.latest_time !== raceMeta.latest_time) {
      throw new Error("最新データの反映待ちです。");
    }
    applyObservedManifest(manifest);
    state.dailyMaxRaceArchive = archive;
    state.temperatureExtremes = extremes;
    state.fullRankingDate = (archive.dates || []).map(String).includes(previousDate)
      ? previousDate
      : String((archive.dates || []).at(-1) || "");
    state.fullRankingElement = previousElement;
    renderFullRankingRows();
    if (previousStation && state.fullRankingRows.some((row) => row.stationKey === previousStation)) {
      locateFullRankingStation(previousStation);
    }
    updateRankingPanel();
    const latest = state.dailyMaxRaceMeta?.latest_time || archive.latest_time || "";
    setFullRankingActionStatus(els.fullRankingRefreshButton, previousLatest && latest !== previousLatest ? "updated" : "current");
  } catch (error) {
    console.warn("Full temperature ranking refresh failed", error);
    setFullRankingActionStatus(els.fullRankingRefreshButton, "error");
  } finally {
    state.fullRankingRefreshing = false;
  }
}

async function copyFullRankingShareUrl() {
  const button = els.fullRankingShareUrlButton;
  if (!button || !state.fullRankingRows.length) return;
  setFullRankingActionStatus(button, "loading");
  const copied = await writeTextToClipboard(fullRankingShareUrl());
  setFullRankingActionStatus(button, copied ? "copied" : "error");
}

async function openFullRankingModal(requestedDate = "", requestedElement = "max", requestedSource = state.source) {
  if (!els.fullRankingBackdrop) return;
  state.fullRankingPreviousFocus = document.activeElement;
  state.fullRankingSource = requestedSource === "forecast" ? "forecast" : "observed";
  state.fullRankingDate = String(requestedDate || state.fullRankingDate);
  state.fullRankingElement = requestedElement === "min" ? "min" : "max";
  els.fullRankingBackdrop.hidden = false;
  document.body.classList.add("race-modal-open");
  els.fullRankingLoading.hidden = false;
  els.fullRankingList.hidden = true;
  els.fullRankingError.hidden = true;
  renderFullRankingRegionLegend();
  els.fullRankingModal.focus({ preventScroll: true });
  try {
    if (state.fullRankingSource === "forecast") {
      await loadForecastFullRankingSelection(state.fullRankingDate, state.fullRankingElement);
    } else {
      await loadObservedFullRankingSelection(state.fullRankingDate, state.fullRankingElement);
    }
    renderFullRankingRows();
    const requestedStation = state.fullRankingDeepLink?.stationKey;
    if (requestedStation && state.fullRankingRows.some((row) => row.stationKey === requestedStation)) {
      locateFullRankingStation(requestedStation);
    }
    state.fullRankingDeepLink = null;
  } catch (error) {
    els.fullRankingLoading.hidden = true;
    els.fullRankingList.hidden = true;
    els.fullRankingError.hidden = false;
    els.fullRankingError.textContent = `読み込めませんでした。${error?.message || "通信状態を確認してください。"}`;
  }
}

function closeFullRankingModal() {
  if (!els.fullRankingBackdrop || els.fullRankingBackdrop.hidden) return;
  els.fullRankingBackdrop.hidden = true;
  document.body.classList.remove("race-modal-open");
  clearFullRankingSearch();
  state.fullRankingPreviousFocus?.focus?.({ preventScroll: true });
}

function trapFullRankingFocus(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeFullRankingModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...els.fullRankingModal.querySelectorAll("button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function dailyMaxRaceArchiveDates() {
  return (state.dailyMaxRaceArchive?.dates || []).map(String).filter(Boolean);
}

function updateDailyMaxRaceSelectionControls() {
  const dates = dailyMaxRaceArchiveDates();
  if (els.dailyMaxRaceDateSelect) {
    els.dailyMaxRaceDateSelect.innerHTML = dates.slice().reverse().map((date) => (
      `<option value="${escapeHtml(date)}">${escapeHtml(dailyMaxRaceDateLabel(date))}</option>`
    )).join("");
    els.dailyMaxRaceDateSelect.value = state.dailyMaxRaceDate;
  }
  els.dailyMaxRaceElementSwitch?.querySelectorAll("[data-race-element]").forEach((button) => {
    const active = button.dataset.raceElement === state.dailyMaxRaceElement;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.disabled = !(state.dailyMaxRaceArchive?.elements || ["max"]).includes(button.dataset.raceElement);
  });
}

function activateDailyMaxRaceSelection({ resetFrame = true } = {}) {
  const archive = state.dailyMaxRaceArchive;
  if (!archive) return null;
  const dates = dailyMaxRaceArchiveDates();
  if (!dates.includes(state.dailyMaxRaceDate)) state.dailyMaxRaceDate = dates.at(-1) || "";
  const day = archive.days.find((item) => String(item.date) === state.dailyMaxRaceDate) || archive.days.at(-1);
  let element = state.dailyMaxRaceElement;
  if (!day?.[element]) element = day?.max ? "max" : "min";
  const race = day?.[element];
  if (!race) throw new Error("選択したランキングデータがありません。");
  state.dailyMaxRaceElement = element;
  els.dailyMaxRaceModal?.classList.toggle("is-minimum", element === "min");
  state.dailyMaxRace = {
    ...race,
    schema_version: archive.schema_version,
    generated_at: archive.generated_at,
    top_n: race.top_n || archive.top_n,
    frame_interval_minutes: race.frame_interval_minutes || archive.frame_interval_minutes,
    station_population: archive.station_population,
    stations: archive.stations,
  };
  if (resetFrame) state.dailyMaxRaceFrameIndex = 0;
  state.dailyMaxRaceRows.clear();
  els.dailyMaxRaceBars.replaceChildren();
  updateDailyMaxRaceSelectionControls();
  renderDailyMaxRaceTimeTicks();
  syncDailyMaxRaceVideoRange({ reset: resetFrame });
  return state.dailyMaxRace;
}

async function loadDailyMaxRace(force = false) {
  els.dailyMaxRaceLoading.hidden = false;
  els.dailyMaxRaceError.hidden = true;
  if (!state.dailyMaxRace) els.dailyMaxRaceChart.hidden = true;
  if (
    !force
    && !state.dailyMaxRaceIndex
    && Number(state.dailyMaxRaceArchive?.schema_version) >= 5
  ) {
    activateDailyMaxRaceSelection({ resetFrame: false });
    els.dailyMaxRaceLoading.hidden = true;
    els.dailyMaxRaceChart.hidden = false;
    return state.dailyMaxRace;
  }
  if (state.dailyMaxRaceMeta?.index_json) {
    try {
      const index = await loadDailyMaxRaceDeliveryIndex(force);
      const dates = index.dates.map(String);
      if (!dates.includes(state.dailyMaxRaceDate)) state.dailyMaxRaceDate = dates.at(-1) || "";
      if (!index.elements.map(String).includes(state.dailyMaxRaceElement)) {
        state.dailyMaxRaceElement = String(index.elements[0] || "max");
      }
      await loadDailyMaxRaceSlice(state.dailyMaxRaceDate, state.dailyMaxRaceElement, force);
      activateDailyMaxRaceSelection({ resetFrame: force || !state.dailyMaxRace });
      els.dailyMaxRaceLoading.hidden = true;
      els.dailyMaxRaceChart.hidden = false;
      return state.dailyMaxRace;
    } catch (error) {
      try {
        const archive = await loadDailyMaxRaceLegacyArchive(true);
        const dates = (archive.dates || []).map(String);
        if (!dates.includes(state.dailyMaxRaceDate)) state.dailyMaxRaceDate = dates.at(-1) || "";
        if (!(archive.elements || []).map(String).includes(state.dailyMaxRaceElement)) {
          state.dailyMaxRaceElement = String((archive.elements || [])[0] || "max");
        }
        activateDailyMaxRaceSelection({ resetFrame: force || !state.dailyMaxRace });
        els.dailyMaxRaceLoading.hidden = true;
        els.dailyMaxRaceChart.hidden = false;
        return state.dailyMaxRace;
      } catch (fallbackError) {
        els.dailyMaxRaceLoading.hidden = true;
        if (!state.dailyMaxRace) {
          els.dailyMaxRaceError.hidden = false;
          els.dailyMaxRaceError.textContent = `読み込めませんでした。${fallbackError?.message || error?.message || "通信状態を確認してください。"}`;
        } else {
          els.dailyMaxRaceChart.hidden = false;
        }
        throw fallbackError;
      }
    }
  }
  if (state.dailyMaxRaceArchive && !force) {
    activateDailyMaxRaceSelection({ resetFrame: false });
    els.dailyMaxRaceLoading.hidden = true;
    els.dailyMaxRaceChart.hidden = false;
    return state.dailyMaxRace;
  }
  const file = String(state.dailyMaxRaceMeta?.json || "observed_daily_max_race.json");
  const url = file.includes("/") ? file : `${DATA_ROOT}/${file}`;
  try {
    const response = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = normalizeDailyMaxRaceArchive(await response.json());
    if (state.dailyMaxRaceMeta?.latest_time && payload.latest_time !== state.dailyMaxRaceMeta.latest_time) {
      throw new Error("最新データの反映待ちです。少し待ってから開き直してください。");
    }
    state.dailyMaxRaceArchive = payload;
    activateDailyMaxRaceSelection();
    els.dailyMaxRaceLoading.hidden = true;
    els.dailyMaxRaceChart.hidden = false;
    return payload;
  } catch (error) {
    els.dailyMaxRaceLoading.hidden = true;
    if (!state.dailyMaxRace) {
      state.dailyMaxRaceArchive = null;
      els.dailyMaxRaceError.hidden = false;
      els.dailyMaxRaceError.textContent = `読み込めませんでした。${error?.message || "通信状態を確認してください。"}`;
    } else {
      els.dailyMaxRaceChart.hidden = false;
    }
    throw error;
  }
}

function setDailyMaxRaceRefreshStatus(status) {
  const button = els.dailyMaxRaceRefreshButton;
  if (!button) return;
  const labels = {
    idle: ["更新", "最新データを再取得"],
    loading: ["取得中", "最新データを取得中"],
    updated: ["更新済", "最新データへ更新しました"],
    current: ["最新", "最新データです"],
    error: ["失敗", "最新データを取得できませんでした"],
  };
  const [text, label] = labels[status] || labels.idle;
  window.clearTimeout(state.dailyMaxRaceRefreshResetTimer);
  button.dataset.status = status;
  button.disabled = status === "loading";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.querySelector(".race-refresh-text").textContent = text;
  if (!["idle", "loading"].includes(status)) {
    state.dailyMaxRaceRefreshResetTimer = window.setTimeout(() => {
      setDailyMaxRaceRefreshStatus("idle");
    }, 2200);
  }
}

async function refreshDailyMaxRaceData() {
  if (state.dailyMaxRaceRefreshing) return;
  const previousDate = state.dailyMaxRaceDate;
  const previousElement = state.dailyMaxRaceElement;
  const previousIndex = state.dailyMaxRaceFrameIndex;
  const previousFrames = state.dailyMaxRace?.frames || [];
  const previousFrameTime = previousFrames[previousIndex]?.time || "";
  const wasAtEnd = previousIndex >= Math.max(0, previousFrames.length - 1);
  const previousLatest = state.dailyMaxRaceMeta?.latest_time || state.dailyMaxRaceArchive?.latest_time || "";
  state.dailyMaxRaceRefreshing = true;
  setDailyMaxRacePlaying(false);
  setDailyMaxRaceRefreshStatus("loading");
  try {
    const cacheKey = Date.now();
    const manifestResponse = await fetch(`${DATA_ROOT}/observed_realtime_manifest.json?_=${cacheKey}`, { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error(`${manifestResponse.status} ${manifestResponse.statusText}`);
    const manifest = await manifestResponse.json();
    const realtime = manifest.realtime_layers && typeof manifest.realtime_layers === "object" ? manifest.realtime_layers : {};
    const raceMeta = realtime.temperature_races || realtime.daily_max_race || state.dailyMaxRaceMeta || {};
    if (raceMeta.index_json) {
      applyObservedManifest(manifest);
      await loadDailyMaxRaceDeliveryIndex(true);
      const dates = state.dailyMaxRaceIndex?.dates?.map(String) || [];
      state.dailyMaxRaceDate = dates.includes(previousDate) ? previousDate : (dates.at(-1) || "");
      state.dailyMaxRaceElement = previousElement;
      await loadDailyMaxRaceSlice(state.dailyMaxRaceDate, state.dailyMaxRaceElement, true);
      activateDailyMaxRaceSelection({ resetFrame: false });
      const frames = state.dailyMaxRace?.frames || [];
      const preservedIndex = frames.findIndex((frame) => frame.time === previousFrameTime);
      state.dailyMaxRaceFrameIndex = wasAtEnd
        ? Math.max(0, frames.length - 1)
        : preservedIndex >= 0 ? preservedIndex : Math.min(previousIndex, Math.max(0, frames.length - 1));
      renderDailyMaxRaceFrame(true);
      updateRankingPanel();
      const latest = state.dailyMaxRaceIndex?.latest_time || "";
      setDailyMaxRaceRefreshStatus(previousLatest && latest !== previousLatest ? "updated" : "current");
      return;
    }
    const file = String(raceMeta.json || "observed_daily_max_race.json");
    const url = file.includes("/") ? file : `${DATA_ROOT}/${file}`;
    const raceResponse = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${cacheKey}`, { cache: "no-store" });
    if (!raceResponse.ok) throw new Error(`${raceResponse.status} ${raceResponse.statusText}`);
    const archive = normalizeDailyMaxRaceArchive(await raceResponse.json());
    if (raceMeta.latest_time && archive.latest_time !== raceMeta.latest_time) {
      throw new Error("最新データの反映待ちです。");
    }

    applyObservedManifest(manifest);
    state.dailyMaxRaceArchive = archive;
    state.dailyMaxRaceDate = previousDate;
    state.dailyMaxRaceElement = previousElement;
    activateDailyMaxRaceSelection({ resetFrame: false });
    const frames = state.dailyMaxRace?.frames || [];
    const preservedIndex = frames.findIndex((frame) => frame.time === previousFrameTime);
    state.dailyMaxRaceFrameIndex = wasAtEnd
      ? Math.max(0, frames.length - 1)
      : preservedIndex >= 0 ? preservedIndex : Math.min(previousIndex, Math.max(0, frames.length - 1));
    renderDailyMaxRaceFrame(true);
    updateRankingPanel();
    const latest = state.dailyMaxRaceMeta?.latest_time || archive.latest_time || "";
    setDailyMaxRaceRefreshStatus(previousLatest && latest !== previousLatest ? "updated" : "current");
  } catch (error) {
    console.warn("Daily temperature race refresh failed", error);
    setDailyMaxRaceRefreshStatus("error");
  } finally {
    state.dailyMaxRaceRefreshing = false;
  }
}

function createDailyMaxRaceRow(stationKey) {
  const row = document.createElement("div");
  row.className = "race-row";
  row.dataset.stationKey = stationKey;
  row.setAttribute("role", "listitem");
  row.innerHTML = '<span class="race-row-rank"><b></b><small></small></span><span class="race-row-place"><strong></strong></span><div class="race-bar-track"><div class="race-bar-fill"></div><strong class="race-row-value"></strong></div>';
  els.dailyMaxRaceBars.appendChild(row);
  state.dailyMaxRaceRows.set(stationKey, row);
  return row;
}

function renderDailyMaxRaceTimeTicks() {
  if (!els.dailyMaxRaceTimeTicks) return;
  const frames = state.dailyMaxRace?.frames || [];
  const denominator = Math.max(1, frames.length - 1);
  els.dailyMaxRaceTimeTicks.replaceChildren(...frames.map((frame, index) => {
    const tick = document.createElement("span");
    const time = dailyMaxRaceTimeLabel(frame.time);
    const major = time.endsWith(":00");
    tick.className = `race-time-tick${major ? " major" : ""}`;
    tick.style.left = `${index / denominator * 100}%`;
    if (major) {
      const label = document.createElement("b");
      label.textContent = String(Number(time.slice(0, 2)));
      if (index === 0) label.style.transform = "translateX(0)";
      else if (index === frames.length - 1) label.style.transform = "translateX(-100%)";
      tick.appendChild(label);
    }
    return tick;
  }));
}

function dailyMaxRaceVideoOutputCount() {
  const payload = state.dailyMaxRace;
  const selected = Number(state.dailyMaxRaceVisibleCount) || 25;
  return Math.max(1, Math.min(25, selected, Number(payload?.top_n) || 100));
}

function dailyMaxRaceVideoFormat(value = state.dailyMaxRaceVideoFormat) {
  return DAILY_MAX_RACE_VIDEO_FORMATS[value] || DAILY_MAX_RACE_VIDEO_FORMATS.landscape;
}

function dailyMaxRaceVideoDurationLabel(milliseconds) {
  const totalSeconds = Math.max(1, Math.round(Number(milliseconds) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}分${String(seconds).padStart(2, "0")}秒` : `${seconds}秒`;
}

function dailyMaxRaceVideoSizeLabel(milliseconds) {
  const megabytes = Math.max(1, Math.ceil((milliseconds / 1000) * DAILY_MAX_RACE_VIDEO_BITRATE / 8 / 1_000_000));
  return `${megabytes}MB`;
}

function updateDailyMaxRaceVideoMeta(message = "") {
  if (!els.dailyMaxRaceVideoMeta) return;
  if (message) {
    els.dailyMaxRaceVideoMeta.textContent = message;
    return;
  }
  const frames = state.dailyMaxRace?.frames || [];
  if (!frames.length) {
    els.dailyMaxRaceVideoMeta.textContent = "ランキングデータを読み込んでいます";
    return;
  }
  const start = Math.max(0, Math.min(state.dailyMaxRaceVideoStartIndex, frames.length - 1));
  const end = Math.max(start, Math.min(state.dailyMaxRaceVideoEndIndex, frames.length - 1));
  const frameMs = DAILY_MAX_RACE_BASE_FRAME_MS / Math.max(0.5, state.dailyMaxRaceSpeed);
  const estimatedMs = (end - start + 2) * frameMs;
  const format = dailyMaxRaceVideoFormat();
  els.dailyMaxRaceVideoMeta.textContent = `${format.label} ${format.width}×${format.height} ・ ${dailyMaxRaceTimeLabel(frames[start].time)}〜${dailyMaxRaceTimeLabel(frames[end].time)} ・ ${state.dailyMaxRaceSpeed}倍 ・ TOP${dailyMaxRaceVideoOutputCount()} ・ 約${dailyMaxRaceVideoDurationLabel(estimatedMs)} ・ 容量上限目安${dailyMaxRaceVideoSizeLabel(estimatedMs)}`;
}

function syncDailyMaxRaceVideoRange({ reset = true } = {}) {
  const frames = state.dailyMaxRace?.frames || [];
  if (!els.dailyMaxRaceVideoStartSelect || !els.dailyMaxRaceVideoEndSelect) return;
  if (!frames.length) {
    els.dailyMaxRaceVideoStartSelect.replaceChildren();
    els.dailyMaxRaceVideoEndSelect.replaceChildren();
    updateDailyMaxRaceVideoMeta();
    return;
  }
  if (reset) {
    state.dailyMaxRaceVideoStartIndex = 0;
    state.dailyMaxRaceVideoEndIndex = frames.length - 1;
  } else {
    state.dailyMaxRaceVideoStartIndex = Math.max(0, Math.min(state.dailyMaxRaceVideoStartIndex, frames.length - 1));
    state.dailyMaxRaceVideoEndIndex = Math.max(state.dailyMaxRaceVideoStartIndex, Math.min(state.dailyMaxRaceVideoEndIndex, frames.length - 1));
  }
  const options = frames.map((frame, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = dailyMaxRaceTimeLabel(frame.time);
    return option;
  });
  els.dailyMaxRaceVideoStartSelect.replaceChildren(...options.map((option) => option.cloneNode(true)));
  els.dailyMaxRaceVideoEndSelect.replaceChildren(...options);
  els.dailyMaxRaceVideoStartSelect.value = String(state.dailyMaxRaceVideoStartIndex);
  els.dailyMaxRaceVideoEndSelect.value = String(state.dailyMaxRaceVideoEndIndex);
  updateDailyMaxRaceVideoMeta();
}

function setDailyMaxRaceVideoPanel(open) {
  if (!els.dailyMaxRaceVideoPanel || !els.dailyMaxRaceVideoButton) return;
  const visible = Boolean(open);
  els.dailyMaxRaceVideoPanel.hidden = !visible;
  els.dailyMaxRaceVideoButton.setAttribute("aria-expanded", visible ? "true" : "false");
  if (visible) {
    updateDailyMaxRaceVideoMeta();
    els.dailyMaxRaceVideoStartSelect?.focus({ preventScroll: true });
  }
}

function dailyMaxRaceTransitionMs() {
  const delay = DAILY_MAX_RACE_BASE_FRAME_MS / Math.max(0.5, state.dailyMaxRaceSpeed);
  return Math.max(220, Math.min(1800, Math.round(delay * DAILY_MAX_RACE_MOVE_RATIO)));
}

function dailyMaxRaceAxisDomain(rows) {
  const values = rows.map((row) => Number(row[1])).filter(Number.isFinite);
  if (!values.length) return { minimum: 0, maximum: 1, leader: 0, floor: 0 };
  const floor = Math.min(...values);
  const leader = Math.max(...values);
  if (state.dailyMaxRaceElement === "min") {
    const lowerAnchor = window.matchMedia("(max-width: 760px)").matches ? 0.1 : 0.08;
    const lowerPadding = Math.min(1, Math.max(0.1, (leader - floor) * lowerAnchor));
    return {
      minimum: Math.floor((floor - lowerPadding) * 10) / 10,
      maximum: Math.ceil((leader + 1) * 10) / 10,
      leader,
      floor,
    };
  }
  const minimum = Math.floor((floor - 1) * 10) / 10;
  const leaderAnchor = window.matchMedia("(max-width: 760px)").matches ? 0.9 : 0.92;
  const upperPadding = Math.min(1, Math.max(0.1, (leader - minimum) * ((1 / leaderAnchor) - 1)));
  const maximum = Math.ceil((leader + upperPadding) * 10) / 10;
  return { minimum, maximum, leader, floor };
}

function dailyMaxRaceAxisTicks(domain) {
  const span = Math.max(0.1, domain.maximum - domain.minimum);
  const pixelsPerDegree = (els.dailyMaxRaceAxis.clientWidth || window.innerWidth * 0.55) / span;
  const labelInterval = pixelsPerDegree >= 58 ? 1 : 2;
  const first = Math.ceil(domain.minimum - 0.0001);
  const last = Math.floor(domain.maximum + 0.0001);
  const ticks = [];
  for (let value = first; value <= last; value += 1) {
    ticks.push({ value, showLabel: (value - first) % labelInterval === 0 });
  }
  return ticks;
}

function animateDailyMaxRaceAxisValue(element, value, transitionMs, immediate) {
  if (element._raceAxisValueAnimation) window.cancelAnimationFrame(element._raceAxisValueAnimation);
  const current = Number.parseFloat(element.textContent);
  const format = (number) => `${Math.round(number)}℃`;
  if (immediate || !Number.isFinite(current) || transitionMs <= 0) {
    element.textContent = format(value);
    return;
  }
  const startedAt = performance.now();
  const animate = (now) => {
    const progress = Math.min(1, (now - startedAt) / transitionMs);
    const eased = 1 - ((1 - progress) ** 3);
    element.textContent = format(current + (value - current) * eased);
    if (progress < 1) element._raceAxisValueAnimation = window.requestAnimationFrame(animate);
    else element._raceAxisValueAnimation = null;
  };
  element._raceAxisValueAnimation = window.requestAnimationFrame(animate);
}

function renderDailyMaxRaceAxis(domain, transitionMs, immediate) {
  const span = Math.max(0.1, domain.maximum - domain.minimum);
  const ticks = dailyMaxRaceAxisTicks(domain);
  while (els.dailyMaxRaceAxis.children.length < ticks.length) {
    const line = document.createElement("div");
    line.className = "race-axis-line";
    line.innerHTML = "<span></span>";
    els.dailyMaxRaceAxis.appendChild(line);
  }
  [...els.dailyMaxRaceAxis.children].forEach((line, index) => {
    if (index >= ticks.length) {
      line.hidden = true;
      return;
    }
    const { value, showLabel } = ticks[index];
    line.hidden = false;
    line.classList.toggle("edge-start", index === 0);
    line.classList.toggle("edge-end", index === ticks.length - 1);
    line.style.left = `${(value - domain.minimum) / span * 100}%`;
    const label = line.querySelector("span");
    if (showLabel) animateDailyMaxRaceAxisValue(label, value, transitionMs, immediate);
    else {
      if (label._raceAxisValueAnimation) window.cancelAnimationFrame(label._raceAxisValueAnimation);
      label._raceAxisValueAnimation = null;
      label.textContent = "";
    }
  });
  els.dailyMaxRaceAxis.dataset.range = `${domain.minimum.toFixed(1)}〜${domain.maximum.toFixed(1)}℃`;
}

function dailyMaxRaceValueLabel(place, value) {
  return `${place}（${value.toFixed(1)}℃）`;
}

function animateDailyMaxRaceValue(element, value, transitionMs, immediate, place) {
  if (element._raceValueAnimation) window.cancelAnimationFrame(element._raceValueAnimation);
  const current = Number(element.dataset.raceValue);
  if (immediate || !Number.isFinite(current) || transitionMs <= 0) {
    element.dataset.raceValue = String(value);
    element.textContent = dailyMaxRaceValueLabel(place, value);
    return;
  }
  const startedAt = performance.now();
  const startValue = current;
  const animate = (now) => {
    const progress = Math.min(1, (now - startedAt) / transitionMs);
    const eased = 1 - ((1 - progress) ** 3);
    const animatedValue = startValue + (value - startValue) * eased;
    element.dataset.raceValue = String(animatedValue);
    element.textContent = dailyMaxRaceValueLabel(place, animatedValue);
    if (progress < 1) element._raceValueAnimation = window.requestAnimationFrame(animate);
    else element._raceValueAnimation = null;
  };
  element._raceValueAnimation = window.requestAnimationFrame(animate);
}

function renderDailyMaxRaceFrame(immediate = false) {
  const payload = state.dailyMaxRace;
  if (!payload?.frames?.length) return;
  const frameIndex = Math.max(0, Math.min(state.dailyMaxRaceFrameIndex, payload.frames.length - 1));
  state.dailyMaxRaceFrameIndex = frameIndex;
  const frame = payload.frames[frameIndex];
  const count = Math.max(10, Math.min(Number(state.dailyMaxRaceVisibleCount) || 20, Number(payload.top_n) || 100));
  const rows = frame.rows.slice(0, count);
  const domain = dailyMaxRaceAxisDomain(rows);
  const domainSpan = Math.max(0.1, domain.maximum - domain.minimum);
  const transitionMs = immediate ? 0 : dailyMaxRaceTransitionMs();
  els.dailyMaxRaceModal.style.setProperty("--race-transition-ms", `${transitionMs}ms`);
  const chartHeight = els.dailyMaxRaceChart.clientHeight || 640;
  const mobileRace = window.matchMedia("(max-width: 760px)").matches;
  const visibleRowsForFit = Math.min(count, mobileRace ? count : 25);
  const rowHeight = Math.max(mobileRace ? 17 : 20, Math.min(count <= 10 ? 42 : 30, Math.floor((chartHeight - (mobileRace ? 21 : 23)) / visibleRowsForFit)));
  els.dailyMaxRaceModal.style.setProperty("--race-row-height", `${rowHeight}px`);
  renderDailyMaxRaceAxis(domain, transitionMs, immediate);

  const desiredKeys = new Set(rows.map((row) => String(row[0])));
  for (const [stationKey, rowElement] of state.dailyMaxRaceRows) {
    if (desiredKeys.has(stationKey)) continue;
    rowElement.classList.add("leaving");
    rowElement.style.setProperty("--race-rank", String(count));
    window.setTimeout(() => {
      if (state.dailyMaxRaceRows.get(stationKey) !== rowElement || !rowElement.classList.contains("leaving")) return;
      rowElement.remove();
      state.dailyMaxRaceRows.delete(stationKey);
    }, Math.max(180, transitionMs + 50));
  }

  rows.forEach(([rawStationKey, rawValue], rankIndex) => {
    const stationKey = String(rawStationKey);
    const value = Number(rawValue);
    const station = payload.stations[stationKey] || {};
    const place = `${station.prefecture ? `${station.prefecture} ` : ""}${station.name || stationKey}`.trim();
    const region = dailyMaxRaceRegion(station);
    let rowElement = state.dailyMaxRaceRows.get(stationKey);
    if (!rowElement) {
      rowElement = createDailyMaxRaceRow(stationKey);
      rowElement.style.setProperty("--race-rank", String(count));
      rowElement.classList.add("leaving");
      rowElement.getBoundingClientRect();
    }
    const previousRank = Number(rowElement.dataset.raceRank);
    const moved = Number.isFinite(previousRank) && previousRank !== rankIndex;
    rowElement.classList.remove("leaving");
    rowElement.classList.toggle("top-three", rankIndex < 3);
    rowElement.classList.toggle("overtaking", moved);
    rowElement.classList.toggle("moving-up", moved && previousRank > rankIndex);
    rowElement.classList.toggle("moving-down", moved && previousRank < rankIndex);
    rowElement.dataset.raceRank = String(rankIndex);
    rowElement.dataset.region = region.id;
    const placeLabel = `${station.prefecture || region.label}｜${station.name || stationKey}`;
    rowElement.style.setProperty("--race-color", dailyMaxRaceColor(station));
    rowElement.style.setProperty("--race-outline-color", dailyMaxRaceOutlineColor(station));
    rowElement.style.setProperty("--race-label-text-color", dailyMaxRaceLabelTextColor(station));
    rowElement.style.setProperty("--race-rank", String(rankIndex));
    rowElement.querySelector(".race-row-rank b").textContent = String(rankIndex + 1);
    rowElement.querySelector(".race-row-rank small").textContent = moved
      ? `${previousRank > rankIndex ? "↑" : "↓"}${Math.abs(previousRank - rankIndex)}`
      : "";
    rowElement.querySelector(".race-row-place strong").textContent = placeLabel;
    animateDailyMaxRaceValue(rowElement.querySelector(".race-row-value"), value, transitionMs, immediate, placeLabel);
    rowElement.style.setProperty("--race-width", `${Math.max(1, Math.min(100, (value - domain.minimum) / domainSpan * 100))}%`);
    rowElement.title = `${rankIndex + 1}位 ${place} ${value.toFixed(1)}℃`;
    rowElement.setAttribute("aria-label", rowElement.title);
    rowElement._raceMotionToken = (rowElement._raceMotionToken || 0) + 1;
    const motionToken = rowElement._raceMotionToken;
    window.setTimeout(() => {
      if (state.dailyMaxRaceRows.get(stationKey) === rowElement && rowElement._raceMotionToken === motionToken) {
        rowElement.classList.remove("overtaking", "moving-up", "moving-down");
      }
    }, transitionMs + 40);
  });

  els.dailyMaxRaceBars.style.height = `${Math.max(count * rowHeight + 22, rowHeight * 4)}px`;
  els.dailyMaxRaceRange.max = String(payload.frames.length - 1);
  els.dailyMaxRaceRange.value = String(frameIndex);
  const frameTimeLabel = dailyMaxRaceTimeLabel(frame.time);
  els.dailyMaxRaceTime.textContent = frameTimeLabel;
  els.dailyMaxRaceTime.dateTime = frame.time;
  const [clockHour = "--", clockMinute = "--"] = frameTimeLabel.split(":");
  const clockHourNumber = Number(clockHour);
  const clockMinuteNumber = Number(clockMinute);
  els.dailyMaxRaceClockHour.textContent = clockHour;
  els.dailyMaxRaceClockMinute.textContent = clockMinute;
  els.dailyMaxRaceClockPeriod.textContent = Number.isFinite(clockHourNumber) && clockHourNumber < 12 ? "AM" : "PM";
  els.dailyMaxRaceClockTime.setAttribute("aria-label", frameTimeLabel);
  if (Number.isFinite(clockHourNumber) && Number.isFinite(clockMinuteNumber)) {
    els.dailyMaxRaceClockFace.style.setProperty("--clock-hour-angle", `${(clockHourNumber % 12) * 30 + clockMinuteNumber * 0.5}deg`);
    els.dailyMaxRaceClockFace.style.setProperty("--clock-minute-angle", `${clockMinuteNumber * 6}deg`);
  }
  const fullDateLabel = dailyMaxRaceDateLabel(payload.date);
  if (els.dailyMaxRaceDateSelect) els.dailyMaxRaceDateSelect.value = payload.date;
  els.dailyMaxRaceClockDate.textContent = fullDateLabel.replace(/^\d{4}年/, "");
  els.dailyMaxRaceClockRange.textContent = `${domain.minimum.toFixed(1)}〜${domain.maximum.toFixed(1)}℃`;
  const isMinimum = state.dailyMaxRaceElement === "min";
  const elementName = isMinimum ? "最低気温" : "最高気温";
  const startTime = dailyMaxRaceTimeLabel(payload.window_start || payload.frames[0]?.time);
  const endTime = dailyMaxRaceTimeLabel(payload.window_end || payload.latest_time || payload.frames.at(-1)?.time);
  if (els.dailyMaxRaceTitleText) els.dailyMaxRaceTitleText.textContent = `${elementName}ランキング`;
  els.dailyMaxRaceTitle.setAttribute("aria-label", `実況・${elementName}ランキング`);
  els.dailyMaxRaceBars.setAttribute("aria-label", `${elementName}ランキング`);
  const lastFrameIndex = Math.max(0, payload.frames.length - 1);
  const atStart = frameIndex <= 0;
  const atEnd = frameIndex >= lastFrameIndex;
  els.dailyMaxRaceRestartButton.disabled = atStart;
  els.dailyMaxRaceStepBackButton.disabled = atStart;
  els.dailyMaxRaceStepForwardButton.disabled = atEnd;
  els.dailyMaxRaceLatestButton.disabled = atEnd;
  els.dailyMaxRaceRestartButton.title = `開始時刻 ${startTime}へ`;
  els.dailyMaxRaceRestartButton.setAttribute("aria-label", `開始時刻 ${startTime}へ`);
  els.dailyMaxRaceLatestButton.title = `終了時刻 ${endTime}へ`;
  els.dailyMaxRaceLatestButton.setAttribute("aria-label", `終了時刻 ${endTime}へ`);
  if (els.dailyMaxRaceClockCaption) els.dailyMaxRaceClockCaption.textContent = `までの${isMinimum ? "最低" : "最高"}`;
  const hybrid = Number(payload.schema_version) >= 2;
  els.dailyMaxRaceSummary.textContent = hybrid
    ? `${startTime}から${endTime}まで、10分順位を気象庁公表の当日${elementName}で補正`
    : `${startTime}から${endTime}まで、10分ごとの全国順位を再生`;
  const officialCount = Number(payload.official_daily_extrema_count || payload.official_daily_maxima_count || 0);
  els.dailyMaxRaceMeta.textContent = hybrid
    ? `全国${Number(payload.eligible_station_count || payload.station_population).toLocaleString()}地点 / TOP${payload.top_n} / 10分順位＋公式${elementName}${officialCount.toLocaleString()}地点`
    : `全国${Number(payload.eligible_station_count || payload.station_population).toLocaleString()}地点 / TOP${payload.top_n} / ${payload.frame_interval_minutes}分間隔`;
  if (els.dailyMaxRaceFootnote) {
    els.dailyMaxRaceFootnote.textContent = `順位の動きはアメダス10分値。気象庁公表の当日${elementName}は観測時分以後の10分枠へ反映します。公表更新まで遅れあり・欠測補間なし。`;
  }
}

function updateDailyMaxRacePlayButton() {
  if (!els.dailyMaxRacePlayButton) return;
  els.dailyMaxRacePlayButton.innerHTML = state.dailyMaxRacePlaying
    ? '<span class="race-play-symbol" aria-hidden="true">Ⅱ</span><span class="race-play-text">一時停止</span>'
    : '<span class="race-play-symbol" aria-hidden="true">▶</span><span class="race-play-text">再生</span>';
  els.dailyMaxRacePlayButton.setAttribute("aria-pressed", state.dailyMaxRacePlaying ? "true" : "false");
  els.dailyMaxRacePlayButton.setAttribute("aria-label", state.dailyMaxRacePlaying ? "一時停止" : "再生");
}

function stepDailyMaxRaceFrame(delta) {
  const frameCount = state.dailyMaxRace?.frames?.length || 0;
  if (!frameCount) return;
  setDailyMaxRacePlaying(false);
  state.dailyMaxRaceFrameIndex = Math.max(0, Math.min(frameCount - 1, state.dailyMaxRaceFrameIndex + delta));
  renderDailyMaxRaceFrame(true);
}

function scheduleDailyMaxRaceFrame() {
  window.clearTimeout(state.dailyMaxRaceTimer);
  if (!state.dailyMaxRacePlaying) return;
  const frameCount = state.dailyMaxRace?.frames?.length || 0;
  if (!frameCount || state.dailyMaxRaceFrameIndex >= frameCount - 1) {
    setDailyMaxRacePlaying(false);
    return;
  }
  const delay = DAILY_MAX_RACE_BASE_FRAME_MS / Math.max(0.5, state.dailyMaxRaceSpeed);
  state.dailyMaxRaceTimer = window.setTimeout(() => {
    state.dailyMaxRaceFrameIndex += 1;
    renderDailyMaxRaceFrame();
    scheduleDailyMaxRaceFrame();
  }, delay);
}

function setDailyMaxRacePlaying(playing) {
  window.clearTimeout(state.dailyMaxRaceTimer);
  state.dailyMaxRaceTimer = null;
  if (playing && state.dailyMaxRace?.frames?.length && state.dailyMaxRaceFrameIndex >= state.dailyMaxRace.frames.length - 1) {
    state.dailyMaxRaceFrameIndex = 0;
    renderDailyMaxRaceFrame(true);
  }
  state.dailyMaxRacePlaying = Boolean(playing && state.dailyMaxRace?.frames?.length);
  updateDailyMaxRacePlayButton();
  if (state.dailyMaxRacePlaying) scheduleDailyMaxRaceFrame();
}

async function openDailyMaxRaceModal(requestedDate = "", options = {}) {
  if (!els.dailyMaxRaceBackdrop) return;
  state.dailyMaxRacePreviousFocus = document.activeElement;
  const requestedElement = ["max", "min"].includes(options.element) ? options.element : "max";
  const requestedCount = Number(options.visibleCount);
  const requestedSpeed = Number(options.speed);
  state.dailyMaxRaceElement = requestedElement;
  els.dailyMaxRaceModal?.classList.toggle("is-minimum", requestedElement === "min");
  if (requestedDate) state.dailyMaxRaceDate = String(requestedDate);
  if ([10, 20, 25, 30, 35, 50, 100].includes(requestedCount)) {
    state.dailyMaxRaceVisibleCount = requestedCount;
  } else if (window.matchMedia("(max-width: 760px)").matches && !state.dailyMaxRace) {
    state.dailyMaxRaceVisibleCount = window.innerHeight >= 820 ? 35 : (window.innerHeight >= 720 ? 30 : 25);
  }
  if ([0.5, 1, 2, 4].includes(requestedSpeed)) state.dailyMaxRaceSpeed = requestedSpeed;
  els.dailyMaxRaceCountSelect.value = String(state.dailyMaxRaceVisibleCount);
  els.dailyMaxRaceSpeedSelect.value = String(state.dailyMaxRaceSpeed);
  els.dailyMaxRaceBackdrop.hidden = false;
  setDailyMaxRaceVideoPanel(false);
  setDailyMaxRaceVideoExportStatus("idle");
  document.body.classList.add("race-modal-open");
  renderDailyMaxRaceRegionLegend();
  els.dailyMaxRaceModal.focus({ preventScroll: true });
  try {
    await loadDailyMaxRace();
    activateDailyMaxRaceSelection();
    const requestedFrameTime = String(options.frameTime || "");
    const exactFrameIndex = requestedFrameTime
      ? state.dailyMaxRace?.frames?.findIndex((frame) => String(frame.time) === requestedFrameTime)
      : -1;
    state.dailyMaxRaceFrameIndex = exactFrameIndex >= 0 ? exactFrameIndex : 0;
    renderDailyMaxRaceFrame(true);
    updateDailyMaxRacePlayButton();
  } catch {
    // The visible alert explains the loading failure.
  }
}

function closeDailyMaxRaceModal() {
  if (!els.dailyMaxRaceBackdrop || els.dailyMaxRaceBackdrop.hidden) return;
  if (state.dailyMaxRaceVideoExporting) state.dailyMaxRaceVideoAbortRequested = true;
  setDailyMaxRacePlaying(false);
  setDailyMaxRaceVideoPanel(false);
  els.dailyMaxRaceBackdrop.hidden = true;
  document.body.classList.remove("race-modal-open");
  state.dailyMaxRacePreviousFocus?.focus?.({ preventScroll: true });
}

function trapDailyMaxRaceFocus(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeDailyMaxRaceModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...els.dailyMaxRaceModal.querySelectorAll("button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function updateRecordPanel(observedRankable) {
  if (!els.recordPanel) return;
  const open = state.showRecordMarkers && observedRankable;
  els.recordPanel.hidden = !open;
  els.recordMarkersButton?.classList.toggle("active", open);
  els.recordMarkersButton?.setAttribute("aria-pressed", open ? "true" : "false");
  if (!open) return;
  const day = selectedExtremeDay();
  applyRecordPanelPosition();
  if (!day) {
    els.recordPanel.innerHTML = `<div class="ranking-head"><strong>気温記録更新</strong></div><p class="ranking-empty">データを読み込めません。</p>${panelResizeHandles("record")}`;
  } else {
    const status = rankingStatusInfo(day);
    const elementName = state.element === "temp" ? "気温" : state.element === "min" ? "最低気温" : "最高気温";
    els.recordPanel.innerHTML = `
      <div class="ranking-head">
        <div><div class="ranking-title-row"><strong>${escapeHtml(day.label || day.date)} ${elementName}の記録更新</strong><span class="ranking-status ${status.className}"><b>${status.label}</b><span>${status.text}</span></span></div><span>気象庁「観測史上1位の値 更新状況」</span></div>
        <button type="button" id="recordPanelCloseButton" aria-label="閉じる">×</button>
      </div>
      <div class="record-grid">${renderRecordList(day, "all_time")}${renderRecordList(day, "monthly")}</div>
      ${panelResizeHandles("record")}`;
  }
  applyPanelScale(els.recordPanel, state.recordPanelScale);
  applyPanelHeight(els.recordPanel, state.recordPanelHeight);
  wireRecordPanelDrag();
  wirePanelResize(els.recordPanel, "record");
  document.getElementById("recordPanelCloseButton")?.addEventListener("click", () => {
    state.showRecordMarkers = false;
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

function defaultRecordPanelPosition() {
  return { left: 16, top: 16 };
}

function clampRecordPanelPosition(position) {
  const wrapRect = els.canvasWrap?.getBoundingClientRect();
  const panelRect = els.recordPanel?.getBoundingClientRect();
  return {
    left: Math.max(10, Math.min((wrapRect?.width || window.innerWidth) - (panelRect?.width || 560) - 10, position.left)),
    top: Math.max(10, Math.min((wrapRect?.height || window.innerHeight) - (panelRect?.height || 380) - 10, position.top)),
  };
}

function applyRecordPanelPosition() {
  if (!els.recordPanel) return;
  if (!state.recordPanelPosition) state.recordPanelPosition = defaultRecordPanelPosition();
  state.recordPanelPosition = clampRecordPanelPosition(state.recordPanelPosition);
  els.recordPanel.style.left = `${state.recordPanelPosition.left}px`;
  els.recordPanel.style.top = `${state.recordPanelPosition.top}px`;
}

function applyPanelScale(panel, scale) {
  if (!panel) return;
  panel.style.setProperty("--panel-scale", String(scale));
}

function applyPanelHeight(panel, height) {
  if (!panel) return;
  panel.style.height = Number.isFinite(height) ? `${height}px` : "";
  panel.style.maxHeight = Number.isFinite(height) ? "none" : "";
}

function wirePanelResize(panel, kind) {
  panel?.querySelectorAll(`[data-panel-resize="${kind}"]`).forEach((handle) => {
    handle.dataset.wired = "1";
  });
}

document.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest?.("[data-panel-resize]");
  if (!handle) return;
  const kind = handle.dataset.panelResize;
  const corner = handle.dataset.panelCorner || "se";
  const panel = kind === "ranking" ? els.rankingPanel : kind === "record" ? els.recordPanel : els.pointChartPanel;
  if (!panel) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = panel.getBoundingClientRect();
  const position = kind === "ranking"
    ? (state.rankingPanelPosition || defaultRankingPanelPosition())
    : kind === "record"
      ? (state.recordPanelPosition || defaultRecordPanelPosition())
    : (state.pointChartPanelPosition || defaultPointChartPanelPosition());
  state.panelResizeStart = {
    kind,
    corner,
    panel,
    x: event.clientX,
    y: event.clientY,
    scale: kind === "ranking" ? state.rankingPanelScale : kind === "record" ? state.recordPanelScale : state.pointChartPanelScale,
    width: rect.width,
    height: rect.height,
    left: position.left,
    top: position.top,
    bottom: position.top + rect.height,
  };
  panel.classList.add("resizing");
});

document.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest?.("[data-panel-height-resize]");
  if (!handle) return;
  const kind = handle.dataset.panelHeightResize;
  const panel = kind === "record" ? els.recordPanel : els.rankingPanel;
  if (!panel) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = panel.getBoundingClientRect();
  const position = kind === "record"
    ? (state.recordPanelPosition || defaultRecordPanelPosition())
    : (state.rankingPanelPosition || defaultRankingPanelPosition());
  state.panelHeightResizeStart = {
    kind, panel, edge: handle.dataset.panelHeightEdge || "top", y: event.clientY,
    height: rect.height, top: position.top, bottom: position.top + rect.height,
    scale: kind === "record" ? state.recordPanelScale : state.rankingPanelScale,
  };
  panel.classList.add("resizing");
});

window.addEventListener("pointermove", (event) => {
  const heightStart = state.panelHeightResizeStart;
  if (heightStart) {
    resizePanelHeightFromDrag(heightStart, heightStart.edge, event.clientY - heightStart.y);
    return;
  }
  const start = state.panelResizeStart;
  if (!start) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (["ranking", "record"].includes(start.kind) && Math.abs(dy) > Math.abs(dx) * 1.25) {
    resizePanelHeightFromDrag(start, start.corner.includes("n") ? "top" : "bottom", dy);
    return;
  }
  const widthRatio = (start.width + (start.corner.includes("w") ? -dx : dx)) / start.width;
  const heightRatio = (start.height + (start.corner.includes("n") ? -dy : dy)) / start.height;
  const ratio = Math.max(widthRatio, heightRatio);
  const scale = Math.max(0.65, Math.min(1.45, start.scale * ratio));
  const scaleRatio = scale / start.scale;
  const position = {
    left: start.left + (start.corner.includes("w") ? start.width * (1 - scaleRatio) : 0),
    top: start.top + (start.corner.includes("n") ? start.height * (1 - scaleRatio) : 0),
  };
  if (start.kind === "ranking") state.rankingPanelScale = scale;
  else if (start.kind === "record") state.recordPanelScale = scale;
  else state.pointChartPanelScale = scale;
  if (start.kind === "ranking") state.rankingPanelPosition = position;
  else if (start.kind === "record") state.recordPanelPosition = position;
  else state.pointChartPanelPosition = position;
  applyPanelScale(start.panel, scale);
  if (start.kind === "ranking") applyRankingPanelPosition();
  else if (start.kind === "record") applyRecordPanelPosition();
  else applyPointChartPanelPosition();
});

function resizePanelHeightFromDrag(start, edge, dy) {
  const wrapHeight = els.canvasWrap?.getBoundingClientRect().height || window.innerHeight;
  let top = start.top;
  let visualHeight;
  if (edge === "bottom") {
    visualHeight = Math.max(160, Math.min(wrapHeight - start.top - 10, start.height + dy));
  } else {
    const desiredHeight = Math.max(160, Math.min(start.bottom - 10, start.height - dy));
    top = Math.max(10, start.bottom - desiredHeight);
    visualHeight = start.bottom - top;
  }
  const cssHeight = visualHeight / start.scale;
  if (start.kind === "record") {
    state.recordPanelHeight = cssHeight;
    state.recordPanelPosition = { ...(state.recordPanelPosition || defaultRecordPanelPosition()), top };
    applyPanelHeight(start.panel, cssHeight);
    applyRecordPanelPosition();
  } else {
    state.rankingPanelHeight = cssHeight;
    state.rankingPanelPosition = { ...(state.rankingPanelPosition || defaultRankingPanelPosition()), top };
    applyPanelHeight(start.panel, cssHeight);
    applyRankingPanelPosition();
  }
}

window.addEventListener("pointerup", () => {
  if (state.panelHeightResizeStart) {
    state.panelHeightResizeStart.panel.classList.remove("resizing");
    state.panelHeightResizeStart = null;
  }
  if (!state.panelResizeStart) return;
  state.panelResizeStart.panel.classList.remove("resizing");
  state.panelResizeStart = null;
});

function defaultPointChartPanelPosition() {
  const wrapRect = els.canvasWrap?.getBoundingClientRect();
  const panelRect = els.pointChartPanel?.getBoundingClientRect();
  return {
    left: Math.max(12, (wrapRect?.width || window.innerWidth) - (panelRect?.width || 500) - 14),
    top: Math.max(12, (wrapRect?.height || window.innerHeight) - (panelRect?.height || 340) - 14),
  };
}

function clampPointChartPanelPosition(position) {
  const wrapRect = els.canvasWrap?.getBoundingClientRect();
  const panelRect = els.pointChartPanel?.getBoundingClientRect();
  return {
    left: Math.max(8, Math.min((wrapRect?.width || window.innerWidth) - (panelRect?.width || 500) - 8, position.left)),
    top: Math.max(8, Math.min((wrapRect?.height || window.innerHeight) - (panelRect?.height || 340) - 8, position.top)),
  };
}

function applyPointChartPanelPosition() {
  if (!els.pointChartPanel) return;
  if (!state.pointChartPanelPosition) state.pointChartPanelPosition = defaultPointChartPanelPosition();
  state.pointChartPanelPosition = clampPointChartPanelPosition(state.pointChartPanelPosition);
  els.pointChartPanel.style.left = `${state.pointChartPanelPosition.left}px`;
  els.pointChartPanel.style.top = `${state.pointChartPanelPosition.top}px`;
}

function wirePointChartPanelDrag() {
  const head = els.pointChartPanel?.querySelector(".point-chart-head");
  if (!head || head.dataset.dragWired === "1") return;
  head.dataset.dragWired = "1";
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.(".point-chart-head") || event.target.closest("button")) return;
    const current = state.pointChartPanelPosition || defaultPointChartPanelPosition();
    state.pointChartPanelDragging = true;
    state.pointChartPanelDragStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: current.left, top: current.top };
    head.setPointerCapture?.(event.pointerId);
    els.pointChartPanel.classList.add("dragging");
  });
  window.addEventListener("pointermove", (event) => {
    if (!state.pointChartPanelDragging || !state.pointChartPanelDragStart || state.panelResizeStart) return;
    if (event.pointerId !== state.pointChartPanelDragStart.pointerId) return;
    state.pointChartPanelPosition = clampPointChartPanelPosition({
      left: state.pointChartPanelDragStart.left + event.clientX - state.pointChartPanelDragStart.x,
      top: state.pointChartPanelDragStart.top + event.clientY - state.pointChartPanelDragStart.y,
    });
    applyPointChartPanelPosition();
  });
  const endDrag = (event) => {
    if (!state.pointChartPanelDragging) return;
    if (event.pointerId !== state.pointChartPanelDragStart?.pointerId) return;
    try { head.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    state.pointChartPanelDragging = false;
    state.pointChartPanelDragStart = null;
    els.pointChartPanel.classList.remove("dragging");
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
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

function wireRecordPanelDrag() {
  const head = els.recordPanel?.querySelector(".ranking-head");
  if (!head) return;
  head.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    state.recordPanelDragging = true;
    const current = state.recordPanelPosition || defaultRecordPanelPosition();
    state.recordPanelDragStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: current.left, top: current.top };
    head.setPointerCapture?.(event.pointerId);
    els.recordPanel?.classList.add("dragging");
  });
  head.addEventListener("pointermove", (event) => {
    if (!state.recordPanelDragging || !state.recordPanelDragStart || state.panelResizeStart) return;
    state.recordPanelPosition = clampRecordPanelPosition({
      left: state.recordPanelDragStart.left + event.clientX - state.recordPanelDragStart.x,
      top: state.recordPanelDragStart.top + event.clientY - state.recordPanelDragStart.y,
    });
    applyRecordPanelPosition();
  });
  const endDrag = (event) => {
    if (!state.recordPanelDragging) return;
    state.recordPanelDragging = false;
    state.recordPanelDragStart = null;
    try { head.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    els.recordPanel?.classList.remove("dragging");
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
        ["40℃", rgb(TEMPERATURE_EXTREME_HEAT_COLOR)], ["35℃", "#cf4381"], ["30℃", "#ff6252"],
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
      labels: [40, 35, 30, 25, 20, 15, 10, 5, 0, -5, -10, -15, -20],
      min: -20,
      max: TEMPERATURE_LEGEND_MAX_C,
      gridStep: 5,
      emphasizedThreshold: TEMPERATURE_EXTREME_HEAT_THRESHOLD_C,
      color: colorForValue,
      signed: false,
    };
  }
  return {
    title: state.mode === "anomaly" ? "平均との差" : "前日差",
    labels: [8, 6, 4, 2, 0, -2, -4, -6, -8],
    min: -8,
    max: 8,
    gridStep: 2,
    color: colorForAnomaly,
    signed: true,
  };
}

const LEGEND_MIN_SCALE = 0.65;
const LEGEND_MAX_SCALE = 1.45;
const LEGEND_WEATHER_METADATA_HEIGHT = 126;

function legendBaseMetrics(cfg = legendConfig()) {
  if (cfg.type === "weather") {
    return {
      width: 190,
      height: 86 + cfg.items.length * 44,
      defaultTop: 78,
    };
  }
  return {
    width: 190,
    height: Math.min(610, Math.max(500, els.canvas.height - 150)),
    defaultTop: 64,
  };
}

function legendScaleRange(metrics) {
  const metadataHeight = state.showWeatherMap ? LEGEND_WEATHER_METADATA_HEIGHT : 0;
  const widthFit = (els.canvas.width - 16) / metrics.width;
  const heightFit = (els.canvas.height - 16) / (metrics.height + metadataHeight);
  return {
    min: LEGEND_MIN_SCALE,
    max: Math.max(LEGEND_MIN_SCALE, Math.min(LEGEND_MAX_SCALE, widthFit, heightFit)),
  };
}

function clampLegendScale(scale, metrics) {
  const range = legendScaleRange(metrics);
  return Math.max(range.min, Math.min(range.max, scale));
}

function syncLegendResizeHandles(bounds) {
  if (!els.legendResizeHandles || !bounds) {
    if (els.legendResizeHandles) els.legendResizeHandles.hidden = true;
    return;
  }
  const canvasRect = els.canvas.getBoundingClientRect();
  const wrapRect = els.canvasWrap.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height || !els.canvas.width || !els.canvas.height) {
    els.legendResizeHandles.hidden = true;
    return;
  }
  const scaleX = canvasRect.width / els.canvas.width;
  const scaleY = canvasRect.height / els.canvas.height;
  const originX = canvasRect.left - wrapRect.left;
  const originY = canvasRect.top - wrapRect.top;
  const corners = {
    nw: [bounds.left, bounds.top],
    ne: [bounds.left + bounds.width, bounds.top],
    sw: [bounds.left, bounds.top + bounds.height],
    se: [bounds.left + bounds.width, bounds.top + bounds.height],
  };
  els.legendResizeHandles.querySelectorAll("[data-legend-resize]").forEach((handle) => {
    const point = corners[handle.dataset.legendResize];
    if (!point) return;
    handle.style.left = `${originX + point[0] * scaleX}px`;
    handle.style.top = `${originY + point[1] * scaleY}px`;
  });
  els.legendResizeHandles.hidden = false;
}

function drawMapLegend() {
  const cfg = legendConfig();
  const metrics = legendBaseMetrics(cfg);
  const scale = clampLegendScale(state.legendScale, metrics);
  state.legendScale = scale;
  const boxW = metrics.width;
  const boxH = metrics.height;
  const scaledW = boxW * scale;
  const scaledH = boxH * scale;
  const metadataHeight = state.showWeatherMap ? LEGEND_WEATHER_METADATA_HEIGHT * scale : 0;
  const defaultLeft = els.canvas.width - scaledW - 28;
  const left = Math.max(8, Math.min(els.canvas.width - scaledW - 8, defaultLeft + state.legendOffsetX));
  const top = Math.max(8, Math.min(els.canvas.height - scaledH - metadataHeight - 8, metrics.defaultTop + state.legendOffsetY));
  state.legendOffsetX = left - defaultLeft;
  state.legendOffsetY = top - metrics.defaultTop;

  ctx.save();
  ctx.translate(left, top);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(255,255,255,0.93)";
  ctx.strokeStyle = "rgba(80,92,104,0.55)";
  ctx.lineWidth = 1;
  ctx.fillRect(0, 0, boxW, boxH);
  ctx.strokeRect(0, 0, boxW, boxH);

  if (cfg.type === "weather") {
    const rowH = 44;
    ctx.fillStyle = "#202932";
    ctx.font = "900 28px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(cfg.title, 24, 44);
    ctx.font = "800 20px -apple-system, BlinkMacSystemFont, sans-serif";
    cfg.items.forEach((item, i) => {
      const y = 72 + i * rowH;
      ctx.fillStyle = item.color;
      ctx.fillRect(26, y, 36, 28);
      ctx.strokeStyle = "#4d5862";
      ctx.strokeRect(26, y, 36, 28);
      ctx.fillStyle = "#202932";
      ctx.fillText(item.label, 74, y + 21);
    });
    ctx.restore();
    return { left, top, width: scaledW, height: scaledH, scale, baseWidth: boxW, baseHeight: boxH };
  }

  const barLeft = 34;
  const titleLines = cfg.titleLines || [cfg.title];
  const twoLineTitle = titleLines.length > 1;
  const barTop = twoLineTitle ? 122 : 92;
  const barW = 58;
  const barH = boxH - (twoLineTitle ? 190 : 160);
  ctx.fillStyle = "#202932";
  const titleFontSize = cfg.signed ? 23 : twoLineTitle ? 23 : 28;
  ctx.font = `900 ${titleFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  titleLines.forEach((line, index) => ctx.fillText(line, 24, 40 + index * 29));
  ctx.font = "900 22px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("℃", boxW - 22, twoLineTitle ? 68 : 42);
  ctx.textAlign = "left";
  for (let i = 0; i < barH; i += 1) {
    const value = cfg.max - (i / (barH - 1)) * (cfg.max - cfg.min);
    ctx.fillStyle = rgb(cfg.color(value));
    ctx.fillRect(barLeft, barTop + i, barW, 1);
  }
  ctx.strokeStyle = "#4d5862";
  ctx.strokeRect(barLeft, barTop, barW, barH);
  if (cfg.gridStep) {
    ctx.save();
    ctx.strokeStyle = cfg.signed ? "rgba(20,24,28,0.55)" : "rgba(55,65,75,0.5)";
    ctx.lineWidth = 1;
    for (let value = Math.ceil(cfg.min / cfg.gridStep) * cfg.gridStep; value <= cfg.max; value += cfg.gridStep) {
      const y = barTop + ((cfg.max - value) / (cfg.max - cfg.min)) * barH;
      ctx.beginPath(); ctx.moveTo(barLeft, y); ctx.lineTo(barLeft + barW, y); ctx.stroke();
    }
    ctx.restore();
  }
  if (Number.isFinite(cfg.emphasizedThreshold)) {
    const y = barTop + ((cfg.max - cfg.emphasizedThreshold) / (cfg.max - cfg.min)) * barH;
    ctx.save();
    ctx.strokeStyle = "rgba(57,20,38,0.92)";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(barLeft, y); ctx.lineTo(barLeft + barW, y); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = "#202932";
  ctx.font = "900 25px -apple-system, BlinkMacSystemFont, sans-serif";
  cfg.labels.forEach((value) => {
    const y = barTop + ((cfg.max - value) / (cfg.max - cfg.min)) * barH;
    ctx.beginPath();
    ctx.moveTo(barLeft + barW, y);
    ctx.lineTo(barLeft + barW + 15, y);
    ctx.stroke();
    const label = cfg.labelForValue
      ? cfg.labelForValue(value)
      : cfg.signed && value > 0 ? `+${value}` : String(value);
    ctx.fillText(label, barLeft + barW + 22, y + 9);
  });
  ctx.restore();
  return { left, top, width: scaledW, height: scaledH, scale, baseWidth: boxW, baseHeight: boxH };
}

function drawWeatherMapMetadata(legendBounds) {
  const fileName = weatherMapFileName();
  if (!state.showWeatherMap || !fileName || !legendBounds) return;
  const scale = legendBounds.scale || 1;
  const width = legendBounds.baseWidth || legendBounds.width / scale;
  const height = 112;
  const left = legendBounds.left;
  const top = legendBounds.top + legendBounds.height + 14 * scale;
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(255,255,255,0.93)";
  ctx.strokeStyle = "rgba(80,92,104,0.55)";
  ctx.lineWidth = 1;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeRect(0, 0, width, height);
  ctx.fillStyle = state.weatherMapKind === "now" ? "#2d7658" : "#9a6415";
  ctx.fillRect(14, 14, 5, 34);
  ctx.fillStyle = "#202932";
  ctx.font = "900 21px -apple-system, BlinkMacSystemFont, sans-serif";
  if (state.weatherMapKind === "now") {
    ctx.fillText("実況天気図", 30, 39);
  } else {
    ctx.fillText("予想天気図", 30, 35);
    ctx.fillStyle = "#78654e";
    ctx.font = "800 15px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(state.weatherMapKind === "ft24" ? "24時間後" : "48時間後", 30, 53);
  }
  ctx.strokeStyle = "rgba(105,116,127,0.3)";
  ctx.beginPath(); ctx.moveTo(14, 64); ctx.lineTo(width - 14, 64); ctx.stroke();
  ctx.fillStyle = "#65717d";
  ctx.font = "800 15px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("対象", 16, 94);
  ctx.fillStyle = "#202932";
  ctx.font = "900 18px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(weatherMapTimeLabelNoYear(fileName), 58, 95);
  ctx.restore();
}

function drawPoints() {
  if (currentDataType() !== "temperature" || !state.points.length) return;
  ctx.save();
  ctx.globalAlpha = state.weatherOpacity;
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
  ctx.restore();
}

function drawRealtimeStations() {
  if (state.source !== "observed") return;
  ctx.save();
  ctx.globalAlpha = state.weatherOpacity;
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

function visibleLonLatBounds() {
  const [west, north] = pixelToLonLat(0, 0);
  const [east, south] = pixelToLonLat(els.canvas.width, els.canvas.height);
  return [Math.min(west, east), Math.min(south, north), Math.max(west, east), Math.max(south, north)];
}

function gsiZoomLevel() {
  const ratio = Math.max(1, state.view.scale / (state.minScale || state.view.scale));
  if (ratio < 1.8) return 5;
  if (ratio < 3.2) return 6;
  if (ratio < 5.5) return 7;
  if (ratio < 9) return 8;
  if (ratio < 16) return 9;
  if (ratio < 28) return 10;
  if (ratio < 50) return 11;
  if (ratio < 90) return 12;
  if (ratio < 180) return 13;
  if (ratio < 350) return 14;
  return 15;
}

function trimGsiTileCache() {
  if (state.gsiTileCache.size <= GSI_TILE_CACHE_LIMIT) return;
  for (const [url, entry] of state.gsiTileCache) {
    if (state.gsiTileCache.size <= GSI_TILE_CACHE_LIMIT) break;
    if (entry.status === "loading") continue;
    state.gsiTileCache.delete(url);
  }
}

function drawGsiTileLayer(layerId, opacity) {
  const z = gsiZoomLevel();
  const bounds = visibleLonLatBounds();
  const n = 2 ** z;
  const lonToX = (lon) => Math.floor((Number(lon) + 180) / 360 * n);
  const latToY = (lat) => Math.floor((1 - Math.asinh(Math.tan(Number(lat) * Math.PI / 180)) / Math.PI) / 2 * n);
  const xMin = Math.max(0, lonToX(bounds[0]));
  const xMax = Math.min(n - 1, lonToX(bounds[2]));
  const yMin = Math.max(0, latToY(bounds[3]));
  const yMax = Math.min(n - 1, latToY(bounds[1]));
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.imageSmoothingEnabled = true;
  for (let x = xMin; x <= xMax; x += 1) for (let y = yMin; y <= yMax; y += 1) {
    const [x0, y0] = lonLatToPixel(tileLon(x, z), tileLat(y, z));
    const [x1, y1] = lonLatToPixel(tileLon(x + 1, z), tileLat(y + 1, z));
    const left = Math.min(x0, x1), top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0) + 1, height = Math.abs(y1 - y0) + 1;
    const url = `https://cyberjapandata.gsi.go.jp/xyz/${layerId}/${z}/${x}/${y}.png`;
    let entry = state.gsiTileCache.get(url);
    if (!entry) {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      entry = { image, status: "loading" };
      state.gsiTileCache.set(url, entry);
      image.onload = () => { entry.status = "loaded"; trimGsiTileCache(); scheduleMapDraw(); };
      image.onerror = () => { entry.status = "missing"; trimGsiTileCache(); };
      image.src = url;
    }
    if (entry.status === "loaded") ctx.drawImage(entry.image, left, top, width, height);
  }
  ctx.restore();
}

function drawDetailedBaseMap() {
  if (!state.showDetailMap) return;
  drawGsiTileLayer("std", state.detailMapOpacity);
}

function drawTerrainLayer() {
  if (!state.showTerrain) return;
  drawGsiTileLayer(state.terrainStyle === "mono" ? "hillshademap" : "relief", state.terrainOpacity);
}

function suikeiTileUrl(template, z, x, y) {
  return `${DATA_ROOT}/${template.replace("{z}", z).replace("{x}", x).replace("{y}", y)}`;
}

function trimSuikeiTileCache() {
  if (state.suikeiTileCache.size <= SUIKEI_TILE_CACHE_LIMIT) return;
  for (const [url, entry] of state.suikeiTileCache) {
    if (state.suikeiTileCache.size <= SUIKEI_TILE_CACHE_LIMIT) break;
    if (entry.status === "loading") continue;
    state.suikeiTileCache.delete(url);
  }
}

function updateSuikeiLoadingNotice(loaded, loading, missing) {
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

function prefetchAdjacentSuikeiOverviews(layerKey) {
  const slots = suikeiSlots();
  const index = Number(state.suikeiSlotIndex);
  for (const offset of [-2, -1, 1, 2]) {
    const layer = slots[index + offset]?.layers?.[layerKey];
    if (!layer?.overview_file) continue;
    const url = `${DATA_ROOT}/${layer.overview_file}`;
    if (state.suikeiTileCache.has(url)) continue;
    const image = new Image();
    const entry = { image, status: "loading" };
    state.suikeiTileCache.set(url, entry);
    image.onload = () => { entry.status = "loaded"; trimSuikeiTileCache(); };
    image.onerror = () => { entry.status = "missing"; trimSuikeiTileCache(); };
    image.src = url;
  }
}

function drawSuikeiOverview(layer, layerKey) {
  const bounds = layer.overview_bounds;
  if (!layer.overview_file || !Array.isArray(bounds) || bounds.length !== 4) return false;
  const url = `${DATA_ROOT}/${layer.overview_file}`;
  let entry = state.suikeiTileCache.get(url);
  if (!entry) {
    const image = new Image();
    entry = { image, status: "loading" };
    state.suikeiTileCache.set(url, entry);
    image.onload = () => { entry.status = "loaded"; trimSuikeiTileCache(); prefetchAdjacentSuikeiOverviews(layerKey); draw(); };
    image.onerror = () => { entry.status = "missing"; trimSuikeiTileCache(); draw(); };
    image.src = url;
  }
  if (entry.status === "loaded") {
    prefetchAdjacentSuikeiOverviews(layerKey);
    const [x0, y0] = lonLatToPixel(Number(bounds[0]), Number(bounds[3]));
    const [x1, y1] = lonLatToPixel(Number(bounds[2]), Number(bounds[1]));
    ctx.save();
    ctx.globalAlpha = state.weatherOpacity;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(entry.image, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1);
    ctx.restore();
  }
  updateSuikeiLoadingNotice(entry.status === "loaded" ? 1 : 0, entry.status === "loading" ? 1 : 0, entry.status === "missing" ? 1 : 0);
  return true;
}

function drawSuikeiTiles() {
  if (state.source !== "observed" || !isSuikeiObservedLayer()) return;
  const layerKey = state.observedLayer === "temp" ? "temperature" : state.observedLayer;
  const layer = currentSuikeiSlot()?.layers?.[layerKey];
  if (!layer?.tile_template || state.suikeiManifest?.availability === false) return;
  const zoomRatio = state.view?.scale / (state.minScale || state.view?.scale || 1);
  if (zoomRatio <= SUIKEI_OVERVIEW_MAX_ZOOM_RATIO && drawSuikeiOverview(layer, layerKey)) return;
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
  ctx.globalAlpha = state.weatherOpacity;
  ctx.imageSmoothingEnabled = false;
  for (let x = xMin; x <= xMax; x += 1) for (let y = yMin; y <= yMax; y += 1) {
    const [x0, y0] = lonLatToPixel(tileLon(x, coordinateZoom), tileLat(y, coordinateZoom));
    const [x1, y1] = lonLatToPixel(tileLon(x + 1, coordinateZoom), tileLat(y + 1, coordinateZoom));
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0) + 1;
    const height = Math.abs(y1 - y0) + 1;
    // Load only the viewport and one surrounding tile. Previously every draw
    // requested all 169 nationwide tiles even after zooming into one region.
    if (left > els.canvas.width + width || left + width < -width || top > els.canvas.height + height || top + height < -height) continue;
    const url = suikeiTileUrl(layer.tile_template, z, x, y);
    let entry = state.suikeiTileCache.get(url);
    if (!entry) {
      const image = new Image();
      entry = { image, status: "loading" };
      state.suikeiTileCache.set(url, entry);
      trimSuikeiTileCache();
      image.onload = () => { entry.status = "loaded"; trimSuikeiTileCache(); draw(); };
      image.onerror = () => { entry.status = "missing"; trimSuikeiTileCache(); draw(); };
      image.src = url;
    } else {
      state.suikeiTileCache.delete(url);
      state.suikeiTileCache.set(url, entry);
    }
    if (entry.status === "loading") loading += 1;
    if (entry.status === "missing") missing += 1;
    if (entry.status !== "loaded") continue;
    loaded += 1;
    ctx.drawImage(entry.image, left, top, width, height);
  }
  ctx.restore();
  updateSuikeiLoadingNotice(loaded, loading, missing);
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

function weatherMapSourcePixel(lon, lat) {
  const projection = WEATHER_MAP_SOURCE_PROJECTION;
  const latitudeRadians = lat * Math.PI / 180;
  const longitudeRadians = (lon - projection.centralLongitude) * Math.PI / 180;
  const radius = projection.scale / Math.tan(Math.PI / 4 + latitudeRadians / 2);
  return [
    projection.centerX + radius * Math.sin(longitudeRadians),
    projection.centerY + radius * Math.cos(longitudeRadians),
  ];
}

function drawImageTriangle(image, source, destination) {
  const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = source;
  const [[dx0, dy0], [dx1, dy1], [dx2, dy2]] = destination;
  const denominator = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(denominator) < 0.0001) return;
  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denominator;
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denominator;
  const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / denominator;
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denominator;
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denominator;
  const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / denominator;
  ctx.save();
  const centerX = (dx0 + dx1 + dx2) / 3;
  const centerY = (dy0 + dy1 + dy2) / 3;
  const expand = (x, y) => {
    const distance = Math.hypot(x - centerX, y - centerY) || 1;
    return [x + (x - centerX) / distance * 1.4, y + (y - centerY) / distance * 1.4];
  };
  const [cx0, cy0] = expand(dx0, dy0);
  const [cx1, cy1] = expand(dx1, dy1);
  const [cx2, cy2] = expand(dx2, dy2);
  ctx.beginPath();
  ctx.moveTo(cx0, cy0);
  ctx.lineTo(cx1, cy1);
  ctx.lineTo(cx2, cy2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function drawWeatherMapOverlay() {
  if (!state.showWeatherMap || !state.weatherMapImage) return;
  const [west, east, south, north] = WEATHER_MAP_BOUNDS;
  const longitudeStep = 5;
  const latitudeStep = 5;
  ctx.save();
  ctx.globalAlpha = state.weatherMapOpacity;
  ctx.imageSmoothingEnabled = true;
  for (let lat = south; lat < north; lat += latitudeStep) {
    for (let lon = west; lon < east; lon += longitudeStep) {
      const nextLon = Math.min(east, lon + longitudeStep);
      const nextLat = Math.min(north, lat + latitudeStep);
      const sourceNorthWest = weatherMapSourcePixel(lon, nextLat);
      const sourceNorthEast = weatherMapSourcePixel(nextLon, nextLat);
      const sourceSouthWest = weatherMapSourcePixel(lon, lat);
      const sourceSouthEast = weatherMapSourcePixel(nextLon, lat);
      const destinationNorthWest = lonLatToPixel(lon, nextLat);
      const destinationNorthEast = lonLatToPixel(nextLon, nextLat);
      const destinationSouthWest = lonLatToPixel(lon, lat);
      const destinationSouthEast = lonLatToPixel(nextLon, lat);
      drawImageTriangle(state.weatherMapImage,
        [sourceNorthWest, sourceNorthEast, sourceSouthWest],
        [destinationNorthWest, destinationNorthEast, destinationSouthWest]);
      drawImageTriangle(state.weatherMapImage,
        [sourceNorthEast, sourceSouthEast, sourceSouthWest],
        [destinationNorthEast, destinationSouthEast, destinationSouthWest]);
    }
  }
  ctx.restore();
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
  const slots = state.source === "forecast" ? currentForecastSlots() : activeObservedDailySlots();
  const labels = state.source === "forecast"
    ? slots.map((slot) => slot.label)
    : slots.map((slot) => slot.label);
  const max = Math.max(0, labels.length - 1);
  const currentObservedActive = state.source === "observed" && state.element === "temp";
  const observedFilteredIndex = state.source === "observed"
    ? slots.findIndex((slot) => slot === currentObservedSlot() || slot.id === currentObservedSlot()?.id)
    : -1;
  const value = state.source === "forecast"
    ? Math.min(state.slotIndex, max)
    : currentObservedActive
      ? Math.min(state.slotIndex, max)
      : Math.max(0, observedFilteredIndex >= 0 ? observedFilteredIndex : max);
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
  const filteredSlots = activeObservedDailySlots();
  const slot = filteredSlots[Number(value)] || filteredSlots[0] || state.observedSlots[0];
  const previousIndex = state.slotIndex;
  const actualIndex = state.observedSlots.findIndex((candidate) => candidate === slot || candidate.id === slot?.id);
  state.slotIndex = actualIndex >= 0 ? actualIndex : 0;
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
  drawDetailedBaseMap();
  drawTerrainLayer();
  drawGrid();
  drawPoints();
  drawRealtimeStations();
  drawSuikeiTiles();
  drawWeatherPolygons();
  drawWeatherMapOverlay();
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
  const legendBounds = drawMapLegend();
  state.legendCoreBounds = legendBounds;
  state.legendBounds = legendBounds ? {
    ...legendBounds,
    height: legendBounds.height + (state.showWeatherMap ? LEGEND_WEATHER_METADATA_HEIGHT * legendBounds.scale : 0),
  } : null;
  drawWeatherMapMetadata(legendBounds);
  syncLegendResizeHandles(legendBounds);
  if (state.hoverPoint) {
    const [x, y] = lonLatToPixel(state.hoverPoint.lon, state.hoverPoint.lat);
    ctx.save();
    ctx.strokeStyle = "rgba(17,24,32,0.92)";
    ctx.lineWidth = 2;
    const inner = 8, outer = 13;
    [[-outer, -outer, -inner, -outer], [-outer, -outer, -outer, -inner],
      [outer, -outer, inner, -outer], [outer, -outer, outer, -inner],
      [-outer, outer, -inner, outer], [-outer, outer, -outer, inner],
      [outer, outer, inner, outer], [outer, outer, outer, inner]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(x + x1, y + y1); ctx.lineTo(x + x2, y + y2); ctx.stroke();
    });
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

function updateRealtimeCoverage(rows, requestedDays) {
  if (!els.pointChartMeta) return;
  if (!rows.length) {
    els.pointChartMeta.hidden = false;
    els.pointChartMeta.textContent = "実況時系列データがありません";
    return;
  }
  const first = new Date(rows[0].time);
  const last = new Date(rows[rows.length - 1].time);
  const spanDays = Math.max(0, (last.getTime() - first.getTime()) / 86400000);
  const fmt = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  els.pointChartMeta.hidden = false;
  els.pointChartMeta.textContent = `蓄積 ${fmt.format(first)}〜${fmt.format(last)}（約${spanDays.toFixed(1)}日／指定${requestedDays}日）`;
}

async function openPointChart(point) {
  if (!point || !els.pointChartPanel) return;
  state.selectedPoint = point;
  els.pointChartPanel.hidden = false;
  applyPanelScale(els.pointChartPanel, state.pointChartPanelScale);
  applyPointChartPanelPosition();
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
      updateRealtimeCoverage(rows, effectiveDays);
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
  syncObservedDailySequenceControl();
  updateModeButtons();
  syncMapLayerControls();
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

function beginLegendResize(event) {
  const handle = event.target.closest?.("[data-legend-resize]");
  const bounds = state.legendCoreBounds;
  if (!handle || !bounds || state.legendResizing) return;
  const corner = handle.dataset.legendResize;
  if (!corner) return;
  const [x, y] = canvasPosition(event);
  const west = corner.includes("w");
  const north = corner.includes("n");
  const draggedX = west ? bounds.left : bounds.left + bounds.width;
  const draggedY = north ? bounds.top : bounds.top + bounds.height;
  const anchorX = west ? bounds.left + bounds.width : bounds.left;
  const anchorY = north ? bounds.top + bounds.height : bounds.top;
  state.legendResizing = true;
  state.legendResizeStart = {
    pointerId: event.pointerId,
    corner,
    anchorX,
    anchorY,
    pointerOffsetX: x - draggedX,
    pointerOffsetY: y - draggedY,
    vectorX: draggedX - anchorX,
    vectorY: draggedY - anchorY,
    startScale: bounds.scale || state.legendScale,
    baseWidth: bounds.baseWidth || bounds.width / (bounds.scale || 1),
    baseHeight: bounds.baseHeight || bounds.height / (bounds.scale || 1),
  };
  state.legendDragging = false;
  state.legendDragStart = null;
  state.dragging = false;
  state.dragStart = null;
  state.dragMoved = true;
  els.canvasWrap.classList.remove("dragging");
  els.canvasWrap.classList.add("legend-resizing");
  handle.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function moveLegendResize(event) {
  const start = state.legendResizeStart;
  if (!state.legendResizing || !start || event.pointerId !== start.pointerId) return;
  const [x, y] = canvasPosition(event);
  const vectorX = x - start.pointerOffsetX - start.anchorX;
  const vectorY = y - start.pointerOffsetY - start.anchorY;
  const denominator = start.vectorX ** 2 + start.vectorY ** 2;
  const ratio = denominator > 0
    ? (vectorX * start.vectorX + vectorY * start.vectorY) / denominator
    : 1;
  const metrics = {
    width: start.baseWidth,
    height: start.baseHeight,
  };
  const scale = clampLegendScale(start.startScale * ratio, metrics);
  const width = start.baseWidth * scale;
  const height = start.baseHeight * scale;
  const west = start.corner.includes("w");
  const north = start.corner.includes("n");
  const metadataHeight = state.showWeatherMap ? LEGEND_WEATHER_METADATA_HEIGHT * scale : 0;
  const left = Math.max(8, Math.min(els.canvas.width - width - 8, west ? start.anchorX - width : start.anchorX));
  const top = Math.max(8, Math.min(
    els.canvas.height - height - metadataHeight - 8,
    north ? start.anchorY - height : start.anchorY,
  ));
  const defaultLeft = els.canvas.width - width - 28;
  const defaultTop = legendBaseMetrics().defaultTop;
  state.legendScale = scale;
  state.legendOffsetX = left - defaultLeft;
  state.legendOffsetY = top - defaultTop;
  draw();
  event.preventDefault();
}

function endLegendResize(event) {
  const start = state.legendResizeStart;
  if (!state.legendResizing || !start || event.pointerId !== start.pointerId) return;
  state.legendResizing = false;
  state.legendResizeStart = null;
  els.canvasWrap.classList.remove("legend-resizing");
  event.preventDefault();
}

els.legendResizeHandles?.addEventListener("pointerdown", beginLegendResize);
window.addEventListener("pointermove", moveLegendResize, { passive: false });
window.addEventListener("pointerup", endLegendResize, { passive: false });
window.addEventListener("pointercancel", endLegendResize, { passive: false });

els.canvas.addEventListener("mousemove", (event) => {
  if (state.legendResizing) return;
  const [x, y, rect] = canvasPosition(event);
  if (state.legendDragging && state.legendDragStart) {
    const dx = x - state.legendDragStart.x;
    const dy = y - state.legendDragStart.y;
    state.legendOffsetX = state.legendDragStart.offsetX + dx;
    state.legendOffsetY = state.legendDragStart.offsetY + dy;
    state.dragMoved = true;
    draw();
    return;
  }
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
  if (point && state.showTooltip) {
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
  scheduleMapDraw();
});

els.canvas.addEventListener("mouseleave", () => {
  if (state.legendDragging || state.legendResizing) return;
  state.dragging = false;
  state.dragStart = null;
  els.canvasWrap.classList.remove("dragging");
  els.tooltip.hidden = true;
  state.hoverPoint = null;
  setReadout(null);
  draw();
});

els.canvas.addEventListener("mousedown", (event) => {
  if (state.legendResizing) return;
  const [x, y] = canvasPosition(event);
  const bounds = state.legendBounds;
  if (bounds && x >= bounds.left && x <= bounds.left + bounds.width && y >= bounds.top && y <= bounds.top + bounds.height) {
    state.legendDragging = true;
    state.legendDragStart = { x, y, offsetX: state.legendOffsetX, offsetY: state.legendOffsetY };
    state.dragMoved = false;
    els.canvasWrap.classList.add("dragging");
    event.preventDefault();
    return;
  }
  state.dragging = true;
  state.dragStart = { x, y };
  state.dragMoved = false;
  els.canvasWrap.classList.add("dragging");
});

window.addEventListener("mouseup", () => {
  state.legendDragging = false;
  state.legendDragStart = null;
  state.dragging = false;
  state.dragStart = null;
  els.canvasWrap.classList.remove("dragging");
});

function mapTouchMetrics() {
  const points = [...state.mapTouches.values()];
  if (points.length < 2) return null;
  const [a, b] = points;
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

els.canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || state.legendResizing) return;
  event.preventDefault();
  const [x, y] = canvasPosition(event);
  state.mapTouches.set(event.pointerId, { x, y });
  els.canvas.setPointerCapture?.(event.pointerId);
  if (state.mapTouches.size === 1) {
    const bounds = state.legendBounds;
    const onLegend = bounds && x >= bounds.left && x <= bounds.left + bounds.width && y >= bounds.top && y <= bounds.top + bounds.height;
    state.legendDragging = Boolean(onLegend);
    state.legendDragStart = onLegend ? { x, y, offsetX: state.legendOffsetX, offsetY: state.legendOffsetY } : null;
    state.dragging = !onLegend;
    state.dragStart = { x, y };
    state.dragMoved = false;
    state.mapTouchGesture = null;
    state.mapTouchTapStart = onLegend ? null : { x, y };
    state.suppressNextMapClick = false;
    els.canvasWrap.classList.add("dragging");
    return;
  }
  state.legendDragging = false;
  state.legendDragStart = null;
  state.dragging = false;
  state.dragStart = null;
  state.dragMoved = true;
  state.mapTouchGesture = mapTouchMetrics();
  state.mapTouchTapStart = null;
});

els.canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "touch" || !state.mapTouches.has(event.pointerId)) return;
  event.preventDefault();
  const [x, y] = canvasPosition(event);
  state.mapTouches.set(event.pointerId, { x, y });
  if (state.mapTouches.size >= 2) {
    const next = mapTouchMetrics();
    const previous = state.mapTouchGesture;
    if (next && previous) {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.2) panBy(dx, dy);
      if (previous.distance > 0 && next.distance > 0) {
        const factor = Math.max(0.75, Math.min(1.33, next.distance / previous.distance));
        if (Math.abs(factor - 1) > 0.002) zoomAt(next.x, next.y, factor);
      }
      state.dragMoved = true;
    }
    state.mapTouchGesture = next;
    return;
  }
  if (state.legendDragging && state.legendDragStart) {
    state.legendOffsetX = state.legendDragStart.offsetX + x - state.legendDragStart.x;
    state.legendOffsetY = state.legendDragStart.offsetY + y - state.legendDragStart.y;
    state.dragMoved = true;
    draw();
    return;
  }
  if (state.dragging && state.dragStart) {
    const dx = x - state.dragStart.x;
    const dy = y - state.dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 10) {
      state.dragMoved = true;
      state.mapTouchTapStart = null;
    }
    state.dragStart = { x, y };
    panBy(dx, dy);
  }
});

function endMapTouch(event) {
  if (event.pointerType !== "touch" || !state.mapTouches.has(event.pointerId)) return;
  event.preventDefault();
  const touchPoint = state.mapTouches.get(event.pointerId);
  const tapStart = state.mapTouchTapStart;
  const wasTap = event.type === "pointerup"
    && state.mapTouches.size === 1
    && !state.dragMoved
    && tapStart
    && touchPoint
    && Math.hypot(touchPoint.x - tapStart.x, touchPoint.y - tapStart.y) <= 14;
  state.mapTouches.delete(event.pointerId);
  try {
    els.canvas.releasePointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture may already be released by the browser.
  }
  if (state.mapTouches.size === 1) {
    const remaining = [...state.mapTouches.values()][0];
    state.mapTouchGesture = null;
    state.legendDragging = false;
    state.legendDragStart = null;
    state.dragging = true;
    state.dragStart = { ...remaining };
    state.dragMoved = true;
    return;
  }
  state.mapTouchGesture = null;
  state.mapTouchTapStart = null;
  state.legendDragging = false;
  state.legendDragStart = null;
  state.dragging = false;
  state.dragStart = null;
  els.canvasWrap.classList.remove("dragging");
  if (wasTap && currentDataType() === "temperature") {
    const [lon, lat] = pixelToLonLat(touchPoint.x, touchPoint.y);
    const point = nearestPoint(lon, lat);
    if (point) {
      state.pointChartSource = state.source === "forecast" ? "forecast" : "observed";
      state.suppressNextMapClick = true;
      openPointChart(point);
      window.setTimeout(() => {
        state.suppressNextMapClick = false;
      }, 500);
    }
  }
}

els.canvas.addEventListener("pointerup", endMapTouch);
els.canvas.addEventListener("pointercancel", endMapTouch);

els.canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const [x, y] = canvasPosition(event);
  zoomAt(x, y, event.deltaY < 0 ? 1.22 : 1 / 1.22);
}, { passive: false });

els.canvas.addEventListener("click", (event) => {
  if (state.suppressNextMapClick) {
    state.suppressNextMapClick = false;
    return;
  }
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
      const preferredElement = state.observedDailySequence === "min" ? "min" : "max";
      state.slotIndex = latestObservedSlotIndex(preferredElement);
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
    const preferredElement = state.observedDailySequence === "min" ? "min" : "max";
    state.slotIndex = latestObservedSlotIndex(preferredElement);
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

els.observedDailySequenceButtons?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-daily-sequence]");
  if (!button) return;
  const sequence = button.dataset.dailySequence;
  if (!["both", "max", "min"].includes(sequence) || sequence === state.observedDailySequence) return;
  const currentSlot = currentObservedSlot();
  state.observedDailySequence = sequence;
  if (sequence !== "both" && currentSlot?.element !== sequence) {
    const sameDateIndex = state.observedSlots.findIndex((slot) => slot.target_date === currentSlot?.target_date && slot.element === sequence);
    state.slotIndex = sameDateIndex >= 0 ? sameDateIndex : latestObservedSlotIndex(sequence);
    state.element = currentObservedSlot()?.element || sequence;
    els.elementSelect.value = state.element;
  }
  syncObservedDailySequenceControl();
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
  if (state.source === "observed" && isSuikeiObservedLayer()) {
    state.suikeiSlotIndex = Math.max(0, Math.min(Number(els.timelineRange.value), suikeiSlots().length - 1));
    syncTimelineFromElement();
    clearTimeout(suikeiTimelineLoadTimer);
    suikeiTimelineLoadTimer = setTimeout(() => {
      suikeiTimelineLoadTimer = null;
      loadData();
    }, SUIKEI_TIMELINE_DEBOUNCE_MS);
    return;
  }
  setElementFromTimeline(els.timelineRange.value);
});

els.timelineBottom.addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeline-index]");
  if (!button) return;
  clearTimeout(suikeiTimelineLoadTimer);
  suikeiTimelineLoadTimer = null;
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

document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, select, textarea"))) return;
  const timeline = document.querySelector(".map-timeline");
  if (!timeline || timeline.hidden || els.timelineRange.disabled) return;
  const delta = event.key === "ArrowLeft" ? -1 : 1;
  const current = Number(els.timelineRange.value);
  const nextValue = Math.max(Number(els.timelineRange.min), Math.min(Number(els.timelineRange.max), current + delta));
  if (nextValue === current) return;
  event.preventDefault();
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

function syncMapLayerControls() {
  els.tooltipToggle.checked = state.showTooltip;
  els.detailMapToggle.checked = state.showDetailMap;
  els.detailMapOpacityRange.value = String(Math.round(state.detailMapOpacity * 100));
  els.detailMapOpacityValue.value = `${Math.round(state.detailMapOpacity * 100)}%`;
  els.detailMapOpacityRange.disabled = !state.showDetailMap;
  els.terrainToggle.checked = state.showTerrain;
  els.terrainStyleSelect.value = state.terrainStyle;
  els.terrainStyleSelect.disabled = !state.showTerrain;
  els.weatherOpacityRange.value = String(Math.round(state.weatherOpacity * 100));
  els.weatherOpacityValue.value = `${Math.round(state.weatherOpacity * 100)}%`;
  els.terrainOpacityRange.value = String(Math.round(state.terrainOpacity * 100));
  els.terrainOpacityValue.value = `${Math.round(state.terrainOpacity * 100)}%`;
  els.terrainOpacityRange.disabled = !state.showTerrain;
  syncWeatherMapControls();
}

els.tooltipToggle.addEventListener("change", () => {
  state.showTooltip = els.tooltipToggle.checked;
  if (!state.showTooltip) els.tooltip.hidden = true;
  draw();
});
els.detailMapToggle.addEventListener("change", () => { state.showDetailMap = els.detailMapToggle.checked; syncMapLayerControls(); draw(); });
els.detailMapOpacityRange.addEventListener("input", () => { state.detailMapOpacity = Number(els.detailMapOpacityRange.value) / 100; syncMapLayerControls(); draw(); });
els.terrainToggle.addEventListener("change", () => { state.showTerrain = els.terrainToggle.checked; syncMapLayerControls(); draw(); });
els.terrainStyleSelect.addEventListener("change", () => { state.terrainStyle = els.terrainStyleSelect.value; draw(); });
els.weatherOpacityRange.addEventListener("input", () => { state.weatherOpacity = Number(els.weatherOpacityRange.value) / 100; syncMapLayerControls(); draw(); });
els.terrainOpacityRange.addEventListener("input", () => { state.terrainOpacity = Number(els.terrainOpacityRange.value) / 100; syncMapLayerControls(); draw(); });
els.weatherMapButton?.addEventListener("change", async () => {
  state.showWeatherMap = els.weatherMapButton.checked;
  syncWeatherMapControls();
  if (state.showWeatherMap) await loadWeatherMapImage();
  else draw();
});
els.weatherMapKindSelect?.addEventListener("change", async () => {
  state.weatherMapKind = els.weatherMapKindSelect.value;
  state.weatherMapImage = null;
  state.weatherMapImageKey = "";
  await loadWeatherMapImage();
});
els.weatherMapTimeSelect?.addEventListener("change", async () => {
  state.weatherMapNowIndex = Number(els.weatherMapTimeSelect.value);
  state.weatherMapImage = null;
  state.weatherMapImageKey = "";
  await loadWeatherMapImage();
});
els.weatherMapOpacityRange?.addEventListener("input", () => {
  state.weatherMapOpacity = Number(els.weatherMapOpacityRange.value) / 100;
  syncWeatherMapControls();
  draw();
});

els.recordMarkersButton?.addEventListener("click", () => {
  if (els.recordMarkersButton.disabled) return;
  state.showRecordMarkers = !state.showRecordMarkers;
  updateRankingPanel();
});

els.rankingPanelButton?.addEventListener("click", () => {
  if (els.rankingPanelButton.disabled) return;
  const opening = !state.showRankingPanel;
  state.showRankingPanel = opening;
  if (opening && state.source === "observed" && state.observedLayer === "daily") {
    const changed = selectLatestObservedDailySlot();
    if (changed) loadData();
  }
  updateRankingPanel();
});

els.dailyMaxRaceCloseButton?.addEventListener("click", closeDailyMaxRaceModal);
els.dailyMaxRaceRefreshButton?.addEventListener("click", refreshDailyMaxRaceData);
els.dailyMaxRaceShareUrlButton?.addEventListener("click", copyDailyMaxRaceShareUrl);
els.dailyMaxRaceShareImageButton?.addEventListener("click", copyDailyMaxRaceShareImage);
els.dailyMaxRaceVideoButton?.addEventListener("click", () => {
  setDailyMaxRaceVideoPanel(els.dailyMaxRaceVideoPanel?.hidden);
});
els.dailyMaxRaceVideoCloseButton?.addEventListener("click", () => setDailyMaxRaceVideoPanel(false));
els.dailyMaxRaceVideoFormatSelect?.addEventListener("change", () => {
  state.dailyMaxRaceVideoFormat = dailyMaxRaceVideoFormat(els.dailyMaxRaceVideoFormatSelect.value).id;
  els.dailyMaxRaceVideoFormatSelect.value = state.dailyMaxRaceVideoFormat;
  updateDailyMaxRaceVideoMeta();
});
els.dailyMaxRaceVideoStartSelect?.addEventListener("change", () => {
  const frames = state.dailyMaxRace?.frames || [];
  state.dailyMaxRaceVideoStartIndex = Math.max(0, Math.min(Number(els.dailyMaxRaceVideoStartSelect.value) || 0, Math.max(0, frames.length - 1)));
  if (state.dailyMaxRaceVideoEndIndex < state.dailyMaxRaceVideoStartIndex) {
    state.dailyMaxRaceVideoEndIndex = state.dailyMaxRaceVideoStartIndex;
    els.dailyMaxRaceVideoEndSelect.value = String(state.dailyMaxRaceVideoEndIndex);
  }
  updateDailyMaxRaceVideoMeta();
});
els.dailyMaxRaceVideoEndSelect?.addEventListener("change", () => {
  const frames = state.dailyMaxRace?.frames || [];
  state.dailyMaxRaceVideoEndIndex = Math.max(0, Math.min(Number(els.dailyMaxRaceVideoEndSelect.value) || 0, Math.max(0, frames.length - 1)));
  if (state.dailyMaxRaceVideoStartIndex > state.dailyMaxRaceVideoEndIndex) {
    state.dailyMaxRaceVideoStartIndex = state.dailyMaxRaceVideoEndIndex;
    els.dailyMaxRaceVideoStartSelect.value = String(state.dailyMaxRaceVideoStartIndex);
  }
  updateDailyMaxRaceVideoMeta();
});
els.dailyMaxRaceVideoExportButton?.addEventListener("click", exportDailyMaxRaceVideo);
els.dailyMaxRaceBackdrop?.addEventListener("click", (event) => {
  if (event.target === els.dailyMaxRaceBackdrop) closeDailyMaxRaceModal();
});
els.dailyMaxRaceModal?.addEventListener("keydown", trapDailyMaxRaceFocus);
els.dailyMaxRacePlayButton?.addEventListener("click", () => {
  setDailyMaxRacePlaying(!state.dailyMaxRacePlaying);
});
els.dailyMaxRaceRestartButton?.addEventListener("click", () => {
  setDailyMaxRacePlaying(false);
  state.dailyMaxRaceFrameIndex = 0;
  renderDailyMaxRaceFrame(true);
});
els.dailyMaxRaceStepBackButton?.addEventListener("click", () => {
  stepDailyMaxRaceFrame(-1);
});
els.dailyMaxRaceStepForwardButton?.addEventListener("click", () => {
  stepDailyMaxRaceFrame(1);
});
els.dailyMaxRaceLatestButton?.addEventListener("click", () => {
  setDailyMaxRacePlaying(false);
  state.dailyMaxRaceFrameIndex = Math.max(0, (state.dailyMaxRace?.frames?.length || 1) - 1);
  renderDailyMaxRaceFrame(true);
});
els.dailyMaxRaceRange?.addEventListener("input", () => {
  setDailyMaxRacePlaying(false);
  state.dailyMaxRaceFrameIndex = Number(els.dailyMaxRaceRange.value) || 0;
  renderDailyMaxRaceFrame(true);
});
els.dailyMaxRaceSpeedSelect?.addEventListener("change", () => {
  state.dailyMaxRaceSpeed = Number(els.dailyMaxRaceSpeedSelect.value) || 1;
  if (state.dailyMaxRacePlaying) scheduleDailyMaxRaceFrame();
  updateDailyMaxRaceVideoMeta();
});
els.dailyMaxRaceCountSelect?.addEventListener("change", () => {
  state.dailyMaxRaceVisibleCount = Number(els.dailyMaxRaceCountSelect.value) || 20;
  renderDailyMaxRaceFrame(true);
  updateDailyMaxRaceVideoMeta();
});
els.dailyMaxRaceDateSelect?.addEventListener("change", async () => {
  setDailyMaxRacePlaying(false);
  const previousDate = state.dailyMaxRaceDate;
  const nextDate = els.dailyMaxRaceDateSelect.value;
  try {
    if (state.dailyMaxRaceIndex) {
      await loadDailyMaxRaceSlice(nextDate, state.dailyMaxRaceElement);
    }
    state.dailyMaxRaceDate = nextDate;
    activateDailyMaxRaceSelection();
    renderDailyMaxRaceFrame(true);
  } catch {
    state.dailyMaxRaceDate = previousDate;
    els.dailyMaxRaceDateSelect.value = previousDate;
  }
});
els.dailyMaxRaceElementSwitch?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-race-element]");
  if (!button || button.disabled) return;
  setDailyMaxRacePlaying(false);
  const previousElement = state.dailyMaxRaceElement;
  const nextElement = button.dataset.raceElement;
  try {
    if (state.dailyMaxRaceIndex) {
      await loadDailyMaxRaceSlice(state.dailyMaxRaceDate, nextElement);
    }
    state.dailyMaxRaceElement = nextElement;
    activateDailyMaxRaceSelection();
    renderDailyMaxRaceFrame(true);
  } catch {
    state.dailyMaxRaceElement = previousElement;
  }
});

els.fullRankingCloseButton?.addEventListener("click", closeFullRankingModal);
els.fullRankingRefreshButton?.addEventListener("click", refreshFullRankingData);
els.fullRankingShareUrlButton?.addEventListener("click", copyFullRankingShareUrl);
els.fullRankingShareImageButton?.addEventListener("click", copyFullRankingShareImage);
els.fullRankingBackdrop?.addEventListener("click", (event) => {
  if (event.target === els.fullRankingBackdrop) closeFullRankingModal();
});
els.fullRankingModal?.addEventListener("keydown", trapFullRankingFocus);
els.fullRankingElementSwitch?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-full-ranking-element]");
  if (!button || button.disabled) return;
  void activateFullRankingSelection(
    state.fullRankingDate,
    button.dataset.fullRankingElement === "min" ? "min" : "max",
  );
});
els.fullRankingDateSelect?.addEventListener("change", () => {
  selectFullRankingDate(els.fullRankingDateSelect.value);
});
els.fullRankingDateNavigation?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-full-ranking-date-action]");
  if (!button || button.disabled) return;
  moveFullRankingDate(button.dataset.fullRankingDateAction);
});
els.fullRankingSearchInput?.addEventListener("input", updateFullRankingSearchSuggestions);
els.fullRankingSearchInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const first = els.fullRankingSearchSuggestions?.querySelector("[data-station-key]");
  if (!first) return;
  event.preventDefault();
  locateFullRankingStation(first.dataset.stationKey);
});
els.fullRankingSearchClearButton?.addEventListener("click", () => clearFullRankingSearch({ keepFocus: true }));
els.fullRankingSearchSuggestions?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-station-key]");
  if (!button) return;
  locateFullRankingStation(button.dataset.stationKey);
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
  if (state.source === "observed" && state.observedLayer === "daily") {
    url.searchParams.set("dailySequence", state.observedDailySequence);
  }
  url.searchParams.set("mode", state.mode);
  url.searchParams.set("period", state.period);
  url.searchParams.set("labels", state.showPlaceLabels ? "1" : "0");
  url.searchParams.set("tooltip", state.showTooltip ? "1" : "0");
  url.searchParams.set("detail", state.showDetailMap ? "1" : "0");
  url.searchParams.set("detailOpacity", String(Math.round(state.detailMapOpacity * 100)));
  url.searchParams.set("terrain", state.showTerrain ? "1" : "0");
  url.searchParams.set("terrainStyle", state.terrainStyle);
  url.searchParams.set("weatherOpacity", String(Math.round(state.weatherOpacity * 100)));
  url.searchParams.set("terrainOpacity", String(Math.round(state.terrainOpacity * 100)));
  url.searchParams.set("weatherMap", state.showWeatherMap ? "1" : "0");
  url.searchParams.set("weatherMapKind", state.weatherMapKind);
  url.searchParams.set("weatherMapOpacity", String(Math.round(state.weatherMapOpacity * 100)));
  return url.toString();
}

function dailyMaxRaceDisplayedFrameIndex(payload = state.dailyMaxRace) {
  const frameCount = Number(payload?.frames?.length) || 0;
  if (!frameCount) return 0;
  const displayedIndex = Number(els.dailyMaxRaceRange?.value);
  const candidate = Number.isFinite(displayedIndex) ? displayedIndex : state.dailyMaxRaceFrameIndex;
  return Math.max(0, Math.min(Math.round(candidate), frameCount - 1));
}

function dailyMaxRaceShareUrl() {
  const url = new URL(shareUrl());
  const frame = state.dailyMaxRace?.frames?.[dailyMaxRaceDisplayedFrameIndex()];
  url.searchParams.set("source", "observed");
  url.searchParams.set("layer", "daily");
  url.searchParams.set("view", "race");
  url.searchParams.set("raceDate", state.dailyMaxRaceDate || state.dailyMaxRace?.date || "");
  url.searchParams.set("raceElement", state.dailyMaxRaceElement === "min" ? "min" : "max");
  if (frame?.time) url.searchParams.set("raceTime", frame.time);
  url.searchParams.set("raceCount", String(state.dailyMaxRaceVisibleCount));
  url.searchParams.set("raceSpeed", String(state.dailyMaxRaceSpeed));
  return url.toString();
}

async function writeTextToClipboard(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function setDailyMaxRaceShareStatus(button, status) {
  if (!button) return;
  const isImage = button === els.dailyMaxRaceShareImageButton;
  const labels = isImage
    ? {
      idle: ["画像", "現在のランキング画像をコピー"],
      loading: ["生成中", "ランキング画像を生成中"],
      copied: ["コピー済", "ランキング画像をコピーしました"],
      saved: ["PNG保存", "画像コピー非対応のためPNGを保存しました"],
      error: ["失敗", "ランキング画像をコピーできませんでした"],
    }
    : {
      idle: ["共有URL", "このランキング画面の共有URLをコピー"],
      loading: ["コピー中", "共有URLをコピー中"],
      copied: ["コピー済", "共有URLをコピーしました"],
      error: ["失敗", "共有URLをコピーできませんでした"],
    };
  const [text, label] = labels[status] || labels.idle;
  window.clearTimeout(button._raceShareResetTimer);
  button.dataset.status = status;
  button.disabled = status === "loading";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.querySelector(".race-share-text").textContent = text;
  if (!["idle", "loading"].includes(status)) {
    button._raceShareResetTimer = window.setTimeout(() => {
      setDailyMaxRaceShareStatus(button, "idle");
    }, 2400);
  }
}

async function copyDailyMaxRaceShareUrl() {
  const button = els.dailyMaxRaceShareUrlButton;
  if (!button || !state.dailyMaxRace?.frames?.length) return;
  setDailyMaxRaceShareStatus(button, "loading");
  const copied = await writeTextToClipboard(dailyMaxRaceShareUrl());
  setDailyMaxRaceShareStatus(button, copied ? "copied" : "error");
}

function fitDailyMaxRaceCanvasText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  let fitted = value;
  while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1);
  return `${fitted}…`;
}

function roundDailyMaxRaceCanvasRect(ctx, x, y, width, height, radius = 6) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
}

function strokeDailyMaxRaceCanvasBarOutline(ctx, station, lineWidth = 2.2) {
  const outline = dailyMaxRaceOutlineColor(station);
  if (outline === "transparent") return false;
  ctx.save();
  ctx.strokeStyle = outline;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.restore();
  return true;
}

function createDailyMaxRaceShareCanvas(options = {}) {
  const payload = state.dailyMaxRace;
  if (!payload?.frames?.length) throw new Error("ランキングデータがありません。");
  const requestedFrameIndex = Number(options.frameIndex);
  const frameIndex = Number.isInteger(requestedFrameIndex)
    ? Math.max(0, Math.min(requestedFrameIndex, payload.frames.length - 1))
    : dailyMaxRaceDisplayedFrameIndex(payload);
  const frame = payload.frames[frameIndex];
  const selectedCount = Math.max(10, Math.min(Number(state.dailyMaxRaceVisibleCount) || 25, frame.rows.length, Number(payload.top_n) || 100));
  const exportCount = Math.max(1, Math.min(Number(options.exportCount) || 25, selectedCount));
  const rows = Array.isArray(options.rows) ? options.rows : frame.rows.slice(0, exportCount);
  const domain = options.domain || dailyMaxRaceAxisDomain(frame.rows.slice(0, exportCount));
  const domainSpan = Math.max(0.1, domain.maximum - domain.minimum);
  const designWidth = 1600;
  const designHeight = 900;
  const outputWidth = Math.max(1, Math.round(Number(options.outputWidth) || designWidth));
  const outputHeight = Math.max(1, Math.round(Number(options.outputHeight) || designHeight));
  const canvas = options.canvas || document.createElement("canvas");
  if (canvas.width !== outputWidth) canvas.width = outputWidth;
  if (canvas.height !== outputHeight) canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を生成できません。");
  ctx.setTransform(outputWidth / designWidth, 0, 0, outputHeight / designHeight, 0, 0);
  const isMinimum = state.dailyMaxRaceElement === "min";
  const accent = isMinimum ? "#2f78b5" : "#b94b29";
  const accentDark = isMinimum ? "#245f91" : "#95391f";
  const accentPale = isMinimum ? "#e7f3fb" : "#fff0e7";
  // Export the tool surface itself. Do not add the dark browser/modal backdrop
  // that surrounds the live screen: the copied PNG should be ready to publish
  // without a second crop operation.
  const outer = { x: 0, y: 0, width: 1600, height: 900 };
  const headerBottom = 84;
  const legendBottom = 118;
  const progressBottom = 171;
  const footerTop = 854;
  const clockLeft = 1330;
  const chartLeft = 294;
  const chartRight = 1110;
  const chartWidth = chartRight - chartLeft;
  const rowsTop = 207;
  const rowsBottom = footerTop - 6;
  const rowHeight = Math.min(26, (rowsBottom - rowsTop) / Math.max(1, exportCount));
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif';

  function fillRoundedRect(x, y, width, height, radius, color) {
    roundDailyMaxRaceCanvasRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function strokeRoundedRect(x, y, width, height, radius, color, lineWidth = 1) {
    roundDailyMaxRaceCanvasRect(ctx, x, y, width, height, radius);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function drawControl(x, y, width, height, label, options = {}) {
    const { active = false, muted = false, fontSize = 13, align = "center" } = options;
    fillRoundedRect(x, y, width, height, 7, active ? accent : muted ? "#f3f5f7" : "rgba(255,255,255,0.92)");
    strokeRoundedRect(x, y, width, height, 7, active ? accentDark : "#bcc8d2", 1.2);
    ctx.fillStyle = active ? "#fff" : muted ? "#9ca7b1" : "#273441";
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(label, align === "left" ? x + 11 : x + width / 2, y + height / 2 + 0.5);
  }

  function drawClock(cx, cy, radius, timeLabel) {
    const [hourText = "0", minuteText = "0"] = timeLabel.split(":");
    const hour = Number(hourText) || 0;
    const minute = Number(minuteText) || 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    for (let index = 0; index < 12; index += 1) {
      const angle = index * Math.PI / 6 - Math.PI / 2;
      const inner = radius - (index % 3 === 0 ? 7 : 4);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * (radius - 2), cy + Math.sin(angle) * (radius - 2));
      ctx.strokeStyle = index % 3 === 0 ? accent : `${accent}88`;
      ctx.lineWidth = index % 3 === 0 ? 1.8 : 1;
      ctx.stroke();
    }
    const hourAngle = ((hour % 12) + minute / 60) * Math.PI / 6 - Math.PI / 2;
    const minuteAngle = minute * Math.PI / 30 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(hourAngle) * radius * 0.47, cy + Math.sin(hourAngle) * radius * 0.47);
    ctx.strokeStyle = "#23303c";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(minuteAngle) * radius * 0.68, cy + Math.sin(minuteAngle) * radius * 0.68);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.restore();
    const period = hour < 12 ? "AM" : "PM";
    fillRoundedRect(cx + radius - 12, cy + radius - 8, 30, 16, 8, "rgba(255,255,255,0.96)");
    strokeRoundedRect(cx + radius - 12, cy + radius - 8, 30, 16, 8, `${accent}66`, 1);
    ctx.fillStyle = accentDark;
    ctx.font = `900 8px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(period, cx + radius + 3, cy + radius);
  }

  ctx.save();
  roundDailyMaxRaceCanvasRect(ctx, outer.x, outer.y, outer.width, outer.height, 0);
  ctx.clip();
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(outer.x, outer.y, outer.width, outer.height);

  const headerGradient = ctx.createLinearGradient(outer.x, outer.y, outer.x + outer.width, outer.y);
  headerGradient.addColorStop(0, "#ffffff");
  headerGradient.addColorStop(0.58, isMinimum ? "#f7fbff" : "#fffaf5");
  headerGradient.addColorStop(1, isMinimum ? "#e5f3fc" : "#ffeadc");
  ctx.fillStyle = headerGradient;
  ctx.fillRect(outer.x, outer.y, outer.width, headerBottom - outer.y);
  ctx.strokeStyle = isMinimum ? "#d4e5f2" : "#e8ddd5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(outer.x, headerBottom);
  ctx.lineTo(outer.x + outer.width, headerBottom);
  ctx.stroke();

  fillRoundedRect(34, 31, 52, 27, 13.5, accent);
  ctx.fillStyle = "#fff";
  ctx.font = `950 11px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("実況", 60, 45);
  ctx.fillStyle = "#17212b";
  ctx.font = `950 31px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText(`${isMinimum ? "最低" : "最高"}気温ランキング`, 98, 47);

  fillRoundedRect(406, 27, 94, 35, 8, "#eef2f5");
  strokeRoundedRect(406, 27, 94, 35, 8, "#c5d0d9", 1);
  fillRoundedRect(isMinimum ? 453 : 409, 30, 44, 29, 6, accent);
  ctx.font = `900 10px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isMinimum ? "#5c6976" : "#fff";
  ctx.fillText("最高", 431, 44.5);
  ctx.fillStyle = isMinimum ? "#fff" : "#5c6976";
  ctx.fillText("最低", 475, 44.5);

  fillRoundedRect(513, 25, 230, 39, 7, isMinimum ? "#edf7ff" : "#fff4ec");
  ctx.fillStyle = accent;
  ctx.fillRect(513, 25, 5, 39);
  ctx.fillStyle = accentDark;
  ctx.font = `950 21px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText(dailyMaxRaceDateLabel(payload.date), 530, 45);
  ctx.beginPath();
  ctx.moveTo(720, 40);
  ctx.lineTo(726, 46);
  ctx.lineTo(732, 40);
  ctx.strokeStyle = accentDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const toolbarY = 26;
  const toolbarH = 38;
  drawControl(830, toolbarY, 40, toolbarH, "|←", { muted: frameIndex === 0, fontSize: 12 });
  drawControl(870, toolbarY, 58, toolbarH, "−10分", { muted: frameIndex === 0, fontSize: 11 });
  const canvasPlaying = options.playing === undefined ? state.dailyMaxRacePlaying : Boolean(options.playing);
  drawControl(928, toolbarY, 82, toolbarH, canvasPlaying ? "Ⅱ 一時停止" : "▶ 再生", { active: true, fontSize: 11 });
  drawControl(1010, toolbarY, 58, toolbarH, "＋10分", { muted: frameIndex === payload.frames.length - 1, fontSize: 11 });
  drawControl(1068, toolbarY, 40, toolbarH, "→|", { muted: frameIndex === payload.frames.length - 1, fontSize: 12 });
  drawControl(1120, toolbarY, 78, toolbarH, `${state.dailyMaxRaceSpeed}倍`, { fontSize: 12 });
  drawControl(1208, toolbarY, 132, toolbarH, `上位${exportCount}地点`, { fontSize: 12 });
  drawControl(1350, toolbarY, 76, toolbarH, "↻ 更新", { fontSize: 11 });
  drawControl(1500, 24, 56, 42, "×", { fontSize: 25 });

  ctx.fillStyle = "#fff";
  ctx.fillRect(outer.x, headerBottom, outer.width, legendBottom - headerBottom);
  ctx.strokeStyle = "#e2e8ed";
  ctx.beginPath();
  ctx.moveTo(outer.x, legendBottom);
  ctx.lineTo(outer.x + outer.width, legendBottom);
  ctx.stroke();
  const legendY = 101;
  DAILY_MAX_RACE_REGIONS.forEach((region, index) => {
    const x = 38 + index * 82;
    ctx.beginPath();
    ctx.arc(x, legendY, 6, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${region.hue} ${region.saturation}% ${region.lightness}%)`;
    ctx.fill();
    if (region.outline) {
      ctx.strokeStyle = region.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = "#42505e";
    ctx.font = `850 10px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(region.label, x + 10, legendY);
  });

  ctx.fillStyle = isMinimum ? "#f4f9fd" : "#f7f9fa";
  ctx.fillRect(outer.x, legendBottom, outer.width, progressBottom - legendBottom);
  ctx.strokeStyle = isMinimum ? "#d7e6f1" : "#dfe5ea";
  ctx.beginPath();
  ctx.moveTo(outer.x, progressBottom);
  ctx.lineTo(outer.x + outer.width, progressBottom);
  ctx.stroke();
  const timeLabel = dailyMaxRaceTimeLabel(frame.time);
  ctx.fillStyle = accentDark;
  ctx.font = `950 27px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(timeLabel, 34, 142);
  const sliderX = 146;
  const sliderY = 136;
  const sliderWidth = 1124;
  const frameDenominator = Math.max(1, payload.frames.length - 1);
  ctx.strokeStyle = "#b7c0c8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sliderX, sliderY);
  ctx.lineTo(sliderX + sliderWidth, sliderY);
  ctx.stroke();
  payload.frames.forEach((candidateFrame, candidateIndex) => {
    const candidateLabel = dailyMaxRaceTimeLabel(candidateFrame.time);
    const candidateMinute = Number(candidateLabel.split(":")[1]);
    const isHour = candidateMinute === 0;
    const x = sliderX + candidateIndex / frameDenominator * sliderWidth;
    ctx.strokeStyle = isHour ? `${accent}88` : "rgba(95,109,122,0.26)";
    ctx.lineWidth = isHour ? 1.2 : 0.8;
    ctx.beginPath();
    ctx.moveTo(x, sliderY + 6);
    ctx.lineTo(x, sliderY + (isHour ? 18 : 12));
    ctx.stroke();
    if (isHour) {
      ctx.fillStyle = "#72808e";
      ctx.font = `800 7px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(Number(candidateLabel.split(":")[0])), x, sliderY + 19);
    }
  });
  const progressRatio = Number.isFinite(Number(options.progressRatio))
    ? Math.max(0, Math.min(1, Number(options.progressRatio)))
    : frameIndex / frameDenominator;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sliderX, sliderY);
  ctx.lineTo(sliderX + progressRatio * sliderWidth, sliderY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sliderX + progressRatio * sliderWidth, sliderY, 9, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  drawControl(1284, 125, 82, 34, "↗ 共有URL", { fontSize: 10 });
  drawControl(1374, 125, 82, 34, "▧ 画像", { fontSize: 10 });
  drawControl(1464, 125, 82, 34, "▶ 動画", { fontSize: 10, active: Boolean(options.videoExporting) });

  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(outer.x, progressBottom, outer.width, footerTop - progressBottom);

  const panelGradient = ctx.createLinearGradient(clockLeft, progressBottom, outer.x + outer.width, footerTop);
  panelGradient.addColorStop(0, isMinimum ? "#f7fbff" : "#fffaf6");
  panelGradient.addColorStop(1, isMinimum ? "#edf7fd" : "#fff1e9");
  ctx.fillStyle = panelGradient;
  ctx.fillRect(clockLeft, progressBottom, outer.x + outer.width - clockLeft, footerTop - progressBottom);
  ctx.strokeStyle = isMinimum ? "#d8e7f2" : "#eadfd8";
  ctx.beginPath();
  ctx.moveTo(clockLeft, progressBottom);
  ctx.lineTo(clockLeft, footerTop);
  ctx.stroke();

  const brandX = clockLeft + 23;
  const brandY = 200;
  fillRoundedRect(brandX, brandY, 34, 34, 8, accent);
  ctx.fillStyle = "#fff";
  ctx.font = `950 11px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NW", brandX + 17, brandY + 17);
  ctx.fillStyle = "#21303c";
  ctx.font = `950 18px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText("NatureWxLab", brandX + 45, brandY + 13);
  ctx.fillStyle = "#687786";
  ctx.font = `850 10px ${fontFamily}`;
  ctx.fillText("天気分布予報プラス", brandX + 45, brandY + 29);
  ctx.strokeStyle = `${accent}55`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(brandX, 250);
  ctx.lineTo(outer.x + outer.width - 23, 250);
  ctx.stroke();

  const clockCenterX = clockLeft + 74;
  const clockCenterY = 385;
  drawClock(clockCenterX, clockCenterY, 26, timeLabel);
  ctx.fillStyle = accentDark;
  ctx.font = `950 23px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(dailyMaxRaceDateLabel(payload.date).replace(/^\d{4}年/, ""), clockCenterX + 44, clockCenterY);
  const [shareHour = "--", shareMinute = "--"] = timeLabel.split(":");
  ctx.fillStyle = "#17212b";
  ctx.font = `950 58px ${fontFamily}`;
  ctx.textAlign = "right";
  ctx.fillText(shareHour, clockLeft + 126, 469);
  ctx.fillStyle = accent;
  ctx.font = `950 43px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText(":", clockLeft + 135, 468);
  ctx.fillStyle = "#17212b";
  ctx.font = `950 58px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText(shareMinute, clockLeft + 146, 469);
  ctx.strokeStyle = "#d6dfe5";
  ctx.beginPath();
  ctx.moveTo(clockLeft + 34, 510);
  ctx.lineTo(clockLeft + 82, 510);
  ctx.moveTo(clockLeft + 174, 510);
  ctx.lineTo(clockLeft + 222, 510);
  ctx.stroke();
  ctx.fillStyle = "#677583";
  ctx.font = `900 11px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText(`までの${isMinimum ? "最低" : "最高"}`, clockLeft + 128, 510);
  fillRoundedRect(clockLeft + 70, 541, 116, 34, 17, "rgba(255,255,255,0.9)");
  strokeRoundedRect(clockLeft + 70, 541, 116, 34, 17, `${accent}55`, 1.2);
  ctx.fillStyle = accentDark;
  ctx.font = `900 11px ${fontFamily}`;
  ctx.fillText(`${domain.minimum.toFixed(1)}〜${domain.maximum.toFixed(1)}℃`, clockLeft + 128, 558);

  fillRoundedRect(clockLeft + 22, 660, 212, 116, 11, "rgba(255,255,255,0.72)");
  strokeRoundedRect(clockLeft + 22, 660, 212, 116, 11, `${accent}42`, 1.2);
  fillRoundedRect(clockLeft + 42, 676, 104, 19, 9.5, accentPale);
  ctx.fillStyle = accentDark;
  ctx.font = `950 8px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText("10 MINUTE LIVE RACE", clockLeft + 94, 685.5);
  ctx.fillStyle = "#536271";
  ctx.font = `850 13px ${fontFamily}`;
  ctx.fillText("10分ごとに追う", clockLeft + 128, 718);
  ctx.fillStyle = "#1d2a35";
  ctx.font = `950 17px ${fontFamily}`;
  ctx.fillText(`全国${isMinimum ? "最低" : "最高"}気温ランキング`, clockLeft + 128, 747);
  ctx.fillStyle = "#7a8793";
  ctx.font = `800 9px ${fontFamily}`;
  ctx.fillText("naturewxlab.com", clockLeft + 128, 793);

  const firstTick = Math.ceil(domain.minimum - 0.0001);
  const lastTick = Math.floor(domain.maximum + 0.0001);
  for (let value = firstTick; value <= lastTick; value += 1) {
    const x = chartLeft + ((value - domain.minimum) / domainSpan) * chartWidth;
    ctx.strokeStyle = "rgba(91, 108, 124, 0.20)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 202);
    ctx.lineTo(x, rowsBottom);
    ctx.stroke();
    ctx.fillStyle = "#667585";
    ctx.font = `850 12px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${value}℃`, x, 194);
  }

  rows.forEach(([rawStationKey, rawValue, rawVisualRank, rawDisplayRank], rankIndex) => {
    const stationKey = String(rawStationKey);
    const value = Number(rawValue);
    const visualRank = Number.isFinite(Number(rawVisualRank)) ? Number(rawVisualRank) : rankIndex;
    const displayRank = Number.isFinite(Number(rawDisplayRank)) ? Number(rawDisplayRank) : rankIndex;
    const station = payload.stations[stationKey] || {};
    const region = dailyMaxRaceRegion(station);
    const placeLabel = `${station.prefecture || region.label}｜${station.name || stationKey}`;
    const color = dailyMaxRaceColor(station);
    const y = rowsTop + visualRank * rowHeight;
    const centerY = y + rowHeight / 2;
    const trackHeight = Math.max(10, rowHeight - 6);
    const trackY = centerY - trackHeight / 2;
    const barWidth = Math.max(2, Math.min(chartWidth, ((value - domain.minimum) / domainSpan) * chartWidth));

    ctx.fillStyle = displayRank < 3 ? accent : "#485665";
    ctx.font = `950 ${Math.max(11, rowHeight - 11)}px ${fontFamily}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(displayRank + 1), 52, centerY);

    roundDailyMaxRaceCanvasRect(ctx, 68, trackY - 1, 212, trackHeight + 2, 5);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    const outline = dailyMaxRaceOutlineColor(station);
    ctx.strokeStyle = outline === "transparent" ? color : outline;
    ctx.globalAlpha = outline === "transparent" ? 0.42 : 0.9;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#111c26";
    ctx.font = `850 ${Math.max(10, rowHeight - 12)}px ${fontFamily}`;
    ctx.textAlign = "right";
    ctx.fillText(fitDailyMaxRaceCanvasText(ctx, placeLabel, 196), 271, centerY);

    roundDailyMaxRaceCanvasRect(ctx, chartLeft, trackY, chartWidth, trackHeight, 4);
    ctx.fillStyle = "#eef1f4";
    ctx.fill();
    roundDailyMaxRaceCanvasRect(ctx, chartLeft, trackY, barWidth, trackHeight, 4);
    ctx.fillStyle = color;
    ctx.fill();
    strokeDailyMaxRaceCanvasBarOutline(ctx, station);

    ctx.fillStyle = displayRank < 3 ? accent : "#24313e";
    ctx.font = `900 ${Math.max(10, rowHeight - 12)}px ${fontFamily}`;
    ctx.textAlign = "left";
    const valueLabelX = chartLeft + barWidth + 8;
    const valueLabelWidth = Math.max(80, clockLeft - valueLabelX - 12);
    ctx.fillText(fitDailyMaxRaceCanvasText(ctx, `${placeLabel}（${value.toFixed(1)}℃）`, valueLabelWidth), valueLabelX, centerY);
  });

  ctx.fillStyle = "#fff";
  ctx.fillRect(outer.x, footerTop, outer.width, outer.y + outer.height - footerTop);
  ctx.strokeStyle = "#d9e1e8";
  ctx.beginPath();
  ctx.moveTo(outer.x, footerTop);
  ctx.lineTo(outer.x + outer.width, footerTop);
  ctx.stroke();
  ctx.fillStyle = "#435160";
  ctx.font = `850 10px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`全国${Number(payload.eligible_station_count || payload.station_population).toLocaleString()}地点 / TOP${Number(payload.top_n) || 100} / 画像表示TOP${exportCount} / 10分順位＋公式${isMinimum ? "最低" : "最高"}気温`, 34, 872);
  ctx.textAlign = "right";
  ctx.fillText("順位はアメダス10分値。気象庁公表の日極値は観測時分以後へ反映。更新遅れあり・欠測補間なし。 出典：気象庁ホームページ", 1550, 872);
  ctx.restore();
  strokeRoundedRect(outer.x + 0.5, outer.y + 0.5, outer.width - 1, outer.height - 1, 0, "#d8e1e8", 1);
  return canvas;
}

function createDailyMaxRacePortraitCanvas(options = {}) {
  const payload = state.dailyMaxRace;
  if (!payload?.frames?.length) throw new Error("ランキングデータがありません。");
  const requestedFrameIndex = Number(options.frameIndex);
  const frameIndex = Number.isInteger(requestedFrameIndex)
    ? Math.max(0, Math.min(requestedFrameIndex, payload.frames.length - 1))
    : dailyMaxRaceDisplayedFrameIndex(payload);
  const frame = payload.frames[frameIndex];
  const selectedCount = Math.max(10, Math.min(Number(state.dailyMaxRaceVisibleCount) || 25, frame.rows.length, Number(payload.top_n) || 100));
  const exportCount = Math.max(1, Math.min(Number(options.exportCount) || 25, selectedCount));
  const rows = Array.isArray(options.rows) ? options.rows : frame.rows.slice(0, exportCount);
  const domain = options.domain || dailyMaxRaceAxisDomain(frame.rows.slice(0, exportCount));
  const domainSpan = Math.max(0.1, domain.maximum - domain.minimum);
  const designWidth = 900;
  const designHeight = 1600;
  const outputWidth = Math.max(1, Math.round(Number(options.outputWidth) || designWidth));
  const outputHeight = Math.max(1, Math.round(Number(options.outputHeight) || designHeight));
  const canvas = options.canvas || document.createElement("canvas");
  if (canvas.width !== outputWidth) canvas.width = outputWidth;
  if (canvas.height !== outputHeight) canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("縦動画の画像を生成できません。");
  ctx.setTransform(outputWidth / designWidth, 0, 0, outputHeight / designHeight, 0, 0);

  const isMinimum = state.dailyMaxRaceElement === "min";
  const accent = isMinimum ? "#2f78b5" : "#b94b29";
  const accentDark = isMinimum ? "#245f91" : "#95391f";
  const accentPale = isMinimum ? "#e7f3fb" : "#fff0e7";
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif';
  const headerBottom = 112;
  const controlsBottom = 188;
  const progressBottom = 294;
  const legendBottom = 384;
  const axisTop = 400;
  const rowsTop = 440;
  const footerTop = 1490;
  const rankRight = 44;
  const placeLeft = 50;
  const placeWidth = 190;
  const chartLeft = 254;
  const chartRight = 600;
  const chartWidth = chartRight - chartLeft;
  const valueRight = 878;
  const rowsBottom = footerTop - 8;
  const rowHeight = Math.min(42, (rowsBottom - rowsTop) / Math.max(1, exportCount));

  function fillRoundedRect(x, y, width, height, radius, color) {
    roundDailyMaxRaceCanvasRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function strokeRoundedRect(x, y, width, height, radius, color, lineWidth = 1) {
    roundDailyMaxRaceCanvasRect(ctx, x, y, width, height, radius);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function drawPill(x, y, width, height, label, { active = false, fontSize = 16 } = {}) {
    fillRoundedRect(x, y, width, height, height / 2, active ? accent : "#fff");
    strokeRoundedRect(x, y, width, height, height / 2, active ? accentDark : "#bcc8d2", 1.4);
    ctx.fillStyle = active ? "#fff" : "#344250";
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width / 2, y + height / 2 + 0.5);
  }

  ctx.save();
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, 900, 1600);

  const headerGradient = ctx.createLinearGradient(0, 0, 900, 112);
  headerGradient.addColorStop(0, "#fff");
  headerGradient.addColorStop(0.58, isMinimum ? "#f7fbff" : "#fffaf5");
  headerGradient.addColorStop(1, isMinimum ? "#dff0fb" : "#ffe6d6");
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, 900, headerBottom);
  ctx.strokeStyle = isMinimum ? "#d4e5f2" : "#e8ddd5";
  ctx.beginPath();
  ctx.moveTo(0, headerBottom);
  ctx.lineTo(900, headerBottom);
  ctx.stroke();

  fillRoundedRect(24, 22, 58, 58, 12, accent);
  ctx.fillStyle = "#fff";
  ctx.font = `950 18px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NW", 53, 51);
  ctx.fillStyle = "#1b2732";
  ctx.font = `950 31px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText(`${isMinimum ? "最低" : "最高"}気温ランキング`, 102, 45);
  ctx.fillStyle = "#657482";
  ctx.font = `850 15px ${fontFamily}`;
  ctx.fillText("NatureWxLab｜天気分布予報プラス", 102, 73);
  fillRoundedRect(712, 23, 164, 30, 15, accentPale);
  ctx.fillStyle = accentDark;
  ctx.font = `900 13px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText("10 MINUTE LIVE RACE", 794, 38);

  ctx.fillStyle = "#f7f9fb";
  ctx.fillRect(0, headerBottom, 900, controlsBottom - headerBottom);
  ctx.fillStyle = "#17212b";
  ctx.font = `950 25px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(dailyMaxRaceDateLabel(payload.date), 24, 150);
  drawPill(370, 128, 104, 42, "最高", { active: !isMinimum });
  drawPill(484, 128, 104, 42, "最低", { active: isMinimum });
  drawPill(610, 128, 112, 42, `${state.dailyMaxRaceSpeed}倍`);
  drawPill(732, 128, 144, 42, `TOP${exportCount}`);

  ctx.fillStyle = isMinimum ? "#f1f8fd" : "#fff8f3";
  ctx.fillRect(0, controlsBottom, 900, progressBottom - controlsBottom);
  ctx.strokeStyle = isMinimum ? "#d7e6f1" : "#eadfd8";
  ctx.beginPath();
  ctx.moveTo(0, progressBottom);
  ctx.lineTo(900, progressBottom);
  ctx.stroke();
  const timeLabel = dailyMaxRaceTimeLabel(frame.time);
  ctx.fillStyle = accentDark;
  ctx.font = `950 48px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText(timeLabel, 24, 235);
  ctx.fillStyle = "#657482";
  ctx.font = `850 13px ${fontFamily}`;
  ctx.fillText(`までの全国${isMinimum ? "最低" : "最高"}気温`, 26, 273);
  const sliderX = 218;
  const sliderY = 235;
  const sliderWidth = 650;
  const frameDenominator = Math.max(1, payload.frames.length - 1);
  ctx.strokeStyle = "#b7c0c8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sliderX, sliderY);
  ctx.lineTo(sliderX + sliderWidth, sliderY);
  ctx.stroke();
  payload.frames.forEach((candidateFrame, candidateIndex) => {
    const candidateLabel = dailyMaxRaceTimeLabel(candidateFrame.time);
    const isHour = candidateLabel.endsWith(":00");
    const x = sliderX + candidateIndex / frameDenominator * sliderWidth;
    ctx.strokeStyle = isHour ? `${accent}88` : "rgba(95,109,122,0.28)";
    ctx.lineWidth = isHour ? 1.4 : 0.8;
    ctx.beginPath();
    ctx.moveTo(x, sliderY + 8);
    ctx.lineTo(x, sliderY + (isHour ? 23 : 16));
    ctx.stroke();
    if (isHour && candidateIndex % 6 === 0) {
      ctx.fillStyle = "#72808e";
      ctx.font = `800 9px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(Number(candidateLabel.slice(0, 2))), x, sliderY + 26);
    }
  });
  const progressRatio = Number.isFinite(Number(options.progressRatio))
    ? Math.max(0, Math.min(1, Number(options.progressRatio)))
    : frameIndex / frameDenominator;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sliderX, sliderY);
  ctx.lineTo(sliderX + progressRatio * sliderWidth, sliderY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sliderX + progressRatio * sliderWidth, sliderY, 12, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, progressBottom, 900, legendBottom - progressBottom);
  DAILY_MAX_RACE_REGIONS.forEach((region, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    const x = 35 + column * 174;
    const y = 326 + row * 38;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${region.hue} ${region.saturation}% ${region.lightness}%)`;
    ctx.fill();
    if (region.outline) {
      ctx.strokeStyle = region.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = "#42505e";
    ctx.font = `850 13px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(region.label, x + 12, y);
  });

  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, legendBottom, 900, footerTop - legendBottom);
  const firstTick = Math.ceil(domain.minimum - 0.0001);
  const lastTick = Math.floor(domain.maximum + 0.0001);
  const tickStep = domainSpan > 9 ? 2 : 1;
  for (let value = firstTick; value <= lastTick; value += 1) {
    const x = chartLeft + ((value - domain.minimum) / domainSpan) * chartWidth;
    ctx.strokeStyle = "rgba(91, 108, 124, 0.20)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, axisTop + 19);
    ctx.lineTo(x, rowsBottom);
    ctx.stroke();
    if ((value - firstTick) % tickStep === 0) {
      ctx.fillStyle = "#667585";
      ctx.font = `850 14px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`${value}℃`, x, axisTop + 9);
    }
  }
  ctx.fillStyle = "#71808e";
  ctx.font = `850 13px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText("順位", 18, axisTop + 9);
  ctx.fillText("都道府県｜地点", placeLeft, axisTop + 9);
  ctx.fillText("地点・気温", chartRight + 10, axisTop + 9);

  rows.forEach(([rawStationKey, rawValue, rawVisualRank, rawDisplayRank], rankIndex) => {
    const stationKey = String(rawStationKey);
    const value = Number(rawValue);
    const visualRank = Number.isFinite(Number(rawVisualRank)) ? Number(rawVisualRank) : rankIndex;
    const displayRank = Number.isFinite(Number(rawDisplayRank)) ? Number(rawDisplayRank) : rankIndex;
    const station = payload.stations[stationKey] || {};
    const region = dailyMaxRaceRegion(station);
    const placeLabel = `${station.prefecture || region.label}｜${station.name || stationKey}`;
    const color = dailyMaxRaceColor(station);
    const y = rowsTop + visualRank * rowHeight;
    const centerY = y + rowHeight / 2;
    const trackHeight = Math.max(18, rowHeight - 11);
    const trackY = centerY - trackHeight / 2;
    const barWidth = Math.max(3, Math.min(chartWidth, ((value - domain.minimum) / domainSpan) * chartWidth));

    ctx.fillStyle = displayRank < 3 ? accent : "#485665";
    ctx.font = `950 ${Math.max(16, rowHeight - 22)}px ${fontFamily}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(displayRank + 1), rankRight, centerY);

    roundDailyMaxRaceCanvasRect(ctx, placeLeft, trackY - 2, placeWidth, trackHeight + 4, 7);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    const outline = dailyMaxRaceOutlineColor(station);
    ctx.strokeStyle = outline === "transparent" ? color : outline;
    ctx.globalAlpha = outline === "transparent" ? 0.42 : 0.9;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#111c26";
    ctx.font = `850 ${Math.max(14, rowHeight - 24)}px ${fontFamily}`;
    ctx.textAlign = "right";
    ctx.fillText(fitDailyMaxRaceCanvasText(ctx, placeLabel, placeWidth - 18), placeLeft + placeWidth - 9, centerY);

    roundDailyMaxRaceCanvasRect(ctx, chartLeft, trackY, chartWidth, trackHeight, 6);
    ctx.fillStyle = "#eef1f4";
    ctx.fill();
    roundDailyMaxRaceCanvasRect(ctx, chartLeft, trackY, barWidth, trackHeight, 6);
    ctx.fillStyle = color;
    ctx.fill();
    strokeDailyMaxRaceCanvasBarOutline(ctx, station);

    const valueLabelX = chartLeft + barWidth + 9;
    const valueLabelWidth = Math.max(1, valueRight - valueLabelX);
    ctx.fillStyle = displayRank < 3 ? accent : "#24313e";
    ctx.font = `950 ${Math.max(14, rowHeight - 26)}px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText(
      fitDailyMaxRaceCanvasText(ctx, `${placeLabel}（${value.toFixed(1)}℃）`, valueLabelWidth),
      valueLabelX,
      centerY,
    );
  });

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, footerTop, 900, 1600 - footerTop);
  ctx.strokeStyle = "#d9e1e8";
  ctx.beginPath();
  ctx.moveTo(0, footerTop);
  ctx.lineTo(900, footerTop);
  ctx.stroke();
  ctx.fillStyle = "#263541";
  ctx.font = `900 15px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`全国${Number(payload.eligible_station_count || payload.station_population).toLocaleString()}地点・TOP${Number(payload.top_n) || 100}から上位${exportCount}地点を表示`, 24, 1518);
  ctx.fillStyle = "#5d6c7a";
  ctx.font = `800 12px ${fontFamily}`;
  ctx.fillText(`順位はアメダス10分値。公式${isMinimum ? "最低" : "最高"}気温は観測時分以後へ反映。欠測補間なし。`, 24, 1548);
  ctx.fillText("出典：気象庁ホームページ（NatureWxLabが加工）", 24, 1572);
  ctx.fillStyle = accentDark;
  ctx.font = `900 13px ${fontFamily}`;
  ctx.textAlign = "right";
  ctx.fillText("naturewxlab.com", 876, 1572);
  ctx.restore();
  strokeRoundedRect(0.5, 0.5, 899, 1599, 0, "#d8e1e8", 1);
  return canvas;
}

function createDailyMaxRaceVideoCanvas(options = {}) {
  const format = dailyMaxRaceVideoFormat(options.format);
  const outputOptions = {
    ...options,
    outputWidth: format.width,
    outputHeight: format.height,
  };
  return format.id === "portrait"
    ? createDailyMaxRacePortraitCanvas(outputOptions)
    : createDailyMaxRaceShareCanvas(outputOptions);
}

function dailyMaxRaceCanvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG画像を生成できません。"));
    }, "image/png");
  });
}

function downloadDailyMaxRaceShareImage(blob) {
  const frame = state.dailyMaxRace?.frames?.[dailyMaxRaceDisplayedFrameIndex()];
  const link = document.createElement("a");
  const time = dailyMaxRaceTimeLabel(frame?.time).replace(":", "");
  link.download = `temperature_ranking_${state.dailyMaxRaceDate}_${state.dailyMaxRaceElement}_${time}.png`;
  link.href = URL.createObjectURL(blob);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function copyDailyMaxRaceShareImage() {
  const button = els.dailyMaxRaceShareImageButton;
  if (!button || !state.dailyMaxRace?.frames?.length) return;
  setDailyMaxRaceShareStatus(button, "loading");
  try {
    const blob = await dailyMaxRaceCanvasToBlob(createDailyMaxRaceShareCanvas());
    if (navigator.clipboard?.write && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setDailyMaxRaceShareStatus(button, "copied");
        return;
      } catch (error) {
        console.warn("Image clipboard unavailable; downloading PNG instead", error);
      }
    }
    downloadDailyMaxRaceShareImage(blob);
    setDailyMaxRaceShareStatus(button, "saved");
  } catch (error) {
    console.warn("Daily temperature race image copy failed", error);
    setDailyMaxRaceShareStatus(button, "error");
  }
}

function fullRankingImageRows() {
  const rows = state.fullRankingRows;
  if (!rows.length) return { rows: [], startIndex: 0 };
  const rowElement = els.fullRankingRows?.querySelector(".full-ranking-row");
  const headElement = els.fullRankingList?.querySelector(".full-ranking-list-head");
  const rowHeight = rowElement?.getBoundingClientRect().height || 62;
  const headHeight = headElement?.getBoundingClientRect().height || 36;
  const scrollTop = els.fullRankingList?.scrollTop || 0;
  let startIndex = Math.max(0, Math.floor(Math.max(0, scrollTop - headHeight) / rowHeight));
  const locatedIndex = rows.findIndex((row) => row.stationKey === state.fullRankingLocatedStationKey);
  if (locatedIndex >= 0) startIndex = Math.max(0, locatedIndex - 6);
  startIndex = Math.min(startIndex, Math.max(0, rows.length - 13));
  return { rows: rows.slice(startIndex, startIndex + 13), startIndex };
}

function createFullRankingLegacyCanvas() {
  const width = 1920;
  const height = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const fontFamily = '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
  const isMinimum = state.fullRankingElement === "min";
  const accent = isMinimum ? "#2f78b5" : "#b94b29";
  const { rows, startIndex } = fullRankingImageRows();
  const tableX = 48;
  const tableWidth = 1824;
  const tableTop = 140;
  const tableHeadHeight = 42;
  const rowHeight = 62;
  const columns = [
    { x: 48, width: 80, label: "全国順位", align: "left" },
    { x: 128, width: 430, label: "地域・市町村・観測地点", align: "left" },
    { x: 558, width: 160, label: "気温・観測日時", align: "right" },
    { x: 718, width: 290, label: "横棒・1位との差", align: "left" },
    { x: 1008, width: 120, label: "県内順位", align: "center" },
    { x: 1128, width: 90, label: "平年差", align: "center" },
    { x: 1218, width: 90, label: "前日差", align: "center" },
    { x: 1308, width: 180, label: "観測史上1位", align: "center" },
    { x: 1488, width: 180, label: `${Number(String(state.fullRankingDate).slice(5, 7))}月の1位`, align: "center" },
    { x: 1668, width: 150, label: "統計開始年", align: "center" },
  ];

  ctx.fillStyle = "#eef2f5";
  ctx.fillRect(0, 0, width, height);
  const headerGradient = ctx.createLinearGradient(0, 0, width, 0);
  headerGradient.addColorStop(0, "#ffffff");
  headerGradient.addColorStop(0.68, isMinimum ? "#f7fbff" : "#fffaf5");
  headerGradient.addColorStop(1, isMinimum ? "#e5f3fc" : "#ffeadc");
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, width, tableTop);
  ctx.fillStyle = accent;
  roundDailyMaxRaceCanvasRect(ctx, 48, 28, 76, 34, 17);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `950 15px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NW 実況", 86, 45);
  ctx.fillStyle = "#202932";
  ctx.font = `950 34px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText(`全国${isMinimum ? "最低" : "最高"}気温ランキング`, 140, 47);
  ctx.fillStyle = "#5e6e7e";
  ctx.font = `850 15px ${fontFamily}`;
  const endIndex = Math.min(state.fullRankingRows.length, startIndex + rows.length);
  ctx.fillText(`${dailyMaxRaceDateLabel(state.fullRankingDate)}・全国${state.fullRankingRows.length.toLocaleString()}地点・表示中 ${startIndex + 1}〜${endIndex}番目`, 48, 91);
  ctx.textAlign = "right";
  ctx.fillStyle = accent;
  ctx.font = `950 21px ${fontFamily}`;
  ctx.fillText(`${dailyMaxRaceDateLabel(state.fullRankingDate)}　${isMinimum ? "最低気温" : "最高気温"}`, 1872, 48);
  ctx.fillStyle = "#667584";
  ctx.font = `850 14px ${fontFamily}`;

  let legendX = 48;
  DAILY_MAX_RACE_REGIONS.forEach((region) => {
    ctx.fillStyle = `hsl(${region.hue} ${region.saturation}% ${region.lightness}%)`;
    ctx.beginPath();
    ctx.arc(legendX + 6, 116, 6, 0, Math.PI * 2);
    ctx.fill();
    if (region.outline) {
      ctx.strokeStyle = region.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = "#4a5866";
    ctx.font = `850 12px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText(region.label, legendX + 17, 116);
    legendX += ctx.measureText(region.label).width + 38;
  });

  ctx.fillStyle = "#e4eaf0";
  ctx.fillRect(tableX, tableTop, tableWidth, tableHeadHeight);
  ctx.strokeStyle = "#d5dde5";
  ctx.lineWidth = 1;
  ctx.strokeRect(tableX + 0.5, tableTop + 0.5, tableWidth - 1, tableHeadHeight - 1);
  ctx.fillStyle = "#4d5c6a";
  ctx.font = `950 13px ${fontFamily}`;
  columns.forEach((column) => {
    ctx.textAlign = column.align === "right" ? "right" : column.align === "center" ? "center" : "left";
    const x = column.align === "right"
      ? column.x + column.width - 10
      : column.align === "center" ? column.x + column.width / 2 : column.x + 10;
    ctx.fillText(column.label, x, tableTop + tableHeadHeight / 2);
  });

  rows.forEach((row, rowIndex) => {
    const y = tableTop + tableHeadHeight + rowIndex * rowHeight;
    ctx.fillStyle = row.stationKey === state.fullRankingLocatedStationKey
      ? "#fff4c7"
      : rowIndex % 2 ? "#fafbfd" : "#ffffff";
    ctx.fillRect(tableX, y, tableWidth, rowHeight);
    ctx.fillStyle = dailyMaxRaceColor(row.station);
    ctx.fillRect(tableX, y, 7, rowHeight);
    ctx.strokeStyle = "#dfe5ea";
    ctx.beginPath();
    ctx.moveTo(tableX, y + rowHeight - 0.5);
    ctx.lineTo(tableX + tableWidth, y + rowHeight - 0.5);
    ctx.stroke();

    ctx.fillStyle = "#374655";
    ctx.font = `950 23px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText(String(row.rank.toLocaleString()), 62, y + 31);
    ctx.font = `900 11px ${fontFamily}`;
    ctx.fillText("位", 62 + ctx.measureText(String(row.rank.toLocaleString())).width + 3, y + 33);

    ctx.fillStyle = dailyMaxRaceColor(row.station);
    roundDailyMaxRaceCanvasRect(ctx, 142, y + 16, 13, 13, 4);
    ctx.fill();
    ctx.fillStyle = "#273441";
    ctx.font = `950 18px ${fontFamily}`;
    ctx.fillText(
      fitDailyMaxRaceCanvasText(
        ctx,
        [[row.prefecture, row.municipality].filter(Boolean).join(" "), row.stationName].filter(Boolean).join("｜"),
        380,
      ),
      164,
      y + 31,
    );

    ctx.fillStyle = accent;
    ctx.font = `950 22px ${fontFamily}`;
    ctx.textAlign = "right";
    ctx.fillText(`${row.value.toFixed(1)}℃`, 704, y + 24);
    ctx.fillStyle = "#667584";
    ctx.font = `800 11px ${fontFamily}`;
    ctx.fillText(fullRankingDateTimeLabel(row.observedAt), 704, y + 44);

    const barX = 734;
    const barY = y + 15;
    const barWidth = 256;
    ctx.fillStyle = "#edf1f4";
    roundDailyMaxRaceCanvasRect(ctx, barX, barY, barWidth, 22, 5);
    ctx.fill();
    ctx.fillStyle = dailyMaxRaceColor(row.station);
    roundDailyMaxRaceCanvasRect(ctx, barX, barY, Math.max(8, barWidth * row.barPercent / 100), 22, 5);
    ctx.fill();
    ctx.fillStyle = "#536271";
    ctx.font = `850 10px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText(`${row.axisMin}℃`, barX, y + 50);
    ctx.textAlign = "center";
    ctx.fillText(`1位差 ${formatSigned(row.firstDifference)}`, barX + barWidth / 2, y + 50);
    ctx.textAlign = "right";
    ctx.fillText(`${row.axisMax}℃`, barX + barWidth, y + 50);

    const centerCell = (text, columnIndex, color = "#344454", font = `900 15px ${fontFamily}`) => {
      const column = columns[columnIndex];
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.fillText(text, column.x + column.width / 2, y + 31);
    };
    centerCell(`${row.prefectureRank.toLocaleString()}位`, 4);
    centerCell(Number.isFinite(row.normalDifference) ? formatSigned(row.normalDifference) : "—", 5);
    centerCell(Number.isFinite(row.previousDifference) ? formatSigned(row.previousDifference) : "—", 6);
    const drawRecord = (value, dateValue, columnIndex, update, updateLabel, updateColor) => {
      const column = columns[columnIndex];
      const centerX = column.x + column.width / 2;
      if (update) {
        const tied = String(update.remarks || "").includes("タイ")
          || (
            Number.isFinite(Number(update.value))
            && Number.isFinite(Number(update.previous_record))
            && Math.abs(Number(update.value) - Number(update.previous_record)) < 0.05
          );
        const label = `${updateLabel}${tied ? " タイ" : ""}`;
        ctx.font = `950 9px ${fontFamily}`;
        const badgeWidth = Math.min(column.width - 12, ctx.measureText(label).width + 16);
        ctx.fillStyle = updateColor;
        roundDailyMaxRaceCanvasRect(ctx, centerX - badgeWidth / 2, y + 5, badgeWidth, 15, 8);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText(label, centerX, y + 12.5);
      }
      ctx.fillStyle = "#344454";
      ctx.font = `950 15px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText(Number.isFinite(value) ? `${value.toFixed(1)}℃` : "—", centerX, y + (update ? 36 : 23));
      if (Number.isFinite(value) && dateValue) {
        ctx.fillStyle = "#6c7987";
        ctx.font = `800 11px ${fontFamily}`;
        ctx.fillText(fullRankingRecordDateLabel(dateValue), centerX, y + (update ? 52 : 43));
      }
    };
    drawRecord(
      row.allTimeRecordValue,
      row.allTimeRecordDate,
      7,
      row.allTimeRecordUpdate,
      "観測史上1位更新",
      isMinimum ? "#246ca8" : "#a93f23",
    );
    drawRecord(
      row.monthRecordValue,
      row.monthRecordDate,
      8,
      row.monthRecordUpdate,
      `${Number(String(state.fullRankingDate).slice(5, 7))}月1位更新`,
      isMinimum ? "#497897" : "#a86900",
    );
    centerCell(row.statisticsStartYear ? `${row.statisticsStartYear}年` : "—", 9);
  });

  const footerY = tableTop + tableHeadHeight + rows.length * rowHeight;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, footerY, width, height - footerY);
  ctx.strokeStyle = "#d8e1e8";
  ctx.beginPath();
  ctx.moveTo(0, footerY + 0.5);
  ctx.lineTo(width, footerY + 0.5);
  ctx.stroke();
  ctx.fillStyle = "#364554";
  ctx.font = `900 15px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText(els.fullRankingMeta?.textContent || "", 48, footerY + 34);
  ctx.fillStyle = "#647385";
  ctx.font = `800 12px ${fontFamily}`;
  ctx.fillText("記録更新は気象庁「毎日の観測史上1位の値 更新状況」（タイ記録を含む）。資料不足・欠測は「—」で表示。", 48, footerY + 60);
  ctx.fillStyle = accent;
  ctx.font = `950 14px ${fontFamily}`;
  ctx.textAlign = "right";
  ctx.fillText("NatureWxLab ｜ naturewxlab.com", 1872, footerY + 48);
  ctx.strokeStyle = "#cfd8e0";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  return canvas;
}

function fullRankingCaptureStyleText() {
  const rules = [];
  [...document.styleSheets].forEach((sheet) => {
    try {
      rules.push([...sheet.cssRules].map((rule) => rule.cssText).join("\n"));
    } catch {
      // Cross-origin stylesheets are not required for this self-contained modal.
    }
  });
  return rules.join("\n");
}

function syncFullRankingCaptureControls(source, clone) {
  const sourceControls = source.querySelectorAll("input, select, textarea");
  const cloneControls = clone.querySelectorAll("input, select, textarea");
  sourceControls.forEach((control, index) => {
    const target = cloneControls[index];
    if (!target) return;
    if (control instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
      [...target.options].forEach((option, optionIndex) => {
        option.selected = Boolean(control.options[optionIndex]?.selected);
      });
    } else if (control instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      target.value = control.value;
      target.setAttribute("value", control.value);
      target.checked = control.checked;
      if (control.checked) target.setAttribute("checked", "");
      else target.removeAttribute("checked");
    } else {
      target.value = control.value;
      target.textContent = control.value;
    }
  });
}

function prepareFullRankingCaptureList(source, clone) {
  const sourceList = source.querySelector("#fullRankingList");
  const cloneList = clone.querySelector("#fullRankingList");
  const sourceHead = source.querySelector(".full-ranking-list-head");
  const cloneHead = clone.querySelector(".full-ranking-list-head");
  const sourceRows = [...source.querySelectorAll("#fullRankingRows .full-ranking-row")];
  const cloneRows = clone.querySelector("#fullRankingRows");
  if (!sourceList || !cloneList || !sourceHead || !cloneHead || !cloneRows) return;

  const listRect = sourceList.getBoundingClientRect();
  const headRect = sourceHead.getBoundingClientRect();
  const visibleTop = Math.max(listRect.top, headRect.bottom);
  const visibleRows = sourceRows
    .map((row) => ({ row, rect: row.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > visibleTop && rect.top < listRect.bottom);
  const contentWidth = Math.max(sourceList.clientWidth, sourceList.scrollWidth);

  cloneList.style.position = "relative";
  cloneList.style.overflow = "hidden";
  cloneList.style.scrollbarWidth = "none";
  cloneHead.style.position = "absolute";
  cloneHead.style.inset = `0 auto auto ${-sourceList.scrollLeft}px`;
  cloneHead.style.width = `${contentWidth}px`;
  cloneHead.style.zIndex = "3";
  cloneRows.replaceChildren();
  if (!visibleRows.length) return;

  visibleRows.forEach(({ row }) => {
    const rowClone = row.cloneNode(true);
    rowClone.style.backgroundColor = getComputedStyle(row).backgroundColor;
    cloneRows.appendChild(rowClone);
  });
  cloneRows.style.position = "absolute";
  cloneRows.style.top = `${visibleRows[0].rect.top - listRect.top}px`;
  cloneRows.style.left = `${-sourceList.scrollLeft}px`;
  cloneRows.style.width = `${contentWidth}px`;
}

async function createFullRankingShareCanvas() {
  const source = els.fullRankingModal;
  if (!source || els.fullRankingBackdrop?.hidden) {
    throw new Error("全国ランキング画面が開かれていません。");
  }
  const rect = source.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const scale = 2;
  const clone = source.cloneNode(true);

  clone.setAttribute("aria-hidden", "true");
  clone.style.position = "relative";
  clone.style.inset = "auto";
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.maxWidth = "none";
  clone.style.maxHeight = "none";
  clone.style.margin = "0";
  clone.style.transform = "none";
  syncFullRankingCaptureControls(source, clone);
  prepareFullRankingCaptureList(source, clone);

  const imageButton = clone.querySelector("#fullRankingShareImageButton");
  if (imageButton) {
    imageButton.removeAttribute("data-status");
    imageButton.disabled = false;
    const text = imageButton.querySelector(".full-ranking-action-text");
    if (text) text.textContent = "画像";
  }

  const wrapper = document.createElement("div");
  wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = "hidden";
  wrapper.style.background = "transparent";
  wrapper.style.color = getComputedStyle(source).color;
  wrapper.style.fontFamily = getComputedStyle(source).fontFamily;
  const style = document.createElement("style");
  style.textContent = `${fullRankingCaptureStyleText()}
html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }
* { animation: none !important; caret-color: transparent !important; }`;
  wrapper.append(style, clone);

  const serialized = new XMLSerializer().serializeToString(wrapper);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}">
    <foreignObject width="${width}" height="${height}" transform="scale(${scale})">${serialized}</foreignObject>
  </svg>`;
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("表示中のランキングを画像化できません。"));
    image.src = svgUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PNG画像の描画領域を作成できません。");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function downloadFullRankingShareImage(blob) {
  const { rows } = fullRankingImageRows();
  const startRank = rows.at(0)?.rank || 1;
  const endRank = rows.at(-1)?.rank || startRank;
  const link = document.createElement("a");
  link.download = `temperature_full_ranking_${state.fullRankingSource}_${state.fullRankingDate}_${state.fullRankingElement}_${startRank}-${endRank}.png`;
  link.href = URL.createObjectURL(blob);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function copyFullRankingShareImage() {
  const button = els.fullRankingShareImageButton;
  if (!button || !state.fullRankingRows.length) return;
  setFullRankingActionStatus(button, "loading");
  try {
    const blob = await dailyMaxRaceCanvasToBlob(await createFullRankingShareCanvas());
    if (navigator.clipboard?.write && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setFullRankingActionStatus(button, "copied");
        return;
      } catch (error) {
        console.warn("Full ranking image clipboard unavailable; downloading PNG instead", error);
      }
    }
    downloadFullRankingShareImage(blob);
    setFullRankingActionStatus(button, "saved");
  } catch (error) {
    console.warn("Full ranking image copy failed", error);
    setFullRankingActionStatus(button, "error");
  }
}

function dailyMaxRaceMp4MuxerModule() {
  if (!dailyMaxRaceMp4MuxerPromise) {
    dailyMaxRaceMp4MuxerPromise = import("./vendor/mp4-muxer.mjs?v=5.2.2");
  }
  return dailyMaxRaceMp4MuxerPromise;
}

async function dailyMaxRaceVideoEncoderConfig(format = dailyMaxRaceVideoFormat()) {
  if (!window.VideoEncoder || !window.VideoFrame || typeof VideoEncoder.isConfigSupported !== "function") return null;
  const base = {
    width: format.width,
    height: format.height,
    bitrate: DAILY_MAX_RACE_VIDEO_BITRATE,
    framerate: DAILY_MAX_RACE_VIDEO_FPS,
    latencyMode: "quality",
    hardwareAcceleration: "prefer-hardware",
    avc: { format: "avc" },
  };
  const candidates = [
    { ...base, codec: "avc1.4d4028" },
    { ...base, codec: "avc1.420028" },
  ];
  for (const candidate of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported(candidate);
      if (support?.supported) return support.config || candidate;
    } catch {
      // Try the next H.264 profile.
    }
  }
  return null;
}

function dailyMaxRaceVideoInterpolatedRows(fromFrame, toFrame, exportCount, progress) {
  const fromRows = fromFrame.rows.slice(0, exportCount);
  const toRows = toFrame.rows.slice(0, exportCount);
  const fromMap = new Map(fromRows.map(([key, value], rank) => [String(key), { rank, value: Number(value) }]));
  const toMap = new Map(toRows.map(([key, value], rank) => [String(key), { rank, value: Number(value) }]));
  const keys = new Set([...fromMap.keys(), ...toMap.keys()]);
  const eased = 1 - ((1 - Math.max(0, Math.min(1, progress))) ** 3);
  const visibleRows = [...keys].map((key) => {
    const from = fromMap.get(key);
    const to = toMap.get(key);
    const fromRank = from?.rank ?? exportCount;
    const toRank = to?.rank ?? exportCount;
    const fromValue = from?.value ?? to?.value ?? 0;
    const toValue = to?.value ?? from?.value ?? 0;
    const visualRank = fromRank + (toRank - fromRank) * eased;
    const value = fromValue + (toValue - fromValue) * eased;
    return [key, value, visualRank];
  })
    .filter((row) => row[2] < exportCount)
    .sort((left, right) => left[2] - right[2])
    .slice(0, exportCount);

  // Rows can cross at the same fractional rank during a transition. Keep a
  // readable gap while preserving exact integer ranks at both endpoints.
  const minimumGap = 0.78;
  const adjustedMaximum = Math.max(0, exportCount - 1 - (visibleRows.length - 1) * minimumGap);
  let previousAdjustedRank = 0;
  return visibleRows.map(([key, value, visualRank], index) => {
    const idealAdjustedRank = visualRank - index * minimumGap;
    const adjustedRank = Math.max(
      previousAdjustedRank,
      Math.min(adjustedMaximum, Math.max(0, idealAdjustedRank)),
    );
    previousAdjustedRank = adjustedRank;
    return [key, value, adjustedRank + index * minimumGap, index];
  });
}

function dailyMaxRaceVideoInterpolatedDomain(fromFrame, toFrame, exportCount, progress) {
  const from = dailyMaxRaceAxisDomain(fromFrame.rows.slice(0, exportCount));
  const to = dailyMaxRaceAxisDomain(toFrame.rows.slice(0, exportCount));
  const eased = 1 - ((1 - Math.max(0, Math.min(1, progress))) ** 3);
  return {
    minimum: from.minimum + (to.minimum - from.minimum) * eased,
    maximum: from.maximum + (to.maximum - from.maximum) * eased,
    leader: from.leader + (to.leader - from.leader) * eased,
  };
}

function setDailyMaxRaceVideoExportStatus(status, text = "") {
  const button = els.dailyMaxRaceVideoExportButton;
  if (!button) return;
  button.dataset.status = status;
  button.querySelector(".race-video-export-text").textContent = text || (status === "working" ? "中止" : "動画を作成");
  const working = status === "working";
  button.setAttribute("aria-label", working ? "動画生成を中止" : "選択範囲の動画を作成してダウンロード");
  [els.dailyMaxRaceVideoFormatSelect, els.dailyMaxRaceVideoStartSelect, els.dailyMaxRaceVideoEndSelect].forEach((select) => {
    if (select) select.disabled = working;
  });
  [
    els.dailyMaxRaceDateSelect,
    els.dailyMaxRaceSpeedSelect,
    els.dailyMaxRaceCountSelect,
    els.dailyMaxRaceRefreshButton,
    els.dailyMaxRacePlayButton,
    els.dailyMaxRaceRestartButton,
    els.dailyMaxRaceStepBackButton,
    els.dailyMaxRaceStepForwardButton,
    els.dailyMaxRaceLatestButton,
  ].forEach((control) => {
    if (control) control.disabled = working;
  });
  els.dailyMaxRaceElementSwitch?.querySelectorAll("[data-race-element]").forEach((control) => {
    control.disabled = working || !(state.dailyMaxRaceArchive?.elements || ["max"]).includes(control.dataset.raceElement);
  });
  if (!working && state.dailyMaxRace?.frames?.length) renderDailyMaxRaceFrame(true);
  if (els.dailyMaxRaceVideoButton) {
    els.dailyMaxRaceVideoButton.dataset.status = working ? "loading" : status;
    els.dailyMaxRaceVideoButton.querySelector(".race-share-text").textContent = working ? "生成中" : "動画";
  }
}

function assertDailyMaxRaceVideoNotAborted() {
  if (state.dailyMaxRaceVideoAbortRequested) throw new DOMException("動画生成を中止しました。", "AbortError");
}

function dailyMaxRaceYieldToBrowser() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function waitForDailyMaxRaceVideoEncoder(encoder, maximumQueueSize = 6) {
  if (encoder.encodeQueueSize < maximumQueueSize) return Promise.resolve();
  return new Promise((resolve) => {
    const handleDequeue = () => {
      if (encoder.encodeQueueSize >= maximumQueueSize) return;
      encoder.removeEventListener("dequeue", handleDequeue);
      resolve();
    };
    encoder.addEventListener("dequeue", handleDequeue);
    handleDequeue();
  });
}

function downloadDailyMaxRaceVideo(blob, mimeType, startIndex, endIndex, format = dailyMaxRaceVideoFormat()) {
  const frames = state.dailyMaxRace?.frames || [];
  const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  const start = dailyMaxRaceTimeLabel(frames[startIndex]?.time).replace(":", "");
  const end = dailyMaxRaceTimeLabel(frames[endIndex]?.time).replace(":", "");
  const link = document.createElement("a");
  link.download = `temperature_ranking_${state.dailyMaxRaceDate}_${state.dailyMaxRaceElement}_${start}-${end}_${state.dailyMaxRaceSpeed}x_${format.id}.${extension}`;
  link.href = URL.createObjectURL(blob);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 30000);
}

async function exportDailyMaxRaceVideo() {
  if (state.dailyMaxRaceVideoExporting) {
    state.dailyMaxRaceVideoAbortRequested = true;
    updateDailyMaxRaceVideoMeta("中止しています…");
    return;
  }
  const payload = state.dailyMaxRace;
  const frames = payload?.frames || [];
  if (!frames.length) return;
  if (!window.VideoEncoder || !window.VideoFrame) {
    setDailyMaxRaceVideoExportStatus("error", "このブラウザは動画生成に未対応です");
    updateDailyMaxRaceVideoMeta("Chrome・Edge・Safariの最新版でお試しください");
    return;
  }
  const startIndex = Math.max(0, Math.min(state.dailyMaxRaceVideoStartIndex, frames.length - 1));
  const endIndex = Math.max(startIndex, Math.min(state.dailyMaxRaceVideoEndIndex, frames.length - 1));
  const exportCount = dailyMaxRaceVideoOutputCount();
  const format = dailyMaxRaceVideoFormat();
  const frameMs = DAILY_MAX_RACE_BASE_FRAME_MS / Math.max(0.5, state.dailyMaxRaceSpeed);
  const transitionMs = dailyMaxRaceTransitionMs();
  const logicalFrameCount = endIndex - startIndex + 1;
  const totalMs = (logicalFrameCount + 1) * frameMs;
  const framesPerStep = Math.max(1, Math.round(frameMs / 1000 * DAILY_MAX_RACE_VIDEO_FPS));
  const transitionFrameCount = Math.max(1, Math.min(framesPerStep, Math.round(transitionMs / 1000 * DAILY_MAX_RACE_VIDEO_FPS)));
  const holdFrameCount = Math.max(0, framesPerStep - transitionFrameCount);
  const totalVideoFrameCount = (logicalFrameCount + 1) * framesPerStep;
  let muxerModule;
  let encoderConfig;
  try {
    [muxerModule, encoderConfig] = await Promise.all([
      dailyMaxRaceMp4MuxerModule(),
      dailyMaxRaceVideoEncoderConfig(format),
    ]);
  } catch (error) {
    setDailyMaxRaceVideoExportStatus("error", "動画エンコーダーを読み込めません");
    updateDailyMaxRaceVideoMeta("通信状態を確認して、もう一度お試しください");
    console.warn("Daily temperature race MP4 encoder loading failed", error);
    return;
  }
  if (!encoderConfig || !muxerModule?.Muxer || !muxerModule?.ArrayBufferTarget) {
    setDailyMaxRaceVideoExportStatus("error", "このブラウザはMP4生成に未対応です");
    updateDailyMaxRaceVideoMeta("Chrome・Edge・Safariの最新版でお試しください");
    return;
  }
  state.dailyMaxRaceVideoExporting = true;
  state.dailyMaxRaceVideoAbortRequested = false;
  setDailyMaxRacePlaying(false);
  setDailyMaxRaceVideoExportStatus("working", "中止 0%");
  updateDailyMaxRaceVideoMeta(`生成中 0% ・ ${format.label} ${format.width}×${format.height} ・ 完成まで約${dailyMaxRaceVideoDurationLabel(totalMs)} ・ 容量上限目安${dailyMaxRaceVideoSizeLabel(totalMs)}`);
  let encoder = null;
  let encoderError = null;
  let encodedVideoFrameCount = 0;
  const updateProgress = (force = false) => {
    const percent = Math.max(0, Math.min(99, Math.round(encodedVideoFrameCount / totalVideoFrameCount * 100)));
    if (!force && encodedVideoFrameCount % Math.max(1, Math.round(totalVideoFrameCount / 100)) !== 0) return;
    setDailyMaxRaceVideoExportStatus("working", `中止 ${percent}%`);
    updateDailyMaxRaceVideoMeta(`生成中 ${percent}% ・ ${format.label} ・ ${dailyMaxRaceTimeLabel(frames[startIndex].time)}〜${dailyMaxRaceTimeLabel(frames[endIndex].time)} ・ ${state.dailyMaxRaceSpeed}倍`);
  };
  try {
    const target = new muxerModule.ArrayBufferTarget();
    const muxer = new muxerModule.Muxer({
      target,
      video: {
        codec: "avc",
        width: format.width,
        height: format.height,
        frameRate: DAILY_MAX_RACE_VIDEO_FPS,
      },
      fastStart: { expectedVideoChunks: totalVideoFrameCount },
    });
    encoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: (error) => { encoderError = error; },
    });
    encoder.configure(encoderConfig);
    let canvas = createDailyMaxRaceVideoCanvas({
      format: format.id,
      frameIndex: startIndex,
      exportCount,
      playing: true,
      videoExporting: true,
    });
    const encodeCanvas = async () => {
      assertDailyMaxRaceVideoNotAborted();
      if (encoderError) throw encoderError;
      await waitForDailyMaxRaceVideoEncoder(encoder);
      const timestamp = encodedVideoFrameCount * DAILY_MAX_RACE_VIDEO_FRAME_US;
      const videoFrame = new VideoFrame(canvas, {
        timestamp,
        duration: DAILY_MAX_RACE_VIDEO_FRAME_US,
      });
      encoder.encode(videoFrame, {
        keyFrame: encodedVideoFrameCount % (DAILY_MAX_RACE_VIDEO_FPS * 2) === 0,
      });
      videoFrame.close();
      encodedVideoFrameCount += 1;
      updateProgress();
      if (encodedVideoFrameCount % 10 === 0) await dailyMaxRaceYieldToBrowser();
    };
    const encodeHold = async (count) => {
      for (let index = 0; index < count; index += 1) await encodeCanvas();
    };

    await encodeHold(framesPerStep);

    for (let frameIndex = startIndex + 1; frameIndex <= endIndex; frameIndex += 1) {
      const fromFrame = frames[frameIndex - 1];
      const toFrame = frames[frameIndex];
      for (let transitionFrame = 1; transitionFrame <= transitionFrameCount; transitionFrame += 1) {
        const progress = transitionFrame / transitionFrameCount;
        canvas = createDailyMaxRaceVideoCanvas({
          format: format.id,
          canvas,
          frameIndex,
          exportCount,
          rows: dailyMaxRaceVideoInterpolatedRows(fromFrame, toFrame, exportCount, progress),
          domain: dailyMaxRaceVideoInterpolatedDomain(fromFrame, toFrame, exportCount, progress),
          progressRatio: (frameIndex - 1 + progress) / Math.max(1, frames.length - 1),
          playing: true,
          videoExporting: true,
        });
        await encodeCanvas();
      }
      await encodeHold(holdFrameCount);
    }

    await encodeHold(framesPerStep);
    assertDailyMaxRaceVideoNotAborted();
    await encoder.flush();
    if (encoderError) throw encoderError;
    encoder.close();
    encoder = null;
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: "video/mp4" });
    if (!blob.size) throw new Error("動画ファイルを生成できませんでした。");
    downloadDailyMaxRaceVideo(blob, "video/mp4", startIndex, endIndex, format);
    setDailyMaxRaceVideoExportStatus("saved", "動画を保存しました");
    updateDailyMaxRaceVideoMeta(`${format.label} ${format.width}×${format.height}・${dailyMaxRaceTimeLabel(frames[startIndex].time)}〜${dailyMaxRaceTimeLabel(frames[endIndex].time)} の動画を保存しました`);
  } catch (error) {
    if (encoder?.state && encoder.state !== "closed") encoder.close();
    const aborted = error?.name === "AbortError" || state.dailyMaxRaceVideoAbortRequested;
    setDailyMaxRaceVideoExportStatus(aborted ? "idle" : "error", aborted ? "動画を作成" : "生成に失敗しました");
    updateDailyMaxRaceVideoMeta(aborted ? "動画生成を中止しました" : `動画を生成できませんでした：${error?.message || "不明なエラー"}`);
    if (!aborted) console.warn("Daily temperature race video export failed", error);
  } finally {
    state.dailyMaxRaceVideoExporting = false;
    state.dailyMaxRaceVideoAbortRequested = false;
    if (els.dailyMaxRaceVideoFormatSelect) els.dailyMaxRaceVideoFormatSelect.disabled = false;
    if (els.dailyMaxRaceVideoStartSelect) els.dailyMaxRaceVideoStartSelect.disabled = false;
    if (els.dailyMaxRaceVideoEndSelect) els.dailyMaxRaceVideoEndSelect.disabled = false;
    window.setTimeout(() => {
      if (!state.dailyMaxRaceVideoExporting) {
        setDailyMaxRaceVideoExportStatus("idle");
        updateDailyMaxRaceVideoMeta();
      }
    }, 2600);
  }
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
  if (params.get("view") === "fullRanking") {
    const rankingSource = params.get("rankingSource") === "forecast" || params.get("source") === "forecast"
      ? "forecast"
      : "observed";
    state.source = rankingSource;
    if (rankingSource === "observed") state.observedLayer = "daily";
    else state.forecastLayer = "daily";
    const rankingElement = params.get("rankingElement");
    state.fullRankingDeepLink = {
      date: params.get("rankingDate") || "",
      element: rankingElement === "min" ? "min" : "max",
      stationKey: params.get("rankingStation") || "",
      source: rankingSource,
    };
  }
  if (params.get("view") === "race") {
    state.source = "observed";
    state.observedLayer = "daily";
    const raceElement = params.get("raceElement");
    const raceCount = Number(params.get("raceCount"));
    const raceSpeed = Number(params.get("raceSpeed"));
    state.dailyMaxRaceDeepLink = {
      date: params.get("raceDate") || "",
      element: ["max", "min"].includes(raceElement) ? raceElement : "max",
      frameTime: params.get("raceTime") || "",
      visibleCount: [10, 20, 25, 30, 35, 50, 100].includes(raceCount) ? raceCount : 25,
      speed: [0.5, 1, 2, 4].includes(raceSpeed) ? raceSpeed : 1,
    };
  }
  const source = params.get("source");
  if (source === "forecast" || source === "observed") state.source = source;
  const layer = params.get("layer");
  if (state.source === "forecast" && layer) state.forecastLayer = layer;
  if (state.source === "observed" && layer) state.observedLayer = layer;
  const dailySequence = params.get("dailySequence");
  if (["both", "max", "min"].includes(dailySequence)) state.observedDailySequence = dailySequence;
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
  if (params.get("tooltip") === "0") state.showTooltip = false;
  if (params.get("detail") === "1") state.showDetailMap = true;
  const detailOpacityParam = params.get("detailOpacity");
  const detailOpacity = Number(detailOpacityParam);
  if (detailOpacityParam !== null && Number.isFinite(detailOpacity) && detailOpacity >= 0 && detailOpacity <= 100) state.detailMapOpacity = detailOpacity / 100;
  if (params.get("terrain") === "1") state.showTerrain = true;
  if (["color", "mono"].includes(params.get("terrainStyle"))) state.terrainStyle = params.get("terrainStyle");
  const weatherOpacity = Number(params.get("weatherOpacity"));
  if (Number.isFinite(weatherOpacity) && weatherOpacity >= 25 && weatherOpacity <= 100) state.weatherOpacity = weatherOpacity / 100;
  const terrainOpacity = Number(params.get("terrainOpacity"));
  if (Number.isFinite(terrainOpacity) && terrainOpacity >= 10 && terrainOpacity <= 80) state.terrainOpacity = terrainOpacity / 100;
  if (params.get("weatherMap") === "1") state.showWeatherMap = true;
  if (["now", "ft24", "ft48"].includes(params.get("weatherMapKind"))) state.weatherMapKind = params.get("weatherMapKind");
  const weatherMapOpacityParam = params.get("weatherMapOpacity");
  const weatherMapOpacity = Number(weatherMapOpacityParam);
  if (weatherMapOpacityParam !== null && Number.isFinite(weatherMapOpacity) && weatherMapOpacity >= 0 && weatherMapOpacity <= 100) state.weatherMapOpacity = weatherMapOpacity / 100;
}

window.addEventListener("resize", () => {
  resizeCanvasToDisplay();
  draw();
  if (!els.dailyMaxRaceBackdrop?.hidden) renderDailyMaxRaceFrame(true);
});

async function init() {
  applyUrlState();
  wirePointChartPanelDrag();
  wirePanelResize(els.pointChartPanel, "point");
  const hasModalDeepLink = Boolean(state.dailyMaxRaceDeepLink || state.fullRankingDeepLink);
  let weatherMapManifestPromise = hasModalDeepLink ? null : loadWeatherMapManifest();
  let mapFoundationPromise = hasModalDeepLink ? null : Promise.all([loadBoundaries(), loadPlaceLabels()]);
  let temperatureExtremesPromise = hasModalDeepLink ? null : loadTemperatureExtremes();
  let forecastManifestPromise = null;
  let observedManifestPromise = null;
  const ensureForecastManifest = () => {
    forecastManifestPromise ||= loadForecastManifest();
    return forecastManifestPromise;
  };
  const ensureObservedManifest = () => {
    observedManifestPromise ||= loadObservedManifest();
    return observedManifestPromise;
  };
  const ensureTemperatureExtremes = () => {
    temperatureExtremesPromise ||= loadTemperatureExtremes();
    return temperatureExtremesPromise;
  };
  if (state.fullRankingDeepLink?.source === "forecast") {
    await Promise.all([ensureForecastManifest(), ensureObservedManifest()]);
  } else if (hasModalDeepLink) {
    await ensureObservedManifest();
  } else {
    await Promise.all([ensureForecastManifest(), ensureObservedManifest()]);
  }
  if (state.source === "observed") {
    if (state.observedLayer === "daily") {
      normalizeObservedDailySelection();
      state.element = currentObservedSlot()?.element || "max";
    } else {
      state.element = state.observedLayer === "temp" ? "temp" : state.observedLayer;
    }
  }
  if (state.dailyMaxRaceDeepLink) {
    const deepLink = state.dailyMaxRaceDeepLink;
    state.dailyMaxRaceDeepLink = null;
    await openDailyMaxRaceModal(deepLink.date, deepLink);
  }
  if (state.fullRankingDeepLink) {
    if (state.fullRankingDeepLink.source !== "forecast") await ensureTemperatureExtremes();
    const deepLink = state.fullRankingDeepLink;
    await openFullRankingModal(deepLink.date, deepLink.element, deepLink.source);
  }
  weatherMapManifestPromise ||= loadWeatherMapManifest();
  mapFoundationPromise ||= Promise.all([loadBoundaries(), loadPlaceLabels()]);
  await Promise.all([
    mapFoundationPromise,
    ensureTemperatureExtremes(),
    ensureForecastManifest(),
    ensureObservedManifest(),
  ]);
  await loadSuikeiManifest();
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.source === state.source));
  els.forecastLayerSelect.value = state.forecastLayer;
  els.modeSelect.value = state.mode;
  els.periodSelect.value = state.period;
  els.placeLabelsToggle.checked = state.showPlaceLabels;
  syncMapLayerControls();
  syncTimelineFromElement();
  await loadData();
  if (state.showWeatherMap) {
    await weatherMapManifestPromise;
    await loadWeatherMapImage();
  }
  window.setInterval(checkForecastManifestUpdate, FORECAST_MANIFEST_POLL_MS);
  window.setInterval(checkObservedDataUpdate, OBSERVED_DATA_POLL_MS);
  window.setInterval(checkWeatherMapUpdate, WEATHER_MAP_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkWeatherMapUpdate();
  });
}

init();
