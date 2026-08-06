/**
 * Popup UI for VPN Route Inspector.
 *
 * Milestone 1: manual IPv4 route check via the service worker / native host.
 * Milestone 2: active-tab capture controls. Optional host permissions are
 * requested only from an explicit click handler (user gesture).
 *
 * Captured fields are rendered with createElement / textContent — never via
 * unrestricted innerHTML of raw capture strings.
 */

const OPTIONAL_HOST_ORIGINS = ['http://*/*', 'https://*/*'];

const CAPTURE_SESSION_KEY = 'captureSession';

/** Debounce timer for storage-driven re-renders while the popup is open. */
let captureRenderTimer = null;

/** Last rendered session fingerprint to skip redundant full list rebuilds. */
let lastCaptureFingerprint = '';

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
const captureTargetTitleEl = document.getElementById('capture-target-title');
const captureTargetUrlEl = document.getElementById('capture-target-url');
const captureStartedAtEl = document.getElementById('capture-started-at');
const captureMessageEl = document.getElementById('capture-message');
const captureResultsEl = document.getElementById('capture-results');

/** Allowed route types from the native host — CSS classes are never derived from raw strings. */
const ROUTE_TYPE_BADGE_CLASS = {
  DIRECT: 'direct',
  VPN: 'vpn',
  UNKNOWN: 'unknown',
};

/**
 * Maps a native-host route type to a safe CSS badge class name.
 * @param {string} routeType
 * @returns {string}
 */
function routeTypeBadgeClass(routeType) {
  const normalized = String(routeType || '').toUpperCase();
  return ROUTE_TYPE_BADGE_CLASS[normalized] || ROUTE_TYPE_BADGE_CLASS.UNKNOWN;
}

/**
 * Minimal HTML escaping for the legacy route-check result block.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Shows the loading state and hides previous route-check results.
 * @param {string} message
 */
function showLoading(message) {
  statusEl.textContent = message;
  statusEl.className = 'status loading';
  resultEl.className = 'result hidden';
  resultEl.replaceChildren();
  checkBtn.disabled = true;
  ipInput.disabled = true;
}

/**
 * Clears loading state and re-enables route-check controls.
 */
function hideLoading() {
  statusEl.className = 'status hidden';
  statusEl.textContent = '';
  checkBtn.disabled = false;
  ipInput.disabled = false;
}

/**
 * Renders a successful route lookup result using escaped HTML only for known fields.
 * @param {object} response - Native host JSON response.
 */
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

/**
 * Renders an error from the service worker or native host.
 * @param {string} title
 * @param {string} message
 * @param {string} [code]
 */
function showError(title, message, code) {
  resultEl.className = 'result error';
  const codeLine = code ? `<p class="error-message">Code: ${escapeHtml(code)}</p>` : '';
  resultEl.innerHTML = `
    <p class="error-title">${escapeHtml(title)}</p>
    <p class="error-message">${escapeHtml(message)}</p>
    ${codeLine}
  `;
}

/**
 * Sends CHECK_ROUTE to the service worker and renders the outcome.
 */
async function handleCheckRoute() {
  const ip = ipInput.value.trim();

  if (!ip) {
    showError('Validation error', 'Enter an IPv4 address before checking the route.');
    return;
  }

  showLoading('Checking route…');

  try {
    const bridgeResponse = await chrome.runtime.sendMessage({
      type: 'CHECK_ROUTE',
      ip,
    });

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
    showError(
      'Extension error',
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    hideLoading();
  }
}

/**
 * Shows a short capture-area message (info / error).
 * @param {string} message
 * @param {'info' | 'error'} [kind]
 */
function showCaptureMessage(message, kind = 'info') {
  captureMessageEl.textContent = message;
  captureMessageEl.className = kind === 'error'
    ? 'capture-message capture-message-error'
    : 'capture-message';
}

/**
 * Hides the capture-area message.
 */
function hideCaptureMessage() {
  captureMessageEl.textContent = '';
  captureMessageEl.className = 'capture-message hidden';
}

/**
 * Formats a millisecond timestamp for display.
 * @param {number|null} ms
 * @returns {string}
 */
function formatTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return '';
  }
  try {
    return new Date(ms).toLocaleString();
  } catch (_err) {
    return String(ms);
  }
}

/**
 * Returns a short path+query for secondary display; never used as HTML.
 * @param {string} url
 * @returns {string}
 */
function shortPath(url) {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    if (path.length <= 64) {
      return path;
    }
    return `${path.slice(0, 61)}…`;
  } catch (_err) {
    return '';
  }
}

/**
 * Maps an entry to a safe CSS modifier class for the result row.
 * @param {object} entry
 * @returns {string}
 */
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

/**
 * Builds a fingerprint so storage-driven refreshes can skip identical payloads.
 * @param {object} session
 * @param {object} summary
 * @returns {string}
 */
function captureFingerprint(session, summary) {
  return [
    session.active ? '1' : '0',
    String(session.tabId ?? ''),
    String(session.startedAt ?? ''),
    String(session.stoppedAt ?? ''),
    String(summary.entryCount ?? 0),
    String(summary.hostnameCount ?? 0),
    String(summary.ipCount ?? 0),
    String(session.entries.length ? session.entries[session.entries.length - 1].id : ''),
  ].join('|');
}

/**
 * Renders capture metadata and the scrollable result list with safe DOM APIs.
 * @param {object} session
 * @param {object} summary
 * @param {{ force?: boolean }} [options]
 */
