// popup.js

const STORAGE_KEYS = {
  SETTINGS: "settings",
  LOGS: "logs",
  STATE: "automationState"
};

const DEFAULT_SETTINGS = {
  template: "",
  minDelay: 60,
  maxDelay: 180,
  dryRun: true
};

const DEFAULT_STATE = {
  currentState: "IDLE",
  processedCount: 0,
  sentCount: 0,
  skippedCount: 0,
  remaining: "Unknown",
  countdown: null
};

// Elements
const elements = {
  template: document.getElementById("messageTemplate"),
  minDelay: document.getElementById("minDelay"),
  maxDelay: document.getElementById("maxDelay"),
  dryRun: document.getElementById("dryRun"),

  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  stopBtn: document.getElementById("stopBtn"),

  processedCount: document.getElementById("processedCount"),
  sentCount: document.getElementById("sentCount"),
  skippedCount: document.getElementById("skippedCount"),
  remainingCount: document.getElementById("remainingCount"),

  currentState: document.getElementById("currentState"),
  countdownValue: document.getElementById("countdownValue"),

  logPanel: document.getElementById("logPanel"),
  exportLogsBtn: document.getElementById("exportLogsBtn"),

  errorContainer: document.getElementById("errorContainer")
};

document.addEventListener("DOMContentLoaded", initialize);

/* -------------------------------------------------------------------------- */
/* Initialization                                                             */
/* -------------------------------------------------------------------------- */

async function initialize() {
  await loadSettings();
  await refreshState();
  await loadLogs();

  registerEventListeners();

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.storage.onChanged.addListener(handleStorageChanges);
}

function registerEventListeners() {
  elements.startBtn.addEventListener("click", handleStart);
  elements.pauseBtn.addEventListener("click", handlePause);
  elements.resumeBtn.addEventListener("click", handleResume);
  elements.stopBtn.addEventListener("click", handleStop);

  elements.exportLogsBtn.addEventListener("click", exportLogs);

  elements.template.addEventListener("input", saveSettings);
  elements.minDelay.addEventListener("change", saveSettings);
  elements.maxDelay.addEventListener("change", saveSettings);
  elements.dryRun.addEventListener("change", saveSettings);
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.SETTINGS] || {})
  };

  elements.template.value = settings.template;
  elements.minDelay.value = settings.minDelay;
  elements.maxDelay.value = settings.maxDelay;
  elements.dryRun.checked = settings.dryRun;
}

async function saveSettings() {
  const settings = getFormSettings();

  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: settings
  });
}

