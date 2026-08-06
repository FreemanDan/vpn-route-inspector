/**
 * Side Panel UI for VPN Route Inspector.
 *
 * Milestone 1: manual IPv4 route check via the service worker / native host.
 * Milestone 2: active-tab capture. Optional host permissions are requested only
 * from an explicit click handler, then verified with permissions.contains.
 *
 * This UI never writes the capture session document. All mutations go through
 * the service worker. Captured fields are rendered with createElement/textContent.
 */

const OPTIONAL_HOST_ORIGINS = ['http://*/*', 'https://*/*'];
const CAPTURE_SESSION_KEY = 'captureSession';

/** Debounce timer for storage-driven list re-renders. */
let captureRenderTimer = null;

/** Faster timer for counters / diagnostics while the list debounce is pending. */
let captureMetaTimer = null;

/** Last rendered fingerprint to skip redundant full list rebuilds. */
let lastCaptureFingerprint = '';

/** Wall-clock when the local UI observed Active after Start (for zero-event warning). */
let captureActivatedAt = null;

const ipInput = document.getElementById('ip-input');
const checkBtn = document.getElementById('check-btn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

const captureStartBtn = document.getElementById('capture-start-btn');
const captureStopBtn = document.getElementById('capture-stop-btn');
const captureClearBtn = document.getElementById('capture-clear-btn');
const captureRevokeBtn = document.getElementById('capture-revoke-btn');
const captureStateEl = document.getElementById('capture-state');
const captureEntryCountEl = document.getElementById('capture-entry-count');
const captureHostnameCountEl = document.getElementById('capture-hostname-count');
const captureIpCountEl = document.getElementById('capture-ip-count');
const captureBrowserTabEl = document.getElementById('capture-browser-tab');
const captureTargetTitleEl = document.getElementById('capture-target-title');
const captureTargetUrlEl = document.getElementById('capture-target-url');
const captureStartedAtEl = document.getElementById('capture-started-at');
const captureMessageEl = document.getElementById('capture-message');
const captureResultsEl = document.getElementById('capture-results');
const captureDiagnosticsBody = document.getElementById('capture-diagnostics-body');

const ROUTE_TYPE_BADGE_CLASS = {
  DIRECT: 'direct',
  VPN: 'vpn',
  UNKNOWN: 'unknown',
};

function routeTypeBadgeClass(routeType) {
  const normalized = String(routeType || '').toUpperCase();
  return ROUTE_TYPE_BADGE_CLASS[normalized] || ROUTE_TYPE_BADGE_CLASS.UNKNOWN;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showLoading(message) {
  statusEl.textContent = message;
  statusEl.className = 'status loading';
  resultEl.className = 'result hidden';
  resultEl.replaceChildren();
  checkBtn.disabled = true;
  ipInput.disabled = true;
}

function hideLoading() {
  statusEl.className = 'status hidden';
  statusEl.textContent = '';
  checkBtn.disabled = false;
  ipInput.disabled = false;
}

function showSuccess(response) {
  const routeType = String(response.routeType || 'UNKNOWN').toUpperCase();
  const badgeClass = routeTypeBadgeClass(routeType);
  const displayType = ROUTE_TYPE_BADGE_CLASS[routeType] ? routeType : 'UNKNOWN';

  resultEl.className = 'result success';
  resultEl.innerHTML = `
    <dl>
      <dt>IP</dt>
      <dd>${escapeHtml(response.ip || '—')}</dd>
      <dt>Interface</dt>
      <dd>${escapeHtml(response.interface || '—')}</dd>
      <dt>Route type</dt>
      <dd><span class="badge ${badgeClass}">${escapeHtml(displayType)}</span></dd>
    </dl>
  `;
}

function showError(title, message, code) {
  resultEl.className = 'result error';
  const codeLine = code ? `<p class="error-message">Code: ${escapeHtml(code)}</p>` : '';
  resultEl.innerHTML = `
    <p class="error-title">${escapeHtml(title)}</p>
    <p class="error-message">${escapeHtml(message)}</p>
    ${codeLine}
  `;
}

async function handleCheckRoute() {
  const ip = ipInput.value.trim();
  if (!ip) {
    showError('Validation error', 'Enter an IPv4 address before checking the route.');
    return;
  }

  showLoading('Checking route…');
  try {
    const bridgeResponse = await chrome.runtime.sendMessage({ type: 'CHECK_ROUTE', ip });
    if (!bridgeResponse) {
      showError('Communication error', 'No response from the service worker.');
      return;
    }
    if (!bridgeResponse.ok) {
      const err = bridgeResponse.error || {};
      showError('Request failed', err.message || 'Unknown error.', err.code);
      return;
    }
    const nativeResponse = bridgeResponse.response;
    if (nativeResponse.ok) {
      showSuccess(nativeResponse);
    } else {
      const err = nativeResponse.error || {};
      showError('Route check failed', err.message || 'Unknown error.', err.code);
    }
  } catch (err) {
    showError('Extension error', err instanceof Error ? err.message : String(err));
  } finally {
    hideLoading();
  }
}

function showCaptureMessage(message, kind = 'info') {
  captureMessageEl.textContent = message;
  captureMessageEl.className = kind === 'error'
    ? 'capture-message capture-message-error'
    : 'capture-message';
}

function hideCaptureMessage() {
  captureMessageEl.textContent = '';
  captureMessageEl.className = 'capture-message hidden';
}

function formatTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return '—';
  }
  try {
    return new Date(ms).toLocaleString();
  } catch (_err) {
    return String(ms);
  }
}

