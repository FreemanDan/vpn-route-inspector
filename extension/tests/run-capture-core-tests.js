/**
 * Dependency-free tests for extension/capture-core.js.
 * Run with macOS JavaScriptCore:
 *
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc \
 *     extension/tests/run-capture-core-tests.js
 *
 * JavaScriptCore does not provide the WHATWG URL global; a minimal polyfill is
 * installed here so the same capture-core.js used in Chrome can be tested.
 */
/* global load, VriCaptureCore */

if (typeof URL === 'undefined') {
  function MinimalURL(input) {
    var s = String(input);
    var match = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/);
    if (!match) {
      throw new TypeError('Invalid URL');
    }
    this.protocol = match[1].toLowerCase() + ':';
    var rest = match[2];
    this.hostname = '';
    this.port = '';
    this.pathname = '';
    this.search = '';
    this.hash = '';
    this.username = '';
    this.password = '';
    this.href = s;

    if (rest.indexOf('//') === 0) {
      rest = rest.slice(2);
      var authEnd = rest.search(/[/?#]/);
      var authority = authEnd === -1 ? rest : rest.slice(0, authEnd);
      var pathPart = authEnd === -1 ? '' : rest.slice(authEnd);

      // Strip userinfo (user:pass@) before host:port parsing.
      var at = authority.lastIndexOf('@');
      if (at !== -1) {
        var userinfo = authority.slice(0, at);
        authority = authority.slice(at + 1);
        var colonUser = userinfo.indexOf(':');
        if (colonUser === -1) {
          this.username = userinfo;
        } else {
          this.username = userinfo.slice(0, colonUser);
          this.password = userinfo.slice(colonUser + 1);
        }
      }

      if (authority.charAt(0) === '[') {
        var end = authority.indexOf(']');
        this.hostname = end === -1 ? authority : authority.slice(0, end + 1);
        var afterBracket = end === -1 ? '' : authority.slice(end + 1);
        if (afterBracket.charAt(0) === ':') {
          this.port = afterBracket.slice(1);
        }
      } else {
        var colonHost = authority.lastIndexOf(':');
        if (colonHost !== -1 && authority.indexOf(':') === colonHost) {
          this.hostname = authority.slice(0, colonHost);
          this.port = authority.slice(colonHost + 1);
        } else {
          this.hostname = authority;
        }
      }

      var hashIdx = pathPart.indexOf('#');
      if (hashIdx !== -1) {
        this.hash = pathPart.slice(hashIdx);
        pathPart = pathPart.slice(0, hashIdx);
      }
      var q = pathPart.indexOf('?');
      if (q === -1) {
        this.pathname = pathPart || '/';
      } else {
        this.pathname = pathPart.slice(0, q) || '/';
        this.search = pathPart.slice(q);
      }
    }
  }
  globalThis.URL = MinimalURL;
}

load('extension/capture-core.js');
var Core = VriCaptureCore;
var failed = 0;
var passed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  print('FAIL: ' + message);
}

function assertEq(actual, expected, message) {
  if (actual === expected) {
    passed += 1;
    return;
  }
  failed += 1;
  print('FAIL: ' + message + ' (expected ' + expected + ', got ' + actual + ')');
}

// --- IP version ---
assertEq(Core.classifyIpVersion('1.1.1.1'), 4, 'IPv4 classification');
assertEq(Core.classifyIpVersion('2001:db8::1'), 6, 'IPv6 classification');
assertEq(Core.classifyIpVersion(null), null, 'missing IP');
assertEq(Core.classifyIpVersion('not-an-ip'), null, 'unrecognized IP');

// --- URL normalization ---
var good = Core.parseHttpUrl('https://example.com/path?q=1');
assert(good.ok === true && good.hostname === 'example.com', 'HTTPS URL parse');
var badProto = Core.parseHttpUrl('chrome://extensions');
assert(badProto.ok === false && badProto.reason === 'unsupported_protocol', 'chrome URL rejected');
var badUrl = Core.parseHttpUrl(':::');
assert(badUrl.ok === false && badUrl.reason === 'invalid_url', 'invalid URL rejected');
assert(Core.isRejectedTabUrl('chrome://settings') === true, 'rejected tab url');
assert(Core.isRejectedTabUrl('https://wildberries.ru/') === false, 'https tab accepted');

// --- Target tab matching / wrong tab ---
var session = Core.emptySession();
session.active = true;
session.tabId = 42;
session.diagnostics.permissionGranted = true;

var stored = Core.applyCaptureEvent(session, 'response', {
  requestId: 'r1',
  url: 'https://cdn.example/a.js',
  method: 'GET',
  type: 'script',
  tabId: 42,
  frameId: 0,
  parentFrameId: -1,
  statusCode: 200,
  ip: '1.2.3.4',
  fromCache: false,
  timeStamp: 1000,
}, function () { return 'id-1'; });
assertEq(stored.decision, 'stored', 'target tab event stored');
assertEq(stored.session.entries.length, 1, 'one entry stored');
assertEq(stored.session.diagnostics.entriesStored, 1, 'entriesStored counter');

