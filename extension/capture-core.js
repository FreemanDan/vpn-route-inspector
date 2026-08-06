/**
 * Pure capture helpers for VPN Route Inspector Milestone 2.
 *
 * Loaded by the service worker via importScripts and by the dependency-free
 * JavaScriptCore test harness. Must not reference Chrome APIs.
 *
 * Global export: VriCaptureCore (attached to globalThis).
 */
(function (global) {
  'use strict';

  /** Schema version for capture session documents. */
  var CAPTURE_SCHEMA_VERSION = 1;

  /** Hard cap on stored capture entries (oldest dropped when exceeded). */
  var CAPTURE_MAX_ENTRIES = 500;

  /** Version stamp embedded in diagnostics to confirm which pipeline ran. */
  var LISTENER_VERSION = 'm2-capture-harden-1';

  /**
   * Creates empty diagnostics counters for a new capture session.
   * @returns {object}
   */
  function emptyDiagnostics() {
    return {
      listenerVersion: LISTENER_VERSION,
      eventsSeen: 0,
      responseEventsSeen: 0,
      redirectEventsSeen: 0,
      errorEventsSeen: 0,
      ignoredNoActiveSession: 0,
      ignoredWrongTab: 0,
      ignoredInvalidUrl: 0,
      ignoredUnsupportedProtocol: 0,
      duplicatesSkipped: 0,
      eventsQueued: 0,
      entriesStored: 0,
      entriesWithoutIp: 0,
      storageWriteFailures: 0,
      lastEventAt: null,
      lastStoredAt: null,
      lastEventTabId: null,
      lastIgnoredReason: null,
      permissionGranted: false,
      targetTabEventsSeen: 0,
    };
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
      diagnostics: emptyDiagnostics(),
    };
  }

  /**
   * Merges unknown diagnostics into a complete counter object.
   * @param {unknown} raw
   * @returns {object}
   */
  function normalizeDiagnostics(raw) {
    var base = emptyDiagnostics();
    if (!raw || typeof raw !== 'object') {
      return base;
    }
    var src = raw;
    var keys = Object.keys(base);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined) {
        base[key] = src[key];
      }
    }
    base.listenerVersion = LISTENER_VERSION;
    return base;
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

    var session = raw;
    if (session.schemaVersion !== CAPTURE_SCHEMA_VERSION) {
      return emptySession();
    }

    var entries = Array.isArray(session.entries) ? session.entries.slice() : [];
    var safeEntries = [];
    for (var i = 0; i < entries.length; i += 1) {
      if (entries[i] && typeof entries[i] === 'object') {
        safeEntries.push(entries[i]);
      }
    }
    if (safeEntries.length > CAPTURE_MAX_ENTRIES) {
      safeEntries = safeEntries.slice(safeEntries.length - CAPTURE_MAX_ENTRIES);
    }

    var tabId = typeof session.tabId === 'number' && isFinite(session.tabId)
      ? session.tabId
      : null;

    return {
      schemaVersion: CAPTURE_SCHEMA_VERSION,
      active: session.active === true,
      tabId: tabId,
      tabUrl: typeof session.tabUrl === 'string' ? session.tabUrl : null,
      tabTitle: typeof session.tabTitle === 'string' ? session.tabTitle : null,
      startedAt: typeof session.startedAt === 'number' ? session.startedAt : null,
      stoppedAt: typeof session.stoppedAt === 'number' ? session.stoppedAt : null,
      entries: safeEntries,
      diagnostics: normalizeDiagnostics(session.diagnostics),
    };
  }

  /**
   * Classifies a literal IP string as IPv4, IPv6, or unrecognized.
   * @param {unknown} ip
   * @returns {4 | 6 | null}
   */
  function classifyIpVersion(ip) {
    if (typeof ip !== 'string' || ip.length === 0) {
      return null;
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
      var parts = ip.split('.');
      for (var i = 0; i < parts.length; i += 1) {
        var n = Number(parts[i]);
        if (!Number.isInteger(n) || n < 0 || n > 255) {
          return null;
        }
      }
      return 4;
    }

    if (ip.indexOf(':') !== -1 && /^[0-9a-fA-F:.%]+$/.test(ip)) {
      return 6;
    }

    return null;
  }

  /**
   * Parses an HTTP(S) URL. Distinguishes parse failure vs unsupported protocol.
   * @param {unknown} rawUrl
   * @returns {{ ok: true, href: string, hostname: string, protocol: string } | { ok: false, reason: 'invalid_url' | 'unsupported_protocol' }}
   */
  function parseHttpUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
      return { ok: false, reason: 'invalid_url' };
    }

    try {
      var parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'unsupported_protocol' };
      }
      return {
        ok: true,
        href: parsed.href,
        hostname: parsed.hostname,
        protocol: parsed.protocol,
      };
    } catch (_err) {
      return { ok: false, reason: 'invalid_url' };
    }
  }

  /**
   * Returns true when a URL scheme is unsuitable as a capture target tab.
   * @param {string} url
   * @returns {boolean}
   */
  function isRejectedTabUrl(url) {
    var lower = String(url || '').toLowerCase();
    return (
      lower.indexOf('chrome://') === 0
      || lower.indexOf('chrome-extension://') === 0
      || lower.indexOf('file://') === 0
      || lower.indexOf('view-source:') === 0
      || lower.indexOf('devtools://') === 0
      || lower.indexOf('about:') === 0
      || lower.indexOf('edge://') === 0
    );
  }

  /**
   * Builds a stable deduplication key. Includes enough fields so redirects and
   * distinct response phases are not collapsed incorrectly.
   * @param {object} entry
   * @returns {string}
   */
  function dedupeKey(entry) {
    return [
      String(entry.requestId || ''),
      String(entry.eventType || ''),
      entry.statusCode == null ? '' : String(entry.statusCode),
      entry.timeStamp == null ? '' : String(entry.timeStamp),
    ].join('|');
  }

  /**
   * Normalizes a webRequest-like details object into a capture entry.
   * Missing IP does NOT prevent storage.
   * @param {'response' | 'redirect' | 'error'} eventType
   * @param {object} details
   * @param {function(): string} createId
   * @returns {{ ok: true, entry: object } | { ok: false, reason: string }}
   */
  function buildCaptureEntry(eventType, details, createId) {
    var parsed = parseHttpUrl(details && details.url);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }

    var ip = typeof details.ip === 'string' && details.ip.length > 0 ? details.ip : null;
    var makeId = typeof createId === 'function' ? createId : function () {
      return 'id-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 10);
    };

    return {
      ok: true,
      entry: {
        id: makeId(),
        requestId: typeof details.requestId === 'string'
          ? details.requestId
          : String(details.requestId || ''),
        eventType: eventType,
        url: parsed.href,
        hostname: parsed.hostname,
        method: typeof details.method === 'string' ? details.method : null,
        resourceType: typeof details.type === 'string' ? details.type : null,
        tabId: typeof details.tabId === 'number' ? details.tabId : null,
        frameId: typeof details.frameId === 'number' ? details.frameId : null,
        parentFrameId: typeof details.parentFrameId === 'number' ? details.parentFrameId : null,
        initiator: typeof details.initiator === 'string' ? details.initiator : null,
        statusCode: typeof details.statusCode === 'number' ? details.statusCode : null,
        ip: ip,
        ipVersion: classifyIpVersion(ip),
        fromCache: details.fromCache === true,
        error: typeof details.error === 'string' ? details.error : null,
        timeStamp: typeof details.timeStamp === 'number' ? details.timeStamp : Date.now(),
      },
    };
  }

  /**
   * Applies a normalized event to a session snapshot (pure).
   * Returns the next session and a decision code for diagnostics.
   * @param {object} session
   * @param {'response' | 'redirect' | 'error'} eventType
   * @param {object} details
   * @param {function(): string} createId
   * @returns {{ session: object, decision: string, entry: object|null }}
   */
  function applyCaptureEvent(session, eventType, details, createId) {
    var next = normalizeSession(session);
    var diag = next.diagnostics;
    diag.eventsSeen += 1;
    diag.lastEventAt = typeof details.timeStamp === 'number' ? details.timeStamp : Date.now();
    diag.lastEventTabId = typeof details.tabId === 'number' ? details.tabId : null;

    if (eventType === 'response') {
      diag.responseEventsSeen += 1;
    } else if (eventType === 'redirect') {
      diag.redirectEventsSeen += 1;
    } else if (eventType === 'error') {
      diag.errorEventsSeen += 1;
    }

    if (!next.active || typeof next.tabId !== 'number') {
      diag.ignoredNoActiveSession += 1;
      diag.lastIgnoredReason = 'no_active_session';
      next.diagnostics = diag;
      return { session: next, decision: 'ignored_no_active_session', entry: null };
    }

    if (typeof details.tabId !== 'number' || details.tabId !== next.tabId) {
      diag.ignoredWrongTab += 1;
      diag.lastIgnoredReason = 'wrong_tab';
      next.diagnostics = diag;
      return { session: next, decision: 'ignored_wrong_tab', entry: null };
    }

    diag.targetTabEventsSeen += 1;

    var built = buildCaptureEntry(eventType, details, createId);
    if (!built.ok) {
      if (built.reason === 'unsupported_protocol') {
        diag.ignoredUnsupportedProtocol += 1;
        diag.lastIgnoredReason = 'unsupported_protocol';
      } else {
        diag.ignoredInvalidUrl += 1;
        diag.lastIgnoredReason = 'invalid_url';
      }
      next.diagnostics = diag;
      return { session: next, decision: 'ignored_' + built.reason, entry: null };
    }

    var entry = built.entry;
    var key = dedupeKey(entry);
    for (var i = 0; i < next.entries.length; i += 1) {
      if (dedupeKey(next.entries[i]) === key) {
        diag.duplicatesSkipped += 1;
        diag.lastIgnoredReason = 'duplicate';
        next.diagnostics = diag;
        return { session: next, decision: 'duplicate', entry: null };
      }
    }

    diag.eventsQueued += 1;
    next.entries = next.entries.concat([entry]);
    if (next.entries.length > CAPTURE_MAX_ENTRIES) {
      next.entries = next.entries.slice(next.entries.length - CAPTURE_MAX_ENTRIES);
    }

    diag.entriesStored += 1;
    if (!entry.ip) {
      diag.entriesWithoutIp += 1;
    }
    diag.lastStoredAt = entry.timeStamp;
    diag.lastIgnoredReason = null;
    next.diagnostics = diag;

    return { session: next, decision: 'stored', entry: entry };
  }

  /**
   * Summary counters for the UI.
   * @param {object} session
   * @returns {{ entryCount: number, hostnameCount: number, ipCount: number }}
   */
  function summarizeSession(session) {
    var normalized = normalizeSession(session);
    var hostnames = {};
    var ips = {};
    var hostnameCount = 0;
    var ipCount = 0;

    for (var i = 0; i < normalized.entries.length; i += 1) {
      var entry = normalized.entries[i];
      if (typeof entry.hostname === 'string' && entry.hostname && !hostnames[entry.hostname]) {
        hostnames[entry.hostname] = true;
        hostnameCount += 1;
      }
      if (typeof entry.ip === 'string' && entry.ip && !ips[entry.ip]) {
        ips[entry.ip] = true;
        ipCount += 1;
      }
    }

    return {
      entryCount: normalized.entries.length,
      hostnameCount: hostnameCount,
      ipCount: ipCount,
    };
  }

  /**
   * Enforces the 500-entry eviction policy on an array.
   * @param {Array} entries
   * @returns {Array}
   */
  function evictOldestEntries(entries) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    if (list.length > CAPTURE_MAX_ENTRIES) {
      return list.slice(list.length - CAPTURE_MAX_ENTRIES);
    }
    return list;
  }

  global.VriCaptureCore = {
    CAPTURE_SCHEMA_VERSION: CAPTURE_SCHEMA_VERSION,
    CAPTURE_MAX_ENTRIES: CAPTURE_MAX_ENTRIES,
    LISTENER_VERSION: LISTENER_VERSION,
    emptyDiagnostics: emptyDiagnostics,
    emptySession: emptySession,
    normalizeDiagnostics: normalizeDiagnostics,
    normalizeSession: normalizeSession,
    classifyIpVersion: classifyIpVersion,
    parseHttpUrl: parseHttpUrl,
    isRejectedTabUrl: isRejectedTabUrl,
    dedupeKey: dedupeKey,
    buildCaptureEntry: buildCaptureEntry,
    applyCaptureEvent: applyCaptureEvent,
    summarizeSession: summarizeSession,
    evictOldestEntries: evictOldestEntries,
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
