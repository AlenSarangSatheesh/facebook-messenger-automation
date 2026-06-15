// background.js

const STATES = {
  IDLE: "IDLE",
  STARTING: "STARTING",
  PROCESSING: "PROCESSING",
  WAITING_DELAY: "WAITING_DELAY",
  PAUSED: "PAUSED",
  STOPPED: "STOPPED"
};

const STORAGE_KEYS = {
  STATE: "automationState",
  LOGS: "logs"
};

const DEFAULT_STATE = {
  running: false,
  paused: false,

  currentState: STATES.IDLE,

  currentMemberIndex: 0,
  processedMembers: {},

  processedCount: 0,
  sentCount: 0,
  skippedCount: 0,

  remaining: "Unknown",
  countdown: null,

  settings: null
};

let automationState = { ...DEFAULT_STATE };
let countdownTimer = null;

initialize();

/* -------------------------------------------------------------------------- */
/* Initialization                                                             */
/* -------------------------------------------------------------------------- */

async function initialize() {
  await restoreState();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  });

  log("INFO", "Background service worker initialized.");

  if (automationState.running && automationState.currentState !== STATES.STOPPED && automationState.currentState !== STATES.PAUSED) {
    log("INFO", "Resuming processing loop after service worker wake up.");
    automationState.currentState = STATES.PROCESSING;
    automationState.countdown = null;
    await persistState();
    processLoop();
  }

  broadcastState();
}

async function restoreState() {
  const result = await chrome.storage.local.get(
    STORAGE_KEYS.STATE
  );

  automationState = {
    ...DEFAULT_STATE,
    ...(result[STORAGE_KEYS.STATE] || {})
  };
}

/* -------------------------------------------------------------------------- */
/* Messaging                                                                  */
/* -------------------------------------------------------------------------- */

async function handleMessage(message) {
  try {
    switch (message?.action) {
      case "START":
        await startAutomation(message.settings);
        return { success: true };

      case "PAUSE":
        await pauseAutomation();
        return { success: true };

      case "RESUME":
        await resumeAutomation();
        return { success: true };

      case "STOP":
        await stopAutomation();
        return { success: true };

      default:
        return {
          success: false,
          error: "Unknown action."
        };
    }
  } catch (error) {
    log("ERROR", error.message);

    return {
      success: false,
      error: error.message
    };
  }
}

/* -------------------------------------------------------------------------- */
/* State Machine                                                              */
/* -------------------------------------------------------------------------- */

async function startAutomation(settings) {
  if (
    automationState.currentState !== STATES.IDLE &&
    automationState.currentState !== STATES.STOPPED
  ) {
    throw new Error("Automation already running.");
  }

  automationState = {
    ...DEFAULT_STATE,
    running: true,
    paused: false,
    currentState: STATES.STARTING,
    settings
  };

  await persistState();

  log("INFO", "Automation started.");

  automationState.currentState = STATES.PROCESSING;

  await persistState();

  processLoop();

  broadcastState();
}

async function pauseAutomation() {
  if (
    automationState.currentState !== STATES.PROCESSING &&
    automationState.currentState !== STATES.WAITING_DELAY
  ) {
    return;
  }

  automationState.paused = true;
  automationState.currentState = STATES.PAUSED;

  clearCountdown();

  await persistState();

  log("INFO", "Automation paused.");
}

async function resumeAutomation() {
  if (automationState.currentState !== STATES.PAUSED) {
    return;
  }

  automationState.paused = false;
  automationState.currentState = STATES.PROCESSING;

  await persistState();

  log("INFO", "Automation resumed.");
}

async function stopAutomation() {
  clearCountdown();

  automationState.running = false;
  automationState.paused = false;
  automationState.currentState = STATES.STOPPED;
  automationState.countdown = null;

  await persistState();

  log("INFO", "Automation stopped.");
}

/* -------------------------------------------------------------------------- */
/* Delay Utilities                                                            */
/* -------------------------------------------------------------------------- */

async function beginDelay(seconds) {
  automationState.currentState = STATES.WAITING_DELAY;
  const targetTime = Date.now() + seconds * 1000;

  await persistState();

  return new Promise(resolve => {
    automationState.countdown = seconds;
    persistState();

    countdownTimer = setInterval(async () => {
      if (automationState.currentState === STATES.PAUSED) {
        return;
      }

      if (automationState.currentState === STATES.STOPPED) {
        clearCountdown();
        resolve();
        return;
      }

      const remaining = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000));
      automationState.countdown = remaining;

      await persistState();

      if (remaining <= 0) {
        clearCountdown();

        automationState.countdown = null;
        automationState.currentState = STATES.PROCESSING;

        await persistState();
        resolve();
      }
    }, 1000);
  });
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/* -------------------------------------------------------------------------- */
/* Progress Helpers                                                           */
/* -------------------------------------------------------------------------- */

async function incrementProcessed() {
  automationState.processedCount++;

  await persistState();
}

async function incrementSent() {
  automationState.sentCount++;

  await persistState();
}

async function incrementSkipped() {
  automationState.skippedCount++;

  await persistState();
}

async function markProcessed(identifier) {
  automationState.processedMembers[identifier] = true;

  await persistState();
}