function getFormSettings() {
  return {
    template: elements.template.value.trim(),
    minDelay: Number(elements.minDelay.value),
    maxDelay: Number(elements.maxDelay.value),
    dryRun: elements.dryRun.checked
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function validateSettings(settings) {
  clearError();
  // All validations bypassed for extraction phase
  return true;
}

function showError(message) {
  elements.errorContainer.hidden = false;
  elements.errorContainer.textContent = message;
}

function clearError() {
  elements.errorContainer.hidden = true;
  elements.errorContainer.textContent = "";
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                     */
/* -------------------------------------------------------------------------- */

async function handleStart() {
  const settings = getFormSettings();

  if (!validateSettings(settings)) {
    return;
  }

  await saveSettings();

  sendCommand({
    action: "START",
    settings
  });
}

function handlePause() {
  sendCommand({
    action: "PAUSE"
  });
}

function handleResume() {
  sendCommand({
    action: "RESUME"
  });
}

function handleStop() {
  sendCommand({
    action: "STOP"
  });
}

async function sendCommand(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);

    if (!response?.success && response?.error) {
      showError(response.error);
    }
  } catch (error) {
    showError(error.message || "Failed to communicate with background.");
  }
}

/* -------------------------------------------------------------------------- */
/* State                                                                        */
/* -------------------------------------------------------------------------- */

async function refreshState() {
  const result = await chrome.storage.local.get(
    STORAGE_KEYS.STATE
  );

  const state = {
    ...DEFAULT_STATE,
    ...(result[STORAGE_KEYS.STATE] || {})
  };

  updateProgress(state);
  updateControls(state.currentState);
}

function updateProgress(state) {
  elements.processedCount.textContent =
    state.processedCount ?? 0;

  elements.sentCount.textContent =
    state.sentCount ?? 0;

  elements.skippedCount.textContent =
    state.skippedCount ?? 0;

  elements.remainingCount.textContent =
    state.remaining ?? "Unknown";

  elements.currentState.textContent =
    state.currentState || "IDLE";

  elements.countdownValue.textContent =
    state.countdown != null
      ? `${state.countdown}s`
      : "—";
}

function updateControls(currentState) {
  const state = currentState || "IDLE";

  elements.startBtn.disabled =
    state !== "IDLE" &&
    state !== "STOPPED";

  elements.pauseBtn.disabled =
    state !== "PROCESSING" &&
    state !== "WAITING_DELAY";

  elements.resumeBtn.disabled =
    state !== "PAUSED";

  elements.stopBtn.disabled =
    state === "IDLE" ||
    state === "STOPPED";
}

/* -------------------------------------------------------------------------- */
/* Logs                                                                         */
/* -------------------------------------------------------------------------- */

async function loadLogs() {
  const result = await chrome.storage.local.get(
    STORAGE_KEYS.LOGS
  );

  const logs = result.logs || [];

  elements.logPanel.innerHTML = "";

  if (!logs.length) {
    appendLog({
      level: "INFO",
      message: "Waiting for action...",
      timestamp: new Date().toISOString()
    });

    return;
  }

  logs.forEach(renderLog);
}

function appendLog(log) {
  renderLog(log);

  chrome.storage.local.get(STORAGE_KEYS.LOGS)
    .then(result => {
      const logs = result.logs || [];

      logs.push(log);

      return chrome.storage.local.set({
        logs
      });
    })
    .catch(console.error);
}

function renderLog(log) {
  const entry = document.createElement("div");

  entry.className =
    `log-entry ${log.level.toLowerCase()}`;

  entry.textContent =
    `[${formatTimestamp(log.timestamp)}] `
    + `[${log.level}] `
    + log.message;

  elements.logPanel.appendChild(entry);

  elements.logPanel.scrollTop =
    elements.logPanel.scrollHeight;
}

async function exportLogs() {
  const result = await chrome.storage.local.get(
    STORAGE_KEYS.LOGS
  );

  const logs = result.logs || [];

  const text = logs
    .map(log =>
      `[${formatTimestamp(log.timestamp)}] `
      + `[${log.level}] `
      + log.message
    )
    .join("\n");

  const blob = new Blob(
    [text],
    { type: "text/plain" }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = "facebook-group-logs.txt";

  link.click();

  URL.revokeObjectURL(url);
}

function formatTimestamp(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Runtime Messages                                                            */
/* -------------------------------------------------------------------------- */

function handleRuntimeMessage(message) {
  if (!message?.type) {
    return;
  }

  switch (message.type) {
    case "STATE_UPDATE":
      updateProgress(message.state);
      updateControls(message.state.currentState);
      break;

    case "LOG":
      appendLog(message.log);
      break;

    case "ERROR":
      showError(message.message);
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Storage Synchronization                                                     */
/* -------------------------------------------------------------------------- */

function handleStorageChanges(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes.automationState) {
    const state =
      changes.automationState.newValue;

    updateProgress(state);
    updateControls(state.currentState);
  }

  if (changes.logs) {
    const oldLogs =
      changes.logs.oldValue || [];

    const newLogs =
      changes.logs.newValue || [];

    if (newLogs.length > oldLogs.length) {
      const latest =
        newLogs[newLogs.length - 1];

      renderLog(latest);
    }
  }
}