/**
 * Manifest V3 service worker.
 * Receives route-check requests from the popup and forwards them to the native host
 * via Chrome Native Messaging. Milestone 1 uses only the nativeMessaging permission.
 */

/** Native Messaging host name registered in the Chrome manifest on disk. */
const NATIVE_HOST_NAME = 'com.freemandan.vpn_route_inspector';

/** Maximum time to wait for the native host response (milliseconds). */
const NATIVE_MESSAGE_TIMEOUT_MS = 15000;

/**
 * Generates a short unique request ID for correlating popup ↔ native host messages.
 * @returns {string}
 */
function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
        // Always read lastError inside the callback to avoid unchecked runtime errors.
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

/** Internal message bridge: popup → service worker → native host. */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'CHECK_ROUTE') {
    return false;
  }

  const ip = typeof message.ip === 'string' ? message.ip.trim() : '';

  checkRouteViaNativeHost(ip)
    .then((response) => sendResponse({ ok: true, response }))
    .catch((err) => {
      sendResponse({
        ok: false,
        error: {
          code: 'NATIVE_HOST_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    });

  return true;
});