function alreadyProcessed(identifier) {
  return Boolean(
    automationState.processedMembers[identifier]
  );
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

async function persistState() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.STATE]: automationState
  });

  broadcastState();
}

/* -------------------------------------------------------------------------- */
/* Logging                                                                    */
/* -------------------------------------------------------------------------- */

let logQueue = [];
let isLogging = false;

async function log(level, message) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };

  logQueue.push(entry);
  processLogQueue();
}

async function processLogQueue() {
  if (isLogging || logQueue.length === 0) return;
  isLogging = true;

  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LOGS);
    const logs = result.logs || [];

    const pending = logQueue.splice(0, logQueue.length);
    logs.push(...pending);

    await chrome.storage.local.set({ logs });

    pending.forEach(entry => {
      chrome.runtime.sendMessage({
        type: "LOG",
        log: entry
      }).catch(() => {
        /* Popup may not be open */
      });
    });
  } finally {
    isLogging = false;
    if (logQueue.length > 0) {
      processLogQueue();
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Popup Synchronization                                                      */
/* -------------------------------------------------------------------------- */

function broadcastState() {
  chrome.runtime.sendMessage({
    type: "STATE_UPDATE",
    state: {
      currentState:
        automationState.currentState,

      processedCount:
        automationState.processedCount,

      sentCount:
        automationState.sentCount,

      skippedCount:
        automationState.skippedCount,

      remaining:
        automationState.remaining,

      countdown:
        automationState.countdown
    }
  }).catch(() => {
    /* Popup may not be open */
  });
}

/* -------------------------------------------------------------------------- */
/* Exported Utilities                                                         */
/* -------------------------------------------------------------------------- */

/*
 * These helpers can be reused by safe member-review flows:
 *
 * randomInt(min, max)
 * markProcessed(id)
 * alreadyProcessed(id)
 * beginDelay(seconds)
 * incrementProcessed()
 * incrementSkipped()
 * incrementSent()
 */

function randomInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

/* -------------------------------------------------------------------------- */
/* Main Processing Loop                                                       */
/* -------------------------------------------------------------------------- */

let isLoopRunning = false;

async function processLoop() {
  if (isLoopRunning) {
    await log("WARNING", "Attempted to start loop while already running. Ignored.");
    return;
  }
  isLoopRunning = true;

  try {
    let emptyScrolls = 0;
    const MAX_EMPTY_SCROLLS = 3;

    while (automationState.running) {
    if (automationState.paused || automationState.currentState === STATES.PAUSED) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    if (automationState.currentState === STATES.STOPPED) {
      break;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      
      if (!tab || !tab.url.includes("facebook.com")) {
        await log("WARNING", "Active tab is not Facebook. Pausing automation.");
        await pauseAutomation();
        continue;
      }

      const checkPage = await chrome.tabs.sendMessage(tab.id, { action: "CHECK_MEMBERS_PAGE" }).catch(() => null);
      if (!checkPage?.isMembersPage) {
        await log("WARNING", "Not on a Facebook members page. Pausing automation.");
        await pauseAutomation();
        continue;
      }

      const scanResult = await chrome.tabs.sendMessage(tab.id, { action: "SCAN_VISIBLE_MEMBERS" }).catch(() => null);
      if (!scanResult || !scanResult.success) {
        throw new Error("Failed to scan members from the page. Make sure the page is fully loaded.");
      }

      const visibleMembers = scanResult.members || [];
      let newMembersFound = false;
      const MAX_EXTRACT_LIMIT = 100;

      for (const member of visibleMembers) {
        if (automationState.currentState === STATES.STOPPED || automationState.paused) break;

        if (!alreadyProcessed(member.profileUrl)) {
          newMembersFound = true;
          
          await markProcessed(member.profileUrl);
          await incrementProcessed();

          await log("SUCCESS", `[EXTRACTED ${automationState.processedCount}/${MAX_EXTRACT_LIMIT}] ${member.fullName} - ${member.profileUrl}`);

          if (automationState.processedCount >= MAX_EXTRACT_LIMIT) {
            await log("SUCCESS", `Extraction complete! Reached limit of ${MAX_EXTRACT_LIMIT} members.`);
            await stopAutomation();
            break;
          }
        }
      }

      if (automationState.currentState === STATES.STOPPED || automationState.paused) continue;

      if (!newMembersFound) {
        await log("INFO", "No new members found. Scrolling down...");
        const scrollResult = await chrome.tabs.sendMessage(tab.id, { action: "SCROLL_MEMBERS" }).catch(() => null);
        
        if (scrollResult && !scrollResult.changed) {
          emptyScrolls++;
          await log("WARNING", `No new members loaded after scroll. (${emptyScrolls}/${MAX_EMPTY_SCROLLS})`);
          
          if (emptyScrolls >= MAX_EMPTY_SCROLLS) {
            await log("SUCCESS", "Reached bottom of the list. Automation complete.");
            await stopAutomation();
            break;
          }
        } else {
          emptyScrolls = 0;
          // Wait an extra 1.5 seconds for Facebook's network request to finish rendering the new members
          await new Promise(r => setTimeout(r, 1500));
        }
      }
      
    } catch (err) {
      await log("ERROR", `Loop error: ${err.message}`);
      await pauseAutomation();
    }
  }
  } finally {
    isLoopRunning = false;
  }
}