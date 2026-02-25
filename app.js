const TAU = Math.PI * 2;
const MAX_ENTRANTS = 200000;
const AUTO_LOAD_DEBOUNCE_MS = 650;
const NAME_REVEAL_MS = 900;
const SPIN_HOLD_MS = 460;
const NAME_WHEEL_DISPLAY_COUNT = 20;
const NAME_WHEEL_FLOOR_EPS = 1e-4;
const NAME_SPIN_LOOPS = 4;
const NAME_SPIN_DURATION_MS = 10000;
const ENERGIES = [
  { id: "grass", label: "Grass", iconText: "🍃", iconPath: "assets/leafenergy.png", color: "#4CAF50" },
  { id: "fire", label: "Fire", iconText: "🔥", iconPath: "assets/fireenergy.png", color: "#FF4C4C" },
  { id: "water", label: "Water", iconText: "💧", iconPath: "assets/waterenergy.png", color: "#41A6FF" },
  { id: "lightning", label: "Lightning", iconText: "⚡", iconPath: "assets/lightningenergy.png", color: "#FFD740" },
  { id: "psychic", label: "Psychic", iconText: "👁", iconPath: "assets/psychicenergy.png", color: "#9B5DE5" },
  { id: "fighting", label: "Fighting", iconText: "👊", iconPath: "assets/fightingenergy.png", color: "#C47A48" },
  { id: "darkness", label: "Darkness", iconText: "🌑", iconPath: "assets/darkenergy.png", color: "#344054" },
  { id: "metal", label: "Metal", iconText: "⚙", iconPath: "assets/metalenergy.png", color: "#8E98A3" },
];
const HEADER_KEYWORDS = ["username", "twitch", "handle", "displayname", "name"];
const CUSTOM_ART_PATHS = {
  topRight: "assets/art-top-right.png",
};

const dom = {
  namesInput: document.getElementById("namesInput"),
  loadBtn: document.getElementById("loadBtn"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  clearBtn: document.getElementById("clearBtn"),
  spinBtn: document.getElementById("spinBtn"),
  exportWinnersBtn: document.getElementById("exportWinnersBtn"),
  totalCount: document.getElementById("totalCount"),
  activeCount: document.getElementById("activeCount"),
  drawCount: document.getElementById("drawCount"),
  lastWinner: document.getElementById("lastWinner"),
  loadTime: document.getElementById("loadTime"),
  message: document.getElementById("message"),
  selectedEnergy: document.getElementById("selectedEnergy"),
  subsetCount: document.getElementById("subsetCount"),
  energyList: document.getElementById("energyList"),
  winnerList: document.getElementById("winnerList"),
  wheelCanvas: document.getElementById("wheelCanvas"),
  wheelModeLabel: document.getElementById("wheelModeLabel"),
  winnerBanner: document.getElementById("winnerBanner"),
  winnerBannerEnergy: document.getElementById("winnerBannerEnergy"),
  winnerBannerName: document.getElementById("winnerBannerName"),
  winnerBannerMeta: document.getElementById("winnerBannerMeta"),
  spinAura: document.getElementById("spinAura"),
  spinSparks: document.getElementById("spinSparks"),
  artTopRight: document.getElementById("artTopRight"),
};

const wheelCtx = dom.wheelCanvas.getContext("2d");

const state = {
  entrants: [],
  buckets: ENERGIES.map(() => []),
  activeTotal: 0,
  drawCount: 0,
  winners: [],
  energyRotation: 0,
  selectedEnergyIndex: -1,
  nameOffset: 0,
  namePointerEntrantId: null,
  nameWinnerPulse: 0,
  nameSpinSequence: null,
  lastLoadDurationMs: null,
  spinHoldTimerId: 0,
  spinHoldReady: false,
  spinHoldAutoFireUntil: 0,
  quickSpinConfirmUntil: 0,
  winnerFlashTimerId: 0,
  lastLoadedInputSignature: "",
  autoLoadTimerId: 0,
  autoLoadQueued: false,
  isLoading: false,
  isSpinning: false,
};

function randomFloat() {
  if (window.crypto?.getRandomValues) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    return arr[0] / 4294967296;
  }
  return Math.random();
}

function randomInt(maxExclusive) {
  if (maxExclusive <= 1) {
    return 0;
  }
  return Math.floor(randomFloat() * maxExclusive);
}

function preloadEnergyIcons() {
  return Promise.all(
    ENERGIES.map((energy) => new Promise((resolve) => {
      if (!energy.iconPath) {
        energy.iconImage = null;
        resolve();
        return;
      }

      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        energy.iconImage = img;
        resolve();
      };
      img.onerror = () => {
        energy.iconImage = null;
        resolve();
      };
      img.src = energy.iconPath;
    })),
  );
}

function ensureEnergyIcon(energy) {
  return energy?.iconImage && energy.iconImage.complete && energy.iconImage.naturalWidth > 0 ? energy.iconImage : null;
}

function createEnergyIconNode(energy, options = {}) {
  const { size = 16, className = "energy-icon", alt = "" } = options;
  if (!energy || !energy.iconPath) {
    return null;
  }

  const icon = document.createElement("img");
  icon.className = className;
  icon.src = energy.iconPath;
  icon.alt = alt || `${energy.label} energy`;
  icon.width = size;
  icon.height = size;
  icon.decoding = "async";
  icon.loading = "lazy";
  icon.addEventListener("error", () => {
    icon.replaceWith(document.createTextNode(energy.iconText || ""));
  });
  return icon;
}

function createBalancedEnergyAssignments(totalEntrants) {
  const assignments = new Uint8Array(totalEntrants);
  const order = Array.from({ length: totalEntrants }, (_, idx) => idx);
  const energyOrder = Array.from({ length: ENERGIES.length }, (_, idx) => idx);

  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  for (let i = energyOrder.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = energyOrder[i];
    energyOrder[i] = energyOrder[j];
    energyOrder[j] = tmp;
  }

  const basePerBucket = Math.floor(totalEntrants / ENERGIES.length);
  const remainder = totalEntrants % ENERGIES.length;
  const extraBuckets = new Set(energyOrder.slice(0, remainder));
  let cursor = 0;

  for (let energyIndex = 0; energyIndex < ENERGIES.length; energyIndex += 1) {
    const targetCount = basePerBucket + (extraBuckets.has(energyIndex) ? 1 : 0);
    for (let i = 0; i < targetCount; i += 1) {
      const entrantPosition = order[cursor];
      assignments[entrantPosition] = energyIndex;
      cursor += 1;
    }
  }

  return assignments;
}

function dedupeNames(names) {
  const unique = [];
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    unique.push(name);
  }
  return unique;
}