var wrong = Core.applyCaptureEvent(stored.session, 'response', {
  requestId: 'r2',
  url: 'https://other.example/',
  method: 'GET',
  type: 'main_frame',
  tabId: 99,
  statusCode: 200,
  ip: '8.8.8.8',
  timeStamp: 1001,
}, function () { return 'id-2'; });
assertEq(wrong.decision, 'ignored_wrong_tab', 'wrong tab rejected');
assertEq(wrong.session.entries.length, 1, 'wrong tab not stored');
assertEq(wrong.session.diagnostics.ignoredWrongTab, 1, 'wrong-tab counter');

// --- No active session ---
var inactive = Core.applyCaptureEvent(Core.emptySession(), 'response', {
  requestId: 'r3',
  url: 'https://example.com/',
  tabId: 1,
  timeStamp: 1,
}, function () { return 'id-3'; });
assertEq(inactive.decision, 'ignored_no_active_session', 'inactive session ignored');

// --- IPv6 / no IP ---
var v6 = Core.applyCaptureEvent(stored.session, 'response', {
  requestId: 'r4',
  url: 'https://example.com/v6',
  method: 'GET',
  type: 'xhr',
  tabId: 42,
  statusCode: 200,
  ip: '2001:db8::2',
  timeStamp: 1002,
}, function () { return 'id-4'; });
assertEq(v6.entry.ipVersion, 6, 'IPv6 entry');

var noIp = Core.applyCaptureEvent(v6.session, 'response', {
  requestId: 'r5',
  url: 'https://example.com/cached',
  method: 'GET',
  type: 'script',
  tabId: 42,
  statusCode: 200,
  fromCache: true,
  timeStamp: 1003,
}, function () { return 'id-5'; });
assertEq(noIp.decision, 'stored', 'missing IP still stored');
assertEq(noIp.entry.ip, null, 'ip null when absent');
assert(noIp.session.diagnostics.entriesWithoutIp >= 1, 'entriesWithoutIp counted');

// --- Redirect / error ---
var redir = Core.applyCaptureEvent(noIp.session, 'redirect', {
  requestId: 'r6',
  url: 'https://example.com/from',
  method: 'GET',
  type: 'main_frame',
  tabId: 42,
  statusCode: 302,
  timeStamp: 1004,
}, function () { return 'id-6'; });
assertEq(redir.decision, 'stored', 'redirect stored');
assertEq(redir.entry.eventType, 'redirect', 'redirect type');

var errEv = Core.applyCaptureEvent(redir.session, 'error', {
  requestId: 'r7',
  url: 'https://example.com/fail',
  method: 'GET',
  type: 'image',
  tabId: 42,
  error: 'net::ERR_CONNECTION_RESET',
  timeStamp: 1005,
}, function () { return 'id-7'; });
assertEq(errEv.decision, 'stored', 'error stored without statusCode');
assertEq(errEv.entry.statusCode, null, 'error status null');

// --- Deduplication key ---
var keyA = Core.dedupeKey({
  requestId: 'same',
  eventType: 'response',
  statusCode: 200,
  timeStamp: 50,
});
var keyB = Core.dedupeKey({
  requestId: 'same',
  eventType: 'response',
  statusCode: 200,
  timeStamp: 51,
});
assert(keyA !== keyB, 'dedupe distinguishes timestamps');

var dup = Core.applyCaptureEvent(errEv.session, 'response', {
  requestId: 'r5',
  url: 'https://example.com/cached',
  method: 'GET',
  type: 'script',
  tabId: 42,
  statusCode: 200,
  fromCache: true,
  timeStamp: 1003,
}, function () { return 'id-dup'; });
assertEq(dup.decision, 'duplicate', 'duplicate skipped');

// --- 500-entry eviction ---
var many = [];
for (var i = 0; i < 505; i += 1) {
  many.push({ id: 'e' + i });
}
var evicted = Core.evictOldestEntries(many);
assertEq(evicted.length, 500, 'eviction length');
assertEq(evicted[0].id, 'e5', 'oldest removed');
assertEq(evicted[499].id, 'e504', 'newest kept');

// --- Malformed session reset ---
var reset = Core.normalizeSession({ schemaVersion: 999, entries: [{ x: 1 }] });
assertEq(reset.active, false, 'bad schema resets');
assertEq(reset.entries.length, 0, 'bad schema clears entries');
assert(reset.diagnostics && typeof reset.diagnostics.eventsSeen === 'number', 'diagnostics present');
assert(reset.routeAnalysis && reset.routeAnalysis.state === 'idle', 'routeAnalysis present on empty');

// ---------------------------------------------------------------------------
// Milestone 3 — route analysis / diagnosis
// ---------------------------------------------------------------------------

