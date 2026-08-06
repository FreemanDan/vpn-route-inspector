/**
 * Manifest V3 service worker.
 *
 * Milestone 1: Side Panel → CHECK_ROUTE → Native Messaging → Swift host.
 * Milestone 2: optional HTTP/HTTPS host access + webRequest observation for one
 *              explicitly selected tab; metadata only in chrome.storage.session.
 * Milestone 3: explicit CAPTURE_ANALYZE_ROUTES batch checkRoutes — never from
 *              webRequest listeners. Route results are a current macOS snapshot.
 *
 * Critical hardening: never drop webRequest events solely because the in-memory
 * cache is still null after a service-worker restart. Always await authoritative
 * session load from chrome.storage.session first.
 */

/* global importScripts, VriCaptureCore */

importScripts('capture-core.js');

const Core = VriCaptureCore;

/** Native Messaging host name registered in the Chrome manifest on disk. */
const NATIVE_HOST_NAME = 'com.freemandan.vpn_route_inspector';

/** Maximum time to wait for a single-IP native host response (milliseconds). */
const NATIVE_MESSAGE_TIMEOUT_MS = 15000;

/** Batch checkRoutes may look up many IPs sequentially — allow more wall time. */
const NATIVE_BATCH_TIMEOUT_MS = 120000;

/**
 * True while a CAPTURE_ANALYZE_ROUTES call is in flight.
 * Only one route analysis may be active at a time.
 * @type {boolean}
 */
let routeAnalysisInFlight = false;

/** chrome.storage.session key for the single active-tab capture session. */
const CAPTURE_SESSION_KEY = 'captureSession';

/** URL filters for non-blocking webRequest observation (HTTP/HTTPS only). */
const WEB_REQUEST_URL_FILTER = {
  urls: ['http://*/*', 'https://*/*'],
};

/**
 * Optional host origins requested only after an explicit user gesture.
 * Must match optional_host_permissions in manifest.json exactly.
 */
const OPTIONAL_HOST_ORIGINS = ['http://*/*', 'https://*/*'];

/**
 * In-memory cache of the capture session for speed after the first load.
 * storage.session remains authoritative. Never treat a null cache as
 * "no active session" without awaiting ensureSessionLoaded().
 * @type {object|null}
 */
let cachedSession = null;

/**
 * Lazily initialized promise that resolves once the session has been loaded
 * from storage at least once in this worker lifetime.
 * @type {Promise<object>|null}
 */
let sessionLoadPromise = null;

/**
 * Serializes read-modify-write updates. Recoverable after failures:
 * writeQueue = writeQueue.catch(() => undefined).then(task)
 * @type {Promise<unknown>}
 */
let storageWriteChain = Promise.resolve();

/**
 * Generates a short unique ID.
 * @returns {string}
 */
function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Structured error envelope.
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Structured success envelope.
 * @param {object} [extra]
 * @returns {{ ok: true } & object}
 */
function ok(extra = {}) {
  return { ok: true, ...extra };
}

/**
 * Prefixed development log for capture state transitions (not every event).
 * @param {string} message
 * @param {object} [fields]
 */
function captureLog(message, fields) {
  if (fields) {
    console.log('[VRI capture]', message, fields);
  } else {
    console.log('[VRI capture]', message);
  }
}

/**
 * Loads the capture session from chrome.storage.session and updates the cache.
 * @returns {Promise<object>}
 */
async function loadSessionFromStorage() {
  try {
    const stored = await chrome.storage.session.get(CAPTURE_SESSION_KEY);
    const session = Core.normalizeSession(stored[CAPTURE_SESSION_KEY]);
    cachedSession = session;
    return session;
  } catch (err) {
    console.error('[VRI capture] failed to load capture session', err);
    cachedSession = Core.emptySession();
    return cachedSession;
  }
}

/**
 * Ensures the session cache is populated. Safe after worker restart: the first
 * webRequest event awaits this instead of treating a null cache as inactive.
 * @returns {Promise<object>}
 */
function ensureSessionLoaded() {
  if (!sessionLoadPromise) {
    sessionLoadPromise = loadSessionFromStorage().catch((err) => {
      console.error('[VRI capture] ensureSessionLoaded failed', err);
      sessionLoadPromise = null;
      cachedSession = Core.emptySession();
      return cachedSession;
    });
  }
  return sessionLoadPromise;
}

