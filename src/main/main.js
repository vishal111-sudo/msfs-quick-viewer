'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell } = require('electron');

const { scanAll } = require('./scanner');
const { resolvePackagesRoot, candidateLocations } = require('./roots');
const { JsonStore, DEFAULT_SETTINGS } = require('./store');
const { ArtCache } = require('./art');
const { listSources, DEFAULT_SOURCE } = require('./art-sources');

const IMAGE_SCHEME = 'msfsart';

// Images live outside the app bundle (inside the sim's package folders and in
// userData), so they are served through a custom scheme rather than file://,
// and only from directories we explicitly allow.
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

let mainWindow = null;
let settings = null;
let artCache = null;
/** Most recent scan result, kept so IPC handlers can resolve aircraft by id. */
let lastScan = null;
/** Directories the image protocol is allowed to read from. */
const allowedRoots = new Set();

function allowRoot(dir) {
  if (dir) allowedRoots.add(path.resolve(dir).toLowerCase());
}

function isAllowedImagePath(target) {
  const resolved = path.resolve(target).toLowerCase();
  for (const root of allowedRoots) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

function encodeImagePath(filePath) {
  return `${IMAGE_SCHEME}://img/${Buffer.from(filePath, 'utf8').toString('base64url')}`;
}

function decodeImagePath(url) {
  const encoded = new URL(url).pathname.replace(/^\/+/, '');
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

function registerImageProtocol() {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    let filePath;
    try {
      filePath = decodeImagePath(request.url);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (!isAllowedImagePath(filePath)) return new Response('forbidden', { status: 403 });
    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

/**
 * Attach a servable image URL to every aircraft and livery in a scan result,
 * and resolve already-cached artwork up front.
 *
 * Artwork is fetched once and kept on disk, so on every later launch this
 * fills the grid straight from the cache with no network access and no
 * per-card round trip to the main process.
 */
async function decorateScan(result) {
  for (const install of result.installs) allowRoot(install.packagesRoot);

  let cachedArt = 0;
  for (const aircraft of result.aircraft) {
    aircraft.thumbnailUrl = aircraft.thumbnail ? encodeImagePath(aircraft.thumbnail) : null;
    for (const livery of aircraft.liveries) {
      livery.thumbnailUrl = livery.thumbnail ? encodeImagePath(livery.thumbnail) : null;
    }

    // A thumbnail the user chose outranks even the add-on's own artwork —
    // they asked for that picture specifically.
    const override = await artCache.findOverride(aircraft.id);
    if (override) {
      aircraft.art = { url: encodeImagePath(override), origin: 'override' };
      cachedArt += 1;
      continue;
    }

    // Otherwise the add-on's own thumbnail always wins over anything fetched.
    if (aircraft.thumbnailUrl) continue;

    const cached = await artCache.lookupCached(aircraft.id);
    if (!cached) continue;

    aircraft.art = {
      url: encodeImagePath(cached.file),
      origin: cached.origin,
      pageTitle: cached.pageTitle,
      pageUrl: cached.pageUrl,
      description: cached.description,
      attribution: cached.attribution,
      license: cached.license,
    };
    cachedArt += 1;
  }

  result.stats.artFromCache = cachedArt;
  return result;
}

function findAircraft(id) {
  if (!lastScan) return null;
  return lastScan.aircraft.find((aircraft) => aircraft.id === id) || null;
}

async function runScan() {
  const result = await scanAll({
    extraRoots: settings.get('extraRoots'),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan:progress', progress);
    },
  });
  lastScan = await decorateScan(result);
  return lastScan;
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.data);

  ipcMain.handle('settings:set', async (_event, patch) => {
    await settings.set(patch || {});
    return settings.data;
  });

  ipcMain.handle('scan:run', async () => runScan());

  ipcMain.handle('art:get', async (_event, aircraftId, options = {}) => {
    const aircraft = findAircraft(aircraftId);
    if (!aircraft) return null;

    if (!options.force) {
      const cached = await artCache.lookupCached(aircraftId);
      if (cached) return { url: encodeImagePath(cached.file), origin: cached.origin, ...cached, file: undefined };
    }

    if (settings.get('artSource') === 'off') return null;
    artCache.setSource(settings.get('artSource'));
    const fetched = await artCache.fetchFor(aircraft, { force: Boolean(options.force) });
    if (!fetched) return null;

    // Keep the scan copy in step so the grid repaints from the new artwork.
    aircraft.art = {
      url: encodeImagePath(fetched.file),
      origin: fetched.origin,
      pageTitle: fetched.pageTitle,
      pageUrl: fetched.pageUrl,
      description: fetched.description,
    };
    return { ...aircraft.art, ...fetched, url: aircraft.art.url, file: undefined };
  });

  ipcMain.handle('art:setOverride', async (_event, aircraftId) => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a thumbnail image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return null;

    const file = await artCache.setOverride(aircraftId, picked.filePaths[0]);
    return { url: encodeImagePath(file), origin: 'override' };
  });

  // Lets the user drop in any picture they like — an official screenshot, one
  // of their own, anything — without the app itself redistributing artwork.
  ipcMain.handle('art:pasteOverride', async (_event, aircraftId) => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;

    const file = await artCache.setOverrideFromBuffer(aircraftId, image.toPNG(), '.png');
    const aircraft = findAircraft(aircraftId);
    if (aircraft) aircraft.art = { url: encodeImagePath(file), origin: 'override' };
    return { url: encodeImagePath(file), origin: 'override' };
  });

  ipcMain.handle('art:clearOverride', async (_event, aircraftId) => artCache.clearOverride(aircraftId));

  ipcMain.handle('art:sources', () => ({
    sources: listSources(),
    current: settings.get('artSource') || DEFAULT_SOURCE,
  }));

  ipcMain.handle('art:cacheInfo', async () => artCache.size());

  ipcMain.handle('art:clearCache', async () => {
    await artCache.clear();
    return true;
  });

  ipcMain.handle('shell:openPath', async (_event, target) => {
    if (!target) return false;
    // Only ever open something we saw during a scan.
    if (!isAllowedImagePath(target)) return false;
    const error = await shell.openPath(target);
    return !error;
  });

  ipcMain.handle('shell:openExternal', async (_event, url) => {
    if (!/^https:\/\//i.test(url || '')) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('roots:add', async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Select your Community folder, or the folder that contains it',
      properties: ['openDirectory'],
    });
    if (picked.canceled || !picked.filePaths.length) return { added: false, reason: 'cancelled' };

    // Accept the Community folder itself as well as its parent.
    const root = resolvePackagesRoot(picked.filePaths[0]);
    if (!root) return { added: false, reason: 'not-a-packages-root', dir: picked.filePaths[0] };

    const extraRoots = [...new Set([...settings.get('extraRoots'), root])];
    await settings.set({ extraRoots });
    allowRoot(root);
    return { added: true, dir: root, extraRoots };
  });

  /** Where an install is looked for, so the app can say so when it finds none. */
  ipcMain.handle('roots:candidates', () => candidateLocations());

  ipcMain.handle('roots:remove', async (_event, dir) => {
    const extraRoots = settings.get('extraRoots').filter((root) => root !== dir);
    await settings.set({ extraRoots });
    return extraRoots;
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#12151b',
    show: false,
    autoHideMenuBar: true,
    title: 'MSFS Quick Viewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Nothing in this app should open a second window or navigate away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  await fsp.mkdir(userData, { recursive: true });

  settings = new JsonStore(path.join(userData, 'settings.json'), DEFAULT_SETTINGS);
  settings.load();

  // Older builds stored a boolean; carry that choice over.
  if (settings.get('artSource') === undefined || typeof settings.get('onlineArt') === 'boolean') {
    const legacy = settings.get('onlineArt');
    await settings.set({ artSource: legacy === false ? 'off' : settings.get('artSource') || DEFAULT_SOURCE });
  }

  artCache = new ArtCache(userData, settings.get('artSource'));
  await artCache.init();
  allowRoot(artCache.dir);
  allowRoot(artCache.overridesDir);
  for (const root of settings.get('extraRoots')) allowRoot(root);

  registerImageProtocol();
  registerIpc();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
