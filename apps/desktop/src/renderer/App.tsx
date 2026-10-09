import React,{useEffect,useMemo,useRef,useState} from 'react';
import {summarizeLiveLocatorCheck,type LiveLocatorSummary} from '../../../../packages/scan-service/src/health.ts';
import {createRoot} from 'react-dom/client';
import type {ScanBatchResult} from '../../../../packages/scan-service/src/index.ts';
type DesktopScanResult=ScanBatchResult&{scanId:string};
import type {BatchDomResult} from '../../../../packages/scan-service/src/batch-dom.ts';
import {collectPagedDomDiagnosis} from '../../../../packages/scan-service/src/paginated-dom.ts';
import {BatchPauseGate} from '../../../../packages/scan-service/src/pause-gate.ts';
import {getRepairInputHint} from './repair-hints.ts';
import {LatestRequestGate} from './latest-request-gate.ts';
import type {ScriptRecord} from '../../../../packages/persistence/src/index.ts';
import type {JournalRun} from '../../../../packages/job-journal/src/index.ts';
import {summarizeSiteTrends} from '../../../../packages/job-journal/src/trends.ts';
import type {LocatorProbeResult} from '../../../../packages/cdp-client/src/locator-probe.ts';
import type {DomSummary} from '../../../../packages/cdp-client/src/snapshot.ts';
import type {ReadOnlyVisibilityEvidence} from '../../../../packages/cdp-client/src/read-only-visibility.ts';
import type {ReadOnlyDomContractResult} from '../../../../packages/test-runner/src/index.ts';
import type {RoleDomResult} from '../../../../packages/test-runner/src/site-adapter-role.ts';
import type {VerifiedCandidate,AdapterScopedRepairsResult} from '../../../../packages/candidate-engine/src/workflow.ts';
import type {VerifiedPreviewResult} from '../../../../packages/repair-workflow/src/verified-preview.ts';
import type {BulkCandidateResult} from '../../../../packages/candidate-engine/src/bulk.ts';
import type {ManagedRevision} from '../../../../packages/repair-workflow/src/history.ts';

import type {AdapterLibraryEntry} from '../../../../packages/candidate-engine/src/site-adapter-library.ts';
type SiteAdapterPreview={previewId:string;siteId:string;version:string;roleCount:number;stateCount:number;urlPatterns:readonly string[];sourceHash:string};

