/**
 * Manifest V3 service worker.
 *
 * Milestone 1: popup → CHECK_ROUTE → Native Messaging → Swift host.
 * Milestone 2: optional HTTP/HTTPS host access + webRequest observation for one
 *              explicitly selected tab; metadata only in chrome.storage.session.
 *
 * Native host framing and route-check API are unchanged. Captured IPs are NOT
 * sent to the native host in this milestone.
 */

/** Native Messaging host name registered in the Chrome manifest on disk. */
const NATIVE_HOST_NAME = 'com.freemandan.vpn_route_inspector';

/** Maximum time to wait for the native host response (milliseconds). */
const NATIVE_MESSAGE_TIMEOUT_MS = 15000;

/** chrome.storage.session key for the single active-tab capture session. */
const CAPTURE_SESSION_KEY = 'captureSession';

/** Schema version for the capture session document. */
const CAPTURE_SCHEMA_VERSION = 1;

/** Hard cap on stored capture entries (oldest dropped when exceeded). */
const CAPTURE_MAX_ENTRIES = 500;

/** URL filters for non-blocking webRequest observation (HTTP/HTTPS only). */
const WEB_REQUEST_URL_FILTER = {
  urls: ['http://*/*', 'https://*/*'],
};

/**
 * Optional host origins requested only after an explicit popup user gesture.
 * These must match optional_host_permissions in manifest.json.
 */
const OPTIONAL_HOST_ORIGINS = ['http://*/*', 'https://*/*'];

/**
 * In-memory mirror of the active capture tab ID for fast filtering in webRequest
 * listeners. Updated whenever the session is loaded or mutated. Never trusted
 * alone for persistence — storage.session is the source of truth.
 */
let activeCaptureTabId = null;

/**
 * Serializes read-modify-write updates to chrome.storage.session so concurrent
 * webRequest events cannot lose entries through overlapping async cycles.
 * @type {Promise<unknown>}
 */
let storageWriteChain = Promise.resolve();

/**
 * Generates a short unique ID for correlating popup ↔ native host messages
 * and for capture entry identifiers.
 * @returns {string}
 */
function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Builds a structured error envelope for popup responses.
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Builds a structured success envelope for popup responses.
 * @param {object} [extra]
 * @returns {{ ok: true } & object}
 */
function ok(extra = {}) {
  return { ok: true, ...extra };
}

/**
 * Returns a safe empty (inactive) capture session document.
 * @returns {object}
 */
function emptySession() {
  return {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    active: false,
    tabId: null,
    tabUrl: null,
    tabTitle: null,
    startedAt: null,
    stoppedAt: null,
    entries: [],
  };
}

/**
 * Validates and normalizes a stored session. Malformed data resets to empty.
 * @param {unknown} raw
 * @returns {object}
 */
function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') {
    return emptySession();
  }

  const session = /** @type {Record<string, unknown>} */ (raw);
  if (session.schemaVersion !== CAPTURE_SCHEMA_VERSION) {
    return emptySession();
  }

  const entries = Array.isArray(session.entries) ? session.entries.slice() : [];
  // Drop anything that is not a plain object — defensive against corruption.
  const safeEntries = entries.filter((entry) => entry && typeof entry === 'object');

  const tabId = typeof session.tabId === 'number' && Number.isFinite(session.tabId)
    ? session.tabId
    : null;

  return {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    active: session.active === true,
    tabId,
    tabUrl: typeof session.tabUrl === 'string' ? session.tabUrl : null,
    tabTitle: typeof session.tabTitle === 'string' ? session.tabTitle : null,
    startedAt: typeof session.startedAt === 'number' ? session.startedAt : null,
    stoppedAt: typeof session.stoppedAt === 'number' ? session.stoppedAt : null,
    entries: safeEntries.slice(-CAPTURE_MAX_ENTRIES),
  };
}

/**
 * Loads the capture session from chrome.storage.session.
 * @returns {Promise<object>}
 */
async function loadSession() {
  try {
    const stored = await chrome.storage.session.get(CAPTURE_SESSION_KEY);
    const session = normalizeSession(stored[CAPTURE_SESSION_KEY]);
    activeCaptureTabId = session.active ? session.tabId : null;
    return session;
  } catch (err) {
    console.error('VPN Route Inspector: failed to load capture session', err);
    activeCaptureTabId = null;
    return emptySession();
  }
}

/**
 * Persists a capture session and refreshes the in-memory tab filter.
 * @param {object} session
 * @returns {Promise<object>}
 */
async function saveSession(session) {
  const normalized = normalizeSession(session);
  await chrome.storage.session.set({ [CAPTURE_SESSION_KEY]: normalized });
  activeCaptureTabId = normalized.active ? normalized.tabId : null;
  return normalized;
}