function shortPath(url) {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return path.length <= 64 ? path : `${path.slice(0, 61)}…`;
  } catch (_err) {
    return '';
  }
}

function entryRowClass(entry) {
  if (entry.eventType === 'error') {
    return 'row-error';
  }
  if (entry.eventType === 'redirect') {
    return 'row-redirect';
  }
  const status = entry.statusCode;
  if (typeof status === 'number') {
    if (status >= 500) {
      return 'row-http-5xx';
    }
    if (status >= 400) {
      return 'row-http-4xx';
    }
  }
  if (!entry.ip) {
    return 'row-no-ip';
  }
  return 'row-ok';
}

function captureFingerprint(session, summary) {
  const diag = session.diagnostics || {};
  return [
    session.active ? '1' : '0',
    String(session.tabId ?? ''),
    String(summary.entryCount ?? 0),
    String(diag.eventsSeen ?? 0),
    String(diag.entriesStored ?? 0),
    String(diag.storageWriteFailures ?? 0),
    String(session.entries.length ? session.entries[session.entries.length - 1].id : ''),
  ].join('|');
}

/**
 * Renders the collapsible diagnostics block from session.diagnostics.
 * @param {object} session
 */
function renderDiagnostics(session) {
  const diag = session.diagnostics || {};
  const rows = [
    ['permissions granted', diag.permissionGranted === true ? 'yes' : 'no'],
    ['listener version', diag.listenerVersion || '—'],
    ['events seen', String(diag.eventsSeen ?? 0)],
    ['target-tab events', String(diag.targetTabEventsSeen ?? 0)],
    ['response / redirect / error', `${diag.responseEventsSeen ?? 0} / ${diag.redirectEventsSeen ?? 0} / ${diag.errorEventsSeen ?? 0}`],
    ['events queued', String(diag.eventsQueued ?? 0)],
    ['entries stored', String(diag.entriesStored ?? 0)],
    ['entries without IP', String(diag.entriesWithoutIp ?? 0)],
    ['wrong-tab events', String(diag.ignoredWrongTab ?? 0)],
    ['ignored (no session)', String(diag.ignoredNoActiveSession ?? 0)],
    ['duplicates skipped', String(diag.duplicatesSkipped ?? 0)],
    ['storage failures', String(diag.storageWriteFailures ?? 0)],
    ['last ignored reason', diag.lastIgnoredReason || '—'],
    ['last event tab', diag.lastEventTabId == null ? '—' : String(diag.lastEventTabId)],
    ['last event at', formatTime(diag.lastEventAt)],
    ['last stored at', formatTime(diag.lastStoredAt)],
  ];

  captureDiagnosticsBody.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    captureDiagnosticsBody.appendChild(dt);
    captureDiagnosticsBody.appendChild(dd);
  }
}

/**
 * Updates counters/meta quickly; optionally rebuilds the result list.
 * @param {object} session
 * @param {object} summary
 * @param {{ force?: boolean, rebuildList?: boolean, browserTabLabel?: string }} [options]
 */