function makeEntry(partial) {
  return {
    id: partial.id || 'e',
    requestId: partial.requestId || 'r',
    eventType: partial.eventType || 'response',
    url: partial.url || ('https://' + (partial.hostname || 'example.com') + '/'),
    method: 'GET',
    resourceType: partial.resourceType || 'xhr',
    tabId: 1,
    frameId: 0,
    parentFrameId: -1,
    statusCode: partial.statusCode === undefined ? 200 : partial.statusCode,
    ip: partial.ip === undefined ? null : partial.ip,
    ipVersion: Core.classifyIpVersion(partial.ip === undefined ? null : partial.ip),
    fromCache: false,
    timeStamp: partial.timeStamp || 1000,
    initiator: null,
    error: partial.error || null,
    hostname: partial.hostname || 'example.com',
  };
}

// unique IPv4 extraction + skip counts
var extractEntries = [
  makeEntry({ ip: '185.138.255.20', hostname: 'a.example' }),
  makeEntry({ ip: '185.138.255.20', hostname: 'a.example', timeStamp: 1001 }),
  makeEntry({ ip: '87.250.250.22', hostname: 'b.example' }),
  makeEntry({ ip: '2001:db8::1', hostname: 'v6.example' }),
  makeEntry({ ip: null, hostname: 'noip.example', error: 'net::ERR_NETWORK_CHANGED', eventType: 'error', statusCode: null }),
];
var extracted = Core.extractUniqueIPv4s(extractEntries);
assertEq(extracted.ips.length, 2, 'unique IPv4 extraction length');
assertEq(extracted.ips[0], '185.138.255.20', 'unique IPv4 first-seen order');
assertEq(extracted.ips[1], '87.250.250.22', 'unique IPv4 second');
assertEq(extracted.skippedIPv6Count, 1, 'IPv6 skip count');
assertEq(extracted.skippedMissingIpCount, 1, 'missing IP skip count');

// max 128 unique IPv4 extraction
var manyIps = [];
for (var mi = 0; mi < 140; mi += 1) {
  manyIps.push(makeEntry({
    ip: '10.0.' + Math.floor(mi / 250) + '.' + (mi % 250),
    hostname: 'h' + mi + '.example',
    timeStamp: 2000 + mi,
  }));
}
var capped = Core.extractUniqueIPv4s(manyIps);
assertEq(capped.ips.length, 128, 'max 128 unique IPv4');
assertEq(capped.truncated, true, 'truncated flag when >128');

// hostname/IP aggregation + repeated error aggregation
var agg = Core.aggregateHostnameIp([
  makeEntry({ hostname: 'shop.example', ip: '1.2.3.4', statusCode: 403, timeStamp: 1 }),
  makeEntry({ hostname: 'shop.example', ip: '1.2.3.4', statusCode: 403, timeStamp: 2 }),
  makeEntry({
    hostname: 'shop.example',
    ip: null,
    eventType: 'error',
    error: 'net::ERR_NETWORK_CHANGED',
    statusCode: null,
    timeStamp: 3,
  }),
  makeEntry({
    hostname: 'shop.example',
    ip: null,
    eventType: 'error',
    error: 'net::ERR_NETWORK_CHANGED',
    statusCode: null,
    timeStamp: 4,
  }),
]);
assertEq(agg.networkChangeErrorCount, 2, 'ERR_NETWORK_CHANGED counted');
assert(agg.groups.some(function (g) { return g.ip === '1.2.3.4' && g.requestCount === 2; }), 'hostname/IP aggregation');
assert(agg.unclassifiedErrors.length >= 2, 'errors without IP collected');

// HTTP 403 + VPN → ERROR_VIA_VPN
var vpn403 = Core.buildFindings(
  Core.aggregateHostnameIp([
    makeEntry({ hostname: 'data-checker.wildberries.ru', ip: '185.138.255.20', statusCode: 403 }),
  ]).groups,
  [{ ok: true, ip: '185.138.255.20', interface: 'utun4', routeType: 'VPN', error: null }],
  []
);
assert(vpn403.findings.some(function (f) { return f.category === 'ERROR_VIA_VPN'; }), 'HTTP 403 + VPN → ERROR_VIA_VPN');
assertEq(vpn403.candidateExclusionIps[0], '185.138.255.20', 'ERROR_VIA_VPN candidate');

// HTTP 500 + VPN → ERROR_VIA_VPN
var vpn500 = Core.buildFindings(
  Core.aggregateHostnameIp([
    makeEntry({ hostname: 'api.example', ip: '9.9.9.9', statusCode: 500 }),
  ]).groups,
  [{ ok: true, ip: '9.9.9.9', interface: 'utun0', routeType: 'VPN', error: null }],
  []
);
assert(vpn500.findings.some(function (f) { return f.category === 'ERROR_VIA_VPN'; }), 'HTTP 500 + VPN → ERROR_VIA_VPN');

