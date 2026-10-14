'use strict';

const { pathToFileURL } = require('node:url');

/** Match one application document, never a hostname prefix or arbitrary file URL. */
function createTrustedPageMatcher({ filePath, developmentUrl }) {
  const expected = new URL(developmentUrl || pathToFileURL(filePath).href);
  if (developmentUrl && (
    expected.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) ||
    expected.username || expected.password
  )) throw new Error('DEPTH_DEV_URL must be a local HTTP development server.');
  return (value) => {
    try {
      const candidate = new URL(value);
      return candidate.protocol === expected.protocol &&
        candidate.host === expected.host &&
        candidate.pathname === expected.pathname &&
        candidate.search === expected.search &&
        !candidate.username && !candidate.password;
    } catch { return false; }
  };
}

function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

/** Short-lived grants tie a picker choice to one document and one capture request. */
function createCaptureAuthorizer(now = Date.now) {
  let selected;
  return {
    select(frame, source) {
      selected = { frame, source, expires: now() + 30_000 };
    },
    clear() { selected = undefined; },
    take(request, trustedFrame) {
      const selection = selected;
      if (!selection || request.frame !== trustedFrame || request.frame !== selection.frame) return null;
      selected = undefined;
      if (selection.expires < now() || !request.videoRequested || request.audioRequested || !request.userGesture) return null;
      return selection.source;
    },
  };
}

module.exports = { createTrustedPageMatcher, isSafeExternalUrl, createCaptureAuthorizer };