function renderCaptureState(session, summary, options = {}) {
  const fingerprint = captureFingerprint(session, summary);
  const rebuildList = options.rebuildList !== false;
  if (!options.force && fingerprint === lastCaptureFingerprint && rebuildList) {
    renderDiagnostics(session);
    return;
  }
  if (rebuildList || options.force) {
    lastCaptureFingerprint = fingerprint;
  }

  const active = session.active === true;
  captureStateEl.textContent = active ? 'Active' : 'Stopped';
  captureStateEl.className = active ? 'meta-value state-active' : 'meta-value state-stopped';

  captureEntryCountEl.textContent = String(summary.entryCount ?? session.entries.length ?? 0);
  captureHostnameCountEl.textContent = String(summary.hostnameCount ?? 0);
  captureIpCountEl.textContent = String(summary.ipCount ?? 0);

  if (typeof options.browserTabLabel === 'string') {
    captureBrowserTabEl.textContent = options.browserTabLabel;
  }

  captureTargetTitleEl.textContent = session.tabId != null
    ? `Capture target tab #${session.tabId}${session.tabTitle ? `: ${session.tabTitle}` : ''}`
    : 'No capture target';

  captureTargetUrlEl.textContent = session.tabUrl || '';
  captureStartedAtEl.textContent = session.startedAt
    ? `Started: ${formatTime(session.startedAt)}`
    : '';

  captureStopBtn.disabled = !active;
  renderDiagnostics(session);

  const diag = session.diagnostics || {};
  if (active && (diag.eventsSeen ?? 0) === 0) {
    const elapsed = captureActivatedAt ? (Date.now() - captureActivatedAt) : 0;
    if (elapsed >= 3000) {
      showCaptureMessage(
        'No webRequest events have reached the extension yet. Open Capture diagnostics for details.',
        'error'
      );
    }
  } else if (active && (diag.eventsSeen ?? 0) > 0 && (diag.entriesStored ?? 0) === 0) {
    showCaptureMessage(
      'Events are reaching the listener but are being filtered or storage is failing. See diagnostics.',
      'error'
    );
  }

  if (!rebuildList && !options.force) {
    return;
  }

  captureResultsEl.replaceChildren();
  const entries = Array.isArray(session.entries) ? session.entries : [];
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'capture-empty';
    empty.textContent = 'No captured responses yet.';
    captureResultsEl.appendChild(empty);
    return;
  }

  const ordered = entries.slice().reverse();
  for (const entry of ordered) {
    const row = document.createElement('article');
    row.className = `capture-row ${entryRowClass(entry)}`;

    const top = document.createElement('div');
    top.className = 'capture-row-top';

    const status = document.createElement('span');
    status.className = 'capture-status-code';
    if (entry.eventType === 'error') {
      status.textContent = 'ERR';
    } else if (typeof entry.statusCode === 'number') {
      status.textContent = String(entry.statusCode);
    } else if (entry.eventType === 'redirect') {
      status.textContent = '→';
    } else {
      status.textContent = '—';
    }
    top.appendChild(status);

    const host = document.createElement('span');
    host.className = 'capture-hostname';
    host.textContent = entry.hostname || '(no hostname)';
    top.appendChild(host);

    const ip = document.createElement('span');
    ip.className = 'capture-ip';
    if (entry.ip) {
      ip.textContent = entry.ipVersion === 6 ? `${entry.ip} (IPv6)` : entry.ip;
    } else {
      ip.textContent = 'No IP';
      ip.classList.add('muted');
    }
    top.appendChild(ip);
    row.appendChild(top);

    const meta = document.createElement('div');
    meta.className = 'capture-row-meta';
    const type = document.createElement('span');
    type.textContent = entry.resourceType || 'unknown';
    meta.appendChild(type);
    const method = document.createElement('span');
    method.textContent = entry.method || '—';
    meta.appendChild(method);
    if (entry.fromCache === true) {
      const cache = document.createElement('span');
      cache.className = 'cache-badge';
      cache.textContent = 'CACHE';
      meta.appendChild(cache);
    }
    if (entry.eventType === 'redirect') {
      const redirect = document.createElement('span');
      redirect.className = 'event-badge';
      redirect.textContent = 'REDIRECT';
      meta.appendChild(redirect);
    }
    if (entry.eventType === 'error' && entry.error) {
      const err = document.createElement('span');
      err.className = 'event-badge';
      err.textContent = String(entry.error);
      meta.appendChild(err);
    }
    row.appendChild(meta);

    const details = document.createElement('div');
    details.className = 'capture-row-details muted';
    const parts = [];
    if (entry.timeStamp) {
      parts.push(formatTime(entry.timeStamp));
    }
    if (entry.initiator) {
      parts.push(`initiator: ${entry.initiator}`);
    }
    const path = shortPath(entry.url || '');
    if (path) {
      parts.push(path);
    }
    details.textContent = parts.join(' · ');
    row.appendChild(details);

    captureResultsEl.appendChild(row);
  }
}