// successful 200 + VPN → VPN_WITHOUT_ERROR
var vpnOk = Core.buildFindings(
  Core.aggregateHostnameIp([
    makeEntry({ hostname: 'ok.example', ip: '1.1.1.1', statusCode: 200 }),
  ]).groups,
  [{ ok: true, ip: '1.1.1.1', interface: 'utun4', routeType: 'VPN', error: null }],
  []
);
assert(vpnOk.findings.some(function (f) { return f.category === 'VPN_WITHOUT_ERROR'; }), '200 + VPN → VPN_WITHOUT_ERROR');
assertEq(vpnOk.candidateExclusionIps.length, 0, 'no candidate from VPN_WITHOUT_ERROR alone');

// 403 + DIRECT → ERROR_VIA_DIRECT
var dir403 = Core.buildFindings(
  Core.aggregateHostnameIp([
    makeEntry({ hostname: 'direct.example', ip: '8.8.8.8', statusCode: 403 }),
  ]).groups,
  [{ ok: true, ip: '8.8.8.8', interface: 'en0', routeType: 'DIRECT', error: null }],
  []
);
assert(dir403.findings.some(function (f) { return f.category === 'ERROR_VIA_DIRECT'; }), '403 + DIRECT → ERROR_VIA_DIRECT');
assertEq(dir403.candidateExclusionIps.length, 0, 'DIRECT not a candidate');

// mixed DIRECT/VPN hostname + candidate from VPN side
var mixed = Core.buildFindings(
  Core.aggregateHostnameIp([
    makeEntry({ hostname: 'mixed.example', ip: '10.0.0.1', statusCode: 200 }),
    makeEntry({ hostname: 'mixed.example', ip: '10.0.0.2', statusCode: 200 }),
  ]).groups,
  [
    { ok: true, ip: '10.0.0.1', interface: 'en0', routeType: 'DIRECT', error: null },
    { ok: true, ip: '10.0.0.2', interface: 'utun4', routeType: 'VPN', error: null },
  ],
  []
);
assert(mixed.findings.some(function (f) { return f.category === 'MIXED_ROUTING'; }), 'mixed DIRECT/VPN hostname');
assertEq(mixed.candidateExclusionIps.join(','), '10.0.0.2', 'mixed-routing VPN candidate only');

// error without IP → UNCLASSIFIED_ERROR; not a candidate
var noIpFinding = Core.buildFindings(
  [],
  [],
  [{ hostname: 'x.example', ip: null, ipVersion: null, error: 'net::ERR_NETWORK_CHANGED', statusCode: null, eventType: 'error' }]
);
assert(noIpFinding.findings.some(function (f) { return f.category === 'UNCLASSIFIED_ERROR'; }), 'error without IP → UNCLASSIFIED_ERROR');
assertEq(noIpFinding.candidateExclusionIps.length, 0, 'ERR_NETWORK_CHANGED without IP is not a candidate');

// IPv6 error → UNCLASSIFIED_ERROR
var v6Finding = Core.buildFindings(
  Core.aggregateHostnameIp([
    makeEntry({
      hostname: 'v6.example',
      ip: '2001:db8::9',
      eventType: 'error',
      error: 'net::ERR_FAILED',
      statusCode: null,
    }),
  ]).groups,
  [],
  Core.aggregateHostnameIp([
    makeEntry({
      hostname: 'v6.example',
      ip: '2001:db8::9',
      eventType: 'error',
      error: 'net::ERR_FAILED',
      statusCode: null,
    }),
  ]).unclassifiedErrors
);
assert(v6Finding.findings.some(function (f) { return f.category === 'UNCLASSIFIED_ERROR'; }), 'IPv6 error → UNCLASSIFIED_ERROR');

// candidate deduplication + deterministic ordering (strong before mixed)
var ordered = Core.buildFindings(
  Core.aggregateHostnameIp([
    makeEntry({ hostname: 'a.example', ip: '1.1.1.1', statusCode: 403 }),
    makeEntry({ hostname: 'b.example', ip: '2.2.2.2', statusCode: 200 }),
    makeEntry({ hostname: 'b.example', ip: '3.3.3.3', statusCode: 200 }),
    makeEntry({ hostname: 'a.example', ip: '1.1.1.1', statusCode: 500 }),
  ]).groups,
  [
    { ok: true, ip: '1.1.1.1', interface: 'utun1', routeType: 'VPN', error: null },
    { ok: true, ip: '2.2.2.2', interface: 'en0', routeType: 'DIRECT', error: null },
    { ok: true, ip: '3.3.3.3', interface: 'utun1', routeType: 'VPN', error: null },
  ],
  []
);
assertEq(ordered.candidateExclusionIps[0], '1.1.1.1', 'strong candidates first');
assert(ordered.candidateExclusionIps.indexOf('3.3.3.3') > 0, 'mixed candidate after strong');
assertEq(ordered.candidateExclusionIps.filter(function (ip) { return ip === '1.1.1.1'; }).length, 1, 'candidate deduplication');