function parseCsvRows(rawText) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < rawText.length; i += 1) {
    const char = rawText[i];

    if (inQuotes) {
      if (char === "\"") {
        if (rawText[i + 1] === "\"") {
          value += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(value);
      value = "";
      continue;
    }

    if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.length > 1 || row[0].trim() !== "") {
    rows.push(row);
  }

  return rows;
}

function looksLikeCsv(rawText) {
  const firstLine = rawText.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes(",") && rawText.includes("\n");
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveCsvColumn(rows) {
  if (rows.length === 0 || rows[0].length === 0) {
    return { columnIndex: -1, label: "" };
  }

  const headers = rows[0].map((value) => normalizeHeader(value));
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (HEADER_KEYWORDS.some((candidate) => header.includes(candidate))) {
      return { columnIndex: i, label: rows[0][i].trim() || "username column" };
    }
  }

  let bestColumn = 0;
  let bestFilled = -1;
  const width = Math.max(...rows.map((row) => row.length));
  for (let col = 0; col < width; col += 1) {
    let filled = 0;
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      if ((rows[rowIndex][col] ?? "").trim()) {
        filled += 1;
      }
    }
    if (filled > bestFilled) {
      bestFilled = filled;
      bestColumn = col;
    }
  }

  return { columnIndex: bestColumn, label: `column ${bestColumn + 1}` };
}

function extractNamesFromCsv(rawText) {
  const rows = parseCsvRows(rawText).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) {
    return { names: [], sourceLabel: "CSV" };
  }

  const { columnIndex, label } = resolveCsvColumn(rows);
  if (columnIndex < 0) {
    return { names: [], sourceLabel: "CSV" };
  }

  const normalizedHeader = normalizeHeader((rows[0][columnIndex] ?? "").trim());
  const looksLikeHeader = HEADER_KEYWORDS.some((candidate) => normalizedHeader.includes(candidate));
  const start = looksLikeHeader ? 1 : 0;

  const names = [];
  for (let i = start; i < rows.length; i += 1) {
    const value = (rows[i][columnIndex] ?? "").trim();
    if (value) {
      names.push(value);
    }
  }

  return { names, sourceLabel: `CSV (${label})` };
}

function extractNamesFromLines(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t+/)[0]?.trim() ?? "")
    .filter(Boolean);

  if (lines.length > 1) {
    const first = normalizeHeader(lines[0]);
    if (HEADER_KEYWORDS.includes(first)) {
      lines.shift();
    }
  }

  return lines;
}

function parseNames(rawText) {
  const text = rawText.trim();
  let parsed = { names: [], sourceLabel: "newline list" };

  if (looksLikeCsv(text)) {
    parsed = extractNamesFromCsv(text);
  }

  if (parsed.names.length === 0) {
    parsed = { names: extractNamesFromLines(text), sourceLabel: "newline list" };
  }

  const names = dedupeNames(parsed.names);
  return { names, sourceLabel: parsed.sourceLabel };
}

function trimName(name, maxLength) {
  if (name.length <= maxLength) {
    return name;
  }
  return `${name.slice(0, maxLength - 1)}…`;
}

function resolveNameSegmentCount(poolSize) {
  if (poolSize <= 1) {
    return 1;
  }

  return Math.min(NAME_WHEEL_DISPLAY_COUNT, poolSize);
}

function resolveNameTextStyle(poolSize) {
  const dense = poolSize > 280;
  const smaller = poolSize > 1200;
  return {
    fontSize: smaller ? 10 : dense ? 11 : 12,
    maxLength: dense ? 10 : 14,
    fill: "rgba(236, 248, 255, 0.93)",
    stroke: poolSize > 900 ? "rgba(14, 24, 36, 0.8)" : null,
    strokeWidth: dense ? 1 : 0.6,
    shadowBlur: dense ? 2 : 0,
  };
}

function resolveNameSegmentTone(i) {
  const tones = [
    { fill: 1.16, edge: 0.22, stroke: 0.28, innerGlow: 0.18 },
    { fill: 0.72, edge: 0.12, stroke: 0.42, innerGlow: 0.08 },
  ];
  return tones[i % tones.length];
}

function sampleNameSequence(sourceBucket, winnerEntrantId, maxCount = NAME_WHEEL_DISPLAY_COUNT) {
  const sourceSize = sourceBucket.length;
  if (sourceSize === 0) {
    return { sequence: [], winnerIndex: -1 };
  }

  const targetSize = Math.min(maxCount, sourceSize);
  const sequence = new Array(targetSize);

  for (let i = 0; i < sourceSize; i += 1) {
    const entrantId = sourceBucket[i];
    if (i < targetSize) {
      sequence[i] = entrantId;
      continue;
    }

    const j = randomInt(i + 1);
    if (j < targetSize) {
      sequence[j] = entrantId;
    }
  }

  for (let i = targetSize - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const temp = sequence[i];
    sequence[i] = sequence[j];
    sequence[j] = temp;
  }

  if (!sequence.includes(winnerEntrantId)) {
    const replaceIndex = randomInt(targetSize);
    sequence[replaceIndex] = winnerEntrantId;
  }

  const winnerIndex = sequence.indexOf(winnerEntrantId);
  return { sequence, winnerIndex };
}

function modulo(value, base) {
  return ((value % base) + base) % base;
}

function hexToRgba(hex, alpha = 1) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((part) => part + part)
          .join("")
      : clean;
  const int = Number.parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeSpinDrama(t) {
  return 1 - Math.pow(1 - t, 1.68);
}

function easeNameSpinDecel(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return Math.sin((clamped * Math.PI) / 2);
}

