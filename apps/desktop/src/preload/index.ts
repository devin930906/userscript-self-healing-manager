import {contextBridge,ipcRenderer,webUtils} from 'electron';
import {TrustedDropSequence} from './trusted-drop-sequence.ts';
// Only the named operations are exposed. Browser JS never receives raw IPC or filesystem access.
// A renderer-created File or string is not evidence of an OS drag.
// The isolated preload alone observes trusted native drop events.
type TrustedDropListener = (authorizedPaths:string[])=>void;
const trustedDropListeners=new Set<TrustedDropListener>();
const trustedDropSequence=new TrustedDropSequence();
window.addEventListener('drop',(event:DragEvent)=>{
 if(!event.isTrusted||!event.dataTransfer)return;
 const files=Array.from(event.dataTransfer.files).slice(0,50);
 const paths:string[]=[];
 for(const file of files){
  try{const path=webUtils.getPathForFile(file);if(path&&path.toLowerCase().endsWith('.user.js'))paths.push(path);}
  catch{/* Ignore browser-only File objects: no OS path evidence. */}
 }
 if(paths.length===0)return;
 const dropGeneration=trustedDropSequence.begin();
 void ipcRenderer.invoke('usshm:grant-drops',paths)
  .then((allowed:unknown)=>{
   if(!trustedDropSequence.isCurrent(dropGeneration)||!Array.isArray(allowed)||allowed.some(path=>typeof path!=='string'))return;
   for(const listener of trustedDropListeners){try{listener(allowed);}catch{/* A failed UI callback must not grant more paths. */}}
  })
  .catch(()=>{ /* Main denies unsafe/unreadable drops; no authorization created. */ });
},true);
const api={
 getAppInfo:()=>ipcRenderer.invoke('usshm:app-info'),
 getRepairQueueRecovery:()=>ipcRenderer.invoke('usshm:repair-queue-recovery'),
 getRepairQueueActivity:()=>ipcRenderer.invoke('usshm:repair-queue-activity'),
 cancelBatchRepair:(input:{proposalId:string})=>ipcRenderer.invoke('usshm:cancel-batch-repair',input),
 pauseBatchRepair:(input:{proposalId:string})=>ipcRenderer.invoke('usshm:pause-batch-repair',input),
 resumeBatchRepair:(input:{proposalId:string})=>ipcRenderer.invoke('usshm:resume-batch-repair',input),
 backupRegistry:()=>ipcRenderer.invoke('usshm:backup-registry'),
 backupJournal:()=>ipcRenderer.invoke('usshm:backup-journal'),
 exportManagedRecovery:()=>ipcRenderer.invoke('usshm:export-managed-recovery'),
 createCoreRecovery:()=>ipcRenderer.invoke('usshm:create-core-recovery'),
 verifyCoreRecovery:()=>ipcRenderer.invoke('usshm:verify-core-recovery'),
 verifyOfflineCoreStage:()=>ipcRenderer.invoke('usshm:verify-offline-core-stage'),
 stageCoreRecovery:()=>ipcRenderer.invoke('usshm:stage-core-recovery'),
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
 listBrowserProfiles:()=>ipcRenderer.invoke('usshm:list-browser-profiles'),
 browserProfileHealth:()=>ipcRenderer.invoke('usshm:browser-profile-health'),
 createBrowserProfile:(input:{name:string})=>ipcRenderer.invoke('usshm:create-browser-profile',input),
 renameBrowserProfile:(input:{profileId:string;name:string})=>ipcRenderer.invoke('usshm:rename-browser-profile',input),
 defaultBrowserProfile:(input:{profileId:string})=>ipcRenderer.invoke('usshm:default-browser-profile',input),
 removeBrowserProfile:(input:{profileId:string;approved:true})=>ipcRenderer.invoke('usshm:remove-browser-profile',input),
 launchBrowserProfile:(input:{profileId:string;approved:true})=>ipcRenderer.invoke('usshm:launch-browser-profile',input),

 launchChrome:()=>ipcRenderer.invoke('usshm:launch-chrome'),
 launchIsolatedChrome:()=>ipcRenderer.invoke('usshm:launch-isolated-chrome'),
 getCdpStatus:()=>ipcRenderer.invoke('usshm:cdp-status'),
 getManagerTargets:(input:{approved:true})=>ipcRenderer.invoke('usshm:manager-targets',input),
 observePageExceptions:(input:{targetId:string;approved:true})=>ipcRenderer.invoke('usshm:read-only-page-exceptions',input),
 probeLocators:(input:{scanId:string;itemIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:probe-locators',input),
 inspectElementVisibility:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:read-only-visibility',input),
 inspectEventListeners:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:read-only-event-listeners',input),
 waitUntilElementVisible:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:wait-until-visible',input),
 inspectInteractionReadiness:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:read-only-interaction-readiness',input),
 reviewProductAction:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;action:string;approved:true})=>ipcRenderer.invoke('usshm:product-action-review',input),
 approvedControlFocus:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:approved-control-focus',input),
 runDomContract:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;expectation:'exists'|'unique'|'count-changed';approved:true})=>ipcRenderer.invoke('usshm:run-dom-contract',input),
 observeManualDomTransition:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;phase:'start'|'finish';approved:true})=>ipcRenderer.invoke('usshm:manual-dom-transition',input),
 batchDiagnose:(input:{targetId:string;scanId:string;approved:true;offset:number})=>ipcRenderer.invoke('usshm:batch-diagnose',input),
 listDiagnosisHistory:():Promise<unknown>=>ipcRenderer.invoke('usshm:diagnosis-history'),
 cancelDiagnosis:(input:{scanId:string;targetId:string})=>ipcRenderer.invoke('usshm:diagnosis-cancel',input),
 suggestRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:suggest-repair',input),
 prepareVerifiedPreview:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:prepare-verified-preview',input),
 suggestRepairsBulk:(input:{scanId:string;itemIndex:number;targetId:string;approved:true;offset?:number})=>ipcRenderer.invoke('usshm:suggest-repairs-bulk',input),
 proposeRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;newSelector:string})=>ipcRenderer.invoke('usshm:propose-repair',input),
 proposeBatchRepair:(input:{scanId:string;itemIndex:number;changes:{selectorIndex:number;newSelector:string}[]})=>ipcRenderer.invoke('usshm:propose-batch-repair',input),
 applyMultiScriptBatch:(input:{scanId:string;jobs:{itemIndex:number;proposalId:string}[];approved:true;stopOnFailure?:boolean})=>ipcRenderer.invoke('usshm:apply-multi-script-batch',input),
 applyBatchRepair:(input:{scanId:string;itemIndex:number;proposalId:string;approved:true})=>ipcRenderer.invoke('usshm:apply-batch-repair',input),
 applyBatchRepairGuarded:(input:{scanId:string;itemIndex:number;proposalId:string;targetId:string;approved:true})=>ipcRenderer.invoke('usshm:apply-batch-repair-guarded',input),
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
