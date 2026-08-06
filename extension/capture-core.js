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

  /** Maximum unique IPv4s sent in one checkRoutes batch. */
  var MAX_ANALYZE_IPV4 = 128;

  /** Schema version for routeAnalysis objects on the capture session. */
  var ROUTE_ANALYSIS_SCHEMA_VERSION = 1;

  /** Version stamp embedded in diagnostics to confirm which pipeline ran. */
  var LISTENER_VERSION = 'm3-route-analysis-1';

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
   * Empty / reset route-analysis document (Milestone 3).
   * @returns {object}
   */
  function emptyRouteAnalysis() {
    return {
      schemaVersion: ROUTE_ANALYSIS_SCHEMA_VERSION,
      state: 'idle',
      startedAt: null,
      completedAt: null,
      sourceFingerprint: null,
      uniqueIPv4Count: 0,
      skippedIPv6Count: 0,
      skippedMissingIpCount: 0,
      results: [],
      findings: [],
      groups: [],
      candidateExclusionIps: [],
      summary: null,
      error: null,
      networkChangeErrorCount: 0,
    };
  }

  /**
   * Normalizes a stored routeAnalysis object.
   * @param {unknown} raw
   * @returns {object}
   */
  function normalizeRouteAnalysis(raw) {
    var base = emptyRouteAnalysis();
    if (!raw || typeof raw !== 'object') {
      return base;
    }
    if (raw.schemaVersion !== ROUTE_ANALYSIS_SCHEMA_VERSION) {
      return base;
    }
    var states = { idle: 1, running: 1, complete: 1, error: 1, stale: 1 };
    base.state = states[raw.state] ? raw.state : 'idle';
    base.startedAt = typeof raw.startedAt === 'number' ? raw.startedAt : null;
    base.completedAt = typeof raw.completedAt === 'number' ? raw.completedAt : null;
    base.sourceFingerprint = raw.sourceFingerprint && typeof raw.sourceFingerprint === 'object'
      ? raw.sourceFingerprint
      : null;
    base.uniqueIPv4Count = typeof raw.uniqueIPv4Count === 'number' ? raw.uniqueIPv4Count : 0;
    base.skippedIPv6Count = typeof raw.skippedIPv6Count === 'number' ? raw.skippedIPv6Count : 0;
    base.skippedMissingIpCount = typeof raw.skippedMissingIpCount === 'number' ? raw.skippedMissingIpCount : 0;
    base.results = Array.isArray(raw.results) ? raw.results.slice(0, MAX_ANALYZE_IPV4) : [];
    base.findings = Array.isArray(raw.findings) ? raw.findings.slice(0, 200) : [];
    base.groups = Array.isArray(raw.groups) ? raw.groups.slice(0, 500) : [];
    base.candidateExclusionIps = Array.isArray(raw.candidateExclusionIps)
      ? raw.candidateExclusionIps.slice(0, MAX_ANALYZE_IPV4)
      : [];
    base.summary = raw.summary && typeof raw.summary === 'object' ? raw.summary : null;
    base.error = raw.error && typeof raw.error === 'object' ? raw.error : null;
    base.networkChangeErrorCount = typeof raw.networkChangeErrorCount === 'number'
      ? raw.networkChangeErrorCount
      : 0;
    return base;
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
      routeAnalysis: emptyRouteAnalysis(),
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
      routeAnalysis: normalizeRouteAnalysis(session.routeAnalysis),
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

    // New evidence after a finished analysis makes prior conclusions stale.
    if (next.routeAnalysis && next.routeAnalysis.state === 'complete') {
      next.routeAnalysis = Object.assign({}, next.routeAnalysis, { state: 'stale' });
    }

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

  // ---------------------------------------------------------------------------
  // Milestone 3 — pure route-analysis / split-tunnel diagnosis
  // ---------------------------------------------------------------------------

  /**
   * Extracts unique IPv4s (first-seen order) and skip counts from capture entries.
   * @param {Array} entries
   * @returns {{ ips: string[], skippedIPv6Count: number, skippedMissingIpCount: number, truncated: boolean }}
   */
  function extractUniqueIPv4s(entries) {
    var ips = [];
    var seen = {};
    var skippedIPv6Count = 0;
    var skippedMissingIpCount = 0;
    var list = Array.isArray(entries) ? entries : [];

    for (var i = 0; i < list.length; i += 1) {
      var entry = list[i];
      var ip = entry && typeof entry.ip === 'string' ? entry.ip : null;
      var version = classifyIpVersion(ip);
      if (!ip) {
        skippedMissingIpCount += 1;
        continue;
      }
      if (version === 6) {
        skippedIPv6Count += 1;
        continue;
      }
      if (version !== 4) {
        continue;
      }
      if (!seen[ip]) {
        seen[ip] = true;
        ips.push(ip);
      }
    }

    var truncated = ips.length > MAX_ANALYZE_IPV4;
    if (truncated) {
      ips = ips.slice(0, MAX_ANALYZE_IPV4);
    }
    return {
      ips: ips,
      skippedIPv6Count: skippedIPv6Count,
      skippedMissingIpCount: skippedMissingIpCount,
      truncated: truncated,
    };
  }

  /**
   * Builds a fingerprint used to detect stale analysis writes.
   * @param {object} session
   * @param {string[]} uniqueIPv4s
   * @returns {object}
   */
  function buildSourceFingerprint(session, uniqueIPv4s) {
    var ips = (uniqueIPv4s || []).slice().sort();
    return {
      tabId: session && typeof session.tabId === 'number' ? session.tabId : null,
      startedAt: session && typeof session.startedAt === 'number' ? session.startedAt : null,
      entryCount: session && Array.isArray(session.entries) ? session.entries.length : 0,
      ipv4s: ips,
      ipv4Key: ips.join(','),
    };
  }

  /**
   * Compares two source fingerprints for material IPv4-set / session identity changes.
   * @param {object|null} a
   * @param {object|null} b
   * @returns {boolean}
   */
  function fingerprintsMatch(a, b) {
    if (!a || !b) {
      return false;
    }
    return a.tabId === b.tabId
      && a.startedAt === b.startedAt
      && a.ipv4Key === b.ipv4Key;
  }

  /**
   * True when an entry shows HTTP 4xx/5xx or a network error event.
   * @param {object} entry
   * @returns {boolean}
   */
  function entryHasErrorEvidence(entry) {
    if (!entry) {
      return false;
    }
    if (entry.eventType === 'error') {
      return true;
    }
    if (typeof entry.statusCode === 'number' && entry.statusCode >= 400 && entry.statusCode <= 599) {
      return true;
    }
    if (typeof entry.error === 'string' && entry.error.length > 0) {
      return true;
    }
    return false;
  }

  /**
   * Aggregates capture entries by hostname → IPv4 (and no-IP / IPv6 buckets).
   * @param {Array} entries
   * @returns {{ groups: Array, networkChangeErrorCount: number, unclassifiedErrors: Array }}
   */
  function aggregateHostnameIp(entries) {
    var groupMap = {};
    var groups = [];
    var networkChangeErrorCount = 0;
    var unclassifiedErrors = [];
    var list = Array.isArray(entries) ? entries : [];

    for (var i = 0; i < list.length; i += 1) {
      var entry = list[i];
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      var errText = typeof entry.error === 'string' ? entry.error : '';
      if (errText.indexOf('ERR_NETWORK_CHANGED') !== -1) {
        networkChangeErrorCount += 1;
      }

      var hostname = typeof entry.hostname === 'string' && entry.hostname
        ? entry.hostname
        : '(unknown)';
      var ip = typeof entry.ip === 'string' && entry.ip ? entry.ip : null;
      var version = classifyIpVersion(ip);
      var ipKey = ip && version === 4 ? ip : (version === 6 ? 'ipv6:' + ip : 'no-ip');

      var key = hostname + '\0' + ipKey;
      var group = groupMap[key];
      if (!group) {
        group = {
          hostname: hostname,
          ip: version === 4 ? ip : null,
          ipVersion: version,
          requestCount: 0,
          statusCodes: {},
          resourceTypes: {},
          eventTypes: {},
          networkErrors: {},
          firstSeen: typeof entry.timeStamp === 'number' ? entry.timeStamp : null,
          lastSeen: typeof entry.timeStamp === 'number' ? entry.timeStamp : null,
          hasErrorEvidence: false,
          httpErrorStatuses: [],
        };
        groupMap[key] = group;
        groups.push(group);
      }

      group.requestCount += 1;
      if (typeof entry.statusCode === 'number') {
        group.statusCodes[String(entry.statusCode)] = true;
        if (entry.statusCode >= 400 && entry.statusCode <= 599) {
          group.httpErrorStatuses.push(entry.statusCode);
        }
      }
      if (typeof entry.resourceType === 'string' && entry.resourceType) {
        group.resourceTypes[entry.resourceType] = true;
      }
      if (typeof entry.eventType === 'string' && entry.eventType) {
        group.eventTypes[entry.eventType] = true;
      }
      if (errText) {
        group.networkErrors[errText] = (group.networkErrors[errText] || 0) + 1;
      }
      if (typeof entry.timeStamp === 'number') {
        if (group.firstSeen == null || entry.timeStamp < group.firstSeen) {
          group.firstSeen = entry.timeStamp;
        }
        if (group.lastSeen == null || entry.timeStamp > group.lastSeen) {
          group.lastSeen = entry.timeStamp;
        }
      }
      if (entryHasErrorEvidence(entry)) {
        group.hasErrorEvidence = true;
      }

      if (entryHasErrorEvidence(entry) && version !== 4) {
        unclassifiedErrors.push({
          hostname: hostname,
          ip: ip,
          ipVersion: version,
          error: errText || null,
          statusCode: typeof entry.statusCode === 'number' ? entry.statusCode : null,
          eventType: entry.eventType || null,
        });
      }
    }

    return {
      groups: groups,
      networkChangeErrorCount: networkChangeErrorCount,
      unclassifiedErrors: unclassifiedErrors,
    };
  }

  /**
   * Indexes native batch results by IPv4.
   * @param {Array} results
   * @returns {object}
   */
  function indexRouteResults(results) {
    var map = {};
    var list = Array.isArray(results) ? results : [];
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (item && typeof item.ip === 'string') {
        map[item.ip] = item;
      }
    }
    return map;
  }

  /**
   * Builds diagnostic findings and candidate exclusion IPs from groups + route results.
   * @param {Array} groups
   * @param {Array} routeResults
   * @param {Array} unclassifiedErrors
   * @returns {{ findings: Array, candidateExclusionIps: string[], summary: object }}
   */
  function buildFindings(groups, routeResults, unclassifiedErrors) {
    var byIp = indexRouteResults(routeResults);
    var findings = [];
    var candidateSet = {};
    var candidateStrong = [];
    var candidateMixed = [];

    // Unique IPv4 route-type tallies (not per hostname×IP pair).
    var vpnCount = 0;
    var directCount = 0;
    var unknownCount = 0;
    var seenRouteIp = {};
    var routeList = Array.isArray(routeResults) ? routeResults : [];
    for (var ri = 0; ri < routeList.length; ri += 1) {
      var rr = routeList[ri];
      if (!rr || typeof rr.ip !== 'string' || seenRouteIp[rr.ip]) {
        continue;
      }
      seenRouteIp[rr.ip] = true;
      if (rr.ok && rr.routeType === 'VPN') {
        vpnCount += 1;
      } else if (rr.ok && rr.routeType === 'DIRECT') {
        directCount += 1;
      } else {
        unknownCount += 1;
      }
    }

    var strongCandidates = 0;
    var mixedHosts = 0;
    var directErrors = 0;
    var unclassifiedCount = 0;

    // Hostname → list of analyzed IPv4 groups for MIXED_ROUTING.
    var hostIpv4 = {};
    for (var g = 0; g < groups.length; g += 1) {
      var gr = groups[g];
      if (gr.ipVersion === 4 && gr.ip) {
        if (!hostIpv4[gr.hostname]) {
          hostIpv4[gr.hostname] = [];
        }
        hostIpv4[gr.hostname].push(gr);
      }
    }

    var hostnames = Object.keys(hostIpv4);
    for (var h = 0; h < hostnames.length; h += 1) {
      var hostname = hostnames[h];
      var hostGroups = hostIpv4[hostname];
      var routeTypes = {};
      var vpnIps = [];
      var directIps = [];
      var hostHasError = false;

      for (var hg = 0; hg < hostGroups.length; hg += 1) {
        var item = hostGroups[hg];
        var route = byIp[item.ip];
        var routeType = route && route.ok ? route.routeType : null;
        var iface = route && route.ok ? route.interface : null;
        item.routeType = routeType;
        item.interface = iface;
        item.routeOk = !!(route && route.ok);
        item.routeError = route && route.error ? route.error : null;

        if (routeType === 'VPN') {
          vpnIps.push(item.ip);
          routeTypes.VPN = true;
        } else if (routeType === 'DIRECT') {
          directIps.push(item.ip);
          routeTypes.DIRECT = true;
        } else {
          routeTypes.UNKNOWN = true;
        }
        if (item.hasErrorEvidence) {
          hostHasError = true;
        }

        // Per hostname/IP findings.
        if (routeType === 'VPN' && item.hasErrorEvidence) {
          strongCandidates += 1;
          findings.push({
            category: 'ERROR_VIA_VPN',
            severity: 'high',
            hostname: hostname,
            ip: item.ip,
            interface: iface,
            routeType: routeType,
            title: 'ERROR VIA VPN',
            message: 'Strong candidate for VPN exclusion',
            evidence: summarizeGroupEvidence(item),
            candidate: true,
          });
          if (!candidateSet[item.ip]) {
            candidateSet[item.ip] = 'strong';
            candidateStrong.push(item.ip);
          }
        } else if (routeType === 'DIRECT' && item.hasErrorEvidence) {
          directErrors += 1;
          findings.push({
            category: 'ERROR_VIA_DIRECT',
            severity: 'medium',
            hostname: hostname,
            ip: item.ip,
            interface: iface,
            routeType: routeType,
            title: 'ERROR VIA DIRECT',
            message: 'The current route is already direct. The current split-tunnel route alone does not explain the failure.',
            guidance: 'Reconnect the VPN, fully quit Chrome with Command+Q, reopen Chrome and repeat the capture before changing exclusions. Stale browser connection state is one possibility — not proven.',
            evidence: summarizeGroupEvidence(item),
            candidate: false,
          });
        } else if (routeType === 'VPN' && !item.hasErrorEvidence) {
          findings.push({
            category: 'VPN_WITHOUT_ERROR',
            severity: 'info',
            hostname: hostname,
            ip: item.ip,
            interface: iface,
            routeType: routeType,
            title: 'VPN WITHOUT ERROR',
            message: 'Routed through VPN, but no failure was observed',
            evidence: summarizeGroupEvidence(item),
            candidate: false,
          });
        } else if (!routeType || routeType === 'UNKNOWN') {
          if (item.hasErrorEvidence) {
            unclassifiedCount += 1;
            findings.push({
              category: 'UNCLASSIFIED_ERROR',
              severity: 'medium',
              hostname: hostname,
              ip: item.ip,
              interface: iface,
              routeType: routeType || 'UNKNOWN',
              title: 'UNCLASSIFIED ERROR',
              message: 'Failure observed, but no usable IPv4 route classification is available',
              evidence: summarizeGroupEvidence(item),
              candidate: false,
            });
          }
        }
      }

      if (routeTypes.DIRECT && routeTypes.VPN) {
        mixedHosts += 1;
        findings.push({
          category: 'MIXED_ROUTING',
          severity: hostHasError ? 'high' : 'medium',
          hostname: hostname,
          ip: null,
          interface: null,
          routeType: 'MIXED',
          title: 'MIXED ROUTING',
          message: 'Hostname uses mixed DIRECT and VPN routing',
          vpnIps: vpnIps.slice(),
          directIps: directIps.slice(),
          evidence: { vpnIps: vpnIps.slice(), directIps: directIps.slice() },
          candidate: true,
        });
        for (var vi = 0; vi < vpnIps.length; vi += 1) {
          var vip = vpnIps[vi];
          if (!candidateSet[vip]) {
            candidateSet[vip] = 'mixed';
            candidateMixed.push(vip);
          }
        }
      }
    }

    // Unclassified errors without usable IPv4 (no-IP / IPv6), aggregated by signature.
    var uncMap = {};
    var uncList = Array.isArray(unclassifiedErrors) ? unclassifiedErrors : [];
    for (var u = 0; u < uncList.length; u += 1) {
      var ue = uncList[u];
      var sig = [ue.hostname || '', ue.ipVersion || '', ue.error || '', ue.statusCode || ''].join('|');
      if (!uncMap[sig]) {
        uncMap[sig] = {
          category: 'UNCLASSIFIED_ERROR',
          severity: 'low',
          hostname: ue.hostname || '(unknown)',
          ip: ue.ip || null,
          ipVersion: ue.ipVersion,
          interface: null,
          routeType: null,
          title: 'UNCLASSIFIED ERROR',
          message: 'Failure observed, but no usable IPv4 route classification is available',
          evidence: { error: ue.error || null, statusCode: ue.statusCode, count: 0 },
          candidate: false,
        };
        findings.push(uncMap[sig]);
        unclassifiedCount += 1;
      }
      uncMap[sig].evidence.count += 1;
    }

    var candidates = candidateStrong.concat(candidateMixed);

    return {
      findings: findings,
      candidateExclusionIps: candidates,
      summary: {
        uniqueIPv4: Object.keys(byIp).length,
        vpn: vpnCount,
        direct: directCount,
        unknown: unknownCount,
        strongCandidates: strongCandidates,
        mixedRoutingHosts: mixedHosts,
        directRouteErrors: directErrors,
        unclassifiedErrors: unclassifiedCount,
      },
    };
  }

  /**
   * Compact evidence object for a hostname/IP group.
   * @param {object} group
   * @returns {object}
   */
  function summarizeGroupEvidence(group) {
    return {
      requestCount: group.requestCount,
      statusCodes: Object.keys(group.statusCodes || {}),
      resourceTypes: Object.keys(group.resourceTypes || {}),
      eventTypes: Object.keys(group.eventTypes || {}),
      networkErrors: group.networkErrors || {},
      httpErrorStatuses: group.httpErrorStatuses || [],
      firstSeen: group.firstSeen,
      lastSeen: group.lastSeen,
    };
  }

  /**
   * Full analysis from capture entries + native batch results.
   * @param {object} session
   * @param {Array} routeResults
   * @returns {object} routeAnalysis document (state: complete)
   */
  function buildRouteAnalysis(session, routeResults) {
    var extracted = extractUniqueIPv4s(session.entries);
    var aggregated = aggregateHostnameIp(session.entries);
    var built = buildFindings(aggregated.groups, routeResults, aggregated.unclassifiedErrors);
    var fingerprint = buildSourceFingerprint(session, extracted.ips);

    // Attach route fields onto serializable groups for the UI.
    var byIp = indexRouteResults(routeResults);
    var uiGroups = [];
    for (var i = 0; i < aggregated.groups.length; i += 1) {
      var g = aggregated.groups[i];
      var route = g.ip ? byIp[g.ip] : null;
      uiGroups.push({
        hostname: g.hostname,
        ip: g.ip,
        ipVersion: g.ipVersion,
        requestCount: g.requestCount,
        hasErrorEvidence: g.hasErrorEvidence,
        routeType: route && route.ok ? route.routeType : (g.ipVersion === 6 ? null : null),
        interface: route && route.ok ? route.interface : null,
        routeAnalysisSupported: g.ipVersion === 4,
        evidence: summarizeGroupEvidence(g),
      });
      if (g.ipVersion === 6) {
        uiGroups[uiGroups.length - 1].routeNote = 'Route analysis not supported yet';
      } else if (!g.ip) {
        uiGroups[uiGroups.length - 1].routeNote = 'No remote IP observed';
      } else if (route && !route.ok) {
        uiGroups[uiGroups.length - 1].routeNote = (route.error && route.error.message) || 'Route lookup failed';
      }
    }

    return {
      schemaVersion: ROUTE_ANALYSIS_SCHEMA_VERSION,
      state: 'complete',
      startedAt: null,
      completedAt: Date.now(),
      sourceFingerprint: fingerprint,
      uniqueIPv4Count: extracted.ips.length,
      skippedIPv6Count: extracted.skippedIPv6Count,
      skippedMissingIpCount: extracted.skippedMissingIpCount,
      results: Array.isArray(routeResults) ? routeResults.slice(0, MAX_ANALYZE_IPV4) : [],
      findings: built.findings.slice(0, 200),
      groups: uiGroups.slice(0, 500),
      candidateExclusionIps: built.candidateExclusionIps.slice(0, MAX_ANALYZE_IPV4),
      summary: Object.assign({}, built.summary, {
        uniqueIPv4: extracted.ips.length,
      }),
      error: null,
      networkChangeErrorCount: aggregated.networkChangeErrorCount,
    };
  }

  /**
   * Marks a completed analysis stale when the IPv4 set / session identity changed.
   * @param {object} analysis
   * @param {object} session
   * @returns {object}
   */
  function refreshAnalysisStaleState(analysis, session) {
    var normalized = normalizeRouteAnalysis(analysis);
    if (normalized.state !== 'complete' && normalized.state !== 'stale') {
      return normalized;
    }
    var extracted = extractUniqueIPv4s(session.entries);
    var current = buildSourceFingerprint(session, extracted.ips);
    if (!fingerprintsMatch(normalized.sourceFingerprint, current)) {
      normalized.state = 'stale';
    }
    return normalized;
  }

  /**
   * Validates one native checkRoutes item before storage.
   * @param {unknown} item
   * @returns {object|null}
   */
  function normalizeNativeRouteItem(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    if (typeof item.ip !== 'string' || !item.ip) {
      return null;
    }
    var okFlag = item.ok === true;
    var routeType = typeof item.routeType === 'string' ? item.routeType : null;
    if (routeType !== 'DIRECT' && routeType !== 'VPN' && routeType !== 'UNKNOWN') {
      routeType = null;
    }
    var iface = typeof item.interface === 'string' ? item.interface : null;
    var error = null;
    if (item.error && typeof item.error === 'object') {
      error = {
        code: typeof item.error.code === 'string' ? item.error.code : 'UNKNOWN',
        message: typeof item.error.message === 'string' ? item.error.message : 'Route lookup failed.',
      };
    }
    if (okFlag && (!iface || !routeType)) {
      return null;
    }
    return {
      ok: okFlag,
      ip: item.ip,
      interface: okFlag ? iface : null,
      routeType: okFlag ? routeType : null,
      error: okFlag ? null : (error || { code: 'UNKNOWN', message: 'Route lookup failed.' }),
    };
  }

  /**
   * Validates a full native checkRoutes results array.
   * @param {unknown} results
   * @param {string[]} expectedIps unique IPv4s that were sent
   * @returns {{ ok: true, results: Array } | { ok: false, error: object }}
   */
  function validateNativeRouteResults(results, expectedIps) {
    if (!Array.isArray(results)) {
      return { ok: false, error: { code: 'INVALID_NATIVE_RESULTS', message: 'Native host results must be an array.' } };
    }
    var expected = Array.isArray(expectedIps) ? expectedIps : [];
    if (results.length !== expected.length) {
      return {
        ok: false,
        error: {
          code: 'INVALID_NATIVE_RESULTS',
          message: 'Native host returned ' + results.length + ' results for ' + expected.length + ' IPs.',
        },
      };
    }
    var normalized = [];
    for (var i = 0; i < results.length; i += 1) {
      var item = normalizeNativeRouteItem(results[i]);
      if (!item) {
        return {
          ok: false,
          error: {
            code: 'INVALID_NATIVE_RESULTS',
            message: 'Native host returned an invalid route result item.',
          },
        };
      }
      if (item.ip !== expected[i]) {
        return {
          ok: false,
          error: {
            code: 'INVALID_NATIVE_RESULTS',
            message: 'Native host result IP order does not match the request.',
          },
        };
      }
      normalized.push(item);
    }
    return { ok: true, results: normalized };
  }

  // ---------------------------------------------------------------------------
  // Diagnostic report export (privacy-reduced Markdown + technical JSON)
  // ---------------------------------------------------------------------------

  /** Maximum Markdown report length (characters). */
  var MAX_DIAGNOSTIC_REPORT_CHARS = 100000;

  /** Maximum hostname groups rendered in the Markdown report. */
  var MAX_REPORT_HOSTNAME_GROUPS = 100;

  /** Maximum IP rows shown under one hostname in the Markdown report. */
  var MAX_REPORT_IP_ROWS_PER_HOST = 20;

  /** Maximum findings rendered in the Markdown report. */
  var MAX_REPORT_FINDINGS = 100;

  /** Maximum distinct aggregated network-error types in the Markdown report. */
  var MAX_REPORT_NETWORK_ERROR_TYPES = 50;

  /** Pathname length limit after URL sanitization. */
  var MAX_REPORT_PATHNAME_CHARS = 200;

  /** Target page title length limit in the Markdown report. */
  var MAX_REPORT_TITLE_CHARS = 120;

  /** Maximum serialized size for the full technical JSON export (bytes, UTF-8). */
  var MAX_TECHNICAL_EXPORT_BYTES = 4 * 1024 * 1024;

  /** Technical JSON envelope version. */
  var TECHNICAL_EXPORT_VERSION = 1;

  /**
   * Returns a safe display string; never emits undefined/null/empty as raw values.
   * @param {unknown} value
   * @returns {string}
   */
  function reportDisplayValue(value) {
    if (value === null || value === undefined) {
      return 'Not available';
    }
    if (typeof value === 'string') {
      var trimmed = value.trim();
      return trimmed.length ? trimmed : 'Not available';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : 'Not available';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return 'Not available';
  }

  /**
   * Truncates text to maxLen characters with an ellipsis when needed.
   * @param {unknown} value
   * @param {number} maxLen
   * @returns {string}
   */
  function truncateReportText(value, maxLen) {
    var text = typeof value === 'string' ? value : '';
    if (!text) {
      return 'Not available';
    }
    if (text.length <= maxLen) {
      return text;
    }
    return text.slice(0, Math.max(0, maxLen - 1)) + '…';
  }

  /**
   * Formats a millisecond timestamp as ISO-8601 UTC, or Not available.
   * @param {unknown} ms
   * @returns {string}
   */
  function formatReportTimestamp(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) {
      return 'Not available';
    }
    try {
      return new Date(ms).toISOString();
    } catch (_err) {
      return 'Not available';
    }
  }

  /**
   * Sanitizes a URL for the privacy-reduced Markdown report.
   * Keeps protocol, hostname, port, pathname (length-limited).
   * Removes username, password, query string, and fragment.
   * @param {unknown} rawUrl
   * @returns {string}
   */
  function sanitizeUrlForReport(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return 'Not available';
    }
    try {
      var parsed = new URL(rawUrl);
      var path = parsed.pathname || '/';
      if (path.length > MAX_REPORT_PATHNAME_CHARS) {
        path = path.slice(0, MAX_REPORT_PATHNAME_CHARS - 1) + '…';
      }
      var host = parsed.hostname || '';
      if (!host) {
        return '[unparseable-url]';
      }
      var port = parsed.port ? (':' + parsed.port) : '';
      return parsed.protocol + '//' + host + port + path;
    } catch (_err) {
      return '[unparseable-url]';
    }
  }

  /**
   * Aggregates network-error strings from capture entries (deterministic order).
   * Sorted by descending count, then ascending error string.
   * @param {Array} entries
   * @returns {{ items: Array<{ error: string, count: number }>, truncated: boolean, totalDistinct: number }}
   */
  function aggregateNetworkErrors(entries) {
    var counts = {};
    var list = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < list.length; i += 1) {
      var entry = list[i];
      var err = entry && typeof entry.error === 'string' ? entry.error.trim() : '';
      if (!err) {
        continue;
      }
      counts[err] = (counts[err] || 0) + 1;
    }
    var keys = Object.keys(counts);
    keys.sort(function (a, b) {
      var diff = counts[b] - counts[a];
      if (diff !== 0) {
        return diff;
      }
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    });
    var truncated = keys.length > MAX_REPORT_NETWORK_ERROR_TYPES;
    var sliced = keys.slice(0, MAX_REPORT_NETWORK_ERROR_TYPES);
    var items = [];
    for (var k = 0; k < sliced.length; k += 1) {
      items.push({ error: sliced[k], count: counts[sliced[k]] });
    }
    return {
      items: items,
      truncated: truncated,
      totalDistinct: keys.length,
    };
  }

  /**
   * Maps routeAnalysis.state to a report-facing analysis label.
   * @param {object} analysis
   * @returns {string}
   */
  function analysisStateLabel(analysis) {
    if (!analysis || typeof analysis !== 'object') {
      return 'not-run';
    }
    var state = analysis.state;
    if (state === 'idle' || !state) {
      return 'not-run';
    }
    if (state === 'running' || state === 'complete' || state === 'stale' || state === 'error') {
      return state;
    }
    return 'not-run';
  }

  /**
   * Builds hostname → IPv4 rows for the Markdown report from stored analysis groups
   * (preferred) or live entry aggregation.
   * @param {object} session
   * @param {object} analysis
   * @returns {{ hosts: Array, truncatedHosts: boolean, truncatedIps: boolean }}
   */
  function buildReportHostnameGroups(session, analysis) {
    var hostMap = {};
    var hostOrder = [];
    var truncatedIps = false;

    function ensureHost(hostname) {
      var key = hostname || '(unknown)';
      if (!hostMap[key]) {
        hostMap[key] = { hostname: key, rows: [] };
        hostOrder.push(key);
      }
      return hostMap[key];
    }

    var groups = analysis && Array.isArray(analysis.groups) ? analysis.groups : null;
    if (groups && groups.length) {
      for (var g = 0; g < groups.length; g += 1) {
        var group = groups[g];
        if (!group || group.ipVersion === 6 || !group.ip) {
          // IPv6 / no-IP rows are summarized elsewhere; keep IPv4 route groups here.
          if (group && group.ipVersion === 6) {
            var v6Host = ensureHost(group.hostname);
            if (v6Host.rows.length < MAX_REPORT_IP_ROWS_PER_HOST) {
              v6Host.rows.push({
                ip: group.ip || 'IPv6',
                routeType: 'Not available',
                interface: 'Not available',
                statuses: [],
                requestCount: group.requestCount || 0,
                note: 'Route analysis not supported yet',
              });
            } else {
              truncatedIps = true;
            }
          }
          continue;
        }
        var host = ensureHost(group.hostname);
        if (host.rows.length >= MAX_REPORT_IP_ROWS_PER_HOST) {
          truncatedIps = true;
          continue;
        }
        var evidence = group.evidence || {};
        host.rows.push({
          ip: group.ip,
          routeType: group.routeType || 'Not available',
          interface: group.interface || 'Not available',
          statuses: Array.isArray(evidence.statusCodes) ? evidence.statusCodes.slice() : [],
          requestCount: group.requestCount || 0,
          note: group.routeNote || null,
        });
      }
    } else {
      var aggregated = aggregateHostnameIp(session.entries);
      for (var a = 0; a < aggregated.groups.length; a += 1) {
        var ag = aggregated.groups[a];
        if (ag.ipVersion !== 4 || !ag.ip) {
          continue;
        }
        var h = ensureHost(ag.hostname);
        if (h.rows.length >= MAX_REPORT_IP_ROWS_PER_HOST) {
          truncatedIps = true;
          continue;
        }
        h.rows.push({
          ip: ag.ip,
          routeType: 'Not available',
          interface: 'Not available',
          statuses: Object.keys(ag.statusCodes || {}),
          requestCount: ag.requestCount || 0,
          note: null,
        });
      }
    }

    var truncatedHosts = hostOrder.length > MAX_REPORT_HOSTNAME_GROUPS;
    var hosts = [];
    var limit = Math.min(hostOrder.length, MAX_REPORT_HOSTNAME_GROUPS);
    for (var i = 0; i < limit; i += 1) {
      hosts.push(hostMap[hostOrder[i]]);
    }
    return {
      hosts: hosts,
      truncatedHosts: truncatedHosts,
      truncatedIps: truncatedIps,
      totalHosts: hostOrder.length,
    };
  }

  /**
   * Normalizes a stored finding into a report-safe object.
   * @param {object} finding
   * @returns {object}
   */
  function normalizeFindingForReport(finding) {
    var evidence = (finding && finding.evidence) || {};
    var networkErrors = evidence.networkErrors || {};
    var errKeys = Object.keys(networkErrors);
    errKeys.sort();
    var statuses = Array.isArray(evidence.statusCodes)
      ? evidence.statusCodes.slice()
      : (Array.isArray(evidence.httpErrorStatuses) ? evidence.httpErrorStatuses.map(String) : []);
    return {
      category: finding.category || 'UNCLASSIFIED_ERROR',
      severity: finding.severity || 'info',
      hostname: finding.hostname || 'Not available',
      ip: finding.ip || null,
      interface: finding.interface || null,
      routeType: finding.routeType || null,
      httpStatuses: statuses,
      networkErrors: errKeys.map(function (key) {
        return { error: key, count: networkErrors[key] };
      }),
      requestCount: typeof evidence.requestCount === 'number' ? evidence.requestCount : null,
      conclusion: finding.message || 'Not available',
      candidate: finding.candidate === true,
      vpnIps: Array.isArray(finding.vpnIps) ? finding.vpnIps.slice() : null,
      directIps: Array.isArray(finding.directIps) ? finding.directIps.slice() : null,
      guidance: typeof finding.guidance === 'string' ? finding.guidance : null,
    };
  }

  /**
   * Builds a structured diagnostic report model from a capture session.
   * Pure: no DOM / Chrome APIs. Deterministic when generatedAtMs is provided.
   * @param {object} session
   * @param {{ extensionVersion?: string, generatedAtMs?: number }} [options]
   * @returns {object}
   */
  function buildDiagnosticReportModel(session, options) {
    var opts = options || {};
    var normalized = normalizeSession(session);
    var summary = summarizeSession(normalized);
    var analysis = normalizeRouteAnalysis(normalized.routeAnalysis);
    var analysisLabel = analysisStateLabel(analysis);
    var generatedAtMs = typeof opts.generatedAtMs === 'number' ? opts.generatedAtMs : Date.now();
    var extensionVersion = typeof opts.extensionVersion === 'string' && opts.extensionVersion
      ? opts.extensionVersion
      : 'Not available';

    var targetHost = 'Not available';
    if (normalized.tabUrl) {
      try {
        targetHost = new URL(normalized.tabUrl).hostname || 'Not available';
      } catch (_err) {
        targetHost = 'Not available';
      }
    }

    var networkErrors = aggregateNetworkErrors(normalized.entries);
    var hostnameGroups = buildReportHostnameGroups(normalized, analysis);

    var findings = Array.isArray(analysis.findings) ? analysis.findings.slice() : [];
    var findingsTruncated = findings.length > MAX_REPORT_FINDINGS;
    findings = findings.slice(0, MAX_REPORT_FINDINGS).map(normalizeFindingForReport);

    var candidates = Array.isArray(analysis.candidateExclusionIps)
      ? analysis.candidateExclusionIps.slice()
      : [];

    var truncationNotes = [];
    if (hostnameGroups.truncatedHosts) {
      truncationNotes.push(
        'Hostname groups capped at ' + MAX_REPORT_HOSTNAME_GROUPS
          + ' (of ' + hostnameGroups.totalHosts + ').'
      );
    }
    if (hostnameGroups.truncatedIps) {
      truncationNotes.push(
        'IP rows per hostname capped at ' + MAX_REPORT_IP_ROWS_PER_HOST + '.'
      );
    }
    if (findingsTruncated) {
      truncationNotes.push('Findings capped at ' + MAX_REPORT_FINDINGS + '.');
    }
    if (networkErrors.truncated) {
      truncationNotes.push(
        'Aggregated network-error types capped at ' + MAX_REPORT_NETWORK_ERROR_TYPES
          + ' (of ' + networkErrors.totalDistinct + ').'
      );
    }

    var analysisSummary = analysis.summary || {};

    return {
      generatedAt: formatReportTimestamp(generatedAtMs),
      extensionVersion: extensionVersion,
      analysisState: analysisLabel,
      analysisError: analysis.error,
      capture: {
        targetTitle: truncateReportText(normalized.tabTitle, MAX_REPORT_TITLE_CHARS),
        targetHost: targetHost,
        targetUrl: sanitizeUrlForReport(normalized.tabUrl),
        tabId: normalized.tabId,
        startedAt: formatReportTimestamp(normalized.startedAt),
        stoppedAt: formatReportTimestamp(normalized.stoppedAt),
        active: normalized.active === true,
        entries: summary.entryCount,
        hostnames: summary.hostnameCount,
        uniqueIps: summary.ipCount,
      },
      routeAnalysis: {
        uniqueIPv4Analyzed: typeof analysis.uniqueIPv4Count === 'number'
          ? analysis.uniqueIPv4Count
          : (analysisSummary.uniqueIPv4 || 0),
        vpn: analysisSummary.vpn || 0,
        direct: analysisSummary.direct || 0,
        unknown: analysisSummary.unknown || 0,
        skippedIPv6: analysis.skippedIPv6Count || 0,
        skippedMissingIp: analysis.skippedMissingIpCount || 0,
        networkChangeErrors: analysis.networkChangeErrorCount || 0,
        strongCandidates: analysisSummary.strongCandidates || 0,
        mixedRoutingHosts: analysisSummary.mixedRoutingHosts || 0,
        directRouteErrors: analysisSummary.directRouteErrors || 0,
        unclassifiedErrors: analysisSummary.unclassifiedErrors || 0,
      },
      candidates: candidates,
      findings: findings,
      hostnameGroups: hostnameGroups.hosts,
      networkErrors: networkErrors.items,
      diagnostics: normalizeDiagnostics(normalized.diagnostics),
      truncationNotes: truncationNotes,
      staleWarning: analysisLabel === 'stale',
    };
  }

  /**
   * Renders the diagnostic report model as privacy-reduced Markdown.
   * @param {object} model
   * @returns {string}
   */
  function renderDiagnosticReportMarkdown(model) {
    var lines = [];
    var m = model || {};

    lines.push('# VPN Route Inspector diagnostic report');
    lines.push('');
    lines.push('Generated: ' + reportDisplayValue(m.generatedAt));
    lines.push('Extension version: ' + reportDisplayValue(m.extensionVersion));
    lines.push('Analysis state: ' + reportDisplayValue(m.analysisState));
    if (m.staleWarning) {
      lines.push('');
      lines.push(
        'Warning: Captured IPv4 data changed after the analysis. Re-analyze before applying exclusions.'
      );
    }
    if (m.analysisState === 'error' && m.analysisError) {
      lines.push(
        'Analysis error: '
          + reportDisplayValue(m.analysisError.code)
          + ' — '
          + reportDisplayValue(m.analysisError.message)
      );
    }
    lines.push('');

    var capture = m.capture || {};
    lines.push('## Capture summary');
    lines.push('');
    lines.push('Target title: ' + reportDisplayValue(capture.targetTitle));
    lines.push('Target host: ' + reportDisplayValue(capture.targetHost));
    lines.push('Target URL: ' + reportDisplayValue(capture.targetUrl));
    lines.push('Tab ID: ' + reportDisplayValue(capture.tabId));
    lines.push('Started: ' + reportDisplayValue(capture.startedAt));
    lines.push('Stopped: ' + reportDisplayValue(capture.stoppedAt));
    lines.push('Entries: ' + reportDisplayValue(capture.entries));
    lines.push('Hostnames: ' + reportDisplayValue(capture.hostnames));
    lines.push('Unique IPs: ' + reportDisplayValue(capture.uniqueIps));
    lines.push('');

    var ra = m.routeAnalysis || {};
    lines.push('## Route-analysis summary');
    lines.push('');
    if (m.analysisState === 'not-run') {
      lines.push('Route analysis has not been run.');
    } else if (m.analysisState === 'running') {
      lines.push('Route analysis is currently running.');
    } else {
      lines.push('Unique IPv4 analyzed: ' + reportDisplayValue(ra.uniqueIPv4Analyzed));
      lines.push('VPN: ' + reportDisplayValue(ra.vpn));
      lines.push('DIRECT: ' + reportDisplayValue(ra.direct));
      lines.push('UNKNOWN: ' + reportDisplayValue(ra.unknown));
      lines.push('IPv6 skipped: ' + reportDisplayValue(ra.skippedIPv6));
      lines.push('Missing-IP events: ' + reportDisplayValue(ra.skippedMissingIp));
      lines.push('Network-change errors: ' + reportDisplayValue(ra.networkChangeErrors));
    }
    lines.push('');

    lines.push('## Candidate exclusion IPs');
    lines.push('');
    if (m.analysisState === 'not-run' || m.analysisState === 'running') {
      lines.push('Route analysis has not been run.');
    } else if (m.staleWarning) {
      lines.push('Candidate exclusions from stale analysis');
      lines.push('');
      if (!m.candidates || !m.candidates.length) {
        lines.push('No strong exclusion candidates were identified.');
      } else {
        for (var c = 0; c < m.candidates.length; c += 1) {
          lines.push('- ' + m.candidates[c]);
        }
      }
    } else if (!m.candidates || !m.candidates.length) {
      lines.push('No strong exclusion candidates were identified.');
    } else {
      for (var ci = 0; ci < m.candidates.length; ci += 1) {
        lines.push('- ' + m.candidates[ci]);
      }
    }
    lines.push('');

    lines.push('## Findings');
    lines.push('');
    if (!m.findings || !m.findings.length) {
      lines.push('No findings.');
    } else {
      for (var f = 0; f < m.findings.length; f += 1) {
        var finding = m.findings[f];
        lines.push(
          '### '
            + String(finding.severity || 'info').toUpperCase()
            + ' — '
            + reportDisplayValue(finding.category)
        );
        lines.push('Hostname: ' + reportDisplayValue(finding.hostname));
        lines.push('IP: ' + reportDisplayValue(finding.ip));
        lines.push('Interface: ' + reportDisplayValue(finding.interface));
        lines.push('Route: ' + reportDisplayValue(finding.routeType));
        lines.push(
          'HTTP statuses: '
            + (finding.httpStatuses && finding.httpStatuses.length
              ? finding.httpStatuses.join(', ')
              : 'Not available')
        );
        if (finding.networkErrors && finding.networkErrors.length) {
          var errParts = [];
          for (var ne = 0; ne < finding.networkErrors.length; ne += 1) {
            errParts.push(
              finding.networkErrors[ne].error + ' ×' + finding.networkErrors[ne].count
            );
          }
          lines.push('Network errors: ' + errParts.join('; '));
        } else {
          lines.push('Network errors: Not available');
        }
        lines.push('Request count: ' + reportDisplayValue(finding.requestCount));
        lines.push('Conclusion: ' + reportDisplayValue(finding.conclusion));
        lines.push('Exclusion candidate: ' + (finding.candidate ? 'yes' : 'no'));
        if (finding.vpnIps && finding.vpnIps.length) {
          lines.push('VPN IPs: ' + finding.vpnIps.join(', '));
        }
        if (finding.directIps && finding.directIps.length) {
          lines.push('DIRECT IPs: ' + finding.directIps.join(', '));
        }
        if (finding.guidance) {
          lines.push('Guidance: ' + finding.guidance);
        }
        lines.push('');
      }
    }

    lines.push('## Hostname / IPv4 route groups');
    lines.push('');
    if (!m.hostnameGroups || !m.hostnameGroups.length) {
      lines.push('No hostname / IPv4 groups.');
    } else {
      for (var h = 0; h < m.hostnameGroups.length; h += 1) {
        var host = m.hostnameGroups[h];
        lines.push('### ' + reportDisplayValue(host.hostname));
        var rows = host.rows || [];
        if (!rows.length) {
          lines.push('- Not available');
        }
        for (var r = 0; r < rows.length; r += 1) {
          var row = rows[r];
          var statusText = row.statuses && row.statuses.length
            ? row.statuses.join(', ')
            : 'Not available';
          var routePart = reportDisplayValue(row.routeType);
          if (row.interface && row.interface !== 'Not available') {
            routePart += ' / ' + row.interface;
          }
          var line = '- '
            + reportDisplayValue(row.ip)
            + ' — '
            + routePart
            + ' — statuses: '
            + statusText
            + ' — requests: '
            + reportDisplayValue(row.requestCount);
          if (row.note) {
            line += ' — ' + row.note;
          }
          lines.push(line);
        }
        lines.push('');
      }
    }

    lines.push('## Aggregated network errors');
    lines.push('');
    if (!m.networkErrors || !m.networkErrors.length) {
      lines.push('No network errors recorded.');
    } else {
      for (var e = 0; e < m.networkErrors.length; e += 1) {
        lines.push('- ' + m.networkErrors[e].error + ' — ' + m.networkErrors[e].count);
      }
    }
    lines.push('');

    var diag = m.diagnostics || {};
    lines.push('## Capture diagnostics');
    lines.push('');
    lines.push('- Events seen: ' + reportDisplayValue(diag.eventsSeen));
    lines.push('- Target-tab events: ' + reportDisplayValue(diag.targetTabEventsSeen));
    lines.push('- Events queued: ' + reportDisplayValue(diag.eventsQueued));
    lines.push('- Entries stored: ' + reportDisplayValue(diag.entriesStored));
    lines.push('- Entries without IP: ' + reportDisplayValue(diag.entriesWithoutIp));
    lines.push('- Wrong-tab events: ' + reportDisplayValue(diag.ignoredWrongTab));
    lines.push('- Storage failures: ' + reportDisplayValue(diag.storageWriteFailures));
    lines.push('- Last ignored reason: ' + reportDisplayValue(diag.lastIgnoredReason));
    lines.push('- Listener version: ' + reportDisplayValue(diag.listenerVersion));
    lines.push('');

    lines.push('## Notes');
    lines.push('');
    lines.push('- Route results are snapshots of the current macOS routing table.');
    lines.push('- They are not packet-capture proof of a previous connection.');
    lines.push('- Query strings and URL fragments were removed from this diagnostic report.');
    lines.push('- IPv6 route analysis is not supported yet.');
    lines.push('- Raw captured events are aggregated; the full event list is omitted.');
    lines.push('- Cookies, authorization values, headers, and bodies are never included.');
    if (m.staleWarning) {
      lines.push(
        '- Captured IPv4 data changed after the analysis. Re-analyze before applying exclusions.'
      );
    }
    if (m.truncationNotes && m.truncationNotes.length) {
      for (var t = 0; t < m.truncationNotes.length; t += 1) {
        lines.push('- Truncation: ' + m.truncationNotes[t]);
      }
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Enforces the Markdown report character limit with an explicit truncation note.
   * @param {string} markdown
   * @returns {{ text: string, truncated: boolean, characterCount: number }}
   */
  function enforceReportLimits(markdown) {
    var text = typeof markdown === 'string' ? markdown : '';
    if (text.length <= MAX_DIAGNOSTIC_REPORT_CHARS) {
      return {
        text: text,
        truncated: false,
        characterCount: text.length,
      };
    }
    var note = '\n\n---\nTruncation: report exceeded '
      + MAX_DIAGNOSTIC_REPORT_CHARS
      + ' characters and was cut for paste safety.\n';
    var budget = MAX_DIAGNOSTIC_REPORT_CHARS - note.length;
    if (budget < 0) {
      budget = 0;
    }
    var cut = text.slice(0, budget) + note;
    return {
      text: cut,
      truncated: true,
      characterCount: cut.length,
    };
  }

  /**
   * Builds the full privacy-reduced Markdown export for a session.
   * @param {object} session
   * @param {{ extensionVersion?: string, generatedAtMs?: number }} [options]
   * @returns {{ ok: true, text: string, format: string, characterCount: number } | { ok: false, error: object }}
   */
  function buildDiagnosticMarkdownExport(session, options) {
    try {
      var normalized = normalizeSession(session);
      if (!normalized.entries.length) {
        return {
          ok: false,
          error: {
            code: 'NO_CAPTURE_DATA',
            message: 'No capture entries are available to export.',
          },
        };
      }
      var model = buildDiagnosticReportModel(normalized, options);
      var markdown = renderDiagnosticReportMarkdown(model);
      var limited = enforceReportLimits(markdown);
      return {
        ok: true,
        text: limited.text,
        format: 'markdown',
        characterCount: limited.characterCount,
        truncated: limited.truncated,
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'EXPORT_FAILED',
          message: err && err.message ? String(err.message) : 'Failed to build diagnostic report.',
        },
      };
    }
  }

  /**
   * UTF-8 byte length of a string (no TextEncoder dependency required for jsc).
   * @param {string} text
   * @returns {number}
   */
  function utf8ByteLength(text) {
    var s = typeof text === 'string' ? text : '';
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(s).length;
    }
    // Fallback: approximate via encodeURIComponent (sufficient for size guards).
    try {
      return unescape(encodeURIComponent(s)).length;
    } catch (_err) {
      return s.length;
    }
  }

  /**
   * Builds the advanced full technical JSON export.
   * Preserves capture session entries/analysis/diagnostics; never adds cookies/headers/bodies.
   * @param {object} session
   * @param {{ extensionVersion?: string, generatedAtMs?: number }} [options]
   * @returns {{ ok: true, text: string, format: string, characterCount: number } | { ok: false, error: object }}
   */
  function buildTechnicalExport(session, options) {
    try {
      var opts = options || {};
      var normalized = normalizeSession(session);
      if (!normalized.entries.length) {
        return {
          ok: false,
          error: {
            code: 'NO_CAPTURE_DATA',
            message: 'No capture entries are available to export.',
          },
        };
      }

      var generatedAtMs = typeof opts.generatedAtMs === 'number' ? opts.generatedAtMs : Date.now();
      var payload = {
        reportFormat: 'vpn-route-inspector-session',
        reportVersion: TECHNICAL_EXPORT_VERSION,
        generatedAt: formatReportTimestamp(generatedAtMs),
        extensionVersion: typeof opts.extensionVersion === 'string' && opts.extensionVersion
          ? opts.extensionVersion
          : 'Not available',
        captureSession: normalized,
      };

      var text = JSON.stringify(payload, null, 2);
      var byteLength = utf8ByteLength(text);
      if (byteLength > MAX_TECHNICAL_EXPORT_BYTES) {
        return {
          ok: false,
          error: {
            code: 'EXPORT_TOO_LARGE',
            message: 'Full technical JSON exceeds the '
              + MAX_TECHNICAL_EXPORT_BYTES
              + ' byte limit ('
              + byteLength
              + ' bytes). Clear older capture data or reduce entry count.',
          },
        };
      }

      return {
        ok: true,
        text: text,
        format: 'json',
        characterCount: text.length,
        byteLength: byteLength,
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'EXPORT_FAILED',
          message: err && err.message ? String(err.message) : 'Failed to build technical JSON export.',
        },
      };
    }
  }

  global.VriCaptureCore = {
    CAPTURE_SCHEMA_VERSION: CAPTURE_SCHEMA_VERSION,
    CAPTURE_MAX_ENTRIES: CAPTURE_MAX_ENTRIES,
    MAX_ANALYZE_IPV4: MAX_ANALYZE_IPV4,
    ROUTE_ANALYSIS_SCHEMA_VERSION: ROUTE_ANALYSIS_SCHEMA_VERSION,
    LISTENER_VERSION: LISTENER_VERSION,
    MAX_DIAGNOSTIC_REPORT_CHARS: MAX_DIAGNOSTIC_REPORT_CHARS,
    MAX_REPORT_HOSTNAME_GROUPS: MAX_REPORT_HOSTNAME_GROUPS,
    MAX_REPORT_IP_ROWS_PER_HOST: MAX_REPORT_IP_ROWS_PER_HOST,
    MAX_REPORT_FINDINGS: MAX_REPORT_FINDINGS,
    MAX_REPORT_NETWORK_ERROR_TYPES: MAX_REPORT_NETWORK_ERROR_TYPES,
    MAX_TECHNICAL_EXPORT_BYTES: MAX_TECHNICAL_EXPORT_BYTES,
    emptyDiagnostics: emptyDiagnostics,
    emptyRouteAnalysis: emptyRouteAnalysis,
    emptySession: emptySession,
    normalizeDiagnostics: normalizeDiagnostics,
    normalizeRouteAnalysis: normalizeRouteAnalysis,
    normalizeSession: normalizeSession,
    classifyIpVersion: classifyIpVersion,
    parseHttpUrl: parseHttpUrl,
    isRejectedTabUrl: isRejectedTabUrl,
    dedupeKey: dedupeKey,
    buildCaptureEntry: buildCaptureEntry,
    applyCaptureEvent: applyCaptureEvent,
    summarizeSession: summarizeSession,
    evictOldestEntries: evictOldestEntries,
    extractUniqueIPv4s: extractUniqueIPv4s,
    buildSourceFingerprint: buildSourceFingerprint,
    fingerprintsMatch: fingerprintsMatch,
    entryHasErrorEvidence: entryHasErrorEvidence,
    aggregateHostnameIp: aggregateHostnameIp,
    buildFindings: buildFindings,
    buildRouteAnalysis: buildRouteAnalysis,
    refreshAnalysisStaleState: refreshAnalysisStaleState,
    normalizeNativeRouteItem: normalizeNativeRouteItem,
    validateNativeRouteResults: validateNativeRouteResults,
    sanitizeUrlForReport: sanitizeUrlForReport,
    aggregateNetworkErrors: aggregateNetworkErrors,
    buildDiagnosticReportModel: buildDiagnosticReportModel,
    renderDiagnosticReportMarkdown: renderDiagnosticReportMarkdown,
    enforceReportLimits: enforceReportLimits,
    buildDiagnosticMarkdownExport: buildDiagnosticMarkdownExport,
    buildTechnicalExport: buildTechnicalExport,
    reportDisplayValue: reportDisplayValue,
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