/**
 * Invalidates the load promise so the next ensureSessionLoaded re-reads storage
 * when needed. Mutations update cachedSession directly after writes.
 */
function invalidateSessionLoad() {
  sessionLoadPromise = null;
}

/**
 * Persists a capture session and refreshes the in-memory cache.
 * @param {object} session
 * @returns {Promise<object>}
 */
async function saveSession(session) {
  const normalized = Core.normalizeSession(session);
  await chrome.storage.session.set({ [CAPTURE_SESSION_KEY]: normalized });
  cachedSession = normalized;
  sessionLoadPromise = Promise.resolve(normalized);
  return normalized;
}

/**
 * Queues an async mutation. Failures are logged and counted; the chain recovers.
 * @param {(session: object) => object | Promise<object>} mutator
 * @returns {Promise<object|null>}
 */
function enqueueSessionUpdate(mutator) {
  const task = async () => {
    // Re-read authoritative state inside the queue to avoid stale snapshots.
    const current = await loadSessionFromStorage();
    const next = await mutator(current);
    return saveSession(next);
  };

  const run = storageWriteChain
    .catch(() => undefined)
    .then(task);

  storageWriteChain = run.catch(async (err) => {
    console.error('[VRI capture] storage write failure', err);
    try {
      const current = await loadSessionFromStorage();
      const diag = current.diagnostics || Core.emptyDiagnostics();
      diag.storageWriteFailures += 1;
      diag.lastIgnoredReason = 'storage_write_failure';
      await saveSession({ ...current, diagnostics: diag });
    } catch (innerErr) {
      console.error('[VRI capture] failed to record storageWriteFailures', innerErr);
    }
  });

  return run.catch((err) => {
    console.error('[VRI capture] storage write failure', err);
    return null;
  });
}

/**
 * Shared capture pipeline for all webRequest listeners.
 * Always awaits session load so SW restarts cannot drop the first events.
 * @param {'response' | 'redirect' | 'error'} eventType
 * @param {object} details
 */
function recordWebRequestEvent(eventType, details) {
  // Fire-and-forget async work with attached error handling (MV3 listeners are sync).
  const work = (async () => {
    await ensureSessionLoaded();

    // First event markers (once per worker wake when counters leave zero).
    const before = cachedSession;
    const wasZeroEvents = !before || before.diagnostics.eventsSeen === 0;

    const result = await enqueueSessionUpdate((session) => {
      const applied = Core.applyCaptureEvent(session, eventType, details, createRequestId);
      return applied.session;
    });

    if (!result) {
      return;
    }

    if (wasZeroEvents && result.diagnostics.eventsSeen === 1) {
      captureLog('first webRequest event received', {
        eventType,
        tabId: details.tabId,
      });
    }

    if (result.diagnostics.targetTabEventsSeen === 1
      && typeof details.tabId === 'number'
      && details.tabId === result.tabId) {
      captureLog('first target-tab event received', { eventType, tabId: details.tabId });
    }

    if (result.diagnostics.entriesStored === 1 && result.entries.length === 1) {
      captureLog('first entry stored', {
        eventType,
        hostname: result.entries[0].hostname,
        hasIp: Boolean(result.entries[0].ip),
      });
    }
  })();

  work.catch((err) => {
    console.error('[VRI capture] recordWebRequestEvent failed', err);
  });
}

/**
 * Low-level Native Messaging send with requestId verification and timeout.
 * @param {object} payload
 * @param {string} requestId
 * @param {number} timeoutMs
 * @returns {Promise<object>}
 */