/**
 * Queues an async mutation against the capture session so overlapping webRequest
 * handlers cannot race on read-modify-write. A single failure is logged and does
 * not permanently break the queue for later events.
 * @param {(session: object) => object | Promise<object>} mutator
 * @returns {Promise<object|null>}
 */
function enqueueSessionUpdate(mutator) {
  const run = storageWriteChain.then(async () => {
    const current = await loadSession();
    const next = await mutator(current);
    return saveSession(next);
  });

  // Keep the chain alive even when a write fails.
  storageWriteChain = run.catch((err) => {
    console.error('VPN Route Inspector: capture session update failed', err);
  });

  return run.catch((err) => {
    console.error('VPN Route Inspector: capture session update failed', err);
    return null;
  });
}

/**
 * Classifies a literal IP string as IPv4, IPv6, or unrecognized.
 * Does not perform DNS resolution.
 * @param {unknown} ip
 * @returns {4 | 6 | null}
 */
function classifyIpVersion(ip) {
  if (typeof ip !== 'string' || ip.length === 0) {
    return null;
  }

  // IPv4 dotted-decimal (same spirit as the native host validator; no leading-zero policy here).
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    if (parts.every((part) => {
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    })) {
      return 4;
    }
    return null;
  }

  // IPv6: contains at least one colon and only hex / colon / optional zone / dotted tail.
  if (ip.includes(':') && /^[0-9a-fA-F:.%]+$/.test(ip)) {
    return 6;
  }

  return null;
}

/**
 * Parses an HTTP(S) URL and returns hostname + protocol, or null on failure.
 * @param {unknown} rawUrl
 * @returns {{ href: string, hostname: string, protocol: string } | null}
 */
function parseHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return {
      href: parsed.href,
      hostname: parsed.hostname,
      protocol: parsed.protocol,
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Returns true when a URL scheme is unsuitable as a capture target tab.
 * @param {string} url
 * @returns {boolean}
 */
function isRejectedTabUrl(url) {
  const lower = url.toLowerCase();
  return (
    lower.startsWith('chrome://')
    || lower.startsWith('chrome-extension://')
    || lower.startsWith('file://')
    || lower.startsWith('view-source:')
    || lower.startsWith('devtools://')
    || lower.startsWith('about:')
    || lower.startsWith('edge://')
  );
}

/**
 * Builds a capture entry from a webRequest details object.
 * Stores metadata only — never headers, bodies, cookies, or authorization.
 * @param {'response' | 'redirect' | 'error'} eventType
 * @param {chrome.webRequest.WebResponseDetails | chrome.webRequest.WebRedirectionResponseDetails | chrome.webRequest.WebResponseErrorDetails} details
 * @returns {object | null}
 */
function buildCaptureEntry(eventType, details) {
  const parsed = parseHttpUrl(details.url);
  if (!parsed) {
    return null;
  }

  const ip = typeof details.ip === 'string' && details.ip.length > 0 ? details.ip : null;

  return {
    id: createRequestId(),
    requestId: typeof details.requestId === 'string' ? details.requestId : String(details.requestId || ''),
    eventType,
    url: parsed.href,
    hostname: parsed.hostname,
    method: typeof details.method === 'string' ? details.method : null,
    resourceType: typeof details.type === 'string' ? details.type : null,
    tabId: typeof details.tabId === 'number' ? details.tabId : null,
    frameId: typeof details.frameId === 'number' ? details.frameId : null,
    parentFrameId: typeof details.parentFrameId === 'number' ? details.parentFrameId : null,
    initiator: typeof details.initiator === 'string' ? details.initiator : null,
    statusCode: typeof details.statusCode === 'number' ? details.statusCode : null,
    ip,
    ipVersion: classifyIpVersion(ip),
    fromCache: details.fromCache === true,
    error: typeof details.error === 'string' ? details.error : null,
    timeStamp: typeof details.timeStamp === 'number' ? details.timeStamp : Date.now(),
  };
}

/**
 * Appends an entry when capture is active for details.tabId.
 * Deduplicates by requestId + eventType.
 * @param {'response' | 'redirect' | 'error'} eventType
 * @param {object} details
 */
function recordWebRequestEvent(eventType, details) {
  // Fast path: no active capture or wrong tab — avoid storage I/O.
  if (activeCaptureTabId === null) {
    return;
  }
  if (typeof details.tabId !== 'number' || details.tabId !== activeCaptureTabId) {
    return;
  }

  const entry = buildCaptureEntry(eventType, details);
  if (!entry) {
    return;
  }

  enqueueSessionUpdate((session) => {
    if (!session.active || session.tabId !== entry.tabId) {
      return session;
    }

    const duplicate = session.entries.some(
      (existing) => existing.requestId === entry.requestId && existing.eventType === entry.eventType
    );
    if (duplicate) {
      return session;
    }

    const entries = session.entries.concat([entry]);
    // Evict oldest entries when the documented maximum is exceeded.
    if (entries.length > CAPTURE_MAX_ENTRIES) {
      entries.splice(0, entries.length - CAPTURE_MAX_ENTRIES);
    }

    return {
      ...session,
      entries,
    };
  });
}

/**
 * Sends a structured route-check request to the Swift native host.
 * @param {string} ip - IPv4 address to look up.
 * @returns {Promise<object>} Parsed JSON response from the native host.
 */
function checkRouteViaNativeHost(ip) {
  const requestId = createRequestId();
  const payload = {
    action: 'checkRoute',
    requestId,
    ip,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const finish = (handler) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      handler();
    };

    timer = setTimeout(() => {
      finish(() => {
        reject(new Error('Native host did not respond in time. Is it installed? Run scripts/doctor.sh.'));
      });
    }, NATIVE_MESSAGE_TIMEOUT_MS);

    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
        const runtimeError = chrome.runtime.lastError;

        if (settled) {
          return;
        }

        finish(() => {
          if (runtimeError) {
            reject(new Error(runtimeError.message || 'Native messaging failed.'));
            return;
          }

          if (!response || typeof response !== 'object') {
            reject(new Error('Native host returned an empty or invalid response.'));
            return;
          }

          const responseId = response.requestId;
          if (typeof responseId !== 'string' || responseId !== requestId) {
            reject(new Error('Native host response requestId does not match the outbound request.'));
            return;
          }

          resolve(response);
        });
      });
    } catch (err) {
      finish(() => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    }
  });
}

