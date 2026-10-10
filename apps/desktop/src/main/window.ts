import { BrowserWindow, session } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface SecureWindowOptions {
  preloadPath?: string;
  rendererPath?: string;
}

/** Only bundled local application HTML may be loaded. No remote dev URL fallback. */
export function createSecureWindow(options: SecureWindowOptions = {}): BrowserWindow {
  const preload = resolve(options.preloadPath ?? join(__dirname, '../preload/index.js'));
  const renderer = resolve(options.rendererPath ?? join(__dirname, '../renderer/index.html'));
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 500,
    show: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Do not open links or popups, even in an external browser implicitly.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());

  // CSP is additionally declared in index.html. Never weaken it for development.
  const expectedUrl = pathToFileURL(renderer).href;
  window.webContents.on('did-finish-load', () => {
    if (window.webContents.getURL() !== expectedUrl) {
      window.webContents.stop();
      window.close();
    }
  });
  window.once('ready-to-show', () => window.show());
  void window.loadFile(renderer).catch(() => window.close());
  return window;
}
