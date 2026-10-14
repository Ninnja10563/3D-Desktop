'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

async function boot() {
  const ipc = new Map();
  const commands = [];
  const externals = [];
  const errors = [];
  const profilePaths = [];
  const createdDirectories = [];
  let productName;
  let window;
  let permission = 'granted';
  const mockSession = new EventEmitter();
  mockSession.setPermissionCheckHandler = (handler) => { mockSession.check = handler; };
  mockSession.setPermissionRequestHandler = (handler) => { mockSession.request = handler; };
  mockSession.setDevicePermissionHandler = () => {};
  mockSession.setDisplayMediaRequestHandler = (handler) => { mockSession.capture = handler; };
  mockSession.webRequest = { onHeadersReceived() {} };
  const mockApp = Object.assign(new EventEmitter(), {
    isPackaged: true,
    setName: (name) => { productName = name; },
    setPath: (name, location) => { profilePaths.push([name, location]); },
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getPath: (name) => name === 'appData' ? '/Users/test/Library/Application Support' : '/Users/test/Downloads',
    quit() {},
  });
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: '' };
      this.webContents.getURL = () => this.webContents.mainFrame.url;
      this.webContents.setWindowOpenHandler = (handler) => { this.openWindow = handler; };
      window = this;
    }
    async loadFile(filename) { this.webContents.mainFrame.url = pathToFileURL(filename).href; }
    isDestroyed() { return false; }
    getMediaSourceId() { return 'window:depth:0'; }
    isFullScreen() { return false; }
    setFullScreen() {}
    show() {}
    static getAllWindows() { return [window]; }
  }
  const fakeElectron = {
    app: mockApp,
    BrowserWindow: FakeWindow,
    Menu: { buildFromTemplate: (template) => template, setApplicationMenu() {} },
    ipcMain: { handle: (name, handler) => ipc.set(name, handler) },
    session: { fromPartition: () => mockSession },
    desktopCapturer: { getSources: async () => [{
      id: 'window:1:0', name: 'Example window',
      thumbnail: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,example' },
    }] },
    dialog: { showErrorBox: (...args) => errors.push(args) },
    shell: { openExternal: async (url) => { externals.push(url); } },
    systemPreferences: { getMediaAccessStatus: () => permission },
  };
  const fakeFs = {
    readdir: async (folder) => folder === '/Applications' ? [{
      name: 'Example; echo unsafe.app', isDirectory: () => true,
    }] : [],
    stat: async () => ({ isDirectory: () => true }),
    access: async () => {},
  };
  const scopedRequire = (name) => {
    if (name === 'electron') return fakeElectron;
    if (name === 'node:fs') return { mkdirSync: (location) => { createdDirectories.push(location); } };
    if (name === 'node:fs/promises') return fakeFs;
    if (name === 'node:child_process') return {
      execFile: (file, args, options, callback) => {
        commands.push({ file, args, options });
        callback(null, '', '');
      },
    };
    return require(name);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), {
    require: scopedRequire,
    __dirname,
    process: { platform: 'darwin', env: {} },
    console,
    URL,
  }, { filename: 'electron/main.cjs' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, []);
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return {
    window, ipc, commands, externals, mockSession, event, productName, profilePaths, createdDirectories,
    invoke: (name, ...args) => ipc.get(`depth:${name}`)(event, ...args),
    setPermission: (value) => { permission = value; },
  };
}

test('product rename retains the existing user profile directory', async () => {
  const { productName, profilePaths, createdDirectories, window } = await boot();
  assert.equal(productName, '3D Desktop');
  assert.equal(window.options.title, '3D Desktop');
  assert.deepEqual(profilePaths, [['userData', '/Users/test/Library/Application Support/Depth']]);
  assert.deepEqual(createdDirectories, ['/Users/test/Library/Application Support/Depth']);
});

test('native shell enables the sandbox and denies untrusted IPC frames', async () => {
  const { window, ipc, event } = await boot();
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.throws(() => ipc.get('depth:get-apps')({ ...event, senderFrame: { url: event.senderFrame.url } }), /only available/);
  window.webContents.mainFrame.url = 'https://example.com/';
  assert.throws(() => ipc.get('depth:get-apps')(event), /only available/);
});

test('app launch accepts inventory IDs and passes paths as literal arguments without a shell', async () => {
  const { invoke, commands } = await boot();
  await assert.rejects(invoke('open-app', '/Applications/Terminal.app'), /Choose an app/);
  const apps = await invoke('get-apps');
  const selected = apps.find((entry) => entry.name.startsWith('Example'));
  await invoke('open-app', selected.id);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].file, '/usr/bin/open');
  assert.deepEqual(Array.from(commands[0].args), ['-a', '/Applications/Example; echo unsafe.app']);
  assert.equal(commands[0].options.shell, undefined);
});

test('native picker only captures the selected source once', async () => {
  const { invoke, mockSession, event } = await boot();
  const request = { frame: event.senderFrame, videoRequested: true, audioRequested: false, userGesture: true };
  const capture = () => new Promise((resolve) => mockSession.capture(request, resolve));
  assert.equal(await capture(), null);
  assert.throws(() => invoke('select-source', 'window:not-listed:0'), /expired/);
  const [source] = await invoke('get-sources');
  await invoke('select-source', source.id);
  assert.equal((await capture()).video.id, source.id);
  assert.equal(await capture(), null);
});

test('denied screen recording permission produces actionable guidance', async () => {
  const { invoke, setPermission, externals } = await boot();
  setPermission('denied');
  await assert.rejects(invoke('get-sources'), /Privacy & Security.*quit and reopen/);
  await invoke('screen-privacy');
  assert.deepEqual(externals, ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture']);
});

test('permission checks allow only capture/fullscreen from the application main frame', async () => {
  const { mockSession, window, event } = await boot();
  const details = { isMainFrame: true, requestingUrl: event.senderFrame.url };
  assert.equal(mockSession.check(window.webContents, 'display-capture', 'file://', details), true);
  assert.equal(mockSession.check(window.webContents, 'media', 'file://', details), false);
  assert.equal(mockSession.check(window.webContents, 'clipboard-read', 'file://', details), false);
  assert.equal(mockSession.check(window.webContents, 'display-capture', 'file://', { ...details, isMainFrame: false }), false);
});

test('only local exports from the application main frame reach Save As', async () => {
  const { mockSession, window, event } = await boot();
  let denied = false;
  let options;
  const downloadEvent = { preventDefault: () => { denied = true; } };
  const item = {
    getURL: () => 'blob:file:///some-local-generated-content',
    getFilename: () => '../../notes.txt',
    setSaveDialogOptions: (value) => { options = value; },
  };
  mockSession.emit('will-download', downloadEvent, item, window.webContents, event.senderFrame);
  assert.equal(denied, false);
  assert.equal(options.defaultPath, '/Users/test/Downloads/notes.txt');
  mockSession.emit('will-download', downloadEvent, { ...item, getURL: () => 'https://example.com/file' }, window.webContents, event.senderFrame);
  assert.equal(denied, true);
});
