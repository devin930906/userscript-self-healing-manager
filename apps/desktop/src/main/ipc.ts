import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

export const APP_INFO_CHANNEL = 'ussm:app-info' as const;

export interface AppInfo {
  name: string;
  version: string;
}

export interface IpcDeps {
  window: Pick<BrowserWindow, 'isDestroyed' | 'webContents'>;
  getAppInfo?: () => AppInfo;
}

function isTrustedSender(event: IpcMainInvokeEvent, window: IpcDeps['window']): boolean {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  return event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame !== null
    && event.senderFrame.url.startsWith('file://')
    && event.senderFrame.url === window.webContents.getURL();
}

function validateAppInfo(value: unknown): AppInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid application information');
  }
  const info = value as Record<string, unknown>;
  if (typeof info.name !== 'string' || !info.name.trim() || info.name.length > 128
    || typeof info.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(info.version)) {
    throw new Error('Invalid application information');
  }
  return { name: info.name, version: info.version };
}

/** Register exactly one allowlisted request. Caller data is never trusted. */
export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.removeHandler(APP_INFO_CHANNEL);
  ipcMain.handle(APP_INFO_CHANNEL, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event, deps.window)) throw new Error('IPC sender not allowed');
    if (args.length !== 0) throw new Error('IPC payload not allowed');
    return validateAppInfo(deps.getAppInfo?.() ?? {
      name: app.getName(),
      version: app.getVersion(),
    });
  });
}

export function unregisterIpcHandlers(): void {
  ipcMain.removeHandler(APP_INFO_CHANNEL);
}