function sendNativeMessageVerified(payload, requestId, timeoutMs) {
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
    }, timeoutMs);

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
          if (typeof response.requestId !== 'string' || response.requestId !== requestId) {
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
 * Sends a structured single-IP route-check request to the Swift native host.
 * @param {string} ip
 * @returns {Promise<object>}
 */
function checkRouteViaNativeHost(ip) {
  const requestId = createRequestId();
  return sendNativeMessageVerified(
    { action: 'checkRoute', requestId, ip },
    requestId,
    NATIVE_MESSAGE_TIMEOUT_MS
  );
}

/**
 * One batch Native Messaging call for unique IPv4s (Milestone 3).
 * Never invoke sendNativeMessage once per IP from the capture pipeline.
 * @param {string[]} ips
 * @returns {Promise<object>}
 */
function checkRoutesViaNativeHost(ips) {
  const requestId = createRequestId();
  return sendNativeMessageVerified(
    { action: 'checkRoutes', requestId, ips },
    requestId,
    NATIVE_BATCH_TIMEOUT_MS
  ).then((response) => ({ requestId, response }));
}

/**
 * CAPTURE_GET_STATE
 * @returns {Promise<object>}
 */
async function handleCaptureGetState() {
  const session = await ensureSessionLoaded().then(() => loadSessionFromStorage());
  let permissionGranted = false;
  try {
    permissionGranted = await chrome.permissions.contains({ origins: OPTIONAL_HOST_ORIGINS });
  } catch (_err) {
    permissionGranted = false;
  }

  // Reflect live permission state in diagnostics without a full write race.
  if (session.diagnostics.permissionGranted !== permissionGranted) {
    session.diagnostics.permissionGranted = permissionGranted;
    await saveSession(session);
  }

  return ok({
    session,
    summary: Core.summarizeSession(session),
    permissionGranted,
  });
}

/**
 * CAPTURE_START — persist + verify session BEFORE reload.
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
  if (Core.isRejectedTabUrl(tabUrl) || !Core.parseHttpUrl(tabUrl).ok) {
    return fail(
      'UNSUPPORTED_TAB',
      'Capture only works on normal http: or https: pages. chrome://, extension, file, and similar URLs are not supported.'
    );
  }

  const permissionGranted = await chrome.permissions.contains({ origins: OPTIONAL_HOST_ORIGINS });
  if (!permissionGranted) {
    return fail(
      'HOST_PERMISSION_REQUIRED',
      'Optional HTTP/HTTPS host access was not granted. Capture was not started.'
    );
  }
  captureLog('optional permissions verified', { permissionGranted: true });

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
  if (Core.isRejectedTabUrl(liveUrl) || !Core.parseHttpUrl(liveUrl).ok) {
    return fail('UNSUPPORTED_TAB', 'Capture only works on normal http: or https: pages.');
  }

  const startedAt = Date.now();
  const diagnostics = Core.emptyDiagnostics();
  diagnostics.permissionGranted = true;

  const toStore = {
    schemaVersion: Core.CAPTURE_SCHEMA_VERSION,
    active: true,
    tabId,
    tabUrl: liveUrl,
    tabTitle: (typeof tab.title === 'string' && tab.title) ? tab.title : tabTitle,
    startedAt,
    stoppedAt: null,
    entries: [],
    diagnostics,
    // CAPTURE_START always resets prior route analysis.
    routeAnalysis: Core.emptyRouteAnalysis(),
  };

  // Persist completely, then read back and verify before acknowledging success.
  await saveSession(toStore);
  const verified = await loadSessionFromStorage();
  if (verified.active !== true || verified.tabId !== tabId) {
    captureLog('session persist verification failed', {
      active: verified.active,
      tabId: verified.tabId,
      expectedTabId: tabId,
    });
    return fail(
      'SESSION_PERSIST_FAILED',
      'Capture session could not be verified in storage. Capture was not started.'
    );
  }

  captureLog('capture session persisted', { tabId, startedAt });
  captureLog('capture start acknowledged', { tabId });

  // Reload is requested by the Side Panel after success so the UI can paint Active
  // first. Keep a server-side reload fallback flag in the response.
  return ok({
    session: verified,
    summary: Core.summarizeSession(verified),
    permissionGranted: true,
    reloadTabId: tabId,
  });
}

/**
 * CAPTURE_STOP
 * @returns {Promise<object>}
 */
async function handleCaptureStop() {
  const session = await enqueueSessionUpdate((current) => ({
    ...current,
    active: false,
    stoppedAt: Date.now(),
  }));
  const finalSession = session || await loadSessionFromStorage();
  captureLog('capture stopped', { tabId: finalSession.tabId });
  return ok({
    session: finalSession,
    summary: Core.summarizeSession(finalSession),
  });
}

/**
 * CAPTURE_CLEAR — clear entries and reset diagnostics counters (keep active/tab).
 * @returns {Promise<object>}
 */
async function handleCaptureClear() {
  const session = await enqueueSessionUpdate((current) => {
    const diag = Core.emptyDiagnostics();
    diag.permissionGranted = current.diagnostics
      ? current.diagnostics.permissionGranted === true
      : false;
    return {
      ...current,
      entries: [],
      diagnostics: diag,
      // CAPTURE_CLEAR resets route analysis with the cleared evidence.
      routeAnalysis: Core.emptyRouteAnalysis(),
    };
  });
  const finalSession = session || await loadSessionFromStorage();
  captureLog('capture results cleared', { tabId: finalSession.tabId });
  return ok({
    session: finalSession,
    summary: Core.summarizeSession(finalSession),
  });
}

/**
 * CAPTURE_REVOKE_HOSTS — stop, clear, revoke optional origins.
 * @returns {Promise<object>}
 */
async function handleCaptureRevokeHosts() {
  await saveSession(Core.emptySession());
  invalidateSessionLoad();
  cachedSession = Core.emptySession();

  let removed = false;
  try {
    removed = await chrome.permissions.remove({ origins: OPTIONAL_HOST_ORIGINS });
  } catch (err) {
    console.error('[VRI capture] failed to remove optional host permissions', err);
    return fail(
      'REVOKE_FAILED',
      err instanceof Error ? err.message : 'Could not revoke optional host access.'
    );
  }

  captureLog('optional host permissions revoked', { removed });
  const session = Core.emptySession();
  return ok({
    session,
    summary: Core.summarizeSession(session),
    removed,
    permissionGranted: false,
  });
}

/**
 * CHECK_ROUTE — unchanged Milestone 1 behavior.
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

/**
 * CAPTURE_ANALYZE_ROUTES — explicit user action only.
 * Loads session → unique IPv4s → one checkRoutes batch → diagnose → store.
 * Guards against concurrent analysis and stale writes after capture changes.
 * @returns {Promise<object>}
 */
async function handleCaptureAnalyzeRoutes() {
  if (routeAnalysisInFlight) {
    return fail(
      'ALREADY_ANALYZING',
      'A route analysis is already in progress. Wait for it to finish.'
    );
  }

  routeAnalysisInFlight = true;
  const analysisStartedAt = Date.now();

  try {
    const session = await loadSessionFromStorage();
    if (!Array.isArray(session.entries) || session.entries.length === 0) {
      return fail('NO_CAPTURE_ENTRIES', 'Capture some responses before analyzing routes.');
    }

    const extracted = Core.extractUniqueIPv4s(session.entries);
    if (extracted.ips.length === 0) {
      return fail(
        'NO_IPV4',
        'No captured IPv4 addresses are available to analyze. IPv6 and missing-IP entries cannot be route-classified yet.'
      );
    }

    const fingerprint = Core.buildSourceFingerprint(session, extracted.ips);

    // Mark running in storage so the Side Panel can show progress.
    const running = Core.emptyRouteAnalysis();
    running.state = 'running';
    running.startedAt = analysisStartedAt;
    running.sourceFingerprint = fingerprint;
    running.uniqueIPv4Count = extracted.ips.length;
    running.skippedIPv6Count = extracted.skippedIPv6Count;
    running.skippedMissingIpCount = extracted.skippedMissingIpCount;
    await saveSession({ ...session, routeAnalysis: running });
    captureLog('route analysis started', {
      uniqueIPv4: extracted.ips.length,
      skippedIPv6: extracted.skippedIPv6Count,
      skippedMissingIp: extracted.skippedMissingIpCount,
    });

    let nativeBundle;
    try {
      nativeBundle = await checkRoutesViaNativeHost(extracted.ips);
    } catch (err) {
      const errSession = await loadSessionFromStorage();
      const errored = Core.emptyRouteAnalysis();
      errored.state = 'error';
      errored.startedAt = analysisStartedAt;
      errored.completedAt = Date.now();
      errored.sourceFingerprint = fingerprint;
      errored.uniqueIPv4Count = extracted.ips.length;
      errored.skippedIPv6Count = extracted.skippedIPv6Count;
      errored.skippedMissingIpCount = extracted.skippedMissingIpCount;
      errored.error = {
        code: 'NATIVE_HOST_ERROR',
        message: err instanceof Error ? err.message : String(err),
      };
      await saveSession({ ...errSession, routeAnalysis: errored });
      return fail('NATIVE_HOST_ERROR', errored.error.message);
    }

    const nativeResponse = nativeBundle.response;
    if (!nativeResponse.ok) {
      const topErr = nativeResponse.error || {};
      const errSession = await loadSessionFromStorage();
      const errored = Core.emptyRouteAnalysis();
      errored.state = 'error';
      errored.startedAt = analysisStartedAt;
      errored.completedAt = Date.now();
      errored.sourceFingerprint = fingerprint;
      errored.uniqueIPv4Count = extracted.ips.length;
      errored.skippedIPv6Count = extracted.skippedIPv6Count;
      errored.skippedMissingIpCount = extracted.skippedMissingIpCount;
      errored.error = {
        code: typeof topErr.code === 'string' ? topErr.code : 'NATIVE_HOST_ERROR',
        message: typeof topErr.message === 'string' ? topErr.message : 'Batch route check failed.',
      };
      await saveSession({ ...errSession, routeAnalysis: errored });
      return fail(errored.error.code, errored.error.message);
    }

    const validated = Core.validateNativeRouteResults(nativeResponse.results, extracted.ips);
    if (!validated.ok) {
      const errSession = await loadSessionFromStorage();
      const errored = Core.emptyRouteAnalysis();
      errored.state = 'error';
      errored.startedAt = analysisStartedAt;
      errored.completedAt = Date.now();
      errored.sourceFingerprint = fingerprint;
      errored.uniqueIPv4Count = extracted.ips.length;
      errored.error = validated.error;
      await saveSession({ ...errSession, routeAnalysis: errored });
      return fail(validated.error.code, validated.error.message);
    }

    // Stale-write protection: reload authoritative session before storing.
    const latest = await loadSessionFromStorage();
    const latestExtracted = Core.extractUniqueIPv4s(latest.entries);
    const latestFingerprint = Core.buildSourceFingerprint(latest, latestExtracted.ips);

    if (!Core.fingerprintsMatch(fingerprint, latestFingerprint)) {
      // Do not overwrite with diagnosis built from a superseded capture set.
      const marked = Core.emptyRouteAnalysis();
      marked.state = 'stale';
      marked.startedAt = analysisStartedAt;
      marked.completedAt = Date.now();
      marked.sourceFingerprint = fingerprint;
      marked.uniqueIPv4Count = extracted.ips.length;
      marked.skippedIPv6Count = extracted.skippedIPv6Count;
      marked.skippedMissingIpCount = extracted.skippedMissingIpCount;
      marked.results = validated.results;
      marked.error = {
        code: 'STALE_ANALYSIS',
        message: 'Capture data changed while route analysis was running. Re-analyze routes.',
      };
      // Preserve a newer completed analysis if one already finished.
      if (latest.routeAnalysis
        && latest.routeAnalysis.state === 'complete'
        && latest.routeAnalysis.completedAt
        && latest.routeAnalysis.completedAt > analysisStartedAt) {
        captureLog('stale analysis discarded — newer complete analysis present');
        return fail(
          'STALE_ANALYSIS',
          'Capture data changed while analysis was running. A newer analysis is already stored.'
        );
      }
      await saveSession({ ...latest, routeAnalysis: marked });
      return fail('STALE_ANALYSIS', marked.error.message);
    }

    // Do not overwrite a newer completed analysis with an older in-flight response.
    if (latest.routeAnalysis
      && latest.routeAnalysis.state === 'complete'
      && typeof latest.routeAnalysis.completedAt === 'number'
      && latest.routeAnalysis.completedAt > analysisStartedAt) {
      captureLog('older in-flight analysis discarded');
      return fail(
        'STALE_ANALYSIS',
        'A newer route analysis completed while this one was still running.'
      );
    }

    const analysis = Core.buildRouteAnalysis(latest, validated.results);
    analysis.startedAt = analysisStartedAt;
    analysis.completedAt = Date.now();
    analysis.sourceFingerprint = fingerprint;
    await saveSession({ ...latest, routeAnalysis: analysis });
    captureLog('route analysis complete', {
      uniqueIPv4: analysis.uniqueIPv4Count,
      candidates: analysis.candidateExclusionIps.length,
      findings: analysis.findings.length,
    });

    return ok({
      session: await loadSessionFromStorage(),
      summary: Core.summarizeSession(latest),
      routeAnalysis: analysis,
    });
  } finally {
    routeAnalysisInFlight = false;
  }
}

/**
 * Resolves the extension version from the installed manifest.
 * @returns {string}
 */
function getExtensionVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest && typeof manifest.version === 'string' && manifest.version) {
      return manifest.version;
    }
  } catch (_err) {
    // Fall through.
  }
  return 'Not available';
}

