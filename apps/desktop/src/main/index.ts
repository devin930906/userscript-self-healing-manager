import { app, BrowserWindow } from 'electron';
import { createSecureWindow } from './window';
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc';

let mainWindow: BrowserWindow | null = null;

function openApplication(): void {
  if (mainWindow && !mainWindow.isDestroyed()) return;
  const window = createSecureWindow();
  mainWindow = window;
  registerIpcHandlers({ window });
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
      unregisterIpcHandlers();
    }
  });
}

void app.whenReady().then(() => {
  openApplication();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openApplication();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', unregisterIpcHandlers);
