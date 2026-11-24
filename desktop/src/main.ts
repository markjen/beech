import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  getAuthTicket,
  initSteam,
  isSteamDeck,
  isSteamReady,
  onMicroTxnResponse,
  openOverlayUrl,
  setRichPresence,
  unlockAchievement,
} from './steam';

const APP_SCHEME = 'app';
const APP_HOST = 'beech';

// Allow passing STEAM_APP_ID at build/launch time (480 = Spacewar test app in dev).
const parsedAppId = Number(process.env.STEAM_APP_ID ?? '');
const STEAM_APP_ID = Number.isInteger(parsedAppId) && parsedAppId > 0 ? parsedAppId : null;

// Must run before app.whenReady() so Steam Overlay attaches to Chromium's GPU process.
const shouldContinue = initSteam(STEAM_APP_ID, app.isPackaged && STEAM_APP_ID !== null);
if (!shouldContinue) {
  app.quit();
  process.exit(0);
}

// Register `app://beech/` as a privileged secure origin so ES module Web Workers,
// localStorage, IndexedDB, and fetch CORS behave identically to HTTPS.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function webRoot(): string {
  // Packaged via electron-builder (`web/` inside app.asar); dev reads `../dist`.
  if (app.isPackaged) return path.join(app.getAppPath(), 'web');
  return path.resolve(__dirname, '..', '..', 'dist');
}

function registerAppProtocol(): void {
  const root = webRoot();
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const relPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const resolved = path.resolve(root, `.${relPath}`);
    if (!resolved.startsWith(root)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

function isSafeExternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const deck = isSteamDeck();
  const win = new BrowserWindow({
    width: deck ? 1280 : 1280,
    height: deck ? 800 : 800,
    minWidth: 800,
    minHeight: 540,
    title: 'beech',
    backgroundColor: '#f7ead9',
    autoHideMenuBar: true,
    fullscreen: deck,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Never navigate the game window to external URLs; route them to Steam Overlay or OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      if (!openOverlayUrl(url)) void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // F11 / Alt+Enter fullscreen toggle for desktop players.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isF11 = input.key === 'F11';
    const isAltEnter = input.alt && input.key === 'Enter';
    if (isF11 || isAltEnter) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  const devUrl = process.env.BEECH_DEV_URL;
  if (devUrl && !app.isPackaged) {
    void win.loadURL(devUrl);
  } else {
    void win.loadURL(`${APP_SCHEME}://${APP_HOST}/`);
  }

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerAppProtocol();

  ipcMain.handle('steam:info', () => ({
    platform: process.platform,
    steamDeck: isSteamDeck(),
    steamReady: isSteamReady(),
  }));

  ipcMain.handle('steam:getAuthTicket', () => getAuthTicket('beech'));
  ipcMain.on('steam:unlockAchievement', (_ev, id: unknown) => {
    if (typeof id === 'string' && id) unlockAchievement(id);
  });
  ipcMain.on('steam:setRichPresence', (_ev, key: unknown, value: unknown) => {
    if (typeof key === 'string' && typeof value === 'string') setRichPresence(key, value);
  });
  ipcMain.on('steam:openExternal', (_ev, url: unknown) => {
    if (typeof url === 'string' && isSafeExternalUrl(url)) {
      if (!openOverlayUrl(url)) void shell.openExternal(url);
    }
  });
  ipcMain.handle('window:toggleFullscreen', () => {
    if (!mainWindow) return false;
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });
  ipcMain.handle('window:isFullscreen', () => mainWindow?.isFullScreen() ?? false);
  ipcMain.on('app:quit', () => app.quit());

  ipcMain.handle('file:saveBeach', async (_ev, suggestedName: unknown, text: unknown) => {
    if (typeof suggestedName !== 'string' || typeof text !== 'string') return false;
    const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
      defaultPath: suggestedName,
      filters: [{ name: 'beech file', extensions: ['beach.json', 'json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, text, 'utf8');
    return true;
  });

  onMicroTxnResponse((ev) => {
    mainWindow?.webContents.send('steam:microTxnResponse', ev);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
