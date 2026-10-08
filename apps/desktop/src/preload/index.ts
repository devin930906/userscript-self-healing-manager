import {contextBridge,ipcRenderer,webUtils} from 'electron';
// Only the named operations are exposed. Browser JS never receives raw IPC or filesystem access.
const api={
 getAppInfo:()=>ipcRenderer.invoke('usshm:app-info'),
 pickFiles:():Promise<string[]>=>ipcRenderer.invoke('usshm:pick-files'),
 pickDirectory:():Promise<string|null>=>ipcRenderer.invoke('usshm:pick-directory'),
 grantDroppedFiles:(files:File[]):Promise<string[]>=>ipcRenderer.invoke('usshm:grant-drops',files.map(file=>webUtils.getPathForFile(file)).filter(Boolean)),
 scan:(request:{paths:string[];recursive:boolean})=>ipcRenderer.invoke('usshm:scan',request),
 listScripts:()=>ipcRenderer.invoke('usshm:list-scripts'),
 pickChrome:():Promise<string|null>=>ipcRenderer.invoke('usshm:pick-chrome'),
 launchChrome:()=>ipcRenderer.invoke('usshm:launch-chrome'),
 getCdpStatus:()=>ipcRenderer.invoke('usshm:cdp-status'),
 exportReport:(format:'json'|'markdown')=>ipcRenderer.invoke('usshm:export',format),
};
contextBridge.exposeInMainWorld('ussm',api);
