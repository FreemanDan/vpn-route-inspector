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
    this.pathname = '';
    this.search = '';
    this.href = s;

    if (rest.indexOf('//') === 0) {
      rest = rest.slice(2);
      var authEnd = rest.search(/[/?#]/);
      var authority = authEnd === -1 ? rest : rest.slice(0, authEnd);
      var pathPart = authEnd === -1 ? '' : rest.slice(authEnd);
      if (authority.charAt(0) === '[') {
        var end = authority.indexOf(']');
        this.hostname = end === -1 ? authority : authority.slice(0, end + 1);
      } else {
        this.hostname = authority.split(':')[0];
      }
      var q = pathPart.indexOf('?');
      if (q === -1) {
        this.pathname = pathPart || '/';
      } else {
        this.pathname = pathPart.slice(0, q) || '/';
        var hash = pathPart.indexOf('#', q);
        this.search = hash === -1 ? pathPart.slice(q) : pathPart.slice(q, hash);
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

print('Capture-core tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  throw new Error(failed + ' capture-core tests failed');
}
