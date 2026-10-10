import { contextBridge, ipcRenderer } from 'electron';

export interface AppInfo {
  name: string;
  version: string;
}

export interface UssmBridge {
  getAppInfo(): Promise<AppInfo>;
}

/** Fixed bridge: no generic send/invoke, raw ipcRenderer, or Node exposure. */
const bridge: Readonly<UssmBridge> = Object.freeze({
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('ussm:app-info'),
});

contextBridge.exposeInMainWorld('ussm', bridge);