declare global {interface Window{ussm:{
 getAppInfo:()=>Promise<{version:string;distributionMode:string;dataRoot:string;preferredChromePath:string|null}>;
 probeLocators:(input:{scanId:string;itemIndex:number;targetId:string;approved:true})=>Promise<{summary:DomSummary;probe:LocatorProbeResult;totalLocators:number;checkedLocators:number}>;
 inspectElementVisibility:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<ReadOnlyVisibilityEvidence>;
 runDomContract:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;expectation:'exists'|'unique';approved:true})=>Promise<ReadOnlyDomContractResult>;
 verifyManagedDom:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;revisionHash:string;approved:true})=>Promise<ReadOnlyDomContractResult&{revisionHash:string;validationLevel:'V1-managed-read-only'}>;
 batchDiagnose:(input:{targetId:string;scanId:string;approved:true;offset:number})=>Promise<BatchDomResult&{remainingItems:number;startIndex:number}>;
 listDiagnosisHistory:()=>Promise<JournalRun[]>;
 cancelDiagnosis:(input:{scanId:string;targetId:string})=>Promise<{cancelled:boolean}>;
 suggestRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<VerifiedCandidate[]>;
 prepareVerifiedPreview:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<VerifiedPreviewResult>;
 suggestRepairsBulk:(input:{scanId:string;itemIndex:number;targetId:string;approved:true;offset?:number})=>Promise<BulkCandidateResult>;
 proposeRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;newSelector:string})=>Promise<{proposalId:string;oldSelector:string;newSelector:string;preview:string;baseHash:string;proposedHash:string}>;
 applyRepair:(input:{scanId:string;proposalId:string;approved:true})=>Promise<{backupPath:string;managedPath:string;hash:string}>;
 applyRepairGuarded:(input:{scanId:string;proposalId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<{status:'retained-v1'|'rolled-back-v1'|'rollback-blocked';appliedHash:string;activeHash:string|null;backupPath:string;managedPath:string}>;
 listManagedRevisions:(input:{scanId:string;itemIndex:number})=>Promise<ManagedRevision[]>;
 rollbackManaged:(input:{scanId:string;itemIndex:number;hash:string;approved:true})=>Promise<{hash:string;activePath:string}>;
 exportManaged:(input:{scanId:string;itemIndex:number})=>Promise<{canceled:boolean;path?:string;hash?:string;bytes?:number}>;
 listSiteAdapters:()=>Promise<AdapterLibraryEntry[]>;
 previewSiteAdapterImport:()=>Promise<SiteAdapterPreview|null>;
 approveSiteAdapterImport:(input:{previewId:string;approved:true})=>Promise<AdapterLibraryEntry>;
 discardSiteAdapterPreview:(input:{previewId:string})=>Promise<{discarded:boolean}>;
 inspectSiteAdapterRole:(input:{siteId:string;expectedSha256:string;roleId:string;declaredStateId:string;targetId:string;approved:true})=>Promise<RoleDomResult>;
 suggestSiteAdapterRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;siteId:string;expectedSha256:string;roleId:string;declaredStateId:string;approved:true})=>Promise<AdapterScopedRepairsResult>;
 pickChrome:()=>Promise<string|null>;launchChrome:()=>Promise<{started:boolean;port:number}>;launchIsolatedChrome:()=>Promise<{started:boolean;port:number;isolated:true}>;getCdpStatus:()=>Promise<{browser:string;protocolVersion:string|null;pages:{id:string;url:string}[]}>;
 pickFiles:()=>Promise<string[]>;pickDirectory:()=>Promise<string|null>;
 onTrustedDrop:(listener:(authorizedPaths:string[])=>void)=>(()=>void);
 scan:(request:{paths:string[];recursive:boolean})=>Promise<DesktopScanResult>;
 listScripts:()=>Promise<ScriptRecord[]>;
 exportReport:(format:'json'|'markdown')=>Promise<{canceled:boolean;path?:string}>;
 exportDomReport:(input:{scanId:string;targetId:string;format:'json'|'markdown'})=>Promise<{canceled:boolean;path?:string}>;
}}}
const nameOf=(path:string)=>path.replace(/\\/g,'/').split('/').at(-1)||path;
function App(){
 const [appInfo,setAppInfo]=useState<{version:string;distributionMode:string;dataRoot:string;preferredChromePath:string|null}|null>(null);
 const [paths,setPaths]=useState<string[]>([]);const [result,setResult]=useState<DesktopScanResult|null>(null);
 const [history,setHistory]=useState<ScriptRecord[]>([]);const [busy,setBusy]=useState(false);
 const [adapterLibrary,setAdapterLibrary]=useState<AdapterLibraryEntry[]|null>(null);
 const [adapterPreview,setAdapterPreview]=useState<SiteAdapterPreview|null>(null);
 const [adapterBusy,setAdapterBusy]=useState(false);
 const [adapterSelectedSiteId,setAdapterSelectedSiteId]=useState('');
 const [adapterSelectedRoleId,setAdapterSelectedRoleId]=useState('');
 const [adapterDeclaredStateId,setAdapterDeclaredStateId]=useState('');
 const [adapterRoleCheck,setAdapterRoleCheck]=useState<RoleDomResult|null>(null);
 const [adapterRoleBusy,setAdapterRoleBusy]=useState(false);
 const adapterRoleGeneration=useRef(new LatestRequestGate());
 const [adapterRepairCandidates,setAdapterRepairCandidates]=useState<AdapterScopedRepairsResult|null>(null);
 const [adapterRepairBusy,setAdapterRepairBusy]=useState(false);
 const adapterRepairGeneration=useRef(new LatestRequestGate());
 const [diagnosisHistory,setDiagnosisHistory]=useState<JournalRun[]|null>(null);
 const [error,setError]=useState('');const [message,setMessage]=useState('');const [focused,setFocused]=useState<number|null>(null);
 const [search,setSearch]=useState('');const [dragging,setDragging]=useState(false);
 const [chromePath,setChromePath]=useState('');const [cdp,setCdp]=useState<{browser:string;protocolVersion:string|null;pages:{id:string;url:string}[]}|null>(null);
 const [targetId,setTargetId]=useState('');
 const [batchResult,setBatchResult]=useState<(BatchDomResult&{remainingItems:number})|null>(null);
 const [batchRunning,setBatchRunning]=useState(false);
 const [batchPaused,setBatchPaused]=useState(false);
 const batchPauseGate=useRef<BatchPauseGate|null>(null);
 const [batchProgress,setBatchProgress]=useState(0);
 const batchCancel=useRef(false);
 const batchGeneration=useRef(new LatestRequestGate());
 const batchActive=useRef(false);
 const [pageProbe,setPageProbe]=useState<{summary:DomSummary;probe:LocatorProbeResult;totalLocators:number;checkedLocators:number}|null>(null);
 const [watchEnabled,setWatchEnabled]=useState(false);
 const [watchStatus,setWatchStatus]=useState<LiveLocatorSummary|null>(null);
 const [watchCheckedAt,setWatchCheckedAt]=useState('');
 const [watchError,setWatchError]=useState('');
 const watchRunning=useRef(false);
 const [repairIndex,setRepairIndex]=useState(0);const [repairNew,setRepairNew]=useState('');
 const [contractExpectation,setContractExpectation]=useState<'exists'|'unique'>('unique');
 const [contractEvidence,setContractEvidence]=useState<{selectorIndex:number;result:ReadOnlyDomContractResult}|null>(null);
 const contractGeneration=useRef(new LatestRequestGate());
 const contractActive=useRef(false);
 const [visibilityEvidence,setVisibilityEvidence]=useState<{selectorIndex:number;result:ReadOnlyVisibilityEvidence}|null>(null);
 const visibilityGeneration=useRef(new LatestRequestGate());
 const visibilityActive=useRef(false);
 const [repairCandidates,setRepairCandidates]=useState<VerifiedCandidate[]|null>(null);
 const [bulkRepairResults,setBulkRepairResults]=useState<BulkCandidateResult|null>(null);
 const bulkGeneration=useRef(new LatestRequestGate());
 const bulkActive=useRef(false);
 const probeGeneration=useRef(new LatestRequestGate());
 const probeActive=useRef(false);
 const [repairProposal,setRepairProposal]=useState<{proposalId:string;oldSelector:string;newSelector:string;preview:string;baseHash:string;proposedHash:string}|null>(null);
 const [repairApplied,setRepairApplied]=useState<{backupPath:string;managedPath:string;hash:string;itemIndex:number;selectorIndex:number}|null>(null);
 const [managedRevisions,setManagedRevisions]=useState<ManagedRevision[]|null>(null);
 const [managedActive,setManagedActive]=useState<{hash:string;activePath:string}|null>(null);
 useEffect(()=>{void window.ussm.listSiteAdapters().then(setAdapterLibrary).catch(error=>setError('无法读取本地 SiteAdapter 规则：'+String(error)));},[]);
 useEffect(()=>{void Promise.all([window.ussm.getAppInfo(),window.ussm.listScripts()]).then(([info,list])=>{setAppInfo(info);setHistory(list);setChromePath(info.preferredChromePath??'');}).catch(e=>setError(String(e)));},[]);
 const filtered=useMemo(()=>result?.items.map((item,index)=>({...item,index})).filter(item=>item.path.toLowerCase().includes(search.toLowerCase()))??[],[result,search]);
 const siteTrends=useMemo(()=>diagnosisHistory?summarizeSiteTrends(diagnosisHistory):[],[diagnosisHistory]);
 const selectedAdapter=adapterLibrary?.find(a=>a.siteId===adapterSelectedSiteId)??null;
 useEffect(()=>{adapterRoleGeneration.current.invalidate();setAdapterRoleCheck(null);setAdapterRoleBusy(false);},[targetId,adapterSelectedSiteId,adapterSelectedRoleId,adapterDeclaredStateId,adapterLibrary]);
 useEffect(()=>{adapterRepairGeneration.current.invalidate();setAdapterRepairCandidates(null);setAdapterRepairBusy(false);},[targetId,adapterSelectedSiteId,adapterSelectedRoleId,adapterDeclaredStateId,adapterLibrary,focused,repairIndex,result]);
 // Switching site or script revokes a previously granted read-only health watch.
 useEffect(()=>{setWatchEnabled(false);setWatchStatus(null);setWatchCheckedAt('');setWatchError('');},[focused,targetId]);
 useEffect(()=>{bulkGeneration.current.invalidate();if(bulkActive.current){bulkActive.current=false;setBusy(false);}setBulkRepairResults(null);},[focused,targetId,result]);
 useEffect(()=>{batchGeneration.current.invalidate();batchCancel.current=true;batchPauseGate.current?.cancel();batchPauseGate.current=null;setBatchPaused(false);if(batchActive.current){batchActive.current=false;setBatchRunning(false);setBusy(false);}setBatchResult(null);setBatchProgress(0);},[targetId,result]);
 useEffect(()=>{probeGeneration.current.invalidate();if(probeActive.current){probeActive.current=false;setBusy(false);}setPageProbe(null);},[focused,targetId,result]);
 useEffect(()=>{contractGeneration.current.invalidate();if(contractActive.current){contractActive.current=false;setBusy(false);}setContractEvidence(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{visibilityGeneration.current.invalidate();if(visibilityActive.current){visibilityActive.current=false;setBusy(false);}setVisibilityEvidence(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{
  if(!watchEnabled||focused===null||!targetId||!result)return;
  const currentScanId=result.scanId;
  let cancelled=false;
  async function poll(){
   if(watchRunning.current)return;
   watchRunning.current=true;
   try{
    const evidence=await window.ussm.probeLocators({scanId:currentScanId,itemIndex:focused!,targetId,approved:true});
    if(cancelled)return;
    setPageProbe(evidence);
    setRepairCandidates(null);
    const watchSummary=summarizeLiveLocatorCheck(evidence.probe.checks);
    setWatchStatus(watchSummary.status==='locator-missing'&&evidence.summary.authorShadowTreeNodes>0?
     {...watchSummary,status:'needs-review',missing:0,needsReview:watchSummary.needsReview+watchSummary.missing}:
     watchSummary);
    setWatchCheckedAt(new Date().toLocaleString());
    setWatchError('');
   }catch(error){
    if(!cancelled){setWatchError('巡检暂停校验：'+String(error));setWatchStatus(null);}
   }finally{watchRunning.current=false;}
  }
  void poll();
  const interval=setInterval(()=>void poll(),60_000);
  return ()=>{cancelled=true;clearInterval(interval);};
 },[watchEnabled,focused,targetId,result]);

 async function chooseFiles(){try{const selected=await window.ussm.pickFiles();setPaths(old=>[...new Set([...old,...selected])]);setError('');}catch(e){setError(String(e));}}
 async function chooseDirectory(){try{const selected=await window.ussm.pickDirectory();if(selected)setPaths(old=>[...new Set([...old,selected])]);setError('');}catch(e){setError(String(e));}}
 function onDrop(event:React.DragEvent<HTMLDivElement>){event.preventDefault();setDragging(false);}
 useEffect(()=>window.ussm.onTrustedDrop(allowed=>{
  setPaths(old=>[...new Set([...old,...allowed])]);
  setError('');setMessage('已接收 '+allowed.length+' 个系统拖放的脚本文件');
 }),[]);
 async function scan(){if(!paths.length)return;setBusy(true);setError('');setMessage('');try{const report=await window.ussm.scan({paths,recursive:true});setResult(report);setFocused(null);setPageProbe(null);setRepairCandidates(null);setRepairProposal(null);setRepairApplied(null);setManagedRevisions(null);setManagedActive(null);setHistory(await window.ussm.listScripts());setMessage(`已分析 ${report.processedCount} 项 · 不代表网页功能正常`);}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function exportReport(format:'json'|'markdown'){try{const saved=await window.ussm.exportReport(format);if(!saved.canceled)setMessage(`报告已保存：${saved.path}`);}catch(e){setError(String(e));}}
 async function exportDomReport(format:'json'|'markdown'){if(!result||!batchResult||batchRunning)return;try{const saved=await window.ussm.exportDomReport({scanId:result.scanId,targetId:batchResult.pageTargetId,format});if(!saved.canceled)setMessage(`只读 DOM 报告已保存：${saved.path}`);}catch(e){setError(String(e));}}
 async function stageSiteAdapterImport(){
  if(adapterBusy)return;
  setAdapterBusy(true);const prior=adapterPreview;setAdapterPreview(null);setError('');
  try{
   if(prior)await window.ussm.discardSiteAdapterPreview({previewId:prior.previewId});
   const preview=await window.ussm.previewSiteAdapterImport();
   if(preview){setAdapterPreview(preview);setMessage('规则文件已解析，仅为预览；需要单独确认才会保存在本机。');}
  }catch(error){setError('SiteAdapter JSON 预览失败：'+String(error));}
  finally{setAdapterBusy(false);}
 }
 async function approveSiteAdapterImport(){
  if(adapterBusy||!adapterPreview)return;
  const previewId=adapterPreview.previewId;
  setAdapterBusy(true);setError('');
  try{
   const receipt=await window.ussm.approveSiteAdapterImport({previewId,approved:true});
   setAdapterLibrary(await window.ussm.listSiteAdapters());
   setMessage('已导入本地规则 '+receipt.siteId+' v'+receipt.version+'；未经过真实脚本运行或功能验证。');
   setAdapterPreview(null);
  }catch(error){setAdapterPreview(null);setError('SiteAdapter 导入失败（需重新预览）：'+String(error));}
  finally{setAdapterBusy(false);}
 }
 async function cancelSiteAdapterImport(){
  if(adapterBusy||!adapterPreview)return;
  const previewId=adapterPreview.previewId;setAdapterPreview(null);
  try{await window.ussm.discardSiteAdapterPreview({previewId});}
  catch(error){setError('取消 SiteAdapter 预览失败：'+String(error));}
 }
 async function inspectSiteAdapterRole(){
  if(!targetId||!selectedAdapter||!adapterSelectedRoleId||!adapterDeclaredStateId||adapterRoleBusy)return;
  const token=adapterRoleGeneration.current.begin();
  setAdapterRoleBusy(true);setAdapterRoleCheck(null);setError('');
  try{
   const receipt=await window.ussm.inspectSiteAdapterRole({
    siteId:selectedAdapter.siteId,expectedSha256:selectedAdapter.sha256,roleId:adapterSelectedRoleId,
    declaredStateId:adapterDeclaredStateId,targetId,approved:true,
   });
   adapterRoleGeneration.current.commit(token,()=>setAdapterRoleCheck(receipt));
  }catch(error){
   adapterRoleGeneration.current.commit(token,()=>setError('SiteAdapter 角色只读核验失败：'+String(error)));
  }finally{
   adapterRoleGeneration.current.commit(token,()=>setAdapterRoleBusy(false));
  }
 }

 async function suggestSiteAdapterRepair(){
  if(focused===null||!result||!selectedAdapter||!targetId||
     !adapterSelectedRoleId||!adapterDeclaredStateId||adapterRepairBusy)return;
  const token=adapterRepairGeneration.current.begin();
  setAdapterRepairBusy(true);setAdapterRepairCandidates(null);setError('');setRepairProposal(null);
  try{
   const suggested=await window.ussm.suggestSiteAdapterRepair({
    scanId:result.scanId,itemIndex:focused,selectorIndex:repairIndex,targetId,
    siteId:selectedAdapter.siteId,expectedSha256:selectedAdapter.sha256,
    roleId:adapterSelectedRoleId,declaredStateId:adapterDeclaredStateId,approved:true,
   });
   adapterRepairGeneration.current.commit(token,()=>setAdapterRepairCandidates(suggested));
  }catch(error){
   adapterRepairGeneration.current.commit(token,()=>setError('SiteAdapter 限定候选检查失败：'+String(error)));
  }finally{
   adapterRepairGeneration.current.commit(token,()=>setAdapterRepairBusy(false));
  }
 }
 async function pickChrome(){try{const p=await window.ussm.pickChrome();if(p)setChromePath(p);setError('');}catch(e){setError(String(e));}}
 async function startChrome(){try{await window.ussm.launchChrome();setMessage('选定 Chrome 的 CDP 握手已验证；点击「检查 CDP 连接」刷新可检查的网页列表。');}catch(e){setError(String(e));}}
 async function startIsolatedChrome(){try{await window.ussm.launchIsolatedChrome();setCdp(null);setTargetId('');setPageProbe(null);setRepairCandidates(null);setMessage('隔离 Chrome 的 CDP 握手已验证；独立资料目录不包含原有登录信息和扩展。点击「检查 CDP 连接」刷新网页列表。');}catch(e){setError(String(e));}}
 async function checkCdp(){try{setCdp(await window.ussm.getCdpStatus());setPageProbe(null);setRepairCandidates(null);setError('');}catch(e){setCdp(null);setError(`CDP 握手失败：${String(e)}。Chrome 136+ 对默认资料目录的调试开关有限制。`);}}
 async function loadDiagnosisHistory(){
  try{setDiagnosisHistory(await window.ussm.listDiagnosisHistory());}
  catch(error){setError('读取本地诊断历史失败：'+String(error));}
 }
 async function batchDiagnose(){
  if(!targetId||!result||batchRunning||busy)return;
  const token=batchGeneration.current.begin();
  const selectedTarget=targetId;
  const gate=new BatchPauseGate();batchPauseGate.current=gate;setBatchPaused(false);
  batchCancel.current=false;batchActive.current=true;setBatchRunning(true);setBatchProgress(0);
  setBusy(true);setError('');setBatchResult(null);
  try{
   const outcome=await collectPagedDomDiagnosis({
    total:result.items.length,targetId:selectedTarget,
    expectedItems:result.items.map(item=>({scriptId:item.scriptId,path:item.path})),
    requestPage:offset=>window.ussm.batchDiagnose({targetId:selectedTarget,scanId:result.scanId,approved:true,offset}),
    isCancelled:()=>batchCancel.current||!batchGeneration.current.isCurrent(token),
    pauseGate:gate,
    retryTransportFailures:1,
    onProgress:evidence=>{
     if(!batchGeneration.current.isCurrent(token))return;
     setBatchResult(evidence);setBatchProgress(evidence.totalItems);
    },
   });
   if(outcome.cancelled&&batchGeneration.current.isCurrent(token)){
    await window.ussm.cancelDiagnosis({scanId:result.scanId,targetId:selectedTarget}).catch(()=>{});
   }
   if(batchGeneration.current.isCurrent(token)){
    setMessage(outcome.cancelled?'已取消后续检查，已保存可用的只读诊断进度。':'批量网页诊断完成：已检查 '+outcome.totalItems+' 份脚本；结果仅为 DOM 证据。');
   }
  }catch(error){
   if(batchGeneration.current.isCurrent(token)){
    // Never display a partial result after inconsistent URL or page evidence.
    setBatchResult(null);setBatchProgress(0);
    setError('批量网页诊断失败，已清除不完整结果：'+String(error));
   }
  }finally{gate.cancel();if(batchPauseGate.current===gate)batchPauseGate.current=null;if(batchGeneration.current.isCurrent(token)){batchActive.current=false;setBatchPaused(false);setBatchRunning(false);setBusy(false);}}
 }
 async function probePage(){if(focused===null||!targetId||!result)return;
  const token=probeGeneration.current.begin();
  const selectedIndex=focused,selectedTarget=targetId,selectedScanId=result.scanId;
  probeActive.current=true;setBusy(true);setError('');setPageProbe(null);setRepairCandidates(null);
  try{
   const evidence=await window.ussm.probeLocators({scanId:selectedScanId,itemIndex:selectedIndex,targetId:selectedTarget,approved:true});
   if(probeGeneration.current.isCurrent(token)){
    setPageProbe(evidence);setMessage('只读页面定位器核验完成；不代表油猴脚本功能通过。');
   }
  }catch(error){
   if(probeGeneration.current.isCurrent(token))setError('页面定位器核验失败：'+String(error));
  }finally{if(probeGeneration.current.isCurrent(token)){probeActive.current=false;setBusy(false);}}
 }
 async function inspectElementVisibility(){
  if(focused===null||!result||!targetId||busy)return;
  const selector=result.items[focused]?.analysis?.selectorRecords[repairIndex];
  if(!selector||selector.runtimeRequired||selector.receiver!=='document')return;
  const token=visibilityGeneration.current.begin();
  const itemIndex=focused,selectorIndex=repairIndex,scanId=result.scanId,target=targetId;
  visibilityActive.current=true;setBusy(true);setError('');setVisibilityEvidence(null);
  try{
   const evidence=await window.ussm.inspectElementVisibility({scanId,itemIndex,selectorIndex,targetId:target,approved:true});
   if(visibilityGeneration.current.isCurrent(token)){
    setVisibilityEvidence({selectorIndex,result:evidence});
    setMessage('只读 CSS 可见性采样完成；不能证明元素可点击、脚本功能或 GM API 通过。');
   }
  }catch(error){
   if(visibilityGeneration.current.isCurrent(token))setError('CSS 可见性检查失败：'+String(error));
  }finally{
   if(visibilityGeneration.current.isCurrent(token)){visibilityActive.current=false;setBusy(false);}
  }
 }
 async function runDomContract(){
  if(focused===null||!result||!targetId||busy)return;
  const selector=result.items[focused]?.analysis?.selectorRecords[repairIndex];
  if(!selector||selector.runtimeRequired||selector.receiver!=='document')return;
  const token=contractGeneration.current.begin();
  const selectedIndex=focused,selectedLocator=repairIndex,selectedTarget=targetId;
  const scanId=result.scanId,expectation=contractExpectation;
  contractActive.current=true;setBusy(true);setError('');setContractEvidence(null);
  try{
   const evidence=await window.ussm.runDomContract({
    scanId,itemIndex:selectedIndex,selectorIndex:selectedLocator,targetId:selectedTarget,
    expectation,approved:true,
   });
   if(contractGeneration.current.isCurrent(token)){
    setContractEvidence({selectorIndex:selectedLocator,result:evidence});
    setMessage('双次 DOM 合约核验完成；只证明指定定位器的当前 DOM 状态，不代表脚本业务功能通过。');
   }
  }catch(error){
   if(contractGeneration.current.isCurrent(token))setError('DOM 合约核验失败：'+String(error));
  }finally{
   if(contractGeneration.current.isCurrent(token)){contractActive.current=false;setBusy(false);}
  }
 }
 async function suggestBulkRepairs(offset=0){
  if(focused===null||!targetId||!result)return;
  const token=bulkGeneration.current.begin();
  const selectedIndex=focused,selectedTarget=targetId;
  bulkActive.current=true;setBusy(true);setError('');
  if(offset===0)setBulkRepairResults(null);
  try{
   const suggestions=await window.ussm.suggestRepairsBulk({scanId:result.scanId,itemIndex:selectedIndex,targetId:selectedTarget,approved:true,offset});
   if(!bulkGeneration.current.isCurrent(token))return;
   if(offset!==0&&(!bulkRepairResults||bulkRepairResults.checkedMissing!==offset||
    bulkRepairResults.pageUrl!==suggestions.pageUrl||
    bulkRepairResults.pageTargetId!==suggestions.pageTargetId||
    bulkRepairResults.totalMissing!==suggestions.totalMissing))
    throw new Error('批量候选页面或结果数量发生变化，请重新检查');
   setBulkRepairResults(previous=>bulkGeneration.current.isCurrent(token)?
    offset>0&&previous?{...suggestions,items:[...previous.items,...suggestions.items]}:suggestions:previous);
   setMessage('批量候选只基于当前 DOM 的唯一匹配结果；不会执行脚本或自动写入补丁。');
  }catch(error){
   if(!bulkGeneration.current.isCurrent(token))return;
   setBulkRepairResults(null);setError('批量候选检查失败：'+String(error));
  }finally{if(bulkGeneration.current.isCurrent(token)){bulkActive.current=false;setBusy(false);}}
 }
 async function suggestRepair(){if(focused===null||!targetId||!result||pageProbe?.probe.checks[repairIndex]?.status!=='missing')return;
  setBusy(true);setError('');setRepairCandidates(null);setRepairProposal(null);
  try{const candidates=await window.ussm.suggestRepair({scanId:result.scanId,itemIndex:focused,selectorIndex:repairIndex,targetId,approved:true});setRepairCandidates(candidates);setMessage(candidates.length?'取得 '+candidates.length+' 个 DOM 匹配的候选；候选不代表功能验证通过。':'当前网页没有足够可靠的唯一候选，请手动输入新选择器。');}
  catch(e){setError('候选定位器提取失败：'+String(e));}finally{setBusy(false);}
 }
 async function prepareVerifiedPreview(){
  if(focused===null||!targetId||!result||busy||pageProbe?.probe.checks[repairIndex]?.status!=='missing')return;
  setWatchEnabled(false);setBusy(true);setError('');setRepairProposal(null);setRepairApplied(null);
  try{
   const receipt=await window.ussm.prepareVerifiedPreview({scanId:result.scanId,itemIndex:focused,selectorIndex:repairIndex,targetId,approved:true});
   if(receipt.status==='prepared'&&receipt.proposal&&receipt.candidate){
    setRepairNew(receipt.candidate.expression);
    setRepairProposal(receipt.proposal);
    setMessage('已从唯一 CDP 候选自动准备补丁预览；仍需单独审核保存。原脚本未修改，V2/V3/V4 未验证。');
   }else{
    setMessage('没有唯一可靠的 DOM 候选：需要人工复核，未创建修复预览，未写入文件。');
   }
  }catch(error){setError('自动准备修复预览失败：'+String(error));}
  finally{setBusy(false);}
 }
 async function proposeRepair(){if(focused===null||!result||!repairNew.trim())return;
  setWatchEnabled(false);setBusy(true);setError('');setRepairProposal(null);setRepairApplied(null);
  try{const r=await window.ussm.proposeRepair({scanId:result.scanId,itemIndex:focused,selectorIndex:repairIndex,newSelector:repairNew.trim()});setRepairProposal(r);setMessage('修复预览已生成；尚未写入任何文件。');}
  catch(e){setError('生成预览失败：'+String(e));}finally{setBusy(false);}
 }
 async function applyRepair(){if(!repairProposal||!result)return;
  setWatchEnabled(false);setBusy(true);setError('');
  try{const r=await window.ussm.applyRepair({scanId:result.scanId,proposalId:repairProposal.proposalId,approved:true});setRepairApplied({...r,itemIndex:focused??-1,selectorIndex:repairIndex});setManagedRevisions(null);setManagedActive({hash:r.hash,activePath:r.managedPath});setRepairProposal(null);setMessage('受管修复副本已保存；原始脚本没有被覆盖。');}
  catch(e){setError('修复保存失败：'+String(e));}finally{setBusy(false);}
 }
 async function applyRepairGuarded(){
  if(!repairProposal||!result||focused===null||!targetId||busy)return;
  setWatchEnabled(false);setBusy(true);setError('');
  try{
   const guarded=await window.ussm.applyRepairGuarded({
    scanId:result.scanId,proposalId:repairProposal.proposalId,
    itemIndex:focused,selectorIndex:repairIndex,targetId,approved:true,
   });
   setRepairProposal(null);setManagedRevisions(null);
   if(guarded.status==='retained-v1'){
    setRepairApplied({backupPath:guarded.backupPath,managedPath:guarded.managedPath,
     hash:guarded.appliedHash,itemIndex:focused,selectorIndex:repairIndex});
    setManagedActive(null);
    setMessage('修订在真实 Chrome V1 双采样中成立，已保留受管副本。V2/V3/V4 未验证；尚不能判定油猴脚本功能成功。');
   }else if(guarded.status==='rolled-back-v1'){
    setRepairApplied(null);setManagedActive(null);
    setMessage('新修订的 V1 证据不成立或无法确认，已自动恢复上一受管修订。V2/V3/V4 未验证，原始脚本未覆盖。');
   }else{
    setRepairApplied(null);setManagedActive(null);
    setError('自动复核后回滚受阻（rollback-blocked）：未确认当前受管版本；请先检查修订历史和外部编辑，原始脚本保持不变。');
   }
  }catch(error){setError('受管补丁安全保存和 V1 自动复核失败：'+String(error));}
  finally{setBusy(false);}
 }
 async function verifyManagedDom(){
  if(!result||!repairApplied||!targetId||focused!==repairApplied.itemIndex||busy)return;
  setBusy(true);setError('');
  try{
   const resultV1=await window.ussm.verifyManagedDom({
    scanId:result.scanId,itemIndex:repairApplied.itemIndex,selectorIndex:repairApplied.selectorIndex,
    targetId,revisionHash:repairApplied.hash,approved:true,
   });
   setMessage('受管修订选择器只读复核 V1：'+resultV1.status+'；'+resultV1.reason+
    '。这是保存的脚本修订在当前网页的 DOM 证据；V2/V3/V4 未验证，不表示 Tampermonkey 已安装或功能正常。');
  }catch(error){setError('受管修订 V1 检查失败：'+String(error));}
  finally{setBusy(false);}
 }
 async function showManagedHistory(){if(focused===null||!result)return;
  setBusy(true);setError('');
  try{setManagedRevisions(await window.ussm.listManagedRevisions({scanId:result.scanId,itemIndex:focused}));}
  catch(e){setError('加载修订历史失败：'+String(e));}finally{setBusy(false);}
 }
 async function exportManaged(){if(focused===null||!result)return;
  setBusy(true);setError('');
  try{const exported=await window.ussm.exportManaged({scanId:result.scanId,itemIndex:focused});
   if(!exported.canceled)setMessage('已安全导出受管脚本：'+exported.path+'。仍需在 Tampermonkey 导入并验证实际功能。');
  }catch(error){setError('导出受管脚本失败：'+String(error));}
  finally{setBusy(false);}
 }
 async function rollbackManaged(hash:string){if(focused===null||!result)return;
  setBusy(true);setError('');setRepairProposal(null);
  try{const restored=await window.ussm.rollbackManaged({scanId:result.scanId,itemIndex:focused,hash,approved:true});setManagedActive(restored);setMessage('当前受管副本已恢复到所选修订；原始脚本不会被覆盖。仍需自行验收脚本行为。');}
  catch(e){setError('恢复受管副本失败：'+String(e));}finally{setBusy(false);}
 }
 const details=focused===null?null:result?.items[focused];
 return <div className="shell">
  <aside className="sidebar"><div className="logo"><span className="logo-icon">✦</span><span>USSHM <small>SELF-HEALING MANAGER</small></span></div>
   <nav><div className="nav-label">工作区</div><div className="nav-item active">▦　脚本资料库</div><div className="nav-item">⌁　页面定位器核验 <span>只读</span></div><div className="nav-item">⚙　受控修复工作台 <span>预览</span></div><div className="nav-label">系统</div><div className="nav-item">◉　Chrome CDP <span>可连接</span></div></nav>
   <div className="sidebar-bottom">V{appInfo?.version??'0.1'} · {appInfo?.distributionMode??'preview'}<div className="dim">本地数据 · 不上传脚本</div></div>
  </aside>
  <main className="main"><header><div><div className="eyebrow">USERSCRIPT MAINTENANCE</div><h1>油猴脚本智能自愈管理器</h1><p>批量检查源码中的 DOM 依赖，定位潜在失效点，记录可追溯的静态分析结果。</p></div><span className="status-dot">●　离线分析模式</span></header>
   <section className="stats"><div className="stat"><label>资料库脚本</label><strong>{history.length}</strong><span>SQLite 本地索引</span></div><div className="stat"><label>本次处理</label><strong>{result?.processedCount??0}</strong><span>逐文件隔离</span></div><div className="stat"><label>解析错误</label><strong className={result?.errorCount?'warn':''}>{result?.errorCount??0}</strong><span>待人工检查</span></div><div className="stat"><label>动态 Selector</label><strong>{result?.items.reduce((sum,x)=>sum+x.runtimeRequiredCount,0)??0}</strong><span>需要运行时确认</span></div></section>
   <section className="panel import"><div className="panel-head"><div><h2>导入并扫描脚本</h2><p>仅静态检查，不运行 JavaScript，不修改原件。</p></div><span className="pill">安全只读</span></div>
   <div className={'drop '+(dragging?'dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{void onDrop(e);}}>
     <div className="drop-symbol">⇧</div><b>拖放 .user.js 文件到这里</b><div>或者使用按钮选择单个、多个脚本及脚本文件夹</div>
     <div className="actions"><button type="button" onClick={()=>void chooseFiles()}>选择脚本</button><button type="button" className="secondary" onClick={()=>void chooseDirectory()}>选择文件夹</button></div>
   </div>
   <div className="queue"><div className="queue-title">待检测路径 <span>{paths.length} 项</span></div>{paths.length?<div className="chips">{paths.map(path=><span key={path} title={path}>{nameOf(path)} <button aria-label={`移除 ${nameOf(path)}`} onClick={()=>setPaths(old=>old.filter(x=>x!==path))}>×</button></span>)}</div>:<div className="dim">尚未选择任何脚本。</div>}</div>
   <div className="toolbar"><button disabled={!paths.length||busy} className="primary" onClick={()=>void scan()}>{busy?'分析进行中…':'开始静态诊断'} →</button><div className="dim">本版本尚未验证网页功能</div></div>
   </section>
   <section className="panel">
    <div className="panel-head"><div><h2>版本化站点兼容规则（SiteAdapter）</h2>
     <p>仅管理本地、静态的语义定位规则。导入前预览并单独批准；不会执行规则文件中的代码，不会自动修复油猴脚本。</p>
    </div><span className="pill">定义级 · 只读</span></div>
    <div className="toolbar">
     <button type="button" className="secondary" disabled={adapterBusy} onClick={()=>void stageSiteAdapterImport()}>预览 SiteAdapter JSON</button>
     <button type="button" className="secondary" disabled={adapterBusy} onClick={()=>void window.ussm.listSiteAdapters().then(setAdapterLibrary).catch(error=>setError(String(error)))}>刷新本地规则</button>
     <span className="dim">同站点已存在版本禁止直接覆盖；升级仍需要完整依赖影响审查。</span>
    </div>
    {adapterPreview&&<div className="notice">
     <p><b>待批准规则：</b>{adapterPreview.siteId} · v{adapterPreview.version} · {adapterPreview.stateCount} 种状态 · {adapterPreview.roleCount} 个角色</p>
     <p>许可站点：{adapterPreview.urlPatterns.join('、')}</p>
     <p className="dim">SHA-256：<code>{adapterPreview.sourceHash.slice(0,20)}…</code>。确认后仅保存规则定义，不会自动绑定、加载脚本或执行兼容性升级。</p>
     <div className="toolbar">
      <button type="button" disabled={adapterBusy} onClick={()=>void approveSiteAdapterImport()}>确认导入此规则</button>
      <button type="button" className="secondary" disabled={adapterBusy} onClick={()=>void cancelSiteAdapterImport()}>取消预览</button>
     </div>
    </div>}
    {adapterLibrary&&<div className="table-wrapper"><table><thead><tr><th>站点</th><th>版本</th><th>角色</th><th>页面状态</th><th>定义来源</th></tr></thead><tbody>
     {adapterLibrary.map(adapter=><tr key={adapter.siteId}><td>{adapter.siteId}</td><td>v{adapter.version}</td><td>{adapter.roleCount}</td><td>{adapter.stateCount}</td><td>本机 JSON · 仅定义</td></tr>)}
    </tbody></table>{adapterLibrary.length===0&&<p className="dim">尚无已导入的 SiteAdapter。</p>}</div>}
    <div className="toolbar" style={{flexWrap:'wrap'}}>
     <label>选择已保存站点
      <select aria-label="SiteAdapter 站点" value={adapterSelectedSiteId} onChange={e=>{setAdapterSelectedSiteId(e.target.value);setAdapterSelectedRoleId('');setAdapterDeclaredStateId('');}}>
       <option value="">— 先选择站点 —</option>{adapterLibrary?.map(a=><option key={a.siteId} value={a.siteId}>{a.siteId} · v{a.version}</option>)}
      </select></label>
     <label>语义角色
      <select aria-label="SiteAdapter 语义角色" value={adapterSelectedRoleId} onChange={e=>setAdapterSelectedRoleId(e.target.value)}>
       <option value="">— 选择角色 —</option>{selectedAdapter?.roleIds.map(id=><option key={id} value={id}>{id}</option>)}
      </select></label>
     <label>声明页面状态（未经实际证明）
      <select aria-label="SiteAdapter 声明页面状态" value={adapterDeclaredStateId} onChange={e=>setAdapterDeclaredStateId(e.target.value)}>
       <option value="">— 选择状态 —</option>{selectedAdapter?.stateIds.map(id=><option key={id} value={id}>{id}</option>)}
      </select></label>
     <button type="button" disabled={!targetId||!cdp||!selectedAdapter||!adapterSelectedRoleId||!adapterDeclaredStateId||adapterRoleBusy} onClick={()=>void inspectSiteAdapterRole()}>
      {adapterRoleBusy?'正在只读检查…':'检查 SiteAdapter 角色 DOM（只读）'}</button>
     <button type="button" className="secondary" disabled={!result||focused===null||!targetId||!cdp||!selectedAdapter||
      !adapterSelectedRoleId||!adapterDeclaredStateId||adapterRepairBusy||busy}
      onClick={()=>void suggestSiteAdapterRepair()}>
      {adapterRepairBusy?'正在核验候选…':'按 SiteAdapter 角色筛选修复候选'}
     </button>
    </div>
    <p className="dim">先在下方连接 Chrome 并明确选定目标网页。状态由用户声明、未经过运行时验证；可检查明确选择的顶层普通 DOM 或受限单个开放式 ShadowRoot；候选修复仅支持普通 document 作用域，不进行点击或页面注入。</p>
    {adapterRoleCheck&&<div className="notice">
     <b>角色核验结果：</b>{adapterRoleCheck.status==='matched-v1'?'当前 DOM 两次采样匹配':adapterRoleCheck.status==='absent-v1'?'当前主文档两次采样均无匹配':adapterRoleCheck.status==='needs-review'?'证据不足／需复核':'当前角色或页面上下文不支持检查'}
     <p>站点 {adapterRoleCheck.siteId} · 版本 {adapterRoleCheck.version} · 角色 {adapterRoleCheck.roleId} · DOM 证据等级 {adapterRoleCheck.evidenceLevel}</p>
     {adapterRoleCheck.matchedSelector&&<code>{adapterRoleCheck.matchedSelector}</code>}
     <p className="dim">{adapterRoleCheck.reason}；状态未经验证，不表示脚本正在运行。</p>
     <p className="dim">V2：阻断 · V3/V4：未配置 · Tampermonkey 与 GM_* 功能未验证；本操作没有修改脚本或扩展。</p>
    </div>}
    {adapterRepairCandidates&&<div className="notice">
     <p><b>SiteAdapter 候选仅是 DOM 证据</b>，不会自动更新源码、激活适配器或证明业务功能正常。</p>
     <p>角色规则：{adapterRepairCandidates.status} · 根上下文：{adapterRepairCandidates.rootScope??'未确认'} · 匹配建议 {adapterRepairCandidates.candidates.length} 项</p>
     {adapterRepairCandidates.candidates.length===0?
      <p className="dim">没有符合当前已审查规则、脚本定位器和网页 DOM 的候选；请复核或使用现有手动预览流程。</p>:
      adapterRepairCandidates.candidates.map(candidate=><div className="selector" key={candidate.expression}>
       <code>{candidate.expression}</code>
       <small>DOM 唯一匹配 · 排序分 {candidate.confidenceScore} · 未验证 V2/V3/V4 或 Tampermonkey</small>
       <button type="button" className="secondary" disabled={adapterRepairBusy||busy}
        onClick={()=>{setRepairNew(candidate.expression);setRepairProposal(null);setMessage('已将 SiteAdapter 候选填入修复工作台；请审核并单独生成预览，尚未修改任何脚本。');}}>
        采用候选并进入独立修复预览
       </button>
      </div>)}
    </div>}
    <p className="dim">所有兼容规则仅为候选定义，未经过真实脚本运行或功能验证。V3／V4 未配置，尚不能认定 Tampermonkey 或 GM_* 功能正常。</p>
   </section>
   <section className="panel"><div className="panel-head"><div><h2>Chrome CDP 浏览器连接</h2><p>仅连接本机 127.0.0.1:9223；可进行人工授权的只读 DOM 快照和定位器匹配，不执行用户脚本。</p></div><span className="pill">受控连接</span></div>
    <div className="actions" style={{justifyContent:'flex-start',flexWrap:'wrap'}}><button className="secondary" onClick={()=>void pickChrome()}>选择 Chrome</button><button className="secondary" disabled={!chromePath} onClick={()=>void startChrome()}>启动浏览器调试</button><button className="secondary" disabled={!chromePath} onClick={()=>void startIsolatedChrome()}>启动隔离调试 Chrome</button><button onClick={()=>void checkCdp()}>检查 CDP 连接</button></div>
    <p className="dim" style={{overflowWrap:'anywhere',marginTop:12}}>{chromePath||'尚未选择浏览器 EXE（可选择便携版 Chrome）'}</p>
     <p className="dim">如 Chrome 136+ 的现有资料目录禁用远程调试，可主动使用隔离模式；资料保存在本软件 Data/Chrome-CDP-Profile。不会使用原有 Chrome 的登录状态或扩展，需要自行安装 Tampermonkey 与测试脚本。</p>
    {cdp&&<div className="notice">检测到本机 CDP：{cdp.browser} · 当前可见 Page Targets：{cdp.pages.length} · Protocol {cdp.protocolVersion||'未知'} · 未验证是否为已选择的 Chrome</div>}
    {cdp&&cdp.pages.length>0&&<div className="toolbar"><label htmlFor="cdp-page">选择正在浏览的网页：</label><select id="cdp-page" aria-label="CDP 页面目标" value={targetId} onChange={e=>{setTargetId(e.target.value);setPageProbe(null);setRepairCandidates(null);setRepairNew('');setRepairProposal(null);}}><option value="">— 请明确选择目标网页 —</option>{cdp.pages.map(p=><option key={p.id} value={p.id}>{p.url.slice(0,130)}</option>)}</select></div>}
    <div className="toolbar"><button disabled={!cdp||!targetId||!result||busy} onClick={()=>void batchDiagnose()}>批量网页诊断（只读）</button>{batchRunning&&<button className="secondary" onClick={()=>{const active=batchPauseGate.current;if(!active)return;if(batchPaused){active.resume();setBatchPaused(false);}else if(active.pause())setBatchPaused(true);}}>{batchPaused?'继续检查':'暂停后续检查'}</button>}{batchRunning&&<button className="secondary" onClick={()=>{batchCancel.current=true;batchPauseGate.current?.cancel();setBatchPaused(false);if(result&&targetId)void window.ussm.cancelDiagnosis({scanId:result.scanId,targetId}).catch(error=>setError('取消诊断请求失败：'+String(error)));}}>取消剩余检查</button>}<span className="dim">自动每批处理 25 份，按顺序完成所有已导入脚本；已检查 {batchProgress}/{result?.items.length??0}。{batchPaused?'已暂停下一批调度；当前请求完成后生效。':''}</span></div>
    <p className="dim">批量诊断不执行油猴脚本、不自动修改原文件或 Tampermonkey 存储，也不等于脚本业务功能通过。临时 CDP 通信超时最多重试一次，导航、身份变化及安全校验失败绝不重试。</p>
    <div className="toolbar"><button className="secondary" onClick={()=>void loadDiagnosisHistory()}>最近批量诊断历史</button><span className="dim">保存在本机独立 SQLite，重启可查看历史进度；不会自动重连旧网页或恢复旧任务。</span></div>
    {diagnosisHistory&&<div className="table-wrapper"><table><thead><tr><th>时间</th><th>站点</th><th>状态</th><th>进度</th><th>匹配</th><th>缺失</th><th>需复核</th><th>错误</th></tr></thead><tbody>
     {diagnosisHistory.map(run=><tr key={run.runId}><td>{run.startedAt}</td><td>{run.pageOrigin}</td>
      <td>{run.status==='completed'?'完成':run.status==='interrupted'?'中断':run.status==='cancelled'?'取消':run.status==='failed'?'失败':'运行中'}</td>
      <td>{run.processedItems}/{run.totalItems}</td><td>{run.domPresent}</td><td>{run.locatorMissing}</td><td>{run.needsReview}</td><td>{run.errors}</td>
     </tr>)}</tbody></table>{diagnosisHistory.length===0&&<div className="dim">暂无本地批量诊断历史。</div>}</div>}
    {diagnosisHistory&&siteTrends.length>0&&<div className="batch-diagnosis">
     <h3>最近站点诊断趋势（仅 DOM）</h3>
     <p className="dim">只比较同一站点最近两次完整诊断、且扫描脚本数量一致的批次。缺失计数变化不能证明网站更新、脚本损坏、修复成功或 V3/V4 功能状态。</p>
     <div className="table-wrapper"><table><thead><tr><th>站点</th><th>趋势</th><th>最近缺失</th><th>上次缺失</th><th>对比条件</th></tr></thead><tbody>
     {siteTrends.map(trend=><tr key={trend.pageOrigin}><td>{trend.pageOrigin}</td>
      <td>{trend.kind==='more-missing'?'缺失记录增加':trend.kind==='fewer-missing'?'缺失记录减少':trend.kind==='unchanged'?'缺失数量无变化':trend.kind==='not-comparable'?'批次不可比较':'证据不足'}</td>
      <td>{trend.currentMissing}</td><td>{trend.previousMissing??'—'}</td>
      <td>{trend.comparable?'两次完整批次，数量一致':'不可得出 DOM 趋势结论'}</td>
     </tr>)}</tbody></table></div>
    </div>}


    {batchResult&&<div className="toolbar"><button className="secondary" disabled={batchRunning||batchResult.totalItems<1} onClick={()=>void exportDomReport('json')}>导出 DOM JSON</button><button className="secondary" disabled={batchRunning||batchResult.totalItems<1} onClick={()=>void exportDomReport('markdown')}>导出 DOM Markdown</button><span className="dim">仅导出脱敏统计及 V0–V4 状态，不包含原始 DOM、完整本地路径或页面查询参数。</span></div>}
    {batchResult&&<div className="batch-diagnosis">
      <div className="notice">批量诊断结果：已完成 {batchResult.totalItems} 份 · 页面：{batchResult.pageUrl} · {batchResult.remainingItems>0?`还有 ${batchResult.remainingItems} 份等待处理（自动分批，每批 25 份）`:'本次扫描范围已全部处理'}</div>
      <div className="table-wrapper"><table><thead><tr><th>脚本</th><th>结果（仅 DOM）</th><th>已检查</th><th>匹配</th><th>缺失</th><th>需复核</th><th>验证等级</th></tr></thead><tbody>
       {batchResult.items.map(row=><tr key={row.index}><td title={row.path}>{nameOf(row.path)}</td><td>{row.status==='locator-missing'?'有选择器缺失':row.status==='dom-present'?'DOM 有匹配':row.status==='out-of-scope'?'不在脚本匹配范围':row.status==='needs-review'?'需要运行时复核':row.status==='skipped'?'跳过':row.status==='error'?'检查失败':'无定位器证据'}{row.reason&&<small>{row.reason}</small>}</td><td>{row.checked}</td><td>{row.found}</td><td>{row.missing}</td><td>{row.needsReview}</td><td><small>V0：{row.verification?.V0??'blocked'} · V1：{row.verification?.V1??'blocked'} · V2：{row.verification?.V2??'blocked'} · V3/V4：{row.verification?.V3??'not-configured'} / {row.verification?.V4??'not-configured'}</small></td></tr>)}
      </tbody></table></div>
    </div>}
   </section>
   {(error||message)&&<div role="status" className={'notice '+(error?'error':'')}>{error||message}</div>}
   <section className="panel"><div className="panel-head"><div><h2>静态诊断结果</h2><p>每个脚本独立显示解析状态与需要运行时确认的定位器。</p></div><div className="actions small"><button disabled={!result} className="secondary" onClick={()=>void exportReport('json')}>导出 JSON</button><button disabled={!result} className="secondary" onClick={()=>void exportReport('markdown')}>导出 Markdown</button></div></div>
   {result?<><input aria-label="筛选脚本" className="search" placeholder="搜索脚本名称或路径" value={search} onChange={e=>setSearch(e.target.value)}/><div className="table-wrapper"><table><thead><tr><th>文件</th><th>状态</th><th>Selectors</th><th>动态表达式</th><th></th></tr></thead><tbody>{filtered.map(item=><tr key={item.index}><td><b>{nameOf(item.path)}</b><small>{item.path}</small></td><td><span className={'tag '+(item.status==='parsed'?'ok':'bad')}>{item.status==='parsed'?'静态解析完成':item.status==='parse-error'?'语法错误':item.status==='unreadable'?'无法读取':'已跳过'}</span></td><td>{item.selectorCount}</td><td>{item.runtimeRequiredCount?`需要运行时确认 × ${item.runtimeRequiredCount}`:'—'}</td><td><button className="link" onClick={()=>{setFocused(item.index);setPageProbe(null);setRepairCandidates(null);setRepairProposal(null);setRepairApplied(null);setManagedRevisions(null);setManagedActive(null);setRepairIndex(0);setRepairNew('');}}>详情 ›</button></td></tr>)}</tbody></table></div></>:<div className="empty"><span>⌕</span><b>尚未开始诊断</b><p>先添加脚本，然后开始静态扫描。</p></div>}
   </section>
   {details&&<section className="panel"><div className="panel-head"><div><h2>{nameOf(details.path)} · Selector 清单</h2><p>先选目标网页，再点击授权核验；不代表油猴脚本功能通过。</p></div><button className="secondary" onClick={()=>{setFocused(null);setPageProbe(null);}}>关闭</button></div>
   {details.analysis?.managerApiCalls?.length ? <div className="notice">
     <b>GM 权限静态清单 · {details.analysis.managerApiCalls.length} 次 API 调用（V4 未验证）</b>
     <p className="dim">仅根据本地 JavaScript AST 与 @grant 元数据比对；无法确认 Tampermonkey 注入、沙箱权限或任何 GM_* 实际功能。</p>
     {details.analysis.managerApiCalls.slice(0,30).map((usage,index)=><div key={index}>
       <code>{usage.api}</code> · 第 {usage.line} 行 · {usage.grantStatus==='declared'?'@grant 已声明（仅静态）':usage.grantStatus==='missing'?'@grant 可能缺失，需检查':'动态 GM 成员名未知'}
     </div>)}
     {details.analysis.managerApiCalls.length>30&&<small>其余 {details.analysis.managerApiCalls.length-30} 项已折叠；完整证据保留在扫描结果中。</small>}
    </div> : null}
   <div className="toolbar"><button disabled={!cdp||!targetId||busy} onClick={()=>void probePage()}>页面定位器核验（只读）</button><span className="dim">每次最多检查前 50 个定位器；不执行脚本、不自动修改文件。</span></div>
    <div className="toolbar"><button disabled={!cdp||!targetId||busy||(!watchEnabled&&!pageProbe)} onClick={()=>setWatchEnabled(old=>!old)}>{watchEnabled?'停止巡检':'启动每分钟只读巡检'}</button><span className="dim">只有窗口运行、目标页面保持匹配时定期复核；不写入脚本、不自动修复。</span></div>
    <p className="dim">巡检只用于 DOM 检测，不代表 Tampermonkey 功能通过。</p>
    {watchStatus&&<div className="notice">最近巡检：{watchCheckedAt} · {watchStatus.status==='locator-missing'?'当前页面存在未匹配的选择器':watchStatus.status==='dom-present'?'当前 DOM 有匹配节点（非功能通过）':watchStatus.status==='needs-review'?'当前结果需人工确认':'当前没有可检查的定位器'} · 匹配 {watchStatus.found} · 缺失 {watchStatus.missing} · 未确定 {watchStatus.needsReview}</div>}
    {watchError&&<div className="notice error">{watchError}</div>}
   {pageProbe&&<div className="notice"><b>DOM 文档节点：</b>{pageProbe.summary.nodeCount} · 文档：{pageProbe.summary.documentCount} · 作者 Shadow Tree 节点：{pageProbe.summary.authorShadowTreeNodes} · 已检查 {pageProbe.checkedLocators}/{pageProbe.totalLocators} 个定位器；仅当前 document 作用域，不代表油猴脚本功能通过。{pageProbe.summary.authorShadowTreeNodes>0&&<strong> Shadow DOM 内的定位器未被顶层 document 检查覆盖，需复核。</strong>}</div>}
   {pageProbe?.probe.checks.map((check,index)=><div className="selector" key={index}><div className="selector-top"><span>{check.method}</span><b>{check.status==='found'?'当前匹配':check.status==='missing'&&pageProbe.summary.authorShadowTreeNodes>0?'需复核（Shadow DOM）':check.status==='missing'?'无匹配':check.status==='ambiguous'?'多重匹配':check.status==='blocked'?'无法核验':'需要运行时确认'}</b></div><code>{check.expression}</code><small>匹配数：{check.matchCount===null?'未知':check.matchCount} · {check.reason}</small></div>)}
   <div className="toolbar">
    <label>DOM 合约预期<select aria-label="DOM 合约条件" value={contractExpectation} onChange={e=>{setContractExpectation(e.target.value as 'exists'|'unique');setContractEvidence(null);}}>
     <option value="unique">唯一匹配</option><option value="exists">至少一个匹配</option>
    </select></label>
    <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired||details.analysis?.selectorRecords[repairIndex]?.receiver!=='document'}
     onClick={()=>void runDomContract()}>双次 DOM 合约核验（V1，只读）</button>
    <span className="dim">仅当前顶层 document、连续两次 CDP 只读检查；V2 未验证，V3/V4：未配置。不执行脚本，也不触发按钮操作。</span>
   </div>
   {contractEvidence&&contractEvidence.selectorIndex===repairIndex&&<div className="notice">
    <b>命名 DOM 合约：</b>{contractEvidence.result.caseId} · 结果：{contractEvidence.result.status==='passed'?'通过（仅 DOM）':contractEvidence.result.status==='failed'?'未满足 DOM 条件':'需要复核'}
    · 连续检查 {contractEvidence.result.attempts} 次 · 匹配数量 {contractEvidence.result.matchCount??'不确定'} · 等级 {contractEvidence.result.evidenceLevel} · V3/V4：未配置
    <small>{contractEvidence.result.reason}；不能据此认定 Tampermonkey 已注入或脚本功能已修复。</small>
   </div>}
   <div className="toolbar">
    <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired||details.analysis?.selectorRecords[repairIndex]?.receiver!=='document'}
     onClick={()=>void inspectElementVisibility()}>只读检查可见性（CSS/盒模型）</button>
    <span className="dim">使用 Chrome DOM/CSS 只读证据，不触发 click、scroll 或脚本。V2 未验证，不能证明元素可点击；V3/V4 未配置。</span>
   </div>
   {visibilityEvidence&&visibilityEvidence.selectorIndex===repairIndex&&<div className="notice">
    <b>CSS 可见性：</b>{visibilityEvidence.result.status==='potentially-visible'?'可能可见':visibilityEvidence.result.status==='hidden'?'被隐藏':visibilityEvidence.result.status==='missing'?'顶层 DOM 未匹配':visibilityEvidence.result.status==='ambiguous'?'多个匹配':'证据不足'}
    · 匹配数 {visibilityEvidence.result.matchCount??'未知'}
    · Pointer events {visibilityEvidence.result.pointerBlocked===true?'禁止':visibilityEvidence.result.pointerBlocked===false?'未禁止':'未知'}
    · 控件属性 {visibilityEvidence.result.controlBlocker==='disabled-attribute'?'存在 disabled（禁用）':visibilityEvidence.result.controlBlocker==='aria-disabled'?'声明 aria-disabled=true':visibilityEvidence.result.controlBlocker==='readonly-attribute'?'存在 readonly（只读）':visibilityEvidence.result.controlBlocker==='none-detected'?'未发现直接禁用属性（不等于可点击）':'无法确认'}
    · V2 未验证；仅供人工判断，不能证明元素可点击或业务功能正常。
   </div>}
   <div className="repair-section"><h3>修复工作台 · 受控副本</h3>
    <p className="dim">输入一个新的静态选择器，先生成修复预览，再人工审核并保存受管副本。不会覆盖原始脚本；不会自动修改 Tampermonkey 扩展内的代码。</p>
    <div className="actions" style={{justifyContent:'flex-start',flexWrap:'wrap'}}>
     <label>旧选择器<select aria-label="选择需要替换的静态定位器" value={repairIndex} onChange={e=>{setRepairIndex(Number(e.target.value));setRepairProposal(null);setRepairCandidates(null);setRepairNew('');}}>{details.analysis?.selectorRecords.map((s,i)=><option key={i} value={i} disabled={s.runtimeRequired}>{s.method} · {s.expression.slice(0,90)}{s.runtimeRequired?'（动态，不可直接补丁）':''}</option>)}</select></label>
     <label>新的方法参数<input aria-label="输入新选择器" value={repairNew} onChange={e=>{setRepairNew(e.target.value);setRepairProposal(null);}} placeholder={getRepairInputHint(details.analysis?.selectorRecords[repairIndex]?.method)} /></label>
     <button type="button" disabled={busy||!targetId||!details.analysis} onClick={()=>void suggestBulkRepairs()}>批量生成修复候选（最多 8 处）</button>
     <button disabled={busy||!targetId||!pageProbe||pageProbe.probe.targetId!==targetId||pageProbe.probe.checks[repairIndex]?.status!=='missing'} onClick={()=>void suggestRepair()}>生成候选定位器（只读）</button>
     <button disabled={busy||!result||focused===null||!targetId||!pageProbe||pageProbe.probe.targetId!==targetId||pageProbe.probe.checks[repairIndex]?.status!=='missing'} onClick={()=>void prepareVerifiedPreview()}>自动准备唯一候选的受管修复预览</button>
     <button disabled={busy||!repairNew.trim()||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired} onClick={()=>void proposeRepair()}>生成修复预览</button>
    </div>
    {bulkRepairResults&&<div className="notice">
     <p><b>批量缺失选择器建议</b>：当前前 50 个定位器中可检查的缺失 {bulkRepairResults.totalMissing} 处；已处理 {bulkRepairResults.checkedMissing} 处{bulkRepairResults.remainingMissing>0?`，还有 ${bulkRepairResults.remainingMissing} 处未检查`:''}。仅为 DOM 证据，不自动修改代码。</p>
     {bulkRepairResults.items.map(row=><div className="selector" key={row.selectorIndex}>
      <div className="selector-top"><span>源码定位器 {row.selectorIndex+1} · {row.method}</span><code>{row.oldSelector}</code></div>
      {row.candidates.length===0?<small>没有唯一可验证的候选，请自行核查。</small>:row.candidates.map(candidate=><div key={candidate.expression} className="actions" style={{justifyContent:'flex-start',flexWrap:'wrap'}}>
       <code>{candidate.expression}</code><small>排序分 {candidate.confidenceScore} · DOM 唯一匹配，不保证业务逻辑正确</small>
       <button type="button" className="secondary" disabled={busy} onClick={()=>{setWatchEnabled(false);setRepairIndex(row.selectorIndex);setRepairNew(candidate.expression);setRepairProposal(null);}}>采用并生成预览前复核</button>
      </div>)}
     </div>)}
     {bulkRepairResults.remainingMissing>0&&<button type="button" className="secondary" disabled={busy} onClick={()=>void suggestBulkRepairs(bulkRepairResults.checkedMissing)}>继续下一组修复候选</button>}
    </div>}
    {repairCandidates!==null&&<div className="notice"><p><b>基于当前网页的候选</b>（排序分不等于可靠性概率）；候选不代表功能验证通过，必须选择并人工审核。</p>{repairCandidates.length===0?<p>未发现可验证的唯一候选，请手动检查页面。</p>:repairCandidates.map((candidate,i)=><div className="selector" key={candidate.expression}><code>{candidate.expression}</code><small>启发式排序分：{candidate.confidenceScore} · {candidate.evidence} · 当前主文档唯一匹配</small><button type="button" className="secondary" onClick={()=>{setWatchEnabled(false);setRepairNew(candidate.expression);setRepairProposal(null);}}>采用候选 {i+1}，进入人工预览</button></div>)}</div>}
    {repairProposal&&<div className="notice"><p>原始 Selector：<code>{repairProposal.oldSelector}</code> → 新 Selector：<code>{repairProposal.newSelector}</code></p><p>待写入片段（仅预览）：</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{repairProposal.preview}</pre><button disabled={busy} onClick={()=>void applyRepair()}>审核后保存受管副本</button><button disabled={busy||!targetId||focused===null} onClick={()=>void applyRepairGuarded()}>保存并自动 V1 复核，失败恢复上一修订</button><p className="dim">仅对受管脚本 current.user.js 生效，不部署到油猴或修改原件。V2/V3/V4 未验证。</p></div>}
    {repairApplied&&<div className="notice"><b>受管副本：</b><code>{repairApplied.managedPath}</code><p>原件备份：<code>{repairApplied.backupPath}</code></p><p>当前仅完成文件副本写入，仍需手动验证功能。</p><button type="button" className="secondary" disabled={busy||!targetId||focused!==repairApplied.itemIndex} onClick={()=>void verifyManagedDom()}>只读复核受管修订 V1</button><p className="dim">检查受管 current.user.js 的真实归档哈希与 Chrome DOM 双采样。V2/V3/V4 未验证，不会执行用户脚本、点击网页或自动部署。</p></div>}
    <section className="managed-history"><h3>受管修订历史与恢复</h3><p className="dim">只恢复软件自己管理的 current.user.js；原始脚本不会被覆盖，也不会直接修改 Tampermonkey 扩展内容。</p>
     <button className="secondary" type="button" disabled={busy} onClick={()=>void showManagedHistory()}>查看受管历史</button>
     <button className="secondary" type="button" disabled={busy||(!managedActive&&!(managedRevisions?.length))} onClick={()=>void exportManaged()}>安全导出 .user.js</button>
     <p className="dim">导出仅复制已归档并校验的受管 current.user.js，必须另行导入 Tampermonkey；原始文件及现有文件均不会被覆盖。</p>
     {managedActive&&<p className="dim">当前受管副本：<code>{managedActive.activePath}</code> · SHA256 {managedActive.hash.slice(0,12)}…</p>}
     {managedRevisions!==null&&<div>{managedRevisions.length===0?<p>尚无保存的修订。</p>:managedRevisions.map(item=><div className="selector" key={item.fileName}><code>{item.kind==='original'?'原始备份':'修复修订'} · {item.hash.slice(0,16)}…</code><button type="button" className="secondary" disabled={busy} onClick={()=>void rollbackManaged(item.hash)}>恢复此受管副本</button></div>)}</div>}
    </section>
   </div>
   {details.analysis?.selectorRecords.map((s,i)=><div className="selector" key={i}><div className="selector-top"><span>{s.method} · 源码第 {s.sourceRange.start.line} 行</span><span className={s.runtimeRequired?'warn':''}>{s.runtimeRequired?'需要运行时确认':'静态字面量'}</span></div><code>{s.expression}</code><small>函数：{s.functionName||'顶层'} {s.alternateSelectors.length?`｜备用选择器：${s.alternateSelectors.join('、')}`:''}</small></div>)}
   {details.diagnostics.map((d,i)=><p className="error-text" key={i}>{d}</p>)}
   {!details.selectorCount&&<div className="dim">未找到内置规则覆盖的 DOM 选择器；不代表该脚本没有 DOM 依赖。</div>}
   </section>}
   <footer>DreamMovie Studio · 本地优先 · 静态诊断 + 人工授权的 DOM 只读核验　　<span title={appInfo?.dataRoot}>数据位置：{appInfo?.dataRoot??'检测中'}</span></footer>
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