/**
 * CAPTURE_EXPORT_REPORT — privacy-reduced Markdown from authoritative session.
 * @returns {Promise<object>}
 */
async function handleCaptureExportReport() {
  try {
    const session = await loadSessionFromStorage();
    const exported = Core.buildDiagnosticMarkdownExport(session, {
      extensionVersion: getExtensionVersion(),
      generatedAtMs: Date.now(),
    });
    if (!exported.ok) {
      return fail(exported.error.code, exported.error.message);
    }
    return ok({
      text: exported.text,
      format: exported.format,
      characterCount: exported.characterCount,
    });
  } catch (err) {
    return fail(
      'EXPORT_FAILED',
      err instanceof Error ? err.message : 'Failed to export diagnostic report.'
    );
  }
}

/**
 * CAPTURE_EXPORT_JSON — full technical JSON (explicit advanced action).
 * @returns {Promise<object>}
 */
async function handleCaptureExportJson() {
  try {
    const session = await loadSessionFromStorage();
    const exported = Core.buildTechnicalExport(session, {
      extensionVersion: getExtensionVersion(),
      generatedAtMs: Date.now(),
    });
    if (!exported.ok) {
      return fail(exported.error.code, exported.error.message);
    }
    return ok({
      text: exported.text,
      format: exported.format,
      characterCount: exported.characterCount,
    });
  } catch (err) {
    return fail(
      'EXPORT_FAILED',
      err instanceof Error ? err.message : 'Failed to export technical JSON.'
    );
  }
}

