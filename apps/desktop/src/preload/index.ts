import {contextBridge,ipcRenderer,webUtils} from 'electron';
// Only the named operations are exposed. Browser JS never receives raw IPC or filesystem access.
// A renderer-created File or string is not evidence of an OS drag.
// The isolated preload alone observes trusted native drop events.
type TrustedDropListener = (authorizedPaths:string[])=>void;
const trustedDropListeners=new Set<TrustedDropListener>();
window.addEventListener('drop',(event:DragEvent)=>{
 if(!event.isTrusted||!event.dataTransfer)return;
 const files=Array.from(event.dataTransfer.files).slice(0,50);
 const paths:string[]=[];
 for(const file of files){
  try{const path=webUtils.getPathForFile(file);if(path&&path.toLowerCase().endsWith('.user.js'))paths.push(path);}
  catch{/* Ignore browser-only File objects: no OS path evidence. */}
 }
 if(paths.length===0)return;
 void ipcRenderer.invoke('usshm:grant-drops',paths)
  .then((allowed:unknown)=>{
   if(!Array.isArray(allowed)||allowed.some(path=>typeof path!=='string'))return;
   for(const listener of trustedDropListeners){try{listener(allowed);}catch{/* A failed UI callback must not grant more paths. */}}
  })
  .catch(()=>{ /* Main denies unsafe/unreadable drops; no authorization created. */ });
},true);
const api={
 getAppInfo:()=>ipcRenderer.invoke('usshm:app-info'),
 pickFiles:():Promise<string[]>=>ipcRenderer.invoke('usshm:pick-files'),
 pickDirectory:():Promise<string|null>=>ipcRenderer.invoke('usshm:pick-directory'),
 onTrustedDrop:(listener:TrustedDropListener):(()=>void)=>{
  if(typeof listener!=='function')throw new TypeError('Expected a drop listener');
  trustedDropListeners.add(listener);
  return ()=>{trustedDropListeners.delete(listener);};
 },
 scan:(request:{paths:string[];recursive:boolean})=>ipcRenderer.invoke('usshm:scan',request),
 listScripts:()=>ipcRenderer.invoke('usshm:list-scripts'),
 listSiteAdapters:()=>ipcRenderer.invoke('usshm:site-adapters'),
 previewSiteAdapterImport:()=>ipcRenderer.invoke('usshm:site-adapter-import-preview'),
 approveSiteAdapterImport:(input:{previewId:string;approved:true})=>ipcRenderer.invoke('usshm:site-adapter-import-approve',input),
 discardSiteAdapterPreview:(input:{previewId:string})=>ipcRenderer.invoke('usshm:site-adapter-import-discard',input),
 inspectSiteAdapterRole:(input:{siteId:string;expectedSha256:string;roleId:string;declaredStateId:string;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:site-adapter-role-check',input),
 suggestSiteAdapterRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;siteId:string;expectedSha256:string;roleId:string;declaredStateId:string;approved:true})=>ipcRenderer.invoke('usshm:site-adapter-suggest-repair',input),
 pickChrome:():Promise<string|null>=>ipcRenderer.invoke('usshm:pick-chrome'),
 launchChrome:()=>ipcRenderer.invoke('usshm:launch-chrome'),
 launchIsolatedChrome:()=>ipcRenderer.invoke('usshm:launch-isolated-chrome'),
 getCdpStatus:()=>ipcRenderer.invoke('usshm:cdp-status'),
 probeLocators:(input:{scanId:string;itemIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:probe-locators',input),
 inspectElementVisibility:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:read-only-visibility',input),
 runDomContract:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;expectation:'exists'|'unique';approved:true})=>ipcRenderer.invoke('usshm:run-dom-contract',input),
 batchDiagnose:(input:{targetId:string;scanId:string;approved:true;offset:number})=>ipcRenderer.invoke('usshm:batch-diagnose',input),
 listDiagnosisHistory:():Promise<unknown>=>ipcRenderer.invoke('usshm:diagnosis-history'),
 cancelDiagnosis:(input:{scanId:string;targetId:string})=>ipcRenderer.invoke('usshm:diagnosis-cancel',input),
 suggestRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:suggest-repair',input),
 prepareVerifiedPreview:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:prepare-verified-preview',input),
 suggestRepairsBulk:(input:{scanId:string;itemIndex:number;targetId:string;approved:true;offset?:number})=>ipcRenderer.invoke('usshm:suggest-repairs-bulk',input),
 proposeRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;newSelector:string})=>ipcRenderer.invoke('usshm:propose-repair',input),
 applyRepair:(input:{scanId:string;proposalId:string;approved:true})=>ipcRenderer.invoke('usshm:apply-repair',input),
 applyRepairGuarded:(input:{scanId:string;proposalId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:apply-repair-guarded',input),
 verifyManagedDom:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;revisionHash:string;approved:true})=>ipcRenderer.invoke('usshm:verify-managed-dom',input),
 inspectManagedIntegrity:(input:{scanId:string;itemIndex:number})=>ipcRenderer.invoke('usshm:managed-health',input),
 listManagedRevisions:(input:{scanId:string;itemIndex:number})=>ipcRenderer.invoke('usshm:managed-revisions',input),
 rollbackManaged:(input:{scanId:string;itemIndex:number;hash:string;approved:true})=>ipcRenderer.invoke('usshm:rollback-managed',input),
 exportManaged:(input:{scanId:string;itemIndex:number})=>ipcRenderer.invoke('usshm:export-managed',input),
 exportReport:(format:'json'|'markdown')=>ipcRenderer.invoke('usshm:export',format),
 exportDomReport:(input:{scanId:string;targetId:string;format:'json'|'markdown'})=>ipcRenderer.invoke('usshm:export-dom-report',input),
};
contextBridge.exposeInMainWorld('ussm',api);