/**
 * Computes summary counters for the popup without mutating the session.
 * @param {object} session
 * @returns {{ entryCount: number, hostnameCount: number, ipCount: number }}
 */
function summarizeSession(session) {
  const hostnames = new Set();
  const ips = new Set();

  for (const entry of session.entries) {
    if (typeof entry.hostname === 'string' && entry.hostname) {
      hostnames.add(entry.hostname);
    }
    if (typeof entry.ip === 'string' && entry.ip) {
      ips.add(entry.ip);
    }
  }

  return {
    entryCount: session.entries.length,
    hostnameCount: hostnames.size,
    ipCount: ips.size,
  };
}

/**
 * CAPTURE_GET_STATE — return the current session plus summary counters.
 * @returns {Promise<object>}
 */
async function handleCaptureGetState() {
  const session = await loadSession();
  return ok({
    session,
    summary: summarizeSession(session),
  });
}

/**
 * CAPTURE_START — bind capture to a validated tab and reload that tab only.
 * Optional host permission must already have been granted by the popup gesture.
 * @param {object} message
 * @returns {Promise<object>}
 */
async function handleCaptureStart(message) {
  const tabId = message.tabId;
  const tabUrl = typeof message.tabUrl === 'string' ? message.tabUrl.trim() : '';
  const tabTitle = typeof message.tabTitle === 'string' ? message.tabTitle : '';

  if (typeof tabId !== 'number' || !Number.isFinite(tabId) || tabId < 0) {
    return fail('INVALID_TAB', 'A valid numeric tab ID is required to start capture.');
  }

  if (!tabUrl) {
    return fail('INVALID_TAB_URL', 'The target tab URL is missing.');
  }

  if (isRejectedTabUrl(tabUrl)) {
    return fail(
      'UNSUPPORTED_TAB',
      'Capture only works on normal http: or https: pages. chrome://, extension, file, and similar URLs are not supported.'
    );
  }

  const parsed = parseHttpUrl(tabUrl);
  if (!parsed) {
    return fail(
      'UNSUPPORTED_TAB',
      'Capture only works on normal http: or https: pages.'
    );
  }

  // Confirm optional host access is present before observing cross-origin traffic.
  const hasHosts = await chrome.permissions.contains({ origins: OPTIONAL_HOST_ORIGINS });
  if (!hasHosts) {
    return fail(
      'HOST_PERMISSION_REQUIRED',
      'Optional HTTP/HTTPS host access was not granted. Capture was not started.'
    );
  }

  // Verify the tab still exists and still matches an HTTP(S) page.
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_err) {
    return fail('TAB_NOT_FOUND', 'The target tab no longer exists.');
  }

  if (!tab || typeof tab.id !== 'number' || tab.id !== tabId) {
    return fail('TAB_NOT_FOUND', 'The target tab no longer exists.');
  }

  const liveUrl = typeof tab.url === 'string' ? tab.url : tabUrl;
  if (isRejectedTabUrl(liveUrl) || !parseHttpUrl(liveUrl)) {
    return fail(
      'UNSUPPORTED_TAB',
      'Capture only works on normal http: or https: pages.'
    );
  }

  const startedAt = Date.now();
  const session = await saveSession({
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    active: true,
    tabId,
    tabUrl: liveUrl,
    tabTitle: (typeof tab.title === 'string' && tab.title) ? tab.title : tabTitle,
    startedAt,
    stoppedAt: null,
    entries: [],
  });

  // Start capture before reload so the main document response is observed.
  try {
    await chrome.tabs.reload(tabId);
  } catch (err) {
    // Capture is already active; report reload failure but keep listening.
    console.error('VPN Route Inspector: failed to reload target tab', err);
    return ok({
      session,
      summary: summarizeSession(session),
      reloadWarning: err instanceof Error ? err.message : String(err),
    });
  }

  return ok({
    session,
    summary: summarizeSession(session),
  });
}

