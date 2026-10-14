'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrustedPageMatcher, isSafeExternalUrl, createCaptureAuthorizer } = require('./security.cjs');

test('packaged page trust rejects other local files, hostnames, and protocols', () => {
  const matches = createTrustedPageMatcher({ filePath: '/Applications/3D Desktop.app/Contents/Resources/app.asar/dist/index.html' });
  const trusted = 'file:///Applications/3D%20Desktop.app/Contents/Resources/app.asar/dist/index.html';
  assert.equal(matches(trusted), true);
  assert.equal(matches(`${trusted}#workspace`), true);
  for (const url of [
    'file:///etc/passwd', `${trusted}/another`, `${trusted}?script=1`,
    'file://attacker/Applications/3D%20Desktop.app/Contents/Resources/app.asar/dist/index.html',
    'https://example.com', 'javascript:alert(1)', '',
  ]) assert.equal(matches(url), false, url);
});

test('development page trust rejects remote hosts, sibling ports, and paths', () => {
  const matches = createTrustedPageMatcher({ developmentUrl: 'http://localhost:5173/' });
  assert.equal(matches('http://localhost:5173/'), true);
  for (const url of [
    'http://localhost.evil:5173/', 'http://localhost:5174/',
    'http://localhost:5173/other', 'http://attacker@localhost:5173/',
    'https://localhost:5173/',
  ]) assert.equal(matches(url), false, url);
  for (const developmentUrl of ['https://example.com/', 'http://example.com/', 'file:///tmp/index.html']) {
    assert.throws(() => createTrustedPageMatcher({ developmentUrl }), /local HTTP/);
  }
});

test('external navigation only accepts web URLs without credentials', () => {
  assert.equal(isSafeExternalUrl('https://example.com/help'), true);
  assert.equal(isSafeExternalUrl('http://localhost:3000/'), true);
  for (const url of ['file:///Applications/Terminal.app', 'javascript:alert(1)', 'mailto:user@example.com', 'https://user:pass@example.com', 'x-apple.systempreferences:anything']) {
    assert.equal(isSafeExternalUrl(url), false, url);
  }
});

function captureFixture() {
  let now = 1_000;
  const authorizer = createCaptureAuthorizer(() => now);
  const frame = { id: 1 };
  const source = { id: 'window:123:0', name: 'Test window' };
  const request = { frame, videoRequested: true, audioRequested: false, userGesture: true };
  return { authorizer, frame, source, request, advance: (ms) => { now += ms; } };
}

test('capture cannot begin without a picker selection and each selection is single use', () => {
  const { authorizer, frame, source, request } = captureFixture();
  assert.equal(authorizer.take(request, frame), null);
  authorizer.select(frame, source);
  assert.equal(authorizer.take(request, frame), source);
  assert.equal(authorizer.take(request, frame), null);
});

test('capture selection cannot be used by another frame', () => {
  const { authorizer, frame, source, request } = captureFixture();
  authorizer.select(frame, source);
  assert.equal(authorizer.take({ ...request, frame: { id: 2 } }, frame), null);
  assert.equal(authorizer.take(request, { id: 3 }), null);
  assert.equal(authorizer.take(request, frame), source);
});

test('capture selection expires and can be explicitly cleared on navigation', () => {
  const { authorizer, frame, source, request, advance } = captureFixture();
  authorizer.select(frame, source);
  advance(30_001);
  assert.equal(authorizer.take(request, frame), null);
  authorizer.select(frame, source);
  authorizer.clear();
  assert.equal(authorizer.take(request, frame), null);
});

test('audio, non-video, and requests without a user gesture are denied and consumed', () => {
  const { authorizer, frame, source, request } = captureFixture();
  for (const changes of [{ audioRequested: true }, { videoRequested: false }, { userGesture: false }]) {
    authorizer.select(frame, source);
    assert.equal(authorizer.take({ ...request, ...changes }, frame), null);
    assert.equal(authorizer.take(request, frame), null);
  }
});