function easeWinnerPulse(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return 0.5 - 0.5 * Math.cos(clamped * Math.PI);
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeInputSignature(rawText) {
  return (rawText ?? "").replace(/\r\n/g, "\n").trim();
}

function setMessage(text, tone = "info") {
  dom.message.textContent = text;
  const tones = {
    info: "#cde7ff",
    success: "#69efba",
    warn: "#ffd980",
    error: "#ff8b95",
  };
  dom.message.style.color = tones[tone] ?? tones.info;
}

function renderEnergyLabel(target, energy, fallbackText = "") {
  if (!target) {
    return;
  }

  target.textContent = "";
  if (!energy) {
    target.textContent = fallbackText || "Ready";
    return;
  }

  const icon = createEnergyIconNode(energy, {
    size: 18,
    className: "energy-icon energy-icon-inline",
  });
  if (icon) {
    target.append(icon);
  }

  const text = document.createTextNode(` ${energy.label}`);
  target.append(text);
}

function updateWinnerBanner({ energy = null, winnerName = "No winner yet", meta = "Load entrants and spin", flash = false }) {
  if (energy) {
    renderEnergyLabel(dom.winnerBannerEnergy, energy, "Ready");
  } else {
    dom.winnerBannerEnergy.textContent = "Ready";
  }
  dom.winnerBannerName.textContent = winnerName;
  dom.winnerBannerMeta.textContent = meta;

  if (flash) {
    window.clearTimeout(state.winnerFlashTimerId);
    dom.winnerBanner.classList.remove("flash");
    void dom.winnerBanner.offsetWidth;
    dom.winnerBanner.classList.add("flash");
    state.winnerFlashTimerId = window.setTimeout(() => {
      dom.winnerBanner.classList.remove("flash");
    }, 1600);
  } else {
    window.clearTimeout(state.winnerFlashTimerId);
    dom.winnerBanner.classList.remove("flash");
  }
}

function setWheelModeLabel(text) {
  dom.wheelModeLabel.textContent = text;
}

function setBusy(isBusy) {
  const disabled = Boolean(isBusy || state.isLoading || state.isSpinning);
  dom.spinBtn.disabled = disabled || state.activeTotal === 0;
  dom.loadBtn.disabled = disabled;
  dom.shuffleBtn.disabled = disabled;
  dom.clearBtn.disabled = disabled;
  dom.exportWinnersBtn.disabled = state.winners.length === 0 || disabled;

  if (disabled) {
    clearSpinHoldState();
  } else {
    setSpinButtonReadyState(false);
  }
}

function setSpinButtonReadyState(ready) {
  if (!dom.spinBtn) {
    return;
  }

  if (ready) {
    dom.spinBtn.classList.add("spin-armed");
    dom.spinBtn.textContent = "Release to Spin";
  } else {
    dom.spinBtn.classList.remove("spin-armed");
    dom.spinBtn.textContent = "Spin Two-Stage Draw";
  }
}

function clearSpinHoldState() {
  if (state.spinHoldTimerId) {
    window.clearTimeout(state.spinHoldTimerId);
    state.spinHoldTimerId = 0;
  }
  state.spinHoldReady = false;
  state.spinHoldAutoFireUntil = 0;
  setSpinButtonReadyState(false);
}

function handleSpinHoldStart() {
  if (state.isSpinning || state.isLoading || state.activeTotal <= 0) {
    return;
  }

  clearSpinHoldState();
  setMessage("Hold button to confirm spin.", "warn");
  state.spinHoldTimerId = window.setTimeout(() => {
    state.spinHoldReady = true;
    setSpinButtonReadyState(true);
    setMessage("Release now to confirm draw.", "warn");
  }, SPIN_HOLD_MS);
}

function handleSpinHoldEnd() {
  if (!state.spinHoldTimerId && !state.spinHoldReady) {
    return;
  }

  const triggerNow = state.spinHoldReady;
  clearSpinHoldState();
  if (!triggerNow) {
    setMessage("Quick confirm: click again to confirm draw.", "warn");
    return;
  }

  state.spinHoldAutoFireUntil = performance.now() + 220;
  void runDraw();
}

function handleSpinFallbackClick() {
  const now = performance.now();
  if (state.spinHoldAutoFireUntil > now) {
    return;
  }

  if (state.spinHoldReady) {
    state.spinHoldReady = false;
    clearSpinHoldState();
    void runDraw();
    return;
  }

  if (state.quickSpinConfirmUntil > now) {
    state.quickSpinConfirmUntil = 0;
    void runDraw();
    return;
  }

  state.quickSpinConfirmUntil = now + 700;
  setMessage("Hold to spin, or click again to confirm.", "warn");
}

function startSpinAura() {
  dom.spinAura?.classList.add("active");
}

function stopSpinAura() {
  dom.spinAura?.classList.remove("active");
}

function spawnSparkBurst() {
  const layer = dom.spinSparks;
  if (!layer) {
    return;
  }

  layer.innerHTML = "";
  const count = 34;
  const palette = [
    "#ffd75f",
    "#7ad4ff",
    "#ff8f6f",
    "#ffffff",
    "#8effc1",
    "#ff7ae0",
  ];

  for (let i = 0; i < count; i += 1) {
    const spark = document.createElement("span");
    spark.className = "spark";

    const angle = randomFloat() * TAU;
    const distance = 130 + randomFloat() * 280;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const width = 3 + Math.floor(randomFloat() * 5);
    const height = 2 + Math.floor(randomFloat() * 4);
    const duration = 900 + Math.floor(randomFloat() * 500);
    const delay = randomFloat() * 90;
    const spin = -300 + Math.floor(randomFloat() * 600);
    const color = palette[Math.floor(randomFloat() * palette.length)];

    spark.style.setProperty("--dx", `${dx}px`);
    spark.style.setProperty("--dy", `${dy}px`);
    spark.style.setProperty("--spin", `${spin}deg`);
    spark.style.width = `${width}px`;
    spark.style.height = `${height}px`;
    spark.style.background = color;
    spark.style.opacity = `${0.5 + randomFloat() * 0.45}`;
    spark.style.animationDuration = `${duration}ms`;
    spark.style.animationDelay = `${delay}ms`;

    layer.append(spark);
  }

  window.setTimeout(() => {
    if (layer) {
      layer.innerHTML = "";
    }
  }, 1700);
}

function setArtSlot(imgEl, sourcePath) {
  if (!imgEl) {
    return;
  }

  const slot = imgEl.closest(".art-slot");
  const source = typeof sourcePath === "string" ? sourcePath.trim() : "";
  if (slot) {
    slot.dataset.slotLabel = source || "custom art";
  }

  if (!source) {
    if (slot) {
      slot.classList.add("empty");
    }
    imgEl.removeAttribute("src");
    return;
  }

  imgEl.onload = () => {
    if (slot) {
      slot.classList.remove("empty");
    }
  };
  imgEl.onerror = () => {
    if (slot) {
      slot.classList.add("empty");
    }
    imgEl.removeAttribute("src");
  };
  imgEl.src = source;
}

function applyCustomArt() {
  setArtSlot(dom.artTopRight, CUSTOM_ART_PATHS.topRight);
}

function resetState() {
  state.entrants = [];
  state.buckets = ENERGIES.map(() => []);
  state.activeTotal = 0;
  state.drawCount = 0;
  state.winners = [];
  state.nameSpinSequence = null;
  state.lastLoadDurationMs = null;
  state.selectedEnergyIndex = -1;
  state.nameOffset = 0;
  state.namePointerEntrantId = null;
  state.nameWinnerPulse = 0;
  dom.winnerList.innerHTML = "";
  dom.lastWinner.textContent = "-";
}

function resetPoolState() {
  state.entrants = [];
  state.buckets = ENERGIES.map(() => []);
  state.activeTotal = 0;
  state.nameSpinSequence = null;
  state.selectedEnergyIndex = -1;
  state.nameOffset = 0;
  state.namePointerEntrantId = null;
  state.nameWinnerPulse = 0;
  dom.lastWinner.textContent = "-";
}

function refreshEmptyEntrantState({ showMessage = true, messageText = "", tone = "info" } = {}) {
  resetState();
  renderEnergyList();
  renderWinners();
  updateSummaryUI();
  setWheelModeLabel("Energy Wheel");
  drawEnergyWheel();
  updateWinnerBanner({
    winnerName: "No winner yet",
    meta: "Load entrants and spin",
  });

  if (showMessage) {
    setMessage(messageText || "No entrants loaded.", tone);
  }
}

function buildNameSpinSequence(activeBucket, winnerEntrantId) {
  return sampleNameSequence(activeBucket, winnerEntrantId, NAME_WHEEL_DISPLAY_COUNT);
}

function drawNameWheelFromSprite(activeBucket, winnerEntrantId = null, options = {}) {
  const sequenceBucket = state.nameSpinSequence ?? activeBucket;
  const visibleBucket = sequenceBucket && sequenceBucket.length > 0 ? sequenceBucket : activeBucket;
  drawNameWheel(visibleBucket, winnerEntrantId, {
    ...options,
    winnerPulse: options.winnerPulse ?? state.nameWinnerPulse,
  });
}

async function loadEntrantsFromNames(names, sourceLabel = "input") {
  const startedAt = performance.now();
  state.isLoading = true;
  setBusy(true);
  const preservedWinnerNames = new Set(state.winners.map((winner) => winner.name));
  resetPoolState();

  const capped = names.slice(0, MAX_ENTRANTS);
  const eligible = [];
  let skippedWinners = 0;
  for (const name of capped) {
    if (preservedWinnerNames.has(name)) {
      skippedWinners += 1;
      continue;
    }
    eligible.push(name);
  }

  if (names.length > MAX_ENTRANTS) {
    const overage = names.length - MAX_ENTRANTS;
    const winnerSuffix = skippedWinners > 0 ? ` (${skippedWinners.toLocaleString()} previous winners skipped)` : "";
    setMessage(
      `Loaded first ${MAX_ENTRANTS.toLocaleString()} names (${overage.toLocaleString()} skipped).${winnerSuffix}`,
      "warn",
    );
  } else {
    setMessage(
      `Loading ${eligible.length.toLocaleString()} names from ${sourceLabel}...`
      + (skippedWinners > 0 ? ` (${skippedWinners.toLocaleString()} previous winners skipped)` : ""),
      "info",
    );
  }

  const energyAssignments = createBalancedEnergyAssignments(eligible.length);
  const remainder = eligible.length % ENERGIES.length;
  const chunkSize = 2500;
  for (let i = 0; i < eligible.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, eligible.length);

    for (let idx = i; idx < end; idx += 1) {
      const name = eligible[idx];
      const energyIndex = energyAssignments[idx];
      const entrantId = state.entrants.length;
      const bucket = state.buckets[energyIndex];

      state.entrants.push({
        id: entrantId,
        name,
        energyIndex,
        active: true,
        bucketPos: bucket.length,
      });

      bucket.push(entrantId);
      state.activeTotal += 1;
    }

    updateSummaryUI();
    renderEnergyList();
    if (i + chunkSize < eligible.length) {
      setMessage(
        `Loading entrants... ${Math.min(i + chunkSize, eligible.length).toLocaleString()} / ${eligible.length.toLocaleString()}`,
      );
      await nextFrame();
    }
  }

  state.isLoading = false;
  setBusy(false);
  state.lastLoadDurationMs = performance.now() - startedAt;

  state.selectedEnergyIndex = -1;
  state.namePointerEntrantId = null;
  setWheelModeLabel("Energy Wheel");
  drawEnergyWheel();
  updateSummaryUI();
  updateWinnerBanner({
    winnerName: "No winner yet",
    meta: `Loaded from ${sourceLabel} in ${(state.lastLoadDurationMs / 1000).toFixed(2)}s`,
  });

  if (state.activeTotal === 0) {
    setMessage("No valid entrants found.", "warn");
  } else {
    const balanceNote =
      remainder === 0
        ? "exact balanced split"
        : `balanced split (+1 in ${remainder} bucket${remainder === 1 ? "" : "s"})`;
    setMessage(
      `Ready: ${state.activeTotal.toLocaleString()} active entrants across ${ENERGIES.length} energies (${balanceNote}).`
        + (skippedWinners > 0
          ? ` | ${skippedWinners.toLocaleString()} previous winners kept in history`
          : ""),
      "success",
    );
  }

  if (state.autoLoadQueued) {
    flushAutoLoadFromInput();
  }
}