async function describeBrowserTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab) {
      return 'Current browser tab: (unknown)';
    }
    const label = tab.title || tab.url || '(untitled)';
    return `Current browser tab #${tab.id}: ${label}`;
  } catch (_err) {
    return 'Current browser tab: (unavailable)';
  }
}

async function refreshCaptureState(options = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_GET_STATE' });
    if (!response || !response.ok) {
      const err = (response && response.error) || {};
      showCaptureMessage(err.message || 'Could not load capture state.', 'error');
      return;
    }
    if (!options.preserveMessage) {
      hideCaptureMessage();
    }
    const browserTabLabel = await describeBrowserTab();
    if (response.session.active && !captureActivatedAt) {
      captureActivatedAt = response.session.startedAt || Date.now();
    }
    if (!response.session.active) {
      captureActivatedAt = null;
    }
    renderCaptureState(response.session, response.summary, {
      force: options.force === true,
      rebuildList: options.rebuildList !== false,
      browserTabLabel,
    });
  } catch (err) {
    showCaptureMessage(err instanceof Error ? err.message : String(err), 'error');
  }
}

function scheduleCaptureRefresh() {
  // Update counters/diagnostics quickly.
  if (captureMetaTimer !== null) {
    clearTimeout(captureMetaTimer);
  }
  captureMetaTimer = setTimeout(() => {
    captureMetaTimer = null;
    refreshCaptureState({ preserveMessage: true, rebuildList: false });
  }, 40);

  // Debounce the heavy list rebuild.
  if (captureRenderTimer !== null) {
    clearTimeout(captureRenderTimer);
  }
  captureRenderTimer = setTimeout(() => {
    captureRenderTimer = null;
    refreshCaptureState({ preserveMessage: true, rebuildList: true });
  }, 150);
}

async function getActiveHttpTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== 'number') {
    throw new Error('Could not determine the active tab ID.');
  }

  const tabUrl = typeof tab.url === 'string' ? tab.url : '';
  if (!tabUrl) {
    throw new Error('The active tab has no URL yet. Wait for the page to finish loading.');
  }

  const lower = tabUrl.toLowerCase();
  if (
    lower.startsWith('chrome://')
    || lower.startsWith('chrome-extension://')
    || lower.startsWith('file://')
    || lower.startsWith('view-source:')
    || lower.startsWith('devtools://')
    || lower.startsWith('about:')
  ) {
    throw new Error(
      'Capture only works on normal http: or https: pages. Switch to a website tab and try again.'
    );
  }

  let parsed;
  try {
    parsed = new URL(tabUrl);
  } catch (_err) {
    throw new Error('The active tab URL could not be parsed.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Capture only works on normal http: or https: pages.');
  }

  return {
    tabId: tab.id,
    tabUrl,
    tabTitle: typeof tab.title === 'string' ? tab.title : '',
  };
}

/**
 * Request optional hosts from this user gesture, then verify with contains().
 * @returns {Promise<boolean>}
 */
async function ensureOptionalHostAccess() {
  const already = await chrome.permissions.contains({ origins: OPTIONAL_HOST_ORIGINS });
  if (already) {
    return true;
  }

  const requested = await chrome.permissions.request({ origins: OPTIONAL_HOST_ORIGINS });
  if (requested !== true) {
    return false;
  }

  // Do not trust the request() boolean alone — verify the granted origins.
  const verified = await chrome.permissions.contains({ origins: OPTIONAL_HOST_ORIGINS });
  return verified === true;
}