// no candidate from UNKNOWN
var unknownErr = Core.buildFindings(
  Core.aggregateHostnameIp([
    makeEntry({ hostname: 'u.example', ip: '4.4.4.4', statusCode: 503 }),
  ]).groups,
  [{ ok: true, ip: '4.4.4.4', interface: 'lo0', routeType: 'UNKNOWN', error: null }],
  []
);
assertEq(unknownErr.candidateExclusionIps.length, 0, 'no candidate from UNKNOWN');
assert(unknownErr.findings.some(function (f) { return f.category === 'UNCLASSIFIED_ERROR'; }), 'UNKNOWN error → UNCLASSIFIED_ERROR');

// source fingerprint comparison + stale when IPv4 set changes
var sessA = Core.emptySession();
sessA.tabId = 7;
sessA.startedAt = 100;
sessA.entries = [makeEntry({ ip: '1.1.1.1' })];
var fpA = Core.buildSourceFingerprint(sessA, ['1.1.1.1']);
var sessB = Core.emptySession();
sessB.tabId = 7;
sessB.startedAt = 100;
sessB.entries = [makeEntry({ ip: '1.1.1.1' }), makeEntry({ ip: '8.8.8.8', timeStamp: 2001 })];
var fpB = Core.buildSourceFingerprint(sessB, ['1.1.1.1', '8.8.8.8']);
assert(Core.fingerprintsMatch(fpA, fpA) === true, 'fingerprint matches self');
assert(Core.fingerprintsMatch(fpA, fpB) === false, 'fingerprint differs when IPv4 set changes');

var analysisComplete = Core.buildRouteAnalysis(sessA, [
  { ok: true, ip: '1.1.1.1', interface: 'en0', routeType: 'DIRECT', error: null },
]);
assertEq(analysisComplete.state, 'complete', 'analysis complete state');
var refreshed = Core.refreshAnalysisStaleState(analysisComplete, sessB);
assertEq(refreshed.state, 'stale', 'completed analysis becomes stale when captured IPv4 set changes');

// new entry after complete marks stale via applyCaptureEvent
var live = Core.emptySession();
live.active = true;
live.tabId = 1;
live.startedAt = 50;
live.diagnostics.permissionGranted = true;
live.entries = [makeEntry({ id: 'e1', ip: '1.1.1.1', hostname: 'a.example', timeStamp: 50 })];
live.routeAnalysis = analysisComplete;
var afterStore = Core.applyCaptureEvent(live, 'response', {
  requestId: 'new-r',
  url: 'https://b.example/',
  method: 'GET',
  type: 'xhr',
  tabId: 1,
  statusCode: 200,
  ip: '8.8.8.8',
  timeStamp: 9999,
}, function () { return 'id-new'; });
assertEq(afterStore.session.routeAnalysis.state, 'stale', 'new capture entry marks analysis stale');

// ---------------------------------------------------------------------------
// Diagnostic report export
// ---------------------------------------------------------------------------

var FIXED_TS = 1700000000000;

