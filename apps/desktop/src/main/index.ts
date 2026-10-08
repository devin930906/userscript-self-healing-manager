import {app,BrowserWindow,dialog,ipcMain,shell} from 'electron';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {existsSync} from 'node:fs';
import {writeFile,lstat,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolveDataRoot,ensureWritableDataRoot,type DistributionMode} from '../../../../packages/runtime-paths/src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../../../packages/persistence/src/index.ts';
import {runStaticScan,type ScanBatchResult} from '../../../../packages/scan-service/src/index.ts';
import {serializeStaticReport} from '../../../../packages/reporting/src/index.ts';
import {getChromeStatus,launchSelectedChrome} from '../../../../packages/cdp-client/src/index.ts';
import {captureDomSummary} from '../../../../packages/cdp-client/src/snapshot.ts';
import {probePageLocators} from '../../../../packages/cdp-client/src/locator-probe.ts';
import {createRepairWorkflow} from '../../../../packages/repair-workflow/src/index.ts';
import {listManagedRevisions,activateManagedRevision} from '../../../../packages/repair-workflow/src/history.ts';
import {captureCandidateNodes} from '../../../../packages/cdp-client/src/candidate-snapshot.ts';
import {suggestCandidateRepairs} from '../../../../packages/candidate-engine/src/workflow.ts';
import {checkUserscriptPageScope} from '../../../../packages/candidate-engine/src/page-scope.ts';

