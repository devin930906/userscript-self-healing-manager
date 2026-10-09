import {app,BrowserWindow,dialog,ipcMain,shell} from 'electron';
import {dirname,join,resolve,relative,isAbsolute,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../../../packages/runtime-paths/src/pinned-file.ts';
import {createHash} from 'node:crypto';
import {resolveDataRoot,ensureWritableDataRoot,type DistributionMode} from '../../../../packages/runtime-paths/src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../../../packages/persistence/src/index.ts';
import {openDiagnosisJournal} from '../../../../packages/job-journal/src/index.ts';
import {runStaticScan,type ScanBatchResult} from '../../../../packages/scan-service/src/index.ts';
import {ScanSessionCoordinator} from '../../../../packages/scan-service/src/scan-session.ts';
import {DiagnosisRequestGate} from '../../../../packages/scan-service/src/diagnosis-request-gate.ts';
import {isTransientCdpReadError} from '../../../../packages/scan-service/src/paginated-dom.ts';
import {serializeStaticReport} from '../../../../packages/reporting/src/index.ts';
import {serializeDomBatchReport} from '../../../../packages/reporting/src/dom-report.ts';
import {writeExclusiveReport} from '../../../../packages/reporting/src/exclusive-report.ts';
import {BatchEvidenceStore} from '../../../../packages/scan-service/src/batch-evidence-store.ts';
import {getVerifiedChromeStatus,launchSelectedChrome} from '../../../../packages/cdp-client/src/index.ts';
import {loadPreferredChromePath,savePreferredChromePath} from '../../../../packages/cdp-client/src/preferred-chrome.ts';
import {listBrowserProfiles,createBrowserProfile,renameBrowserProfile,setDefaultBrowserProfile,removeBrowserProfile,resolveBrowserProfileForLaunch,inspectBrowserProfileRegistry} from '../../../../packages/cdp-client/src/browser-profiles.ts';
import {captureDomSummary} from '../../../../packages/cdp-client/src/snapshot.ts';
import {probePageLocators} from '../../../../packages/cdp-client/src/locator-probe.ts';
import {inspectReadOnlyElementVisibility,qualifyTopDocumentVisibility} from '../../../../packages/cdp-client/src/read-only-visibility.ts';
import {inspectReadOnlyEventListeners} from '../../../../packages/cdp-client/src/read-only-event-listeners.ts';
import {confirmPageIdentity,assertStablePageDocument} from '../../../../packages/cdp-client/src/page-identity.ts';
import {createRepairWorkflow} from '../../../../packages/repair-workflow/src/index.ts';
import {prepareVerifiedRepairPreview} from '../../../../packages/repair-workflow/src/verified-preview.ts';
import {readVerifiedManagedLocator} from '../../../../packages/repair-workflow/src/managed-locator.ts';
import {guardAppliedManagedRevision} from '../../../../packages/repair-workflow/src/guarded-v1.ts';
import {ProposalApprovalGate} from '../../../../packages/repair-workflow/src/proposal-approval.ts';
import {listManagedRevisions} from '../../../../packages/repair-workflow/src/history.ts';
import {inspectManagedIntegrity} from '../../../../packages/repair-workflow/src/managed-health.ts';
import {exportManagedCurrent} from '../../../../packages/repair-workflow/src/export.ts';
import {captureCandidateNodes} from '../../../../packages/cdp-client/src/candidate-snapshot.ts';
import {suggestCandidateRepairs,suggestAdapterScopedRepairs} from '../../../../packages/candidate-engine/src/workflow.ts';
import {suggestMissingCandidatesBulk} from '../../../../packages/candidate-engine/src/bulk.ts';
import {checkUserscriptPageScope} from '../../../../packages/candidate-engine/src/page-scope.ts';
import {createSiteAdapterLibrary} from '../../../../packages/candidate-engine/src/site-adapter-library.ts';
import {diagnoseScriptsOnPage} from '../../../../packages/scan-service/src/batch-dom.ts';
import {runReadOnlyDomContract} from '../../../../packages/test-runner/src/index.ts';
import {runSiteAdapterRoleDomCheck} from '../../../../packages/test-runner/src/site-adapter-role.ts';

let mainWindow:BrowserWindow;
let lastScan:(ScanBatchResult&{scanId:string})|null=null;
const scanSessions=new ScanSessionCoordinator<ScanBatchResult>();
const batchEvidence=new BatchEvidenceStore();
const diagnosisRequests=new DiagnosisRequestGate();
const pendingApprovals=new ProposalApprovalGate();
const authorizedRoots=new Set<string>();
let approvedChromePath:string|null=null;
function distributionMode():DistributionMode{
 if(process.env.PORTABLE_EXECUTABLE_DIR)return 'portable-exe';
 if(app.isPackaged&&existsSync(join(dirname(process.execPath),'.usshm-portable')))return 'portable-zip';
 return 'installed';
}
function withinAuthorized(path:string):boolean{
 const normalized=resolve(path);
 for(const root of authorizedRoots){const rel=relative(root,normalized);if(rel===''||(!rel.startsWith('..')&&!isAbsolute(rel)))return true;}
 return false;
}
function assertSender(event:Electron.IpcMainInvokeEvent):void{
 if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)
  throw new Error('Untrusted IPC sender');
 // A generic file:// prefix would also authorize some OTHER local HTML file.
 // Bind every privileged IPC operation to the exact app document which
 // createWindow() loads; refuse dev servers and arbitrary same-scheme pages.
 const trustedUrl=pathToFileURL(join(__dirname,'index.html')).href;
 if(event.sender.getURL()!==trustedUrl||event.senderFrame.url!==trustedUrl)
  throw new Error('Untrusted renderer document URL');
}
function createWindow():BrowserWindow{
 const window=new BrowserWindow({width:1320,height:860,minWidth:960,minHeight:650,
   show:false,backgroundColor:'#0b1020',autoHideMenuBar:true,
   webPreferences:{preload:join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 window.once('ready-to-show',()=>window.show());
 window.loadFile(join(__dirname,'index.html'));
 return window;
}
async function bootstrap():Promise<void>{
 const originalUserData=app.getPath('userData');const mode=distributionMode();
 const dataRoot=resolveDataRoot({distributionMode:mode,exeDirectory:dirname(process.execPath),osUserDataDirectory:originalUserData,portableExternalDirectory:process.env.PORTABLE_EXECUTABLE_DIR});
 await ensureWritableDataRoot(dataRoot);
 app.setPath('userData',dataRoot);
 await app.whenReady();
 approvedChromePath=await loadPreferredChromePath({dataRoot});
 const db=openDatabase(join(dataRoot,'registry.sqlite'));migrateDatabase(db);
 const journal=openDiagnosisJournal(join(dataRoot,'diagnosis-journal.sqlite'));
 const repository=createScriptRepository(db);
 const repairs=createRepairWorkflow({managedRoot:dataRoot});
 const adapters=createSiteAdapterLibrary({dataRoot});
 app.on('before-quit',()=>{db.close();journal.close();});
 mainWindow=createWindow();
 ipcMain.handle('usshm:app-info',event=>{assertSender(event);return {version:app.getVersion(),distributionMode:mode,dataRoot,preferredChromePath:approvedChromePath};});
 ipcMain.handle('usshm:pick-files',async event=>{assertSender(event);const x=await dialog.showOpenDialog(mainWindow,{properties:['openFile','multiSelections'],filters:[{name:'UserScript',extensions:['js']} ]});
 if(x.canceled)return [];for(const path of x.filePaths)authorizedRoots.add(resolve(path));return x.filePaths;});
 ipcMain.handle('usshm:pick-directory',async event=>{assertSender(event);const x=await dialog.showOpenDialog(mainWindow,{properties:['openDirectory']});if(x.canceled)return null;
 const selected=x.filePaths[0]??null;if(selected)authorizedRoots.add(resolve(selected));return selected;});
 ipcMain.handle('usshm:grant-drops',async (event,paths:unknown)=>{assertSender(event);if(!Array.isArray(paths)||paths.length>50)throw new Error('Invalid drop list');
 const granted:string[]=[];for(const p of paths){if(typeof p!=='string'||!isAbsolute(p)||!p.toLowerCase().endsWith('.user.js'))continue;
 const stat=await lstat(p).catch(()=>null);if(stat?.isFile()&&stat.size<=512*1024){authorizedRoots.add(resolve(p));granted.push(resolve(p));}}return granted;});
 ipcMain.handle('usshm:scan',async(event,input:unknown)=>{assertSender(event);
 if(!input||typeof input!=='object')throw new Error('Invalid scan request');const q=input as Record<string,unknown>;
 if(!Array.isArray(q.paths)||q.paths.length>1000||q.paths.some(x=>typeof x!=='string'||!withinAuthorized(x)))throw new Error('Paths not authorized by file picker');
 if(typeof q.recursive!=='boolean')throw new Error('Invalid recursive flag');
 const scanPaths=q.paths as string[],recursive=q.recursive as boolean;
 diagnosisRequests.invalidateAll();
 journal.interruptRunning();
 batchEvidence.clear(); // A new scan revokes any previously collected DOM evidence immediately.
 lastScan=await scanSessions.replace(()=>runStaticScan({paths:scanPaths,recursive,maxFiles:1000},{repository}));
 pendingApprovals.clear();repairs.invalidatePending();return lastScan;});
 ipcMain.handle('usshm:list-scripts',event=>{assertSender(event);return repository.list();});
 ipcMain.handle('usshm:site-adapters',async event=>{
  assertSender(event);
  // Return only bounded, parsed site metadata, never local source paths.
  return adapters.list();
 });
 ipcMain.handle('usshm:site-adapter-import-preview',async event=>{
  assertSender(event);
  // The renderer cannot specify an import path or arbitrary JSON object.
  // Only a fresh native OS file-picker selection is accepted.
  const pick=await dialog.showOpenDialog(mainWindow,{
   properties:['openFile'],filters:[{name:'SiteAdapter JSON',extensions:['json']}],
  });
  if(pick.canceled||!pick.filePaths[0])return null;
  return adapters.previewImport({sourcePath:pick.filePaths[0]});
 });
 ipcMain.handle('usshm:site-adapter-import-approve',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {previewId?:unknown;approved?:unknown}|null;
  if(!q||q.approved!==true||typeof q.previewId!=='string')
   throw new Error('Explicit SiteAdapter import approval required');
  return adapters.approveImport({previewId:q.previewId,approved:true});
 });
 ipcMain.handle('usshm:site-adapter-import-discard',(event,input:unknown)=>{
  assertSender(event);
  const q=input as {previewId?:unknown}|null;
  if(!q||typeof q.previewId!=='string')throw new Error('Invalid SiteAdapter preview cancellation');
  return {discarded:adapters.discardPreview({previewId:q.previewId})};
 });
 ipcMain.handle('usshm:site-adapter-role-check',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {approved?:unknown;siteId?:unknown;expectedSha256?:unknown;roleId?:unknown;declaredStateId?:unknown;targetId?:unknown}|null;
  if(!q||q.approved!==true||typeof q.siteId!=='string'||typeof q.expectedSha256!=='string'||
     !/^[0-9a-f]{64}$/.test(q.expectedSha256)||typeof q.roleId!=='string'||
     typeof q.declaredStateId!=='string'||!q.declaredStateId||q.declaredStateId.length>64||
     typeof q.targetId!=='string'||!q.targetId||q.targetId.length>128)
   throw new Error('Explicit SiteAdapter site, role, declared state, CDP target and consent required');
  // Importantly, never accept raw strategies or a caller-chosen file path.
  const adapter=await adapters.getForInspection({siteId:q.siteId,expectedSha256:q.expectedSha256});
  const status=await getVerifiedChromeStatus({port:9223});
  const selected=status.pages.find(page=>page.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Selected SiteAdapter Chrome target unavailable');
  return runSiteAdapterRoleDomCheck({
   approved:true,target:selected,adapter,roleId:q.roleId,declaredStateId:q.declaredStateId,
   deps:{
    confirm:confirmPageIdentity,
    probe:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true}),
    probeOpenShadow:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true,rootScope:'open-shadow'}),
    probeIframe:(page,locators,frameId)=>probePageLocators(page,locators,{includeNodeFingerprints:true,rootScope:'iframe-document',expectedFrameId:frameId}),
    summarize:captureDomSummary,
    wait:()=>new Promise<void>(resolve=>setTimeout(resolve,650)),
   },
  });
 });

 ipcMain.handle('usshm:site-adapter-suggest-repair',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {approved?:unknown;scanId?:unknown;itemIndex?:unknown;selectorIndex?:unknown;
   targetId?:unknown;siteId?:unknown;expectedSha256?:unknown;roleId?:unknown;declaredStateId?:unknown}|null;
  if(!q||q.approved!==true||typeof q.scanId!=='string'||
    !Number.isSafeInteger(q.itemIndex)||Number(q.itemIndex)<0||
    !Number.isSafeInteger(q.selectorIndex)||Number(q.selectorIndex)<0||
    typeof q.targetId!=='string'||!q.targetId||q.targetId.length>128||
    typeof q.siteId!=='string'||typeof q.expectedSha256!=='string'||
    !/^[0-9a-f]{64}$/.test(q.expectedSha256)||
    typeof q.roleId!=='string'||!q.roleId||q.roleId.length>128||
    typeof q.declaredStateId!=='string'||!q.declaredStateId||q.declaredStateId.length>64)
   throw new Error('Explicit scanned script, SiteAdapter SHA, role, state, Chrome target and consent required');
  // The main process resolves the scan/selector, reviewed JSON, and actual
  // target. Renderer-supplied CSS or arbitrary filesystem paths are forbidden.
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[Number(q.itemIndex)];
  if(!item?.analysis||!item.scriptId||!withinAuthorized(item.path))
   throw new Error('SiteAdapter repair candidate requires an authorized scanned script');
  const record=item.analysis.selectorRecords[Number(q.selectorIndex)];
  if(!record||record.runtimeRequired||record.receiver!=='document')
   throw new Error('SiteAdapter repair candidates support only static document-scoped script locators');
  const adapter=await adapters.getForInspection({siteId:q.siteId,expectedSha256:q.expectedSha256});
  const status=await getVerifiedChromeStatus({port:9223});
  const selected=status.pages.find(page=>page.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Selected Chrome page unavailable');
  const pageScope=checkUserscriptPageScope(item.analysis.metadata,selected.url);
  if(pageScope.status!=='allowed')
   throw new Error('Selected webpage is outside userscript scope: '+pageScope.reason);
  const startingDocument=await confirmPageIdentity(selected);
  const candidateResult=await suggestAdapterScopedRepairs({
   target:{id:selected.id,url:selected.url},
   locator:{method:record.method,expression:record.expression,runtimeRequired:false},
   adapter,roleId:q.roleId,observedStateId:q.declaredStateId,
   deps:{
    probe:locators=>probePageLocators(selected,locators,{includeNodeFingerprints:true}),
    capture:()=>captureCandidateNodes(selected),confirm:()=>confirmPageIdentity(selected),
   },
  });
  assertStablePageDocument(startingDocument,await confirmPageIdentity(selected));
  scanSessions.assertCurrent(scanSnapshot);
  return candidateResult;
 });
 ipcMain.handle('usshm:pick-chrome',async event=>{assertSender(event);
  const pick=await dialog.showOpenDialog(mainWindow,{properties:['openFile'],filters:[{name:'Chrome executable',extensions:['exe']}]});
  if(pick.canceled)return approvedChromePath;
  const picked=pick.filePaths[0];
  if(picked){await savePreferredChromePath({dataRoot,executablePath:picked});approvedChromePath=picked;}
  return approvedChromePath;
 });
 ipcMain.handle('usshm:browser-profile-health',async event=>{
  assertSender(event);
  return inspectBrowserProfileRegistry({dataRoot});
 });
 ipcMain.handle('usshm:list-browser-profiles',async event=>{
  assertSender(event);
  return listBrowserProfiles({dataRoot});
 });
 ipcMain.handle('usshm:create-browser-profile',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {name?:unknown}|null;
  if(!q||typeof q.name!=='string'||!approvedChromePath)
   throw new Error('Select a trusted Chrome executable and profile name first');
  // Only a previously OS-picked chrome.exe is accepted. Renderer never sends
  // executable or profile data paths for native launch.
  return createBrowserProfile({dataRoot,name:q.name,executablePath:approvedChromePath});
 });
 ipcMain.handle('usshm:rename-browser-profile',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {profileId?:unknown;name?:unknown}|null;
  if(!q||typeof q.profileId!=='string'||typeof q.name!=='string')
   throw new Error('Invalid browser profile rename request');
  return renameBrowserProfile({dataRoot,profileId:q.profileId,name:q.name});
 });
 ipcMain.handle('usshm:default-browser-profile',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {profileId?:unknown}|null;
  if(!q||typeof q.profileId!=='string')throw new Error('Invalid browser profile id');
  return setDefaultBrowserProfile({dataRoot,profileId:q.profileId});
 });
 ipcMain.handle('usshm:remove-browser-profile',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {profileId?:unknown;approved?:unknown}|null;
  if(!q||typeof q.profileId!=='string'||q.approved!==true)
   throw new Error('Explicit approval required to delete browser profile record');
  const list=await listBrowserProfiles({dataRoot});
  const selected=list.find(p=>p.id===q.profileId);
  if(!selected)throw new Error('Browser profile not found');
  // User must confirm this exact named profile in a native OS dialog. No
  // directory or browser binary is ever deleted, even on confirmation.
  const decision=await dialog.showMessageBox(mainWindow,{
   type:'warning',title:'删除浏览器配置记录',
   message:'确定删除浏览器配置记录：'+selected.name+'？',
   detail:'只删除管理器保存的配置记录，不删除 Chrome、扩展、配置目录或浏览器数据。',
   buttons:['取消','仅删除配置记录'],defaultId:0,cancelId:0,noLink:true,
  });
  if(decision.response!==1)return {deleted:false};
  await removeBrowserProfile({dataRoot,profileId:q.profileId,approved:true});
  return {deleted:true};
 });
 ipcMain.handle('usshm:launch-browser-profile',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {profileId?:unknown;approved?:unknown}|null;
  if(!q||typeof q.profileId!=='string'||q.approved!==true)
   throw new Error('Explicit browser profile launch approval required');
  const {executablePath,isolatedProfileDir}=await resolveBrowserProfileForLaunch({
   dataRoot,profileId:q.profileId,
  });
  await ensureWritableDataRoot(isolatedProfileDir);
  await launchSelectedChrome({executablePath,port:9223,isolatedProfileDir});
  return {started:true,port:9223,isolated:true};
 });
 ipcMain.handle('usshm:launch-chrome',async event=>{assertSender(event);
  if(!approvedChromePath)throw new Error('请先通过文件选择器选择 Chrome');
  await launchSelectedChrome({executablePath:approvedChromePath,port:9223});return {started:true,port:9223};
 });
 ipcMain.handle('usshm:launch-isolated-chrome',async event=>{assertSender(event);
  if(!approvedChromePath)throw new Error('请先通过文件选择器选择 Chrome');
  // Only this explicit action opens a separate profile. Never copy the user's default profile.
  const isolatedProfileDir=join(dataRoot,'Chrome-CDP-Profile');
  await ensureWritableDataRoot(isolatedProfileDir);
  await launchSelectedChrome({executablePath:approvedChromePath,port:9223,isolatedProfileDir});
  return {started:true,port:9223,isolated:true};
 });
 ipcMain.handle('usshm:cdp-status',async event=>{assertSender(event);const status=await getVerifiedChromeStatus({port:9223});return {browser:status.browser,protocolVersion:status.protocolVersion,pages:status.pages.map(page=>({id:page.id,url:page.url}))};});
 ipcMain.handle('usshm:probe-locators',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;itemIndex:number;targetId:string;approved:true}|null;
  if(!q||q.approved!==true||!Number.isInteger(q.itemIndex)||typeof q.targetId!=='string'||q.targetId.length>128)throw new Error('Explicit target and consent required');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item||!item.analysis)throw new Error('No imported script for this scan index');
  const status=await getVerifiedChromeStatus({port:9223});const selected=status.pages.find(x=>x.id===q.targetId);
  if(!selected)throw new Error('Selected CDP page target no longer exists');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);if(scope.status!=='allowed')throw new Error('Selected webpage is outside userscript scope: '+scope.reason);
  if(!selected.webSocketDebuggerUrl)throw new Error('CDP page has no debugger endpoint');
  // Check the live main-frame URL: /json/list can become stale after navigation.
  const startingDocument=await confirmPageIdentity(selected);
  // Read-only evidence. No userscript execution, no page text transmitted to renderer.
  const summary=await captureDomSummary(selected);
  const records=item.analysis.selectorRecords.slice(0,50).map(x=>({method:x.method,expression:x.expression,runtimeRequired:x.runtimeRequired||x.receiver!=='document'}));
  const probe=await probePageLocators(selected,records);
  // Fail closed if the selected page navigated while snapshots were being collected.
  assertStablePageDocument(startingDocument,await confirmPageIdentity(selected));
  scanSessions.assertCurrent(scanSnapshot);
  return {summary,probe,totalLocators:item.analysis.selectorRecords.length,checkedLocators:records.length};
 });
 ipcMain.handle('usshm:diagnosis-history',event=>{
  assertSender(event);
  // No script source, complete file path, page query, DOM or CDP tokens are
  // present in this limited local journal summary.
  return journal.listRecent(40);
 });
 ipcMain.handle('usshm:diagnosis-cancel',(event,input:unknown)=>{
  assertSender(event);
  const q=input as {scanId?:unknown;targetId?:unknown}|null;
  if(!q||typeof q.scanId!=='string'||typeof q.targetId!=='string'||
     !q.targetId||q.targetId.length>128)throw new Error('Invalid diagnosis cancellation');
  scanSessions.require(q.scanId);
  // Main revokes already dispatched CDP page leases synchronously. A late
  // response from Chrome can no longer write into the trusted evidence store.
  diagnosisRequests.cancel({scanId:q.scanId,targetId:q.targetId});
  journal.cancel({scanId:q.scanId,targetId:q.targetId});
  return {cancelled:true};
 });
 ipcMain.handle('usshm:batch-diagnose',async(event,input:unknown)=>{assertSender(event);
  const q=input as {targetId:string;scanId:string;approved:true;offset?:number}|null;
  if(!q||q.approved!==true||typeof q.targetId!=='string'||q.targetId.length<1||q.targetId.length>128||typeof q.scanId!=='string')
   throw new Error('Explicit CDP page consent and scan identity required for batch diagnosis');
  const offset=q.offset??0;
  if(!Number.isSafeInteger(offset)||offset<0||offset>1000||offset%25!==0)throw new Error('Invalid batch offset');
  const scanSnapshot=scanSessions.require(q.scanId);
  const journalRunId=journal.currentRunId({scanId:q.scanId,targetId:q.targetId});
  const ticket=diagnosisRequests.begin({scanId:q.scanId,targetId:q.targetId,offset});
  try{
  const status=await getVerifiedChromeStatus({port:9223});
  scanSessions.assertCurrent(scanSnapshot);
  diagnosisRequests.assertCurrent(ticket);
  const selected=status.pages.find(p=>p.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Selected CDP page is no longer available');
  // Bounded first page of scripts; no untrusted JS execution and no source writes.
  const checked=scanSnapshot.items.slice(offset,offset+25);
  const result=await diagnoseScriptsOnPage({items:checked,target:selected,consent:true,deps:{
   confirm:confirmPageIdentity,probe:probePageLocators,summarize:captureDomSummary,
   waitBeforeMissingRecheck:()=>new Promise<void>(resolve=>setTimeout(resolve,750)),
  }});
  scanSessions.assertCurrent(scanSnapshot);
  diagnosisRequests.assertCurrent(ticket);
  const authenticatedPage={...result,
   items:result.items.map(entry=>({...entry,index:entry.index+offset})),
   startIndex:offset,remainingItems:Math.max(0,scanSnapshot.items.length-offset-checked.length)};
  batchEvidence.record({scanId:q.scanId,targetId:q.targetId,
   total:scanSnapshot.items.length,offset,page:authenticatedPage});
  journal.recordPage({scanId:q.scanId,targetId:q.targetId,
   total:scanSnapshot.items.length,offset,page:authenticatedPage});
  diagnosisRequests.complete(ticket,{pageItems:checked.length,totalItems:scanSnapshot.items.length});
  return authenticatedPage;
  }catch(error){
   // Old, cancelled and superseded requests may reject after a new batch
   // starts. They must NOT wipe that newer batch's evidence or journal.
   if(diagnosisRequests.isCurrent(ticket)){
    if(isTransientCdpReadError(error)){
     // Preserve completed pages so the renderer's one transport retry can
     // repeat this same offset without duplicating committed rows.
     diagnosisRequests.releaseForRetry(ticket);
    }else{
     diagnosisRequests.failIfCurrent(ticket);
     batchEvidence.invalidateIfCurrent({scanId:q.scanId,targetId:q.targetId});
     journal.failIfCurrent({scanId:q.scanId,targetId:q.targetId,runId:journalRunId});
    }
   }
   throw error;
  }
 });
 ipcMain.handle('usshm:read-only-visibility',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {scanId?:unknown;itemIndex?:unknown;selectorIndex?:unknown;targetId?:unknown;approved?:unknown}|null;
  if(!q||q.approved!==true||typeof q.scanId!=='string'||
     !Number.isSafeInteger(q.itemIndex)||Number(q.itemIndex)<0||
     !Number.isSafeInteger(q.selectorIndex)||Number(q.selectorIndex)<0||
     typeof q.targetId!=='string'||!q.targetId||q.targetId.length>128)
   throw new Error('Explicit DOM visibility target, static selector and consent required');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex as number];
  if(!item?.analysis||!withinAuthorized(item.path))
   throw new Error('No authorized static script analysis for visibility check');
  const record=item.analysis.selectorRecords[q.selectorIndex as number];
  if(!record||record.runtimeRequired||record.receiver!=='document')
   throw new Error('Visibility probe requires an authorized static top-document locator');
  const cdp=await getVerifiedChromeStatus({port:9223});
  const selected=cdp.pages.find(p=>p.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Selected Chrome target unavailable');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);
  if(scope.status!=='allowed')throw new Error('Script not authorized on this target webpage');
  const start=await confirmPageIdentity(selected);
  const observed=await inspectReadOnlyElementVisibility(selected,{
   method:record.method,expression:record.expression,runtimeRequired:false,
  });
  // A top-document CSS miss cannot exclude targets inside an iframe or
  // author ShadowRoot. A failed/saturated snapshot stays unknown, not missing.
  const context=observed.status==='missing'?
   await captureDomSummary(selected).catch(()=>null):null;
  const end=await confirmPageIdentity(selected);
  assertStablePageDocument(start,end);
  scanSessions.assertCurrent(scanSnapshot);
  const authorRoots=context&&context.targetId===selected.id&&
   context.url===selected.url&&context.validationLevel==='evidence-only'&&
   Number.isSafeInteger(context.authorShadowTreeNodes)&&
   context.authorShadowTreeNodes>=0&&context.authorShadowTreeNodes<=200000?
   context.authorShadowTreeNodes:null;
  return qualifyTopDocumentVisibility(observed,
   Math.max(start.subframeCount??0,end.subframeCount??0),authorRoots);
 });
 ipcMain.handle('usshm:read-only-event-listeners',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {scanId?:unknown;itemIndex?:unknown;selectorIndex?:unknown;targetId?:unknown;approved?:unknown}|null;
  if(!q||q.approved!==true||typeof q.scanId!=='string'||
     !Number.isSafeInteger(q.itemIndex)||Number(q.itemIndex)<0||
     !Number.isSafeInteger(q.selectorIndex)||Number(q.selectorIndex)<0||
     typeof q.targetId!=='string'||!q.targetId||q.targetId.length>128)
   throw new Error('Explicit direct listener probe approval and authorized target required');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex as number];
  if(!item?.analysis||!withinAuthorized(item.path))
   throw new Error('No authorized script analysis for direct listener probe');
  const record=item.analysis.selectorRecords[q.selectorIndex as number];
  if(!record||record.runtimeRequired||record.receiver!=='document')
   throw new Error('A static document locator is required');
  const cdp=await getVerifiedChromeStatus({port:9223});
  const selected=cdp.pages.find(page=>page.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)
   throw new Error('Selected Chrome CDP page target unavailable');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);
  if(scope.status!=='allowed')
   throw new Error('Script is not authorized on this target URL');
  const start=await confirmPageIdentity(selected);
  const observed=await inspectReadOnlyEventListeners(selected,{
   method:record.method,expression:record.expression,runtimeRequired:false,
  });
  const context=observed.status==='missing'?
   await captureDomSummary(selected).catch(()=>null):null;
  const end=await confirmPageIdentity(selected);
  assertStablePageDocument(start,end);
  scanSessions.assertCurrent(scanSnapshot);
  // A missing top-document listener is not conclusive inside author Shadow
  // roots or child frames. Unknown snapshot evidence also fails closed.
  if(observed.status==='missing'){
   const roots=context&&context.targetId===selected.id&&context.url===selected.url&&
    context.validationLevel==='evidence-only'&&
    Number.isSafeInteger(context.authorShadowTreeNodes)&&
    context.authorShadowTreeNodes>=0&&context.authorShadowTreeNodes<=200000?
    context.authorShadowTreeNodes:null;
   if((start.subframeCount??0)>0||(end.subframeCount??0)>0||roots===null||roots>0)
    return {...observed,status:'unknown',listenerCount:null};
  }
  return observed;
 });
 ipcMain.handle('usshm:run-dom-contract',async(event,input:unknown)=>{
  assertSender(event);
  const q=input as {scanId:string;itemIndex:number;selectorIndex:number;targetId:string;
   expectation:'exists'|'unique';approved:boolean}|null;
  if(!q||q.approved!==true||!Number.isSafeInteger(q.itemIndex)||q.itemIndex<0||
   !Number.isSafeInteger(q.selectorIndex)||q.selectorIndex<0||
   typeof q.targetId!=='string'||!q.targetId||q.targetId.length>128||
   (q.expectation!=='exists'&&q.expectation!=='unique'))
   throw new Error('Explicit target, selector, expectation and consent required');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item?.analysis||!item.scriptId||!withinAuthorized(item.path))
   throw new Error('Selected script is not an authorized static scan');
  const record=item.analysis.selectorRecords[q.selectorIndex];
  if(!record||record.runtimeRequired||record.receiver!=='document')
   throw new Error('Supported static document-scoped selector required');
  const status=await getVerifiedChromeStatus({port:9223});
  const selected=status.pages.find(target=>target.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Selected CDP target no longer exists');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);
  if(scope.status!=='allowed')
   throw new Error('Selected target outside approved userscript scope: '+scope.reason);
  const verdict=await runReadOnlyDomContract({
   approved:true,target:selected,
   caseId:'SCRIPT_'+item.scriptId.slice(0,44)+':LOCATOR_'+q.selectorIndex+':'+q.expectation,
   locator:{method:record.method,expression:record.expression,runtimeRequired:false},
   expectation:q.expectation,
   deps:{
    confirm:confirmPageIdentity,
    probe:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true}),
    summarize:captureDomSummary,
    wait:()=>new Promise<void>(resolve=>setTimeout(resolve,650)),
   },
  });
  scanSessions.assertCurrent(scanSnapshot);
  return verdict;
 });
 ipcMain.handle('usshm:suggest-repair',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true}|null;
  if(!q||q.approved!==true||!Number.isInteger(q.itemIndex)||q.itemIndex<0||!Number.isInteger(q.selectorIndex)||q.selectorIndex<0||typeof q.targetId!=='string'||q.targetId.length>128)throw new Error('Explicit CDP target and user approval required');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item?.analysis||!item.scriptId||!withinAuthorized(item.path))throw new Error('Script is not an authorized scanned file');
  const record=item.analysis.selectorRecords[q.selectorIndex];
  if(!record||record.runtimeRequired||record.receiver!=='document')throw new Error('A document-scoped literal selector is required');
  const status=await getVerifiedChromeStatus({port:9223});const selected=status.pages.find(p=>p.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Selected CDP page no longer exists');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);if(scope.status!=='allowed')throw new Error('Selected webpage is outside userscript scope: '+scope.reason);
  const locator={method:record.method,expression:record.expression,runtimeRequired:record.runtimeRequired};
  const startingDocument=await confirmPageIdentity(selected);
  const candidates=await suggestCandidateRepairs({target:{id:selected.id,url:selected.url},locator,deps:{
   probe:(locators)=>probePageLocators(selected,locators,{includeNodeFingerprints:true}),
   capture:()=>captureCandidateNodes(selected),confirm:()=>confirmPageIdentity(selected),
  }});
  assertStablePageDocument(startingDocument,await confirmPageIdentity(selected));
  scanSessions.assertCurrent(scanSnapshot);
  return candidates;
 });
 ipcMain.handle('usshm:suggest-repairs-bulk',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;itemIndex:number;targetId:string;approved:true;offset?:number}|null;
  if(!q||q.approved!==true||!Number.isSafeInteger(q.itemIndex)||q.itemIndex<0||
    typeof q.targetId!=='string'||q.targetId.length<1||q.targetId.length>128)
   throw new Error('Explicit CDP target and consent required');
  if(q.offset!==undefined&&(!Number.isSafeInteger(q.offset)||q.offset<0||q.offset>48||q.offset%8!==0))
   throw new Error('Invalid candidate offset');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item?.analysis||!item.scriptId||!withinAuthorized(item.path))
   throw new Error('Selected script is not authorized for page inspection');
  const status=await getVerifiedChromeStatus({port:9223});
  const selected=status.pages.find(page=>page.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('CDP target no longer available');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);
  if(scope.status!=='allowed')throw new Error('Selected webpage is outside userscript scope: '+scope.reason);
  const locators=item.analysis.selectorRecords.slice(0,50).map(record=>({
   method:record.method,expression:record.expression,
   runtimeRequired:record.runtimeRequired||record.receiver!=='document',
  }));
  const startingDocument=await confirmPageIdentity(selected);
  const evidence=await probePageLocators(selected,locators,{includeNodeFingerprints:true});
  const suggestions=await suggestMissingCandidatesBulk({
   target:{id:selected.id,url:selected.url},locators,checks:evidence.checks,
   evidenceIdentity:{targetId:evidence.targetId,url:evidence.url},offset:q.offset,
   deps:{probe:inputs=>probePageLocators(selected,inputs),capture:()=>captureCandidateNodes(selected),confirm:()=>confirmPageIdentity(selected)},
  });
  assertStablePageDocument(startingDocument,await confirmPageIdentity(selected));
  scanSessions.assertCurrent(scanSnapshot);
  return suggestions;
 });
 ipcMain.handle('usshm:prepare-verified-preview',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId?:unknown;itemIndex?:unknown;selectorIndex?:unknown;targetId?:unknown;approved?:unknown}|null;
  if(!q||q.approved!==true||typeof q.scanId!=='string'||
     !Number.isSafeInteger(q.itemIndex)||Number(q.itemIndex)<0||
     !Number.isSafeInteger(q.selectorIndex)||Number(q.selectorIndex)<0||
     typeof q.targetId!=='string'||!q.targetId||q.targetId.length>128)
   throw new Error('Explicit live CDP target and repair-preview consent required');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[Number(q.itemIndex)];
  if(!item?.analysis||!item.scriptId||!withinAuthorized(item.path))
   throw new Error('Source script is not an authorized scanned file');
  const record=item.analysis.selectorRecords[Number(q.selectorIndex)];
  if(!record||record.runtimeRequired||record.receiver!=='document')
   throw new Error('Only static literal document selectors can enter automatic preview');
  const status=await getVerifiedChromeStatus({port:9223});
  scanSessions.assertCurrent(scanSnapshot);
  const selected=status.pages.find(page=>page.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)
   throw new Error('Selected CDP target is no longer available');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);
  if(scope.status!=='allowed')
   throw new Error('Selected webpage is outside userscript scope: '+scope.reason);
  const locator={method:record.method,expression:record.expression,runtimeRequired:record.runtimeRequired};
  const verifySource=async()=>{
   const sourceInfo=await lstat(item.path);
   if(!sourceInfo.isFile()||sourceInfo.isSymbolicLink())
    throw new Error('Source file changed or is an unsafe symlink; rescan required');
   const bytes=await readPinnedRegularFile(item.path,{maxBytes:512*1024,expected:sourceInfo});
   if(createHash('sha256').update(bytes).digest('hex')!==item.analysis!.sourceSha256)
    throw new Error('Source script hash changed since scan; rescan before preview');
   scanSessions.assertCurrent(scanSnapshot);
  };
  const receipt=await prepareVerifiedRepairPreview({
   approved:true,target:{id:selected.id,url:selected.url},locator,
   source:{scriptId:item.scriptId,sourcePath:item.path,expectedSha256:item.analysis.sourceSha256,
    selectorLocation:{method:record.method,line:record.sourceRange.start.line,column:record.sourceRange.start.column}},
   deps:{
    confirm:()=>confirmPageIdentity(selected),
    discover:()=>suggestCandidateRepairs({target:{id:selected.id,url:selected.url},locator,deps:{
     confirm:()=>confirmPageIdentity(selected),
     probe:locators=>probePageLocators(selected,locators,{includeNodeFingerprints:true}),
     capture:()=>captureCandidateNodes(selected),
    }}),
    verifySource,
    propose:newSelector=>repairs.propose({
     sourcePath:item.path,scriptId:item.scriptId!,oldSelector:record.expression,newSelector,
     selectorLocation:{method:record.method,line:record.sourceRange.start.line,column:record.sourceRange.start.column},
    }),
    revoke:proposalId=>{repairs.discard(proposalId);},
   },
  });
  scanSessions.assertCurrent(scanSnapshot);
  if(receipt.proposal)
   pendingApprovals.register(receipt.proposal.proposalId,scanSnapshot.scanId);
  return receipt;
 });
 ipcMain.handle('usshm:propose-repair',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;itemIndex:number;selectorIndex:number;newSelector:string}|null;
  if(!q||!Number.isInteger(q.itemIndex)||!Number.isInteger(q.selectorIndex)||typeof q.newSelector!=='string'||q.newSelector.length<1||q.newSelector.length>1024)throw new Error('Invalid patch request');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item||!item.analysis||!item.scriptId||!withinAuthorized(item.path))throw new Error('Source script is not authorized');
  const sel=item.analysis.selectorRecords[q.selectorIndex];
  if(!sel||sel.runtimeRequired)throw new Error('Only a known static literal can be patched');
  // Renderer-supplied selectors may not turn an already scanned file into an
  // unbounded second disk read. Reject path swaps, symlinks and growth even
  // when the hash will ultimately mismatch.
  const sourceInfo=await lstat(item.path);
  if(sourceInfo.isSymbolicLink()||!sourceInfo.isFile())
   throw new Error('Source script must be an ordinary file; rescan required');
  const current=await readPinnedRegularFile(item.path,{maxBytes:512*1024,expected:sourceInfo});
  const currentSha=createHash('sha256').update(current).digest('hex');
  if(currentSha!==item.analysis.sourceSha256)throw new Error('Source changed since static scan, please rescan');
  scanSessions.assertCurrent(scanSnapshot);
  const proposal=await repairs.propose({sourcePath:item.path,scriptId:item.scriptId,oldSelector:sel.expression,newSelector:q.newSelector,selectorLocation:{method:sel.method,line:sel.sourceRange.start.line,column:sel.sourceRange.start.column}});
  scanSessions.assertCurrent(scanSnapshot);
  if(proposal.originalHash!==item.analysis.sourceSha256)throw new Error('Original scan hash mismatch; please rescan');
  pendingApprovals.register(proposal.proposalId,scanSnapshot.scanId);
  return proposal;
 });
 ipcMain.handle('usshm:apply-repair-guarded',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId?:unknown;proposalId?:unknown;approved?:unknown;
   itemIndex?:unknown;selectorIndex?:unknown;targetId?:unknown}|null;
  if(!q||q.approved!==true||typeof q.scanId!=='string'||
     typeof q.proposalId!=='string'||!/^[a-f0-9-]{36}$/i.test(q.proposalId)||
     !Number.isSafeInteger(q.itemIndex)||Number(q.itemIndex)<0||
     !Number.isSafeInteger(q.selectorIndex)||Number(q.selectorIndex)<0||
     typeof q.targetId!=='string'||!q.targetId||q.targetId.length>128)
   throw new Error('Explicit managed V1 check, target and approval required');
  const scanSnapshot=scanSessions.require(q.scanId);
  pendingApprovals.require(q.proposalId,scanSnapshot.scanId);
  const trusted=repairs.inspectPending(q.proposalId);
  const item=scanSnapshot.items[Number(q.itemIndex)];
  if(!trusted||!item?.scriptId||!item.analysis||!withinAuthorized(item.path)||
     trusted.scriptId!==item.scriptId)
   throw new Error('Stale or unrelated managed patch approval');
  const sourceInfo=await lstat(item.path);
  if(!sourceInfo.isFile()||sourceInfo.isSymbolicLink())
   throw new Error('Unsafe source file; rescan required');
  const source=await readPinnedRegularFile(item.path,{maxBytes:512*1024,expected:sourceInfo});
  if(createHash('sha256').update(source).digest('hex')!==item.analysis.sourceSha256)
   throw new Error('Source script changed; rescan before approved repair');
  const status=await getVerifiedChromeStatus({port:9223});
  scanSessions.assertCurrent(scanSnapshot);
  const selected=status.pages.find(page=>page.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Approved Chrome target is unavailable');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);
  if(scope.status!=='allowed')
   throw new Error('Selected Chrome page outside authorized userscript scope: '+scope.reason);
  const documentBefore=await confirmPageIdentity(selected);
  scanSessions.assertCurrent(scanSnapshot);
  // Only Main owns the original/proposed hashes. The renderer supplies neither
  // rollback target nor replacement selector, even with IPC tampering.
  let applied:Awaited<ReturnType<typeof repairs.apply>>;
  try{applied=await repairs.apply({proposalId:q.proposalId,approved:true});}
  finally{pendingApprovals.consume(q.proposalId);}
  const index=Number(q.selectorIndex);
  const safety=await guardAppliedManagedRevision({
   approved:true,scriptId:item.scriptId,appliedHash:applied.hash,
   previousHash:trusted.previousHash,
   verify:async()=>{
    if(applied.hash!==trusted.proposedHash)
     throw new Error('The applied bytes no longer match the reviewed patch');
    scanSessions.assertCurrent(scanSnapshot);
    const locator=await readVerifiedManagedLocator({
     managedRoot:dataRoot,scriptId:item.scriptId!,revisionHash:applied.hash,selectorIndex:index,
    });
    if(locator.expression!==trusted.newSelector)
     throw new Error('Managed AST selector differs from approved replacement');
    // Guarded retention is intentionally narrower than standalone V1 checks:
    // a multi-match/existence contract cannot prove the patch targets one
    // stable node across both Chrome samples. Roll back if it is not unique.
    const expectation='unique' as const;
    const verdict=await runReadOnlyDomContract({
     approved:true,target:selected,
     caseId:'MANAGED_GUARD_'+item.scriptId!.slice(0,24)+':IDX_'+index,
     locator:{method:locator.method,expression:locator.expression,runtimeRequired:false},
     expectation,
     deps:{confirm:confirmPageIdentity,
      probe:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true}),
      summarize:captureDomSummary,
      wait:()=>new Promise<void>(resolve=>setTimeout(resolve,650)),
     },
    });
    const after=await readVerifiedManagedLocator({
     managedRoot:dataRoot,scriptId:item.scriptId!,revisionHash:applied.hash,selectorIndex:index,
    });
    if(after.expression!==locator.expression||after.method!==locator.method)
     throw new Error('Managed active selector changed during post-apply test');
    assertStablePageDocument(documentBefore,await confirmPageIdentity(selected));
    scanSessions.assertCurrent(scanSnapshot);
    return verdict;
   },
   restore:(previousHash)=>repairs.restore({scriptId:item.scriptId!,hash:previousHash,approved:true,expectedCurrentHash:applied.hash}),
  });
  return {...safety,managedPath:applied.managedPath,backupPath:applied.backupPath};
 });
 ipcMain.handle('usshm:apply-repair',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;proposalId:string;approved:true}|null;
  if(!q||q.approved!==true||typeof q.proposalId!=='string'||!/^[0-9a-f-]{36}$/i.test(q.proposalId))throw new Error('Explicit repair approval required');
  const scanSnapshot=scanSessions.require(q.scanId);
  pendingApprovals.require(q.proposalId,scanSnapshot.scanId);
  const applied=await repairs.apply({proposalId:q.proposalId,approved:true});
  pendingApprovals.consume(q.proposalId);
  return applied;
 });
 ipcMain.handle('usshm:verify-managed-dom',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId?:unknown;itemIndex?:unknown;selectorIndex?:unknown;
   targetId?:unknown;revisionHash?:unknown;approved?:unknown}|null;
  if(!q||q.approved!==true||typeof q.scanId!=='string'||
     !Number.isSafeInteger(q.itemIndex)||Number(q.itemIndex)<0||
     !Number.isSafeInteger(q.selectorIndex)||Number(q.selectorIndex)<0||
     typeof q.targetId!=='string'||!q.targetId||q.targetId.length>128||
     typeof q.revisionHash!=='string'||!/^[a-f0-9]{64}$/.test(q.revisionHash))
   throw new Error('Explicit approved managed revision, selector and CDP page are required');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[Number(q.itemIndex)];
  if(!item?.analysis||!item.scriptId||!withinAuthorized(item.path))
   throw new Error('Untrusted managed source scan; rescan required');
  const originalInfo=await lstat(item.path);
  if(!originalInfo.isFile()||originalInfo.isSymbolicLink())
   throw new Error('Original source changed into an unsafe file; rescan required');
  const originalBytes=await readPinnedRegularFile(item.path,{maxBytes:512*1024,expected:originalInfo});
  if(createHash('sha256').update(originalBytes).digest('hex')!==item.analysis.sourceSha256)
   throw new Error('Original source hash changed; do not trust a stale managed V1 test');
  scanSessions.assertCurrent(scanSnapshot);
  const status=await getVerifiedChromeStatus({port:9223});
  scanSessions.assertCurrent(scanSnapshot);
  const selected=status.pages.find(page=>page.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Selected CDP page no longer exists');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);
  if(scope.status!=='allowed')
   throw new Error('Selected CDP page is outside the userscript matching scope: '+scope.reason);
  const index=Number(q.selectorIndex);
  const locator=await readVerifiedManagedLocator({managedRoot:dataRoot,scriptId:item.scriptId,
   revisionHash:q.revisionHash,selectorIndex:index});
  scanSessions.assertCurrent(scanSnapshot);
  const expectation=['querySelectorAll','getElementsByName','getElementsByClassName']
   .includes(locator.method)?'exists' as const:'unique' as const;
  const verdict=await runReadOnlyDomContract({
   approved:true,target:selected,
   caseId:'MANAGED_'+item.scriptId.slice(0,32)+':IDX_'+index+':'+expectation,
   locator:{method:locator.method,expression:locator.expression,runtimeRequired:false},
   expectation,
   deps:{confirm:confirmPageIdentity,
    probe:(page,locators)=>probePageLocators(page,locators,{includeNodeFingerprints:true}),
    summarize:captureDomSummary,
    wait:()=>new Promise<void>(resolve=>setTimeout(resolve,650)),
   },
  });
  // Re-read after all CDP awaits: a rollback or an external edit while
  // Chrome was observing must not attach stale V1 evidence to a revision.
  const ending=await readVerifiedManagedLocator({managedRoot:dataRoot,scriptId:item.scriptId,
   revisionHash:q.revisionHash,selectorIndex:index});
  if(ending.method!==locator.method||ending.expression!==locator.expression)
   throw new Error('Managed current changed during DOM verification');
  scanSessions.assertCurrent(scanSnapshot);
  return {...verdict,revisionHash:locator.revisionHash,validationLevel:'V1-managed-read-only' as const};
 });
 ipcMain.handle('usshm:managed-health',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;itemIndex:number}|null;
  if(!q||typeof q.scanId!=='string'||!Number.isSafeInteger(q.itemIndex)||q.itemIndex<0)
   throw new Error('Invalid managed health script index');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item?.scriptId||!withinAuthorized(item.path))throw new Error('Script not authorized');
  // No arbitrary renderer paths or lock deletion; Main computes the Data root.
  return inspectManagedIntegrity({managedRoot:dataRoot,scriptId:item.scriptId});
 });
 ipcMain.handle('usshm:managed-revisions',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;itemIndex:number}|null;
  if(!q||!Number.isInteger(q.itemIndex)||q.itemIndex<0)throw new Error('Invalid managed revision item index');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item?.scriptId||!withinAuthorized(item.path))throw new Error('Script not authorized');
  return listManagedRevisions({managedRoot:dataRoot,scriptId:item.scriptId});
 });
 ipcMain.handle('usshm:export-managed',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;itemIndex:number}|null;
  if(!q||!Number.isSafeInteger(q.itemIndex)||q.itemIndex<0)throw new Error('Invalid managed export script index');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item?.scriptId||!withinAuthorized(item.path))throw new Error('Source script is not authorized');
  const suggested=basename(item.path).replace(/\.user\.js$/i,'')+'-repaired.user.js';
  const save=await dialog.showSaveDialog(mainWindow,{defaultPath:join(app.getPath('documents'),suggested),
   filters:[{name:'Tampermonkey UserScript',extensions:['js']}]});
  if(save.canceled||!save.filePath)return {canceled:true};
  scanSessions.assertCurrent(scanSnapshot);
  const receipt=await exportManagedCurrent({managedRoot:dataRoot,scriptId:item.scriptId,destinationPath:save.filePath});
  return {canceled:false,...receipt};
 });
 ipcMain.handle('usshm:rollback-managed',async(event,input:unknown)=>{assertSender(event);
  const q=input as {scanId:string;itemIndex:number;hash:string;approved:true}|null;
  if(!q||q.approved!==true||!Number.isInteger(q.itemIndex)||q.itemIndex<0||typeof q.hash!=='string'||!/^[a-f0-9]{64}$/.test(q.hash))throw new Error('Explicit managed revision rollback approval required');
  const scanSnapshot=scanSessions.require(q.scanId);
  const item=scanSnapshot.items[q.itemIndex];
  if(!item?.scriptId||!withinAuthorized(item.path))throw new Error('Script not authorized');
  return repairs.restore({scriptId:item.scriptId,hash:q.hash,approved:true});
 });
 ipcMain.handle('usshm:export-dom-report',async(event,input:unknown)=>{
  assertSender(event);
  if(!input||typeof input!=='object')throw new Error('Invalid DOM export request');
  const q=input as {scanId?:unknown;targetId?:unknown;format?:unknown};
  if(typeof q.scanId!=='string'||typeof q.targetId!=='string'||
     !q.targetId||q.targetId.length>128||(q.format!=='json'&&q.format!=='markdown'))
   throw new Error('Invalid DOM export parameters');
  const scanSnapshot=scanSessions.require(q.scanId);
  // Export trusted main-process evidence, not caller-provided flags, scores,
  // paths, statuses or arbitrary raw DOM strings from renderer IPC.
  const observed=batchEvidence.snapshot({scanId:q.scanId,targetId:q.targetId});
  const report=observed.report;
  if(report.items.length>scanSnapshot.items.length)
   throw new Error('Trusted DOM export exceeds scanned items');
  for(let index=0;index<report.items.length;index++){
   const evidence=report.items[index],source=scanSnapshot.items[index];
   if(!evidence||!source||evidence.index!==index||evidence.scriptId!==(source.scriptId??null)||
      evidence.path!==source.path)
    throw new Error('Trusted DOM report no longer matches its imported script');
  }
  const content=serializeDomBatchReport(report,q.format,observed.lastObservedAt);
  const extension=q.format==='json'?'json':'md';
  const selection=await dialog.showSaveDialog(mainWindow,{
   defaultPath:join(app.getPath('documents'),`usshm-dom-report.${extension}`),
   filters:[{name:extension.toUpperCase(),extensions:[extension]}],
  });
  if(selection.canceled||!selection.filePath)return {canceled:true};
  scanSessions.assertCurrent(scanSnapshot);
  // The scan or target may have changed while the save dialog was visible.
  const fresh=batchEvidence.snapshot({scanId:q.scanId,targetId:q.targetId});
  if(fresh.revision!==observed.revision)
   throw new Error('DOM evidence changed while save dialog was open; export cancelled');
  await writeExclusiveReport({destinationPath:selection.filePath,content});
  return {canceled:false,path:selection.filePath};
 });
 ipcMain.handle('usshm:export',async (event,format:unknown)=>{assertSender(event);
  if(format!=='json'&&format!=='markdown')throw new Error('Invalid format');
  if(!lastScan)throw new Error('No scan has been performed');
  const scanSnapshot=lastScan;
  const content=serializeStaticReport(scanSnapshot,format);
  const ext=format==='json'?'json':'md';
  const result=await dialog.showSaveDialog(mainWindow,{
   defaultPath:join(app.getPath('documents'),`usshm-report.${ext}`),
   filters:[{name:ext.toUpperCase(),extensions:[ext]}],
  });
  if(result.canceled||!result.filePath)return {canceled:true};
  if(lastScan!==scanSnapshot)
   throw new Error('Static scan changed while save dialog was open; export cancelled');
  await writeExclusiveReport({destinationPath:result.filePath,content});
  return {canceled:false,path:result.filePath};
 });
}
// Only one Electron main process may own this application's SQLite database and
// managed script revisions. A second launch focuses the existing GUI instead
// of creating a competing file writer or stale repair history.
const singleInstanceLock=app.requestSingleInstanceLock();
if(!singleInstanceLock)app.quit();
else {
 app.on('second-instance',()=>{
  if(mainWindow&&!mainWindow.isDestroyed()){
   if(mainWindow.isMinimized())mainWindow.restore();
   mainWindow.show();
   mainWindow.focus();
  }
 });
 bootstrap().catch(error=>{dialog.showErrorBox('Userscript Self-Healing Manager 启动失败',String(error));app.exit(1);});
}