function removeEntrantFromActivePool(entrantId) {
  const entrant = state.entrants[entrantId];
  if (!entrant || !entrant.active) {
    return;
  }

  const bucket = state.buckets[entrant.energyIndex];
  const removeIndex = entrant.bucketPos;
  const lastIndex = bucket.length - 1;
  const lastEntrantId = bucket[lastIndex];

  bucket[removeIndex] = lastEntrantId;
  state.entrants[lastEntrantId].bucketPos = removeIndex;
  bucket.pop();

  entrant.active = false;
  entrant.bucketPos = -1;
  state.activeTotal -= 1;
}

function pickEnergyWeighted() {
  if (state.activeTotal <= 0) {
    return -1;
  }

  const target = randomFloat() * state.activeTotal;
  let cumulative = 0;

  for (let i = 0; i < state.buckets.length; i += 1) {
    cumulative += state.buckets[i].length;
    if (target < cumulative) {
      return i;
    }
  }
  return state.buckets.length - 1;
}

function drawPokeballHub(ctx, cx, cy, hubRadius, options = {}) {
  const {
    alpha = 1,
    winnerHighlight = false,
    topColor = "rgba(228, 70, 84, 0.58)",
    bottomColor = "rgba(246, 251, 255, 0.64)",
  } = options;

  ctx.save();
  ctx.globalAlpha *= alpha;

  if (winnerHighlight) {
    ctx.save();
    ctx.shadowColor = "rgba(255, 226, 132, 0.8)";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(cx, cy, hubRadius + 5, 0, TAU);
    ctx.strokeStyle = "rgba(255, 226, 132, 0.72)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, hubRadius, 0, TAU);
  ctx.clip();

  ctx.fillStyle = topColor;
  ctx.fillRect(cx - hubRadius, cy - hubRadius, hubRadius * 2, hubRadius);

  ctx.fillStyle = bottomColor;
  ctx.fillRect(cx - hubRadius, cy, hubRadius * 2, hubRadius);

  const depthGradient = ctx.createLinearGradient(cx, cy - hubRadius, cx, cy + hubRadius);
  depthGradient.addColorStop(0, "rgba(255, 255, 255, 0.22)");
  depthGradient.addColorStop(0.48, "rgba(255, 255, 255, 0.06)");
  depthGradient.addColorStop(0.52, "rgba(0, 0, 0, 0.12)");
  depthGradient.addColorStop(1, "rgba(0, 0, 0, 0.28)");
  ctx.fillStyle = depthGradient;
  ctx.fillRect(cx - hubRadius, cy - hubRadius, hubRadius * 2, hubRadius * 2);

  const gloss = ctx.createRadialGradient(
    cx - hubRadius * 0.36,
    cy - hubRadius * 0.54,
    hubRadius * 0.06,
    cx - hubRadius * 0.36,
    cy - hubRadius * 0.54,
    hubRadius * 0.58,
  );
  gloss.addColorStop(0, "rgba(255, 255, 255, 0.7)");
  gloss.addColorStop(0.35, "rgba(255, 255, 255, 0.2)");
  gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(cx - hubRadius, cy - hubRadius, hubRadius * 2, hubRadius * 2);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, hubRadius, 0, TAU);
  ctx.strokeStyle = "rgba(7, 10, 14, 0.92)";
  ctx.lineWidth = Math.max(3, hubRadius * 0.08);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - hubRadius * 0.94, cy);
  ctx.lineTo(cx + hubRadius * 0.94, cy);
  ctx.strokeStyle = "rgba(5, 8, 12, 0.95)";
  ctx.lineWidth = Math.max(4, hubRadius * 0.12);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, hubRadius * 0.26, 0, TAU);
  ctx.fillStyle = "rgba(5, 8, 12, 0.94)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, hubRadius * 0.16, 0, TAU);
  const buttonGradient = ctx.createRadialGradient(
    cx - hubRadius * 0.04,
    cy - hubRadius * 0.05,
    hubRadius * 0.04,
    cx,
    cy,
    hubRadius * 0.18,
  );
  buttonGradient.addColorStop(0, "rgba(255, 255, 255, 0.98)");
  buttonGradient.addColorStop(1, "rgba(223, 232, 241, 0.95)");
  ctx.fillStyle = buttonGradient;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, hubRadius * 0.16, 0, TAU);
  ctx.strokeStyle = "rgba(9, 15, 24, 0.78)";
  ctx.lineWidth = Math.max(1.6, hubRadius * 0.02);
  ctx.stroke();

  ctx.restore();
}

