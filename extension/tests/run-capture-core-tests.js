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

print('Capture-core tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  throw new Error(failed + ' capture-core tests failed');
}