async function handleCaptureStart() {
  hideCaptureMessage();
  captureStartBtn.disabled = true;

  try {
    const granted = await ensureOptionalHostAccess();
    if (!granted) {
      showCaptureMessage(
        'Optional HTTP/HTTPS host access was denied or could not be verified. Capture was not started.',
        'error'
      );
      return;
    }

    const tab = await getActiveHttpTab();

    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_START',
      tabId: tab.tabId,
      tabUrl: tab.tabUrl,
      tabTitle: tab.tabTitle,
    });

    if (!response || !response.ok) {
      const err = (response && response.error) || {};
      showCaptureMessage(err.message || 'Could not start capture.', 'error');
      return;
    }

    captureActivatedAt = Date.now();
    const browserTabLabel = await describeBrowserTab();
    renderCaptureState(response.session, response.summary, {
      force: true,
      browserTabLabel,
    });
    showCaptureMessage(
      'Capture is Active for the target tab. Reloading that tab now — keep this Side Panel open to watch results arrive.'
    );

    // Reload only after the session was persisted and verified by the worker.
    const reloadTabId = typeof response.reloadTabId === 'number'
      ? response.reloadTabId
      : tab.tabId;

    const reloadResponse = await chrome.runtime.sendMessage({
      type: 'CAPTURE_RELOAD_TARGET',
      tabId: reloadTabId,
    });

    if (reloadResponse && reloadResponse.ok && reloadResponse.reloadWarning) {
      showCaptureMessage(
        `Capture stays Active, but reload failed: ${reloadResponse.reloadWarning}`,
        'error'
      );
    } else if (!reloadResponse || !reloadResponse.ok) {
      const err = (reloadResponse && reloadResponse.error) || {};
      showCaptureMessage(
        `Capture stays Active, but reload was not confirmed: ${err.message || 'unknown error'}`,
        'error'
      );
    }
  } catch (err) {
    showCaptureMessage(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    captureStartBtn.disabled = false;
  }
}

async function handleCaptureStop() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_STOP' });
    if (!response || !response.ok) {
      const err = (response && response.error) || {};
      showCaptureMessage(err.message || 'Could not stop capture.', 'error');
      return;
    }
    captureActivatedAt = null;
    renderCaptureState(response.session, response.summary, { force: true });
    showCaptureMessage('Capture stopped. Existing results are kept until you clear them.');
  } catch (err) {
    showCaptureMessage(err instanceof Error ? err.message : String(err), 'error');
  }
}

async function handleCaptureClear() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_CLEAR' });
    if (!response || !response.ok) {
      const err = (response && response.error) || {};
      showCaptureMessage(err.message || 'Could not clear capture results.', 'error');
      return;
    }
    renderCaptureState(response.session, response.summary, { force: true });
    showCaptureMessage('Capture results cleared.');
  } catch (err) {
    showCaptureMessage(err instanceof Error ? err.message : String(err), 'error');
  }
}

async function handleCaptureRevoke() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_REVOKE_HOSTS' });
    if (!response || !response.ok) {
      const err = (response && response.error) || {};
      showCaptureMessage(err.message || 'Could not revoke network access.', 'error');
      return;
    }
    try {
      await chrome.permissions.remove({ origins: OPTIONAL_HOST_ORIGINS });
    } catch (_err) {
      // Already removed.
    }
    captureActivatedAt = null;
    renderCaptureState(response.session, response.summary, { force: true });
    showCaptureMessage('Network access revoked. Capture stopped and results cleared.');
  } catch (err) {
    showCaptureMessage(err instanceof Error ? err.message : String(err), 'error');
  }
}

function onStorageChanged(changes, areaName) {
  if (areaName !== 'session') {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(changes, CAPTURE_SESSION_KEY)) {
    return;
  }
  // Never write storage from the Side Panel — only refresh from the worker/storage.
  scheduleCaptureRefresh();
}

checkBtn.addEventListener('click', handleCheckRoute);
ipInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleCheckRoute();
  }
});

captureStartBtn.addEventListener('click', handleCaptureStart);
captureStopBtn.addEventListener('click', handleCaptureStop);
captureClearBtn.addEventListener('click', handleCaptureClear);
captureRevokeBtn.addEventListener('click', handleCaptureRevoke);

chrome.storage.onChanged.addListener(onStorageChanged);

window.addEventListener('unload', () => {
  chrome.storage.onChanged.removeListener(onStorageChanged);
  if (captureRenderTimer !== null) {
    clearTimeout(captureRenderTimer);
  }
  if (captureMetaTimer !== null) {
    clearTimeout(captureMetaTimer);
  }
});

// Zero-event warning poll while Active (Side Panel can stay open across reloads).
setInterval(() => {
  if (captureActivatedAt && captureStateEl.textContent === 'Active') {
    refreshCaptureState({ preserveMessage: true, rebuildList: false });
  }
}, 2000);

refreshCaptureState({ force: true });
