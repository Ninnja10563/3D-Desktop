import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangeWindows, DEFAULT_CAMERA, DEFAULT_WINDOWS, readWorkspace, sanitizeWorkspace } from '../src/workspace.ts';

const copy = (value) => structuredClone(value);

test('a fresh or corrupt workspace receives independent default windows and camera', () => {
  for (const value of [undefined, null, false, 15, 'invalid', { windows: 'invalid', camera: [] }]) {
    const workspace = sanitizeWorkspace(value);
    assert.deepEqual(workspace.windows, DEFAULT_WINDOWS);
    assert.deepEqual(workspace.camera, DEFAULT_CAMERA);
    assert.notEqual(workspace.windows, DEFAULT_WINDOWS);
    assert.notEqual(workspace.windows[0], DEFAULT_WINDOWS[0]);
    assert.notEqual(workspace.camera, DEFAULT_CAMERA);
  }
});

test('an intentionally empty workspace stays empty after reload', () => {
  assert.deepEqual(sanitizeWorkspace({ windows: [] }).windows, []);
});

test('saved workspaces exclude unknown apps, capture sessions, and duplicate app identities', () => {
  const saved = {
    windows: [null, false, 'notes', { type: ['notes'] }, { type: { toString: null } },
      { type: 'capture', id: 'capture-secret', appId: 'private-source' },
      { type: 'unknown' }, { type: 'notes', id: 'spoofed', title: '<script>', x: 25, appId: 'leaked-source' },
      { type: 'notes', x: 600 }, { type: 'calculator', id: 'notes', minimized: true }],
  };
  const result = sanitizeWorkspace(saved);
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].id, 'notes');
  assert.equal(result.windows[0].title, 'Notes');
  assert.equal(result.windows[0].x, 25);
  assert.equal('appId' in result.windows[0], false);
  assert.equal(result.windows[1].id, 'calculator');
  assert.equal(result.windows[1].title, 'Calculator');
  assert.equal(result.windows[1].minimized, true);
});

test('untrusted saved geometry is clamped and cannot introduce non-finite scene transforms', () => {
  const result = sanitizeWorkspace({
    windows: [{ type: 'files', x: 1e6, y: -1e6, z: 1e6, width: -200, height: 1e6, tilt: 1e6, minimized: 'true' },
      { type: 'focus', x: NaN, y: Infinity, z: '-500', width: null, height: {}, tilt: undefined }],
    camera: { rx: -1e6, ry: 1e6, zoom: 0 },
  });
  assert.deepEqual(result.windows[0], {
    id: 'files', type: 'files', title: 'Files', x: 1100, y: -700, z: 350,
    width: 280, height: 700, tilt: 35, minimized: false,
  });
  assert.deepEqual(result.windows[1], {
    id: 'focus', type: 'focus', title: 'Focus', x: 0, y: 0, z: 0,
    width: 440, height: 350, tilt: 0, minimized: false,
  });
  assert.deepEqual(result.camera, { rx: -25, ry: 40, zoom: 0.45 });
  assert.deepEqual(sanitizeWorkspace({ camera: { rx: '0', ry: Infinity, zoom: null } }).camera, DEFAULT_CAMERA);
});

test('a valid saved workspace round-trips without mutating the input', () => {
  const saved = { windows: copy(DEFAULT_WINDOWS), camera: { rx: -4, ry: 25, zoom: 1.15 } };
  saved.windows[0].minimized = true;
  saved.windows[1].x = -97;
  const before = copy(saved);
  assert.deepEqual(sanitizeWorkspace(saved), before);
  assert.deepEqual(saved, before);
});

test('readWorkspace recovers from damaged JSON and blocked storage', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  for (const storage of [{ getItem: () => '{broken' }, { getItem: () => { throw new Error('Storage denied'); } }]) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    assert.deepEqual(readWorkspace(), { windows: DEFAULT_WINDOWS, camera: DEFAULT_CAMERA });
  }
  const saved = { windows: [], camera: { rx: 3, ry: 8, zoom: 1 } };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => { assert.equal(key, 'depth.workspace.v1'); return JSON.stringify(saved); } },
  });
  assert.deepEqual(readWorkspace(), saved);
});

test('grid centers visible windows, preserves dimensions, and never changes minimized windows', () => {
  const windows = copy(DEFAULT_WINDOWS);
  windows[1].minimized = true;
  const before = copy(windows);
  const arranged = arrangeWindows(windows, 'grid');
  assert.deepEqual(windows, before);
  assert.deepEqual(arranged[1], before[1]);
  assert.deepEqual(arranged.map(({ x, y, z, tilt }) => ({ x, y, z, tilt })), [
    { x: -270, y: 0, z: 0, tilt: 0 },
    { x: before[1].x, y: before[1].y, z: before[1].z, tilt: before[1].tilt },
    { x: 270, y: 0, z: 0, tilt: 0 },
  ]);
  for (let i = 0; i < windows.length; i++) {
    assert.equal(arranged[i].width, windows[i].width);
    assert.equal(arranged[i].height, windows[i].height);
    assert.equal(arranged[i].id, windows[i].id);
  }
});

test('grid spaces uneven windows far enough apart to avoid overlapping', () => {
  const windows = [...copy(DEFAULT_WINDOWS), { ...DEFAULT_WINDOWS[0], id: 'calculator', type: 'calculator', width: 600, height: 400 }];
  const result = arrangeWindows(windows, 'grid');
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i];
      const b = result[j];
      const horizontalSeparation = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
      const verticalSeparation = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
      assert.ok(horizontalSeparation >= 40 || verticalSeparation >= 40, `${a.id} overlaps ${b.id}`);
    }
  }
});

test('cascade is deterministic, ordered in depth, and excludes minimized windows from spacing', () => {
  const windows = copy(DEFAULT_WINDOWS);
  windows[1].minimized = true;
  const before = copy(windows);
  const result = arrangeWindows(windows, 'cascade');
  assert.deepEqual(result, arrangeWindows(windows, 'cascade'));
  assert.deepEqual(windows, before);
  assert.deepEqual(result[1], before[1]);
  assert.equal(result[0].x, -125);
  assert.equal(result[2].x, 125);
  assert.equal(result[0].z, 150);
  assert.equal(result[2].z, 25);
  assert.equal(result[0].y, -37.5);
  assert.equal(result[2].y, 37.5);
});

test('arranging empty and fully minimized workspaces is safe', () => {
  for (const mode of ['grid', 'cascade']) {
    assert.deepEqual(arrangeWindows([], mode), []);
    const minimized = DEFAULT_WINDOWS.map((window) => ({ ...window, minimized: true }));
    assert.deepEqual(arrangeWindows(minimized, mode), minimized);
  }
});