function drawNameCenterLabel(ctx, cx, cy, entrant) {
  if (!entrant) {
    return;
  }

  const label = trimName(entrant.name, 18);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
  ctx.strokeStyle = "rgba(4, 8, 12, 0.9)";
  ctx.lineWidth = 2.4;
  ctx.font = "700 22px Rajdhani";
  ctx.strokeText(label, cx, cy + 10);
  ctx.fillText(label, cx, cy + 10);
  ctx.restore();
}

function drawEnergyWheel(options = {}) {
  const {
    clear = true,
    alpha = 1,
    highlightIndex = state.selectedEnergyIndex,
    centerTopText = "ACTIVE",
    centerBottomText = state.activeTotal.toLocaleString(),
    centerTopEnergy = null,
  } = options;

  const ctx = wheelCtx;
  const canvas = dom.wheelCanvas;
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.47;
  const segmentAngle = TAU / ENERGIES.length;

  if (clear) {
    ctx.clearRect(0, 0, width, height);
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(state.energyRotation);

  for (let i = 0; i < ENERGIES.length; i += 1) {
    const energy = ENERGIES[i];
    const start = i * segmentAngle;
    const end = start + segmentAngle;

    const gradient = ctx.createRadialGradient(0, 0, radius * 0.22, 0, 0, radius);
    gradient.addColorStop(0, hexToRgba(energy.color, 0.98));
    gradient.addColorStop(1, "rgba(8, 17, 27, 0.95)");

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.lineWidth = i === highlightIndex ? 5 : 2;
    ctx.strokeStyle = i === highlightIndex ? "rgba(255, 238, 146, 0.95)" : "rgba(196, 223, 255, 0.25)";
    ctx.stroke();

    const mid = start + segmentAngle / 2;
    const iconRadius = radius * 0.67;
    const textRadius = radius * 0.84;

    ctx.save();
    ctx.rotate(mid);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f4fcff";
    const icon = ensureEnergyIcon(energy);
    if (icon) {
      const energyIconSize = Math.max(24, radius * 0.11);
      ctx.drawImage(icon, iconRadius - energyIconSize / 2, -energyIconSize / 2, energyIconSize, energyIconSize);
    } else {
      ctx.font = "700 33px Rajdhani";
      ctx.fillText(energy.iconText, iconRadius, 12);
    }

    ctx.font = "700 18px Rajdhani";
    ctx.fillStyle = "rgba(235, 246, 255, 0.95)";
    ctx.fillText(energy.label, textRadius, 8);

    ctx.font = "600 14px Rajdhani";
    ctx.fillStyle = "rgba(205, 223, 244, 0.88)";
    ctx.fillText(state.buckets[i].length.toLocaleString(), textRadius, 26);
    ctx.restore();
  }

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  const hubRadius = radius * 0.24;
  drawPokeballHub(ctx, cx, cy, hubRadius);

  ctx.fillStyle = "rgba(19, 27, 36, 0.95)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(255, 255, 255, 0.4)";
  ctx.shadowBlur = 4;
  ctx.font = "700 19px Rajdhani";
  let centerTopY = cy - hubRadius * 0.36;
  const topEnergy = centerTopEnergy || null;
  const topIcon = topEnergy ? ensureEnergyIcon(topEnergy) : null;

  if (topIcon) {
    const topIconSize = Math.max(24, hubRadius * 0.26);
    const topIconY = centerTopY - topIconSize * 0.18;
    const iconX = cx - topIconSize / 2;
    const iconY = topIconY - topIconSize / 2 + 2;
    ctx.drawImage(topIcon, iconX, iconY, topIconSize, topIconSize);
    centerTopY = topIconY + topIconSize * 0.78;
  } else if (topEnergy?.iconText) {
    const topText = centerTopText || `${topEnergy.label}`;
    const energyIconText = topEnergy.iconText;
    ctx.font = "700 24px Rajdhani";
    ctx.fillText(energyIconText, cx - (topText.length > 0 ? 18 : 0), centerTopY);
    centerTopY += 18;
  }

  ctx.fillText(centerTopText, cx, centerTopY);
  ctx.font = "700 25px Rajdhani";
  ctx.fillText(centerBottomText, cx, cy + hubRadius * 0.4);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawNameWheel(bucket = null, winnerEntrantId = null, options = {}) {
  const {
    colorOverride = null,
    clear = true,
    alpha = 1,
    winnerPulse = state.nameWinnerPulse,
  } = options;
  const ctx = wheelCtx;
  const canvas = dom.wheelCanvas;
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.47;

  if (clear) {
    ctx.clearRect(0, 0, width, height);
  }

  const energyIndex = state.selectedEnergyIndex;
  const energy = energyIndex >= 0 ? ENERGIES[energyIndex] : null;
  const displayColor = colorOverride ?? (energy ? energy.color : null);
  const activeBucket = bucket ?? (energyIndex >= 0 ? state.buckets[energyIndex] : null);

  ctx.save();
  ctx.globalAlpha = alpha;

  if (!activeBucket || activeBucket.length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    const idleGrad = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
    idleGrad.addColorStop(0, "rgba(26, 58, 99, 0.8)");
    idleGrad.addColorStop(1, "rgba(8, 14, 22, 0.96)");
    ctx.fillStyle = idleGrad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(180, 214, 251, 0.28)";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(205, 227, 247, 0.9)";
    ctx.font = "700 36px Rajdhani";
    ctx.fillText("Name Wheel", cx, cy - 20);
    ctx.font = "600 22px Rajdhani";
    ctx.fillStyle = "rgba(173, 200, 231, 0.9)";
    ctx.fillText("Spin an energy to fill this wheel", cx, cy + 20);
    ctx.restore();
    return;
  }

  const segmentCount = resolveNameSegmentCount(activeBucket.length);
  const segmentAngle = TAU / segmentCount;
  const rawOffset = state.nameOffset;
  const base = Math.floor(rawOffset + NAME_WHEEL_FLOOR_EPS);
  const fractional = rawOffset - base;
  const winnerPulseAlpha = Math.max(0, Math.min(1, winnerPulse));
  const textStyle = resolveNameTextStyle(activeBucket.length);
  const pointerEntrantId = activeBucket[modulo(base, segmentCount)];

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 2 - segmentAngle / 2 - fractional * segmentAngle);

  for (let i = 0; i < segmentCount; i += 1) {
    const start = i * segmentAngle;
    const end = start + segmentAngle;
    const bucketIndex = modulo(base + i, segmentCount);
    if (bucketIndex == null) {
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();

    const tone = resolveNameSegmentTone(bucketIndex);
    const baseShade = displayColor ? hexToRgba(displayColor, tone.fill) : `rgba(103, 142, 191, 0.48)`;
    const edgeShade = displayColor
      ? hexToRgba(displayColor, tone.edge)
      : "rgba(22, 55, 110, 0.88)";
    const grad = ctx.createRadialGradient(0, 0, radius * 0.14, 0, 0, radius);
    grad.addColorStop(0, baseShade);
    grad.addColorStop(1, edgeShade);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = displayColor
      ? hexToRgba(displayColor, tone.stroke)
      : "rgba(194, 227, 255, 0.22)";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = "rgba(255, 255, 255, 0.07)";
    ctx.shadowBlur = tone.innerGlow * 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const entrantId = activeBucket[bucketIndex];
    const entrant = state.entrants[entrantId];
    if (!entrant) {
      continue;
    }

    const isWinnerSegment = winnerEntrantId === entrant.id;
    const nameRadius = radius * 0.79;
    const nameMaxLength = textStyle.maxLength;
    const mid = start + segmentAngle / 2;

    ctx.save();
    ctx.rotate(mid);
    ctx.textAlign = "center";
    ctx.fillStyle = isWinnerSegment && winnerPulseAlpha > 0
      ? "#fffdd9"
      : textStyle.fill;
    ctx.font = `700 ${textStyle.fontSize}px Rajdhani`;

    if (textStyle.stroke && winnerPulseAlpha > 0) {
      ctx.strokeStyle = textStyle.stroke;
      ctx.lineWidth = isWinnerSegment ? textStyle.strokeWidth + 0.2 : textStyle.strokeWidth;
      ctx.strokeText(trimName(entrant.name, nameMaxLength), nameRadius, 4);
    }
    if (winnerPulseAlpha > 0 && textStyle.shadowBlur) {
      ctx.shadowColor = isWinnerSegment ? "rgba(255, 255, 255, 0.75)" : "rgba(255, 255, 255, 0.22)";
      ctx.shadowBlur = textStyle.shadowBlur + (isWinnerSegment ? 2 : 0);
    }
    ctx.fillText(trimName(entrant.name, nameMaxLength), nameRadius, 4);
    ctx.restore();

  }

  ctx.restore();

  state.namePointerEntrantId = pointerEntrantId;
  const pointerEntrant = state.entrants[pointerEntrantId];
  if (!pointerEntrant) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.32, 0, TAU);
    ctx.fillStyle = "rgba(8, 20, 36, 0.9)";
    ctx.fill();
    ctx.restore();
    return;
  }

  const hubRadius = radius * 0.32;
  drawPokeballHub(ctx, cx, cy, hubRadius, {
    winnerHighlight: winnerEntrantId === pointerEntrantId && winnerPulseAlpha > 0,
  });

  drawNameCenterLabel(ctx, cx, cy, pointerEntrant);

  ctx.shadowBlur = 0;
  ctx.restore();
}