// 1. empty session report
var emptyExport = Core.buildDiagnosticMarkdownExport(Core.emptySession(), {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assertEq(emptyExport.ok, false, 'empty session report rejected');
assertEq(emptyExport.error.code, 'NO_CAPTURE_DATA', 'empty session NO_CAPTURE_DATA');

// Helper session with capture entries
function sessionWithEntries(entries, analysisPatch) {
  var s = Core.emptySession();
  s.active = false;
  s.tabId = 42;
  s.tabTitle = 'Shop Title';
  s.tabUrl = 'https://user:secret@shop.example:443/path/page?token=abc#frag';
  s.startedAt = FIXED_TS - 10000;
  s.stoppedAt = FIXED_TS - 1000;
  s.entries = entries;
  s.diagnostics.eventsSeen = entries.length;
  s.diagnostics.entriesStored = entries.length;
  s.diagnostics.targetTabEventsSeen = entries.length;
  if (analysisPatch) {
    s.routeAnalysis = Object.assign(Core.emptyRouteAnalysis(), analysisPatch);
  }
  return s;
}

var baseEntries = [
  makeEntry({
    hostname: 'data-checker.wildberries.ru',
    ip: '185.138.255.20',
    statusCode: 403,
    url: 'https://data-checker.wildberries.ru/api?key=SECRET#top',
    timeStamp: FIXED_TS - 5000,
  }),
  makeEntry({
    hostname: 'data-checker.wildberries.ru',
    ip: '185.138.255.20',
    statusCode: 204,
    timeStamp: FIXED_TS - 4000,
  }),
  makeEntry({
    hostname: 'cdn.example',
    ip: '10.0.0.1',
    statusCode: 200,
    timeStamp: FIXED_TS - 3000,
  }),
  makeEntry({
    hostname: 'cdn.example',
    ip: '10.0.0.2',
    statusCode: 200,
    timeStamp: FIXED_TS - 2500,
  }),
  makeEntry({
    hostname: 'fail.example',
    ip: null,
    eventType: 'error',
    error: 'net::ERR_NETWORK_CHANGED',
    statusCode: null,
    timeStamp: FIXED_TS - 2000,
  }),
  makeEntry({
    hostname: 'fail.example',
    ip: null,
    eventType: 'error',
    error: 'net::ERR_NETWORK_CHANGED',
    statusCode: null,
    timeStamp: FIXED_TS - 1500,
  }),
];

// 2. report without route analysis
var noAnalysisExport = Core.buildDiagnosticMarkdownExport(
  sessionWithEntries(baseEntries),
  { extensionVersion: '0.3.1', generatedAtMs: FIXED_TS }
);
assertEq(noAnalysisExport.ok, true, 'report without route analysis ok');
assert(noAnalysisExport.text.indexOf('Analysis state: not-run') !== -1, 'not-run analysis state');
assert(noAnalysisExport.text.indexOf('Route analysis has not been run.') !== -1, 'no-analysis candidate section');

// Build a complete analysis session
var completeSession = sessionWithEntries(baseEntries);
completeSession.routeAnalysis = Core.buildRouteAnalysis(completeSession, [
  { ok: true, ip: '185.138.255.20', interface: 'utun4', routeType: 'VPN', error: null },
  { ok: true, ip: '10.0.0.1', interface: 'en0', routeType: 'DIRECT', error: null },
  { ok: true, ip: '10.0.0.2', interface: 'utun4', routeType: 'VPN', error: null },
]);
completeSession.routeAnalysis.startedAt = FIXED_TS - 500;
completeSession.routeAnalysis.completedAt = FIXED_TS - 100;

// 3. complete-analysis report
var completeExport = Core.buildDiagnosticMarkdownExport(completeSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assertEq(completeExport.ok, true, 'complete-analysis report ok');
assert(completeExport.text.indexOf('Analysis state: complete') !== -1, 'complete analysis state');
assert(completeExport.text.indexOf('## Candidate exclusion IPs') !== -1, 'candidate section present');
assert(completeExport.text.indexOf('185.138.255.20') !== -1, 'candidate IP section contains VPN error IP');

// 30. candidate IPs match stored analysis (not recomputed differently)
var modelComplete = Core.buildDiagnosticReportModel(completeSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assertEq(
  modelComplete.candidates.join(','),
  completeSession.routeAnalysis.candidateExclusionIps.join(','),
  'candidate IPs are not recomputed differently from stored analysis'
);

// 4. stale-analysis warning
var staleSession = Core.normalizeSession(JSON.parse(JSON.stringify(completeSession)));
staleSession.routeAnalysis.state = 'stale';
var staleExport = Core.buildDiagnosticMarkdownExport(staleSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assert(staleExport.text.indexOf('Analysis state: stale') !== -1, 'stale analysis state');
assert(staleExport.text.indexOf('Candidate exclusions from stale analysis') !== -1, 'stale candidate label');
assert(staleExport.text.indexOf('Re-analyze before applying exclusions') !== -1, 'stale-analysis warning');

// 5. error-analysis report
var errorSession = sessionWithEntries(baseEntries, {
  state: 'error',
  error: { code: 'NATIVE_HOST_ERROR', message: 'host unavailable' },
});
var errorExport = Core.buildDiagnosticMarkdownExport(errorSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assert(errorExport.text.indexOf('Analysis state: error') !== -1, 'error-analysis report');
assert(errorExport.text.indexOf('NATIVE_HOST_ERROR') !== -1, 'error code in report');

// 6/7. candidate / no-candidate sections
var noCandSession = sessionWithEntries([
  makeEntry({ hostname: 'ok.example', ip: '1.1.1.1', statusCode: 200 }),
]);
noCandSession.routeAnalysis = Core.buildRouteAnalysis(noCandSession, [
  { ok: true, ip: '1.1.1.1', interface: 'en0', routeType: 'DIRECT', error: null },
]);
var noCandExport = Core.buildDiagnosticMarkdownExport(noCandSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assert(noCandExport.text.indexOf('No strong exclusion candidates were identified.') !== -1, 'no-candidate section');

// 8–11 finding rendering
assert(completeExport.text.indexOf('ERROR_VIA_VPN') !== -1, 'ERROR_VIA_VPN rendering');
assert(completeExport.text.indexOf('MIXED_ROUTING') !== -1, 'MIXED_ROUTING rendering');
assert(completeExport.text.indexOf('Strong candidate for VPN exclusion') !== -1, 'ERROR_VIA_VPN conclusion wording');

var directErrSession = sessionWithEntries([
  makeEntry({ hostname: 'direct.example', ip: '8.8.8.8', statusCode: 403 }),
]);
directErrSession.routeAnalysis = Core.buildRouteAnalysis(directErrSession, [
  { ok: true, ip: '8.8.8.8', interface: 'en0', routeType: 'DIRECT', error: null },
]);
var directErrExport = Core.buildDiagnosticMarkdownExport(directErrSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assert(directErrExport.text.indexOf('ERROR_VIA_DIRECT') !== -1, 'ERROR_VIA_DIRECT rendering');

var uncSession = sessionWithEntries([
  makeEntry({
    hostname: 'x.example',
    ip: null,
    eventType: 'error',
    error: 'net::ERR_FAILED',
    statusCode: null,
  }),
]);
uncSession.routeAnalysis = Core.buildRouteAnalysis(uncSession, []);
var uncExport = Core.buildDiagnosticMarkdownExport(uncSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assert(uncExport.text.indexOf('UNCLASSIFIED_ERROR') !== -1, 'UNCLASSIFIED_ERROR rendering');

// 12/13 aggregated ERR_NETWORK_CHANGED; not printed individually
assert(completeExport.text.indexOf('net::ERR_NETWORK_CHANGED — 2') !== -1, 'aggregated ERR_NETWORK_CHANGED count');
assert(completeExport.text.indexOf('## Aggregated network errors') !== -1, 'aggregated errors section');
// Ensure we do not dump per-event IDs from raw entries
assert(completeExport.text.indexOf('"requestId"') === -1, 'repeated errors are not printed individually as raw JSON');

// 14–18 URL sanitization
assertEq(
  Core.sanitizeUrlForReport('https://user:pass@example.com:8443/a/b?x=1#frag'),
  'https://example.com:8443/a/b',
  'query/fragment/userinfo removed; pathname preserved'
);
assert(Core.sanitizeUrlForReport('https://example.com/path?q=1').indexOf('?') === -1, 'query string removal');
assert(Core.sanitizeUrlForReport('https://example.com/path#frag').indexOf('#') === -1, 'fragment removal');
assert(Core.sanitizeUrlForReport('https://user:secret@example.com/').indexOf('user') === -1, 'username/password removal');
assert(Core.sanitizeUrlForReport('https://example.com/keep/path').indexOf('/keep/path') !== -1, 'pathname preservation');
assertEq(Core.sanitizeUrlForReport(':::bad'), '[unparseable-url]', 'malformed URL handling');
assert(completeExport.text.indexOf('token=abc') === -1, 'report omits query secrets');
assert(completeExport.text.indexOf('#frag') === -1, 'report omits fragments');
assert(completeExport.text.indexOf('secret@') === -1, 'report omits userinfo');

// 19. long-title truncation
var longTitleSession = sessionWithEntries([makeEntry({ ip: '1.2.3.4' })]);
longTitleSession.tabTitle = Array(200).join('T');
var longTitleModel = Core.buildDiagnosticReportModel(longTitleSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assert(longTitleModel.capture.targetTitle.length <= 120, 'long-title truncation');

// 20. hostname-group cap
var manyHostEntries = [];
for (var hi = 0; hi < 120; hi += 1) {
  manyHostEntries.push(makeEntry({
    hostname: 'host' + hi + '.example',
    ip: '10.1.' + Math.floor(hi / 250) + '.' + (hi % 250),
    timeStamp: FIXED_TS + hi,
  }));
}
var manyHostSession = sessionWithEntries(manyHostEntries);
manyHostSession.routeAnalysis = Core.buildRouteAnalysis(
  manyHostSession,
  manyHostEntries.map(function (e) {
    return { ok: true, ip: e.ip, interface: 'en0', routeType: 'DIRECT', error: null };
  })
);
var manyHostModel = Core.buildDiagnosticReportModel(manyHostSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assertEq(manyHostModel.hostnameGroups.length, Core.MAX_REPORT_HOSTNAME_GROUPS, 'hostname-group cap');
assert(manyHostModel.truncationNotes.some(function (n) {
  return n.indexOf('Hostname groups capped') !== -1;
}), 'hostname-group truncation note');

// 21. finding cap
var manyFindings = [];
for (var fi = 0; fi < 150; fi += 1) {
  manyFindings.push({
    category: 'VPN_WITHOUT_ERROR',
    severity: 'info',
    hostname: 'h' + fi + '.example',
    ip: '1.1.1.' + (fi % 200),
    interface: 'utun0',
    routeType: 'VPN',
    message: 'Routed through VPN, but no failure was observed',
    evidence: { requestCount: 1, statusCodes: ['200'], networkErrors: {} },
    candidate: false,
  });
}
var findingCapSession = sessionWithEntries([makeEntry({ ip: '1.1.1.1' })]);
findingCapSession.routeAnalysis = Object.assign(Core.emptyRouteAnalysis(), {
  state: 'complete',
  findings: manyFindings,
  candidateExclusionIps: [],
  summary: { uniqueIPv4: 1, vpn: 1, direct: 0, unknown: 0 },
  uniqueIPv4Count: 1,
});
var findingCapModel = Core.buildDiagnosticReportModel(findingCapSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assertEq(findingCapModel.findings.length, Core.MAX_REPORT_FINDINGS, 'finding cap');

// 22. deterministic output
var detA = Core.buildDiagnosticMarkdownExport(completeSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
}).text;
var detB = Core.buildDiagnosticMarkdownExport(completeSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
}).text;
assertEq(detA, detB, 'deterministic output');

// 23/24 no literal undefined / [object Object]
assert(completeExport.text.indexOf('undefined') === -1, 'no literal undefined');
assert(completeExport.text.indexOf('[object Object]') === -1, 'no literal [object Object]');

// 25. no cookies/Authorization fields in markdown (allow privacy notes mentioning the words)
assert(completeExport.text.indexOf('Authorization:') === -1, 'no Authorization header fields in markdown');
assert(completeExport.text.indexOf('"Cookie"') === -1, 'no Cookie header fields in markdown');
assert(completeExport.text.indexOf('Cookie:') === -1, 'no Cookie: fields in markdown');

// 26/27 full JSON valid + includes routeAnalysis/diagnostics
var jsonExport = Core.buildTechnicalExport(completeSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
assertEq(jsonExport.ok, true, 'full JSON export ok');
var parsedJson = JSON.parse(jsonExport.text);
assertEq(parsedJson.reportFormat, 'vpn-route-inspector-session', 'full JSON format');
assertEq(parsedJson.reportVersion, 1, 'full JSON version');
assert(parsedJson.captureSession && parsedJson.captureSession.routeAnalysis, 'full JSON includes routeAnalysis');
assert(parsedJson.captureSession && parsedJson.captureSession.diagnostics, 'full JSON includes diagnostics');
assert(Array.isArray(parsedJson.captureSession.entries), 'full JSON includes entries');

// 28. full JSON size rejection
var hugeSession = sessionWithEntries([]);
hugeSession.entries = [];
for (var zi = 0; zi < 500; zi += 1) {
  hugeSession.entries.push(makeEntry({
    id: 'huge-' + zi,
    hostname: 'huge' + zi + '.example.com',
    ip: '11.22.' + Math.floor(zi / 250) + '.' + (zi % 250),
    url: 'https://huge' + zi + '.example.com/' + Array(2000).join('x') + '?q=' + zi,
    timeStamp: FIXED_TS + zi,
  }));
}
// Force size check by temporarily lowering is hard; instead build and if under limit,
// invent oversized text path via enforce by monkeypatching is not ideal.
// Build a synthetic oversize by calling with inflated entries enough for 4MiB.
var inflate = [];
for (var yi = 0; yi < 500; yi += 1) {
  inflate.push(makeEntry({
    id: 'pad-' + yi,
    hostname: 'pad' + yi + '.example',
    ip: '9.9.' + Math.floor(yi / 250) + '.' + (yi % 250),
    url: 'https://pad' + yi + '.example/' + Array(9000).join('Z'),
    timeStamp: FIXED_TS + yi,
  }));
}
var inflateSession = sessionWithEntries(inflate);
inflateSession.routeAnalysis = Core.emptyRouteAnalysis();
inflateSession.routeAnalysis.state = 'complete';
var tooLarge = Core.buildTechnicalExport(inflateSession, {
  extensionVersion: '0.3.1',
  generatedAtMs: FIXED_TS,
});
if (tooLarge.ok) {
  // If environment still under 4MiB, fabricate rejection by checking limit helper path:
  // ensure EXPORT_TOO_LARGE path exists by constructing oversized JSON manually through
  // a second inflate pass with longer URLs.
  var inflate2 = [];
  for (var y2 = 0; y2 < 500; y2 += 1) {
    inflate2.push(makeEntry({
      id: 'pad2-' + y2,
      hostname: 'pad2-' + y2 + '.example',
      ip: '8.8.' + Math.floor(y2 / 250) + '.' + (y2 % 250),
      url: 'https://pad2-' + y2 + '.example/' + Array(20000).join('W'),
      timeStamp: FIXED_TS + y2,
    }));
  }
  tooLarge = Core.buildTechnicalExport(sessionWithEntries(inflate2), {
    extensionVersion: '0.3.1',
    generatedAtMs: FIXED_TS,
  });
}
assertEq(tooLarge.ok, false, 'full JSON size rejection');
assertEq(tooLarge.error.code, 'EXPORT_TOO_LARGE', 'EXPORT_TOO_LARGE code');

// 29. report character limit
var longMd = Array(Core.MAX_DIAGNOSTIC_REPORT_CHARS + 500).join('A');
var limited = Core.enforceReportLimits(longMd);
assert(limited.truncated === true, 'report character limit truncated');
assert(limited.characterCount <= Core.MAX_DIAGNOSTIC_REPORT_CHARS, 'report character limit enforced');
assert(limited.text.indexOf('Truncation:') !== -1, 'report truncation note');

print('Capture-core tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  throw new Error(failed + ' capture-core tests failed');
}