/**
 * CAPTURE_STOP — mark the session inactive; keep existing entries.
 * @returns {Promise<object>}
 */
async function handleCaptureStop() {
  const session = await enqueueSessionUpdate((current) => ({
    ...current,
    active: false,
    stoppedAt: Date.now(),
  }));

  const finalSession = session || await loadSession();
  return ok({
    session: finalSession,
    summary: summarizeSession(finalSession),
  });
}

/**
 * CAPTURE_CLEAR — clear entries; leave active flag unchanged unless stopping.
 * @returns {Promise<object>}
 */
async function handleCaptureClear() {
  const session = await enqueueSessionUpdate((current) => ({
    ...current,
    entries: [],
  }));

  const finalSession = session || await loadSession();
  return ok({
    session: finalSession,
    summary: summarizeSession(finalSession),
  });
}

/**
 * CAPTURE_REVOKE_HOSTS — stop capture, clear entries, remove optional hosts.
 * The popup also calls permissions.remove; this keeps session state consistent
 * if the revoke is coordinated through the service worker.
 * @returns {Promise<object>}
 */
async function handleCaptureRevokeHosts() {
  await enqueueSessionUpdate(() => emptySession());
  const session = emptySession();
  activeCaptureTabId = null;

  let removed = false;
  try {
    removed = await chrome.permissions.remove({ origins: OPTIONAL_HOST_ORIGINS });
  } catch (err) {
    console.error('VPN Route Inspector: failed to remove optional host permissions', err);
    return fail(
      'REVOKE_FAILED',
      err instanceof Error ? err.message : 'Could not revoke optional host access.'
    );
  }

  return ok({
    session,
    summary: summarizeSession(session),
    removed,
  });
}

/**
 * Handles CHECK_ROUTE exactly as in Milestone 1.
 * @param {object} message
 * @returns {Promise<object>}
 */
async function handleCheckRoute(message) {
  const ip = typeof message.ip === 'string' ? message.ip.trim() : '';

  try {
    const response = await checkRouteViaNativeHost(ip);
    return ok({ response });
  } catch (err) {
    return fail(
      'NATIVE_HOST_ERROR',
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ---------------------------------------------------------------------------
// webRequest listeners — registered synchronously at top level (MV3 requirement).
// Non-blocking observation only. Never request bodies or headers.
// ---------------------------------------------------------------------------

chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    recordWebRequestEvent('response', details);
  },
  WEB_REQUEST_URL_FILTER
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    recordWebRequestEvent('redirect', details);
  },
  WEB_REQUEST_URL_FILTER
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    recordWebRequestEvent('error', details);
  },
  WEB_REQUEST_URL_FILTER
);

// Restore in-memory tab filter when the service worker wakes.
loadSession().catch((err) => {
  console.error('VPN Route Inspector: initial session load failed', err);
});

/** Internal message bridge: popup → service worker. */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    return false;
  }

  /** @type {Promise<object>} */
  let task;

  switch (message.type) {
    case 'CHECK_ROUTE':
      task = handleCheckRoute(message);
      break;
    case 'CAPTURE_GET_STATE':
      task = handleCaptureGetState();
      break;
    case 'CAPTURE_START':
      task = handleCaptureStart(message);
      break;
    case 'CAPTURE_STOP':
      task = handleCaptureStop();
      break;
    case 'CAPTURE_CLEAR':
      task = handleCaptureClear();
      break;
    case 'CAPTURE_REVOKE_HOSTS':
      task = handleCaptureRevokeHosts();
      break;
    default:
      return false;
  }

  task
    .then((response) => sendResponse(response))
    .catch((err) => {
      sendResponse(fail(
        'INTERNAL_ERROR',
        err instanceof Error ? err.message : String(err)
      ));
    });

  // Keep the message channel open for the async response.
  return true;
});