/**
 * Reloads the target tab after CAPTURE_START was verified.
 * Kept as a separate action so the Side Panel can render Active first.
 * @param {object} message
 * @returns {Promise<object>}
 */
async function handleCaptureReloadTarget(message) {
  const tabId = message.tabId;
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) {
    return fail('INVALID_TAB', 'A valid numeric tab ID is required to reload.');
  }

  const session = await ensureSessionLoaded().then(() => loadSessionFromStorage());
  if (!session.active || session.tabId !== tabId) {
    return fail('CAPTURE_NOT_ACTIVE', 'Capture is not active for that tab.');
  }

  try {
    captureLog('target reload requested', { tabId });
    await chrome.tabs.reload(tabId);
    return ok({ reloaded: true, tabId, session, summary: Core.summarizeSession(session) });
  } catch (err) {
    // Capture remains active even if reload fails.
    console.error('[VRI capture] target reload failed', err);
    return ok({
      reloaded: false,
      tabId,
      session,
      summary: Core.summarizeSession(session),
      reloadWarning: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Side Panel: open on action click (primary UI). No default_popup.
// ---------------------------------------------------------------------------

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.error('[VRI capture] sidePanel.setPanelBehavior failed', err);
  });
}

// ---------------------------------------------------------------------------
// webRequest listeners — registered synchronously at top level.
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