let mainWindow:BrowserWindow;
let lastScan:ScanBatchResult|null=null;
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
 if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)throw new Error('Untrusted IPC sender');
 const u=event.sender.getURL();if(!u.startsWith('file://')&&!u.startsWith('http://localhost:5173/'))throw new Error('Untrusted frame URL');
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
 const db=openDatabase(join(dataRoot,'registry.sqlite'));migrateDatabase(db);
 const repository=createScriptRepository(db);
 const repairs=createRepairWorkflow({managedRoot:dataRoot});
 app.on('before-quit',()=>db.close());
 mainWindow=createWindow();
 ipcMain.handle('usshm:app-info',event=>{assertSender(event);return {version:app.getVersion(),distributionMode:mode,dataRoot};});
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
 lastScan=await runStaticScan({paths:q.paths as string[],recursive:q.recursive,maxFiles:1000},{repository});return lastScan;});
 ipcMain.handle('usshm:list-scripts',event=>{assertSender(event);return repository.list();});
 ipcMain.handle('usshm:pick-chrome',async event=>{assertSender(event);
  const pick=await dialog.showOpenDialog(mainWindow,{properties:['openFile'],filters:[{name:'Chrome executable',extensions:['exe']}]});
  approvedChromePath=pick.canceled?approvedChromePath:(pick.filePaths[0]??null);return approvedChromePath;
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
 ipcMain.handle('usshm:cdp-status',async event=>{assertSender(event);const status=await getChromeStatus({port:9223});return {browser:status.browser,protocolVersion:status.protocolVersion,pages:status.pages.map(page=>({id:page.id,url:page.url}))};});
 ipcMain.handle('usshm:probe-locators',async(event,input:unknown)=>{assertSender(event);
  const q=input as {itemIndex:number;targetId:string;approved:true}|null;
  if(!q||q.approved!==true||!Number.isInteger(q.itemIndex)||typeof q.targetId!=='string'||q.targetId.length>128)throw new Error('Explicit target and consent required');
  const item=lastScan?.items[q.itemIndex];
  if(!item||!item.analysis)throw new Error('No imported script for this scan index');
  const status=await getChromeStatus({port:9223});const selected=status.pages.find(x=>x.id===q.targetId);
  if(!selected)throw new Error('Selected CDP page target no longer exists');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);if(scope.status!=='allowed')throw new Error('Selected webpage is outside userscript scope: '+scope.reason);
  if(!selected.webSocketDebuggerUrl)throw new Error('CDP page has no debugger endpoint');
  // Read-only evidence. No userscript execution, no page text transmitted to renderer.
  const summary=await captureDomSummary(selected);
  const records=item.analysis.selectorRecords.slice(0,50).map(x=>({method:x.method,expression:x.expression,runtimeRequired:x.runtimeRequired||x.receiver!=='document'}));
  const probe=await probePageLocators(selected,records);
  return {summary,probe,totalLocators:item.analysis.selectorRecords.length,checkedLocators:records.length};
 });
 ipcMain.handle('usshm:suggest-repair',async(event,input:unknown)=>{assertSender(event);
  const q=input as {itemIndex:number;selectorIndex:number;targetId:string;approved:true}|null;
  if(!q||q.approved!==true||!Number.isInteger(q.itemIndex)||q.itemIndex<0||!Number.isInteger(q.selectorIndex)||q.selectorIndex<0||typeof q.targetId!=='string'||q.targetId.length>128)throw new Error('Explicit CDP target and user approval required');
  const item=lastScan?.items[q.itemIndex];
  if(!item?.analysis||!item.scriptId||!withinAuthorized(item.path))throw new Error('Script is not an authorized scanned file');
  const record=item.analysis.selectorRecords[q.selectorIndex];
  if(!record||record.runtimeRequired||record.receiver!=='document')throw new Error('A document-scoped literal selector is required');
  const status=await getChromeStatus({port:9223});const selected=status.pages.find(p=>p.id===q.targetId);
  if(!selected?.webSocketDebuggerUrl)throw new Error('Selected CDP page no longer exists');
  const scope=checkUserscriptPageScope(item.analysis.metadata,selected.url);if(scope.status!=='allowed')throw new Error('Selected webpage is outside userscript scope: '+scope.reason);
  const locator={method:record.method,expression:record.expression,runtimeRequired:record.runtimeRequired};
  return suggestCandidateRepairs({target:{id:selected.id,url:selected.url},locator,deps:{
   probe:(locators)=>probePageLocators(selected,locators),
   capture:()=>captureCandidateNodes(selected),
  }});
 });
 ipcMain.handle('usshm:propose-repair',async(event,input:unknown)=>{assertSender(event);
  const q=input as {itemIndex:number;selectorIndex:number;newSelector:string}|null;
  if(!q||!Number.isInteger(q.itemIndex)||!Number.isInteger(q.selectorIndex)||typeof q.newSelector!=='string'||q.newSelector.length<1||q.newSelector.length>1024)throw new Error('Invalid patch request');
  const item=lastScan?.items[q.itemIndex];
  if(!item||!item.analysis||!item.scriptId||!withinAuthorized(item.path))throw new Error('Source script is not authorized');
  const sel=item.analysis.selectorRecords[q.selectorIndex];
  if(!sel||sel.runtimeRequired)throw new Error('Only a known static literal can be patched');
  const current=await readFile(item.path);
  const currentSha=createHash('sha256').update(current).digest('hex');
  if(currentSha!==item.analysis.sourceSha256)throw new Error('Source changed since static scan, please rescan');
  const proposal=await repairs.propose({sourcePath:item.path,scriptId:item.scriptId,oldSelector:sel.expression,newSelector:q.newSelector});
  if(proposal.baseHash!==item.analysis.sourceSha256)throw new Error('Patch base hash mismatch');
  return proposal;
 });
 ipcMain.handle('usshm:apply-repair',async(event,input:unknown)=>{assertSender(event);
  const q=input as {proposalId:string;approved:true}|null;
  if(!q||q.approved!==true||typeof q.proposalId!=='string'||!/^[0-9a-f-]{36}$/i.test(q.proposalId))throw new Error('Explicit repair approval required');
  return repairs.apply({proposalId:q.proposalId,approved:true});
 });
 ipcMain.handle('usshm:managed-revisions',async(event,input:unknown)=>{assertSender(event);
  const q=input as {itemIndex:number}|null;
  if(!q||!Number.isInteger(q.itemIndex)||q.itemIndex<0)throw new Error('Invalid managed revision item index');
  const item=lastScan?.items[q.itemIndex];
  if(!item?.scriptId||!withinAuthorized(item.path))throw new Error('Script not authorized');
  return listManagedRevisions({managedRoot:dataRoot,scriptId:item.scriptId});
 });
 ipcMain.handle('usshm:rollback-managed',async(event,input:unknown)=>{assertSender(event);
  const q=input as {itemIndex:number;hash:string;approved:true}|null;
  if(!q||q.approved!==true||!Number.isInteger(q.itemIndex)||q.itemIndex<0||typeof q.hash!=='string'||!/^[a-f0-9]{64}$/.test(q.hash))throw new Error('Explicit managed revision rollback approval required');
  const item=lastScan?.items[q.itemIndex];
  if(!item?.scriptId||!withinAuthorized(item.path))throw new Error('Script not authorized');
  return activateManagedRevision({managedRoot:dataRoot,scriptId:item.scriptId,hash:q.hash,approved:true});
 });
 ipcMain.handle('usshm:export',async (event,format:unknown)=>{assertSender(event);if(format!=='json'&&format!=='markdown')throw new Error('Invalid format');if(!lastScan)throw new Error('No scan has been performed');
 const ext=format==='json'?'json':'md';const result=await dialog.showSaveDialog(mainWindow,{defaultPath:join(app.getPath('documents'),`usshm-report.${ext}`),filters:[{name:ext.toUpperCase(),extensions:[ext]}]});
 if(result.canceled||!result.filePath)return {canceled:true};await writeFile(result.filePath,serializeStaticReport(lastScan,format),{encoding:'utf8',flag:'w'});return {canceled:false,path:result.filePath};});
}
bootstrap().catch(error=>{dialog.showErrorBox('Userscript Self-Healing Manager 启动失败',String(error));app.exit(1);});