function animate(durationMs, onFrame, easingFn = (t) => t) {
  return new Promise((resolve) => {
    const startedAt = performance.now();

    function frame(now) {
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / durationMs);
      onFrame(easingFn(t), t);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

async function animateEnergySpin(targetEnergyIndex) {
  const segmentAngle = TAU / ENERGIES.length;
  const targetCenter = -Math.PI / 2 - (targetEnergyIndex * segmentAngle + segmentAngle / 2);
  const currentRotation = modulo(state.energyRotation, TAU);
  const delta = modulo(targetCenter - currentRotation, TAU);
  const extraTurns = 7 + randomInt(3);
  const finalRotation = currentRotation + extraTurns * TAU + delta;

  await animate(
    6200,
    (eased) => {
      state.energyRotation = currentRotation + (finalRotation - currentRotation) * eased;
      drawEnergyWheel({
        highlightIndex: -1,
        centerTopText: "ROLLING",
        centerBottomText: "ENERGY",
      });
    },
    easeSpinDrama,
  );

  state.energyRotation = modulo(finalRotation, TAU);
}

async function animateEnergyToNamesTransition(displaySequence, activeCount, energy) {
  await animate(
    650,
    (eased) => {
      wheelCtx.clearRect(0, 0, dom.wheelCanvas.width, dom.wheelCanvas.height);
      drawEnergyWheel({
        clear: false,
        alpha: 1 - eased,
        highlightIndex: state.selectedEnergyIndex,
        centerTopEnergy: energy,
        centerTopText: energy.label,
        centerBottomText: `${activeCount.toLocaleString()} IN POOL`,
      });
      drawNameWheel(displaySequence, null, {
        clear: false,
        alpha: eased,
      });
    },
    easeOutCubic,
  );
}

async function animateWinnerPause(nameSequence, winnerEntrantId) {
  await animate(
    NAME_REVEAL_MS,
    (eased) => {
      state.nameWinnerPulse = easeWinnerPulse(eased);
      drawNameWheelFromSprite(nameSequence, winnerEntrantId, {
        winnerPulse: state.nameWinnerPulse,
      });
    },
    (t) => t,
  );
  state.nameWinnerPulse = 0;
  drawNameWheelFromSprite(nameSequence, winnerEntrantId);
}

async function animateNameSpin(nameSequence, winnerEntrantId) {
  if (nameSequence.length === 1) {
    const fallbackIndex = nameSequence.indexOf(winnerEntrantId);
    const singleWinnerIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
    state.nameOffset = singleWinnerIndex;
    state.nameSpinSequence = nameSequence;
    state.nameWinnerPulse = 0.9;
    drawNameWheelFromSprite(nameSequence, winnerEntrantId);
    return;
  }

  const sequence = nameSequence;
  const winnerIndex = sequence.indexOf(winnerEntrantId);
  const n = sequence.length;
  const resolvedWinnerIndex = winnerIndex >= 0 ? winnerIndex : randomInt(n);
  state.nameSpinSequence = sequence;

  const loops = NAME_SPIN_LOOPS;
  const startOffset = randomFloat() * n;
  const finalOffset = resolvedWinnerIndex + loops * n;
  const totalDistance = finalOffset - startOffset;
  const duration = NAME_SPIN_DURATION_MS;
  state.nameOffset = startOffset;

  await animate(duration, (t) => {
    const easedT = easeNameSpinDecel(t);
    const targetOffset = startOffset + totalDistance * easedT;
    state.nameOffset = targetOffset;
    drawNameWheelFromSprite(nameSequence, winnerEntrantId, {
      winnerPulse: state.nameWinnerPulse,
    });
  });

  state.nameOffset = finalOffset;

  state.nameWinnerPulse = 0.9;
  drawNameWheelFromSprite(nameSequence, winnerEntrantId, {
    winnerPulse: 0.9,
  });
}

function renderEnergyList() {
  const fragment = document.createDocumentFragment();

  ENERGIES.forEach((energy, index) => {
    const entry = document.createElement("div");
    entry.className = "energy-item";
    entry.style.background = `linear-gradient(160deg, ${hexToRgba(energy.color, 0.4)}, rgba(8, 16, 27, 0.85))`;

    const left = document.createElement("span");
    left.className = "energy-tag";
    const icon = createEnergyIconNode(energy, {
      size: 16,
      className: "energy-icon energy-icon-small",
    });
    if (icon) {
      left.append(icon);
    } else {
      left.textContent = `${energy.iconText ?? ""} `;
    }
    const label = document.createElement("span");
    label.textContent = energy.label;
    left.append(label);

    const right = document.createElement("strong");
    right.textContent = state.buckets[index].length.toLocaleString();

    entry.append(left, right);
    fragment.append(entry);
  });

  dom.energyList.innerHTML = "";
  dom.energyList.append(fragment);
}

function renderWinners() {
  const show = state.winners.slice(0, 5);
  const fragment = document.createDocumentFragment();

  for (const winner of show) {
    const li = document.createElement("li");
    if (winner.draw === state.drawCount) {
      li.classList.add("winner-new");
    }

    li.className = "winner-ticker-item";
    const title = document.createElement("div");
    title.className = "winner-inline";

    const drawText = document.createElement("span");
    drawText.textContent = `#${winner.draw} `;
    title.append(drawText);

    const energySpan = document.createElement("span");
    energySpan.className = "winner-inline-energy";
    const winnerEnergy = ENERGIES.find((energy) => energy.id === winner.energyId) ?? null;
    const winnerEnergyIcon = winnerEnergy ? createEnergyIconNode(winnerEnergy, {
      size: 14,
      className: "energy-icon energy-icon-inline",
    }) : null;
    if (winnerEnergyIcon) {
      energySpan.append(winnerEnergyIcon);
    } else {
      energySpan.textContent = `${winner.energyLabel || ""} `;
    }

    const winnerEnergyLabel = document.createElement("span");
    winnerEnergyLabel.textContent = winner.energyLabel || "";
    energySpan.append(winnerEnergyLabel);
    title.append(energySpan);
    title.append(document.createTextNode(` • ${winner.name} • ${winner.timestamp}`));

    li.append(title);
    fragment.append(li);
  }

  dom.winnerList.innerHTML = "";
  dom.winnerList.append(fragment);
}

function updateSummaryUI() {
  dom.totalCount.textContent = state.entrants.length.toLocaleString();
  dom.activeCount.textContent = state.activeTotal.toLocaleString();
  dom.drawCount.textContent = state.drawCount.toLocaleString();
  dom.loadTime.textContent =
    state.lastLoadDurationMs == null
      ? "-"
      : `${state.lastLoadDurationMs >= 1000 ? (state.lastLoadDurationMs / 1000).toFixed(2) : Math.round(state.lastLoadDurationMs)}${
          state.lastLoadDurationMs >= 1000 ? "s" : "ms"
        }`;
  dom.selectedEnergy.textContent =
    state.selectedEnergyIndex >= 0 ? `Energy: ${ENERGIES[state.selectedEnergyIndex].label}` : "Energy: -";
  dom.subsetCount.textContent =
    state.selectedEnergyIndex >= 0
      ? `Pool: ${state.buckets[state.selectedEnergyIndex].length.toLocaleString()}`
      : "Pool: 0";

  dom.exportWinnersBtn.disabled = state.winners.length === 0 || state.isLoading || state.isSpinning;
}

async function runDraw() {
  if (state.isSpinning || state.isLoading) {
    return;
  }

  if (state.activeTotal <= 0) {
    setMessage("No active entrants left.", "warn");
    return;
  }

  const energyIndex = pickEnergyWeighted();
  if (energyIndex < 0) {
    setMessage("Could not select an energy pool.", "error");
    return;
  }

  const activeBucket = state.buckets[energyIndex];
  if (activeBucket.length === 0) {
    setMessage("Selected energy pool is empty. Try again.", "warn");
    return;
  }

  const winnerBucketIndex = randomInt(activeBucket.length);
  const winnerEntrantId = activeBucket[winnerBucketIndex];
  const winnerEntrant = state.entrants[winnerEntrantId];
  const energy = ENERGIES[energyIndex];
  const { sequence: nameSequence } = buildNameSpinSequence(activeBucket, winnerEntrantId);

  state.isSpinning = true;
  setBusy(true);
  setWheelModeLabel("Energy Wheel");
  startSpinAura();
  setMessage(
    `Spinning weighted energy wheel (${state.activeTotal.toLocaleString()} active entrants)...`,
    "info",
  );

  state.selectedEnergyIndex = -1;
  updateSummaryUI();
  updateWinnerBanner({
    winnerName: "Spinning...",
    meta: "Rolling energy wheel",
  });

  setMessage("Preparing to spin...", "info");
  await animateEnergySpin(energyIndex);
  state.selectedEnergyIndex = energyIndex;
  updateSummaryUI();
  drawEnergyWheel({
    highlightIndex: energyIndex,
    centerTopEnergy: energy,
    centerTopText: energy.label,
    centerBottomText: `${activeBucket.length.toLocaleString()} IN POOL`,
  });
  updateWinnerBanner({
    energy,
    winnerName: `${energy.label} Selected`,
    meta: `${activeBucket.length.toLocaleString()} entrants in this energy pool`,
  });
  setMessage(`Energy selected: ${energy.label}. Pool size: ${activeBucket.length.toLocaleString()}.`, "success");
  setMessage(`Spinning ${nameSequence.length.toLocaleString()} names in ${energy.label} pool...`, "info");
  setWheelModeLabel("Name Wheel");
  await animateEnergyToNamesTransition(nameSequence, activeBucket.length, energy);
  updateWinnerBanner({
    energy,
    winnerName: "Spinning Names...",
    meta: "Final roll for winner",
  });

  await animateNameSpin(nameSequence, winnerEntrantId);
  spawnSparkBurst();
  await animateWinnerPause(nameSequence, winnerEntrantId);

  state.drawCount += 1;
  const timestamp = new Date().toLocaleTimeString();
  state.winners.unshift({
    draw: state.drawCount,
    entrantId: winnerEntrantId,
    name: winnerEntrant.name,
    energyLabel: energy.label,
    energyId: energy.id,
    energyIconPath: energy.iconPath,
    timestamp,
  });

  dom.lastWinner.textContent = winnerEntrant.name;

  removeEntrantFromActivePool(winnerEntrantId);

  renderEnergyList();
  renderWinners();
  updateSummaryUI();
  setWheelModeLabel("Name Wheel Result");

  state.isSpinning = false;
  setBusy(false);
  updateWinnerBanner({
    energy,
    winnerName: winnerEntrant.name,
    meta: `Draw #${state.drawCount} winner`,
    flash: true,
  });
  setMessage(`Winner: ${winnerEntrant.name} (${energy.label})`, "success");
  stopSpinAura();

  flushAutoLoadFromInput();
}

function exportWinners() {
  if (state.winners.length === 0) {
    setMessage("No winners to export yet.", "warn");
    return;
  }

  const rows = ["draw,timestamp,energy,name"];
  for (const winner of [...state.winners].reverse()) {
    const safeName = winner.name.replaceAll("\"", "\"\"");
    rows.push(`${winner.draw},"${winner.timestamp}",${winner.energyLabel},"${safeName}"`);
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pokewheel_winners_${Date.now()}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  setMessage(`Exported ${state.winners.length.toLocaleString()} winners.`, "success");
}

function scheduleAutoLoadFromInput() {
  const currentSignature = normalizeInputSignature(dom.namesInput.value);
  if (state.isLoading || state.isSpinning) {
    state.autoLoadQueued = true;
    return;
  }

  if (currentSignature === state.lastLoadedInputSignature) {
    state.autoLoadQueued = false;
    return;
  }

  if (state.autoLoadTimerId) {
    window.clearTimeout(state.autoLoadTimerId);
  }

  state.autoLoadTimerId = window.setTimeout(() => {
    state.autoLoadTimerId = 0;
    void loadEntrantsFromCurrentInput({ auto: true });
  }, AUTO_LOAD_DEBOUNCE_MS);
}

function flushAutoLoadFromInput() {
  if (!state.autoLoadQueued) {
    return;
  }

  state.autoLoadQueued = false;
  void loadEntrantsFromCurrentInput({ auto: true });
}

function shuffleArrayInPlace(values) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const temp = values[i];
    values[i] = values[j];
    values[j] = temp;
  }

  return values;
}

async function loadEntrantsFromCurrentInput(options = {}) {
  const { auto = false } = options;

  if (state.isLoading || state.isSpinning) {
    state.autoLoadQueued = true;
    return;
  }

  const raw = dom.namesInput.value;
  const signature = normalizeInputSignature(raw);
  state.lastLoadedInputSignature = signature;

  if (!signature) {
    state.autoLoadQueued = false;
    if (!auto) {
      setMessage("Paste names first.", "warn");
    } else {
      refreshEmptyEntrantState({ showMessage: false });
      setBusy(false);
    }
    return;
  }

  const { names, sourceLabel } = parseNames(raw);

  if (names.length === 0) {
    state.autoLoadQueued = false;
    if (!auto) {
      setMessage("No valid names found in input.", "warn");
    } else {
      refreshEmptyEntrantState({ showMessage: false });
    }
    return;
  }

  dom.namesInput.value = names.join("\n");
  state.lastLoadedInputSignature = normalizeInputSignature(dom.namesInput.value);
  state.autoLoadQueued = false;
  window.clearTimeout(state.autoLoadTimerId);
  state.autoLoadTimerId = 0;
  await loadEntrantsFromNames(names, sourceLabel);
}

async function handleLoadFromText() {
  await loadEntrantsFromCurrentInput();
}

async function handleShuffleEntrants() {
  if (state.isLoading || state.isSpinning) {
    return;
  }

  const raw = dom.namesInput.value;
  const { names, sourceLabel } = parseNames(raw);

  if (names.length === 0) {
    setMessage("No valid names found to shuffle.", "warn");
    return;
  }

  const shuffled = shuffleArrayInPlace([...names]);
  dom.namesInput.value = shuffled.join("\n");
  state.lastLoadedInputSignature = normalizeInputSignature(dom.namesInput.value);
  if (state.autoLoadTimerId) {
    window.clearTimeout(state.autoLoadTimerId);
    state.autoLoadTimerId = 0;
  }
  state.autoLoadQueued = false;
  await loadEntrantsFromNames(shuffled, sourceLabel);
  setMessage(`Shuffled ${shuffled.length.toLocaleString()} names.`, "success");
}

function clearAll() {
  if (state.isSpinning || state.isLoading) {
    return;
  }

  dom.namesInput.value = "";
  state.lastLoadedInputSignature = "";
  if (state.autoLoadTimerId) {
    window.clearTimeout(state.autoLoadTimerId);
    state.autoLoadTimerId = 0;
  }
  state.autoLoadQueued = false;
  refreshEmptyEntrantState({ showMessage: true, messageText: "Cleared entrants and winners.", tone: "info" });
  setBusy(false);
}

function attachEvents() {
  dom.namesInput.addEventListener("input", scheduleAutoLoadFromInput);
  dom.loadBtn.addEventListener("click", () => {
    void handleLoadFromText();
  });

  dom.shuffleBtn.addEventListener("click", () => {
    void handleShuffleEntrants();
  });

  dom.clearBtn.addEventListener("click", clearAll);
  dom.spinBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handleSpinHoldStart();
  });
  dom.spinBtn.addEventListener("pointerup", () => {
    handleSpinHoldEnd();
  });
  dom.spinBtn.addEventListener("pointercancel", () => {
    clearSpinHoldState();
  });
  dom.spinBtn.addEventListener("pointerleave", () => {
    clearSpinHoldState();
  });
  dom.spinBtn.addEventListener("click", () => {
    handleSpinFallbackClick();
  });

  dom.exportWinnersBtn.addEventListener("click", exportWinners);
}

function init() {
  void (async () => {
    await preloadEnergyIcons();
    applyCustomArt();
    renderEnergyList();
    updateSummaryUI();
    setWheelModeLabel("Energy Wheel");
    drawEnergyWheel();
    updateWinnerBanner({
      winnerName: "No winner yet",
      meta: "Load entrants and spin",
    });
    attachEvents();
    setBusy(false);
  })();
}

init();