function renderCaptureState(session, summary, options = {}) {
  const fingerprint = captureFingerprint(session, summary);
  if (!options.force && fingerprint === lastCaptureFingerprint) {
    return;
  }
  lastCaptureFingerprint = fingerprint;

  const active = session.active === true;
  captureStateEl.textContent = active ? 'Active' : 'Stopped';
  captureStateEl.className = active ? 'meta-value state-active' : 'meta-value state-stopped';

  captureEntryCountEl.textContent = String(summary.entryCount ?? session.entries.length ?? 0);
  captureHostnameCountEl.textContent = String(summary.hostnameCount ?? 0);
  captureIpCountEl.textContent = String(summary.ipCount ?? 0);

  captureTargetTitleEl.textContent = session.tabTitle
    ? `Page: ${session.tabTitle}`
    : (session.tabId != null ? 'Page: (untitled)' : 'No target tab');

  captureTargetUrlEl.textContent = session.tabUrl || '';
  captureStartedAtEl.textContent = session.startedAt
    ? `Started: ${formatTime(session.startedAt)}`
    : '';

  captureStopBtn.disabled = !active;
  captureStartBtn.disabled = false;

  captureResultsEl.replaceChildren();

  const entries = Array.isArray(session.entries) ? session.entries : [];
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'capture-empty';
    empty.textContent = 'No captured responses yet.';
    captureResultsEl.appendChild(empty);
    return;
  }

  // Newest first for diagnostic scanning.
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

/**
 * Fetches capture state from the service worker and renders it.
 * @param {{ force?: boolean, preserveMessage?: boolean }} [options]
 */
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
    renderCaptureState(response.session, response.summary, { force: options.force === true });
  } catch (err) {
    showCaptureMessage(
      err instanceof Error ? err.message : String(err),
      'error'
    );
  }
}

/**
 * Debounced refresh used by chrome.storage.onChanged while the popup is open.
 */
function scheduleCaptureRefresh() {
  if (captureRenderTimer !== null) {
    clearTimeout(captureRenderTimer);
  }
  captureRenderTimer = setTimeout(() => {
    captureRenderTimer = null;
    refreshCaptureState({ preserveMessage: true });
  }, 120);
}

/**
 * Queries the active tab in the current window and validates it for capture.
 * @returns {Promise<{ tabId: number, tabUrl: string, tabTitle: string }>}
 */
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
 * Ensures optional HTTP/HTTPS host access is granted from this user gesture.
 * @returns {Promise<boolean>} true when access is available
 */
async function ensureOptionalHostAccess() {
  const already = await chrome.permissions.contains({ origins: OPTIONAL_HOST_ORIGINS });
  if (already) {
    return true;
  }

  // Must stay inside the click handler so Chrome associates the prompt with the gesture.
  const granted = await chrome.permissions.request({ origins: OPTIONAL_HOST_ORIGINS });
  return granted === true;
}

/**
 * Start capture and reload — permission request stays in this click stack.
 */
async function handleCaptureStart() {
  hideCaptureMessage();
  captureStartBtn.disabled = true;

  try {
    const granted = await ensureOptionalHostAccess();
    if (!granted) {
      showCaptureMessage(
        'Optional HTTP/HTTPS host access was denied. Capture was not started. Cross-origin resources cannot be observed without it.',
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

    renderCaptureState(response.session, response.summary, { force: true });
    showCaptureMessage(
      'Capture has started and the tab will reload. Reopen the extension popup to inspect the results.'
    );
  } catch (err) {
    showCaptureMessage(
      err instanceof Error ? err.message : String(err),
      'error'
    );
  } finally {
    captureStartBtn.disabled = false;
  }
}

/**
 * Stops the active capture session without clearing entries.
 */
async function handleCaptureStop() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_STOP' });
    if (!response || !response.ok) {
      const err = (response && response.error) || {};
      showCaptureMessage(err.message || 'Could not stop capture.', 'error');
      return;
    }
    renderCaptureState(response.session, response.summary, { force: true });
    showCaptureMessage('Capture stopped. Existing results are kept until you clear them.');
  } catch (err) {
    showCaptureMessage(
      err instanceof Error ? err.message : String(err),
      'error'
    );
  }
}

/**
 * Clears captured entries.
 */
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
    showCaptureMessage(
      err instanceof Error ? err.message : String(err),
      'error'
    );
  }
}

/**
 * Stops capture, clears data, and revokes optional host permissions.
 */
async function handleCaptureRevoke() {
  try {
    // Keep session consistent in the service worker, then remove origins from the popup
    // gesture context as well (permissions.remove is also valid here).
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_REVOKE_HOSTS' });
    if (!response || !response.ok) {
      const err = (response && response.error) || {};
      showCaptureMessage(err.message || 'Could not revoke network access.', 'error');
      return;
    }

    // Ensure origins are removed even if the worker path partially failed earlier.
    try {
      await chrome.permissions.remove({ origins: OPTIONAL_HOST_ORIGINS });
    } catch (_err) {
      // Already removed or unavailable — session is already cleared.
    }

    renderCaptureState(response.session, response.summary, { force: true });
    showCaptureMessage('Network access revoked. Capture stopped and results cleared.');
  } catch (err) {
    showCaptureMessage(
      err instanceof Error ? err.message : String(err),
      'error'
    );
  }
}

/**
 * storage.session change listener — refresh while the popup stays open.
 * @param {object} changes
 * @param {string} areaName
 */
function onStorageChanged(changes, areaName) {
  if (areaName !== 'session') {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(changes, CAPTURE_SESSION_KEY)) {
    return;
  }
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
    captureRenderTimer = null;
  }
});

// On open, load any existing session immediately (no permission prompt).
refreshCaptureState({ force: true });
