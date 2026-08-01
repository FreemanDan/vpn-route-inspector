/**
 * Popup UI logic for Milestone 1: manual IPv4 route check.
 * Sends an internal message to the service worker; never calls native messaging directly.
 */

const ipInput = document.getElementById('ip-input');
const checkBtn = document.getElementById('check-btn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

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
 * Shows the loading state and hides previous results.
 * @param {string} message
 */
function showLoading(message) {
  statusEl.textContent = message;
  statusEl.className = 'status loading';
  resultEl.className = 'result hidden';
  resultEl.innerHTML = '';
  checkBtn.disabled = true;
  ipInput.disabled = true;
}

/**
 * Clears loading state and re-enables controls.
 */
function hideLoading() {
  statusEl.className = 'status hidden';
  statusEl.textContent = '';
  checkBtn.disabled = false;
  ipInput.disabled = false;
}

/**
 * Renders a successful route lookup result.
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
 * Minimal HTML escaping for user-controlled and API strings.
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

checkBtn.addEventListener('click', handleCheckRoute);

ipInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleCheckRoute();
  }
});