// Stop capture only when the *target* tab is closed — never on ordinary navigation.
chrome.tabs.onRemoved.addListener((closedTabId) => {
  const work = (async () => {
    await ensureSessionLoaded();
    const session = cachedSession || Core.emptySession();
    if (session.active && session.tabId === closedTabId) {
      await enqueueSessionUpdate((current) => {
        if (!current.active || current.tabId !== closedTabId) {
          return current;
        }
        return {
          ...current,
          active: false,
          stoppedAt: Date.now(),
        };
      });
      captureLog('target tab closed — capture stopped', { tabId: closedTabId });
    }
  })();
  work.catch((err) => {
    console.error('[VRI capture] tabs.onRemoved handler failed', err);
  });
});

// Warm the session cache when the worker starts (does not gate listeners).
ensureSessionLoaded().catch((err) => {
  console.error('[VRI capture] initial session load failed', err);
});

/** Internal message bridge: Side Panel → service worker. */
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
    case 'CAPTURE_RELOAD_TARGET':
      task = handleCaptureReloadTarget(message);
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
    case 'CAPTURE_ANALYZE_ROUTES':
      task = handleCaptureAnalyzeRoutes();
      break;
    case 'CAPTURE_EXPORT_REPORT':
      task = handleCaptureExportReport();
      break;
    case 'CAPTURE_EXPORT_JSON':
      task = handleCaptureExportJson();
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

  return true;
});
