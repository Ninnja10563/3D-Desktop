'use strict';

const { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, session, shell, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { createTrustedPageMatcher, isSafeExternalUrl, createCaptureAuthorizer } = require('./security.cjs');

const runFile = promisify(execFile);
const applicationPage = path.join(__dirname, '..', 'dist', 'index.html');
const developmentUrl = !app.isPackaged ? process.env.DEPTH_DEV_URL : undefined;
const isTrustedPage = createTrustedPageMatcher({ filePath: applicationPage, developmentUrl });
const captures = createCaptureAuthorizer();
let mainWindow;
let appInventory = new Map();
let sourceInventory = new Map();
let sourceInventoryTime = 0;
let sessionConfigured = false;

// Keep the established profile directory so the product rename preserves notes,
// imported files, local storage, and Screen Recording-related session settings.
const legacyUserData = path.join(app.getPath('appData'), 'Depth');
mkdirSync(legacyUserData, { recursive: true });
app.setPath('userData', legacyUserData);
app.setName('3D Desktop');

function isTrustedContents(contents) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() &&
    contents === mainWindow.webContents && isTrustedPage(contents.getURL()));
}

function requireTrustedSender(event) {
  if (!isTrustedContents(event.sender) ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedPage(event.senderFrame.url)) {
    throw new Error('This action is only available from the 3D Desktop application.');
  }
}

function screenPermission() {
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
}

function screenPermissionError() {
  return new Error('Allow 3D Desktop in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen 3D Desktop.');
}

async function installedApps() {
  if (process.platform !== 'darwin') return [];
  const locations = ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications'];
  const found = new Map();
  async function scan(directory, depth) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { return; }
    await Promise.all(entries.filter((entry) => !entry.name.startsWith('.')).map(async (entry) => {
      const appPath = path.join(directory, entry.name);
      if (/\.app$/i.test(entry.name)) {
        try {
          if (!(await fs.stat(appPath)).isDirectory()) return;
          const id = createHash('sha256').update(appPath).digest('hex').slice(0, 24);
          found.set(id, { id, name: entry.name.slice(0, -4), path: appPath });
        } catch { /* An app may be removed while the inventory is loading. */ }
      } else if (entry.isDirectory() && depth > 0) {
        await scan(appPath, depth - 1);
      }
    }));
  }
  await Promise.all(locations.map((location) => scan(location, 2)));
  const finderPath = '/System/Library/CoreServices/Finder.app';
  try {
    await fs.access(finderPath);
    const id = createHash('sha256').update(finderPath).digest('hex').slice(0, 24);
    found.set(id, { id, name: 'Finder', path: finderPath });
  } catch { /* Finder is absent outside a standard macOS installation. */ }
  appInventory = found;
  return [...found.values()].filter((entry) => !['3D Desktop', 'Depth'].includes(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function sourcesForPicker() {
  const permission = screenPermission();
  if (permission === 'denied' || permission === 'restricted') throw screenPermissionError();
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 480, height: 300 },
      fetchWindowIcons: false,
    });
  } catch {
    throw screenPermissionError();
  }
  if (process.platform === 'darwin' && screenPermission() !== 'granted') throw screenPermissionError();
  // Capturing 3D Desktop itself causes an endless hall of mirrors.
  const ownWindowSource = mainWindow?.getMediaSourceId();
  sources = sources.filter((source) => source.id !== ownWindowSource);
  sourceInventory = new Map(sources.map((source) => [source.id, source]));
  sourceInventoryTime = Date.now();
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
  }));
}

function registerIpc() {
  const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    requireTrustedSender(event);
    return action(event, ...args);
  });
  handle('depth:get-apps', () => installedApps());
  handle('depth:open-app', async (_event, id) => {
    if (process.platform !== 'darwin') throw new Error('Opening installed applications is available in the Mac app.');
    if (typeof id !== 'string' || !appInventory.has(id)) throw new Error('Choose an app from your Applications list.');
    const selected = appInventory.get(id);
    try {
      await fs.access(selected.path);
      await runFile('/usr/bin/open', ['-a', selected.path], { timeout: 15_000 });
    } catch {
      throw new Error(`${selected.name} could not be opened. Refresh your Applications list and try again.`);
    }
  });
  handle('depth:get-sources', () => sourcesForPicker());
  handle('depth:select-source', (event, id) => {
    if (typeof id !== 'string' || !sourceInventory.has(id) || Date.now() - sourceInventoryTime > 120_000) {
      throw new Error('This window list has expired. Refresh it and choose a window again.');
    }
    if (['denied', 'restricted'].includes(screenPermission())) throw screenPermissionError();
    captures.select(event.senderFrame, sourceInventory.get(id));
  });
  handle('depth:screen-permission', () => screenPermission());
  handle('depth:screen-privacy', async () => {
    if (process.platform !== 'darwin') return;
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });
  handle('depth:toggle-fullscreen', () => {
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });
}

function configureSession(appSession) {
  const canUsePermission = (contents, permission, details) =>
    isTrustedContents(contents) && details?.isMainFrame === true &&
    isTrustedPage(details.requestingUrl || contents.getURL()) &&
    ['display-capture', 'fullscreen'].includes(permission);
  appSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    canUsePermission(contents, permission, details));
  appSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(canUsePermission(contents, permission, details)));
  appSession.setDevicePermissionHandler(() => false);
  appSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!mainWindow || !isTrustedContents(mainWindow.webContents) || !request.frame || !isTrustedPage(request.frame.url)) {
      callback(null);
      return;
    }
    const source = captures.take(request, mainWindow.webContents.mainFrame);
    callback(source ? { video: source } : null);
  }, { useSystemPicker: false });
  appSession.on('will-download', (event, item, contents, frame) => {
    // Local exports still go through a Save As dialog; arbitrary downloads are blocked.
    if (!isTrustedContents(contents) || frame !== contents.mainFrame || !item.getURL().startsWith('blob:')) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({
      title: 'Save from 3D Desktop',
      defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename()) || '3D Desktop export'),
    });
  });
  const developmentOrigin = developmentUrl ? new URL(developmentUrl).origin : '';
  const csp = [
    "default-src 'self'",
    `script-src 'self'${developmentUrl ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self'${developmentUrl ? ` ${developmentOrigin} ${developmentOrigin.replace('http:', 'ws:')}` : ''}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  appSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
  }));
}

async function createWindow() {
  const appSession = session.fromPartition('persist:depth');
  if (!sessionConfigured) {
    configureSession(appSession);
    sessionConfigured = true;
  }
  mainWindow = new BrowserWindow({
    title: '3D Desktop',
    width: 1512,
    height: 982,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#12181c',
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      session: appSession,
    },
  });
  const window = mainWindow;
  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedPage(url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) captures.clear();
  });
  window.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (isTrustedContents(window.webContents) && isSafeExternalUrl(url) &&
      ['foreground-tab', 'background-tab', 'new-window'].includes(disposition)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  window.on('closed', () => {
    captures.clear();
    sourceInventory.clear();
    mainWindow = undefined;
  });
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(applicationPage);
}

function setMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'reload' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    registerIpc();
    setMenu();
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(showLaunchError);
    });
  }).catch(showLaunchError);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

function showLaunchError(error) {
  dialog.showErrorBox('3D Desktop could not start', error.message);
  app.quit();
}
