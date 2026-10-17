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
import {summarizeSafeDesktopError} from './safe-error.ts';
import {safeDomReportPageOrigin} from './safe-page-origin.ts';
import type {SiteTestCase,SiteTestSelection,DeclaredPageState} from '../../../../packages/candidate-engine/src/site-test-cases.ts';
import type {ScriptRecord} from '../../../../packages/persistence/src/index.ts';
import type {JournalRun} from '../../../../packages/job-journal/src/index.ts';
import type {AuditTrace} from '../../../../packages/contracts/src/audit-trace.ts';
import type {RollbackEvent} from '../../../../packages/audit-journal/src/rollback-events.ts';
import {summarizeSiteTrends} from '../../../../packages/job-journal/src/trends.ts';
import type {LocatorProbeResult} from '../../../../packages/cdp-client/src/locator-probe.ts';
import type {DomSummary} from '../../../../packages/cdp-client/src/snapshot.ts';
import type {ReadOnlyVisibilityEvidence} from '../../../../packages/cdp-client/src/read-only-visibility.ts';
import type {ReadOnlyEventListenerEvidence} from '../../../../packages/cdp-client/src/read-only-event-listeners.ts';
import type {ReadOnlyInteractionReadinessResult,ReadOnlyVisibilityWaitResult} from '../../../../packages/test-runner/src/read-only-interaction-readiness.ts';
import type {UserscriptManagerTargetReport} from '../../../../packages/cdp-client/src/manager-targets.ts';
import type {PassivePageExceptionEvidence} from '../../../../packages/cdp-client/src/read-only-exceptions.ts';
import type {ReadOnlyDomContractResult} from '../../../../packages/test-runner/src/index.ts';
import type {ManualDomTransitionResult} from '../../../../packages/test-runner/src/manual-dom-transition.ts';
import type {ProductAction,ProductActionReview} from '../../../../packages/test-runner/src/product-action-review.ts';
import type {ApprovedControlFocusResult} from '../../../../packages/test-runner/src/approved-focus.ts';
import type {RoleDomResult} from '../../../../packages/test-runner/src/site-adapter-role.ts';
import type {VerifiedCandidate,AdapterScopedRepairsResult} from '../../../../packages/candidate-engine/src/workflow.ts';
import type {VerifiedPreviewResult} from '../../../../packages/repair-workflow/src/verified-preview.ts';
import type {BulkCandidateResult} from '../../../../packages/candidate-engine/src/bulk.ts';
import type {ManagedRevision} from '../../../../packages/repair-workflow/src/history.ts';
import type {ManagedIntegrityReport,ManagedHealthStatus} from '../../../../packages/repair-workflow/src/managed-health.ts';

import type {AdapterLibraryEntry} from '../../../../packages/candidate-engine/src/site-adapter-library.ts';
type SiteAdapterPreview={previewId:string;siteId:string;version:string;roleCount:number;stateCount:number;urlPatterns:readonly string[];sourceHash:string};
const managedHealthDescription:Record<ManagedHealthStatus,string>={
 healthy:'活动修订与经 SHA-256 校验的不可变归档一致',
 empty:'未找到受管修订记录',
 'missing-current':'已有完整归档，但当前受管修订缺失',
 'unarchived-current':'当前受管文件不属于任何有效归档，可能遭到外部修改',
 'damaged-archive':'不可变修订归档校验失败，不能进行自动恢复',
 'write-locked':'受管写入锁存在：可能仍有其他进程正在写入，也可能是崩溃遗留',
 'staging-leftover':'检测到未完成的受管写入暂存文件：可能是异常退出遗留，需离线核查；程序不会自动删除',
 unsafe:'受管目录或文件安全验证失败，请保留原始资料排查',
};

declare global {interface Window{ussm:{
 getAppInfo:()=>Promise<{version:string;distributionMode:string;dataRoot:string;preferredChromePath:string|null}>;
 getAuditTrace:(input:{revisionId:string})=>Promise<AuditTrace|null>;
 getRepairQueueRecovery:()=>Promise<RepairQueueRecoverySummary>;
 getRepairQueueActivity:()=>Promise<RepairQueueActivitySummary>;
 cancelBatchRepair:(input:{proposalId:string})=>Promise<boolean>;
 pauseBatchRepair:(input:{proposalId:string})=>Promise<boolean>;
 resumeBatchRepair:(input:{proposalId:string})=>Promise<boolean>;
 backupRegistry:()=>Promise<{canceled:boolean;path?:string;sha256?:string;bytes?:number}>;
 backupJournal:()=>Promise<{canceled:boolean;path?:string;sha256?:string;bytes?:number}>;
 exportManagedRecovery:()=>Promise<{canceled:boolean;path?:string;files?:number;bytes?:number}>;
 createCoreRecovery:()=>Promise<{canceled:boolean;path?:string;manifestSha256?:string;files?:number;verified?:boolean}>;
 verifyCoreRecovery:()=>Promise<{canceled:boolean;verified?:boolean;files?:number}>;
 verifyOfflineCoreStage:()=>Promise<{canceled:boolean;verified?:boolean;fileCount?:number;sourceManifestSha256?:string;activated?:false}>;
 stageCoreRecovery:()=>Promise<{canceled:boolean;path?:string;fileCount?:number;sourceManifestSha256?:string;activated?:false}>;
 probeLocators:(input:{scanId:string;itemIndex:number;targetId:string;approved:true})=>Promise<{summary:DomSummary;probe:LocatorProbeResult;totalLocators:number;checkedLocators:number}>;
 inspectElementVisibility:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<ReadOnlyVisibilityEvidence>;
 inspectEventListeners:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<ReadOnlyEventListenerEvidence>;
 waitUntilElementVisible:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<ReadOnlyVisibilityWaitResult>;
 inspectInteractionReadiness:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<ReadOnlyInteractionReadinessResult>;
  reviewProductAction:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;action:ProductAction;approved:true})=>Promise<ProductActionReview>;
  approvedControlFocus:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<ApprovedControlFocusResult>;
 runDomContract:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;expectation:'exists'|'unique'|'count-changed';approved:true})=>Promise<ReadOnlyDomContractResult>;
 observeManualDomTransition:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;phase:'start'|'finish';approved:true})=>Promise<ManualDomTransitionResult>;
 verifyManagedDom:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;revisionHash:string;approved:true})=>Promise<ReadOnlyDomContractResult&{revisionHash:string;validationLevel:'V1-managed-read-only'}>;
 batchDiagnose:(input:{targetId:string;scanId:string;approved:true;offset:number})=>Promise<BatchDomResult&{remainingItems:number;startIndex:number}>;
 listDiagnosisHistory:()=>Promise<JournalRun[]>;
 cancelDiagnosis:(input:{scanId:string;targetId:string})=>Promise<{cancelled:boolean}>;
 suggestRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<VerifiedCandidate[]>;
 prepareVerifiedPreview:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<VerifiedPreviewResult>;
 suggestRepairsBulk:(input:{scanId:string;itemIndex:number;targetId:string;approved:true;offset?:number})=>Promise<BulkCandidateResult>;
 proposeRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;newSelector:string})=>Promise<{proposalId:string;oldSelector:string;newSelector:string;preview:string;baseHash:string;proposedHash:string}>;
 proposeBatchRepair:(input:{scanId:string;itemIndex:number;changes:{selectorIndex:number;newSelector:string}[]})=>Promise<{proposalId:string;originalHash:string;baseHash:string;proposedHash:string;changes:readonly {selectorIndex:number;method:string;line:number;column:number;oldSelector:string;newSelector:string}[];preview:string}>;
 applyMultiScriptBatch:(input:{scanId:string;jobs:{itemIndex:number;proposalId:string}[];approved:true;stopOnFailure?:boolean})=>Promise<{queued:number;running:number;completed:number;failed:number;blocked:number;cancelled:number}>;
 applyBatchRepair:(input:{scanId:string;itemIndex:number;proposalId:string;approved:true})=>Promise<{backupPath:string;managedPath:string;hash:string;activePath:string}>;
 applyBatchRepairGuarded:(input:{scanId:string;itemIndex:number;proposalId:string;targetId:string;approved:true})=>Promise<{status:'retained-v1'|'rolled-back-v1'|'rollback-blocked';appliedHash:string;activeHash:string|null;verifiedIndexes:readonly number[];backupPath:string;managedPath:string;activePath:string}>;
 applyRepair:(input:{scanId:string;proposalId:string;approved:true})=>Promise<{backupPath:string;managedPath:string;hash:string;activePath:string}>;
 applyRepairGuarded:(input:{scanId:string;proposalId:string;itemIndex:number;selectorIndex:number;targetId:string;approved:true})=>Promise<{status:'retained-v1'|'rolled-back-v1'|'rollback-blocked';appliedHash:string;activeHash:string|null;backupPath:string;managedPath:string;activePath:string;auditRevisionId:string|null}>;
 inspectManagedIntegrity:(input:{scanId:string;itemIndex:number})=>Promise<ManagedIntegrityReport>;
 listManagedRevisions:(input:{scanId:string;itemIndex:number})=>Promise<ManagedRevision[]>;
 getManagedAuditTrace:(input:{scanId:string;itemIndex:number;revisionHash:string})=>Promise<AuditTrace|null>;
 listRollbackAuditHistory:(input:{scanId:string;itemIndex:number})=>Promise<readonly RollbackEvent[]>;
 rollbackManaged:(input:{scanId:string;itemIndex:number;hash:string;approved:true})=>Promise<{hash:string;activePath:string}>;
 exportManaged:(input:{scanId:string;itemIndex:number})=>Promise<{canceled:boolean;path?:string;hash?:string;bytes?:number}>;
 listSiteTestCases:(input:{scanId:string;itemIndex:number})=>Promise<SiteTestCase[]>;
 createSiteTestCase:(input:{scanId:string;itemIndex:number;url:string;label:string;stateId:DeclaredPageState;approved:true})=>Promise<SiteTestCase>;
 removeSiteTestCase:(input:{scanId:string;itemIndex:number;caseId:string;approved:true})=>Promise<{deleted:boolean}>;
 verifySiteTestCase:(input:{scanId:string;itemIndex:number;caseId:string;targetId:string;approved:true})=>Promise<SiteTestSelection>;
 listSiteAdapters:()=>Promise<AdapterLibraryEntry[]>;
 previewSiteAdapterImport:()=>Promise<SiteAdapterPreview|null>;
 approveSiteAdapterImport:(input:{previewId:string;approved:true})=>Promise<AdapterLibraryEntry>;
 discardSiteAdapterPreview:(input:{previewId:string})=>Promise<{discarded:boolean}>;
 inspectSiteAdapterRole:(input:{siteId:string;expectedSha256:string;roleId:string;declaredStateId:string;targetId:string;approved:true})=>Promise<RoleDomResult>;
 suggestSiteAdapterRepair:(input:{scanId:string;itemIndex:number;selectorIndex:number;targetId:string;siteId:string;expectedSha256:string;roleId:string;declaredStateId:string;approved:true})=>Promise<AdapterScopedRepairsResult>;
 listBrowserProfiles:()=>Promise<BrowserProfile[]>;
 browserProfileHealth:()=>Promise<{status:'empty'|'ready'|'write-locked'|'invalid';count:number|null}>;
 createBrowserProfile:(input:{name:string})=>Promise<BrowserProfile>;
 renameBrowserProfile:(input:{profileId:string;name:string})=>Promise<BrowserProfile>;
 defaultBrowserProfile:(input:{profileId:string})=>Promise<BrowserProfile>;
 removeBrowserProfile:(input:{profileId:string;approved:true})=>Promise<{deleted:boolean}>;
 launchBrowserProfile:(input:{profileId:string;approved:true})=>Promise<{started:boolean;port:number;isolated:true}>;
  pickChrome:()=>Promise<string|null>;launchChrome:()=>Promise<{started:boolean;port:number}>;launchIsolatedChrome:()=>Promise<{started:boolean;port:number;isolated:true}>;getCdpStatus:()=>Promise<{browser:string;protocolVersion:string|null;pages:{id:string;origin:string}[]}>;
 getManagerTargets:(input:{approved:true})=>Promise<UserscriptManagerTargetReport>;
 observePageExceptions:(input:{targetId:string;approved:true})=>Promise<PassivePageExceptionEvidence>;
 pickFiles:()=>Promise<string[]>;pickDirectory:()=>Promise<string|null>;
 onTrustedDrop:(listener:(authorizedPaths:string[])=>void)=>(()=>void);
 scan:(request:{paths:string[];recursive:boolean})=>Promise<DesktopScanResult>;
 listScripts:()=>Promise<ScriptRecord[]>;
 exportReport:(format:'json'|'markdown')=>Promise<{canceled:boolean;path?:string}>;
 exportDomReport:(input:{scanId:string;targetId:string;format:'json'|'markdown'})=>Promise<{canceled:boolean;path?:string}>;
}}}
interface BrowserProfile {id:string;name:string;executablePath:string;isDefault:boolean}
interface RepairQueueRecoverySummary{
 checkpointFiles:number;completed:number;needsReview:number;uncertain:number;unreadable:number;
}
interface RepairQueueActivitySummary{
 queued:number;running:number;completed:number;failed:number;blocked:number;cancelled:number;
}
const nameOf=(path:string)=>path.replace(/\\/g,'/').split('/').at(-1)||path;
function App(){
 const [appInfo,setAppInfo]=useState<{version:string;distributionMode:string;dataRoot:string;preferredChromePath:string|null}|null>(null);
 const [repairQueueRecovery,setRepairQueueRecovery]=useState<RepairQueueRecoverySummary|null>(null);
 const [repairQueueActivity,setRepairQueueActivity]=useState<RepairQueueActivitySummary|null>(null);
 const [batchApplying,setBatchApplying]=useState(false);
 const [managedBatchPaused,setManagedBatchPaused]=useState(false);
 const [browserProfiles,setBrowserProfiles]=useState<BrowserProfile[]>([]);
 const [browserProfileHealth,setBrowserProfileHealth]=useState<'empty'|'ready'|'write-locked'|'invalid'|null>(null);
 const [selectedBrowserProfileId,setSelectedBrowserProfileId]=useState('');
 const [browserProfileName,setBrowserProfileName]=useState('');

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
 const [chromePath,setChromePath]=useState('');const [cdp,setCdp]=useState<{browser:string;protocolVersion:string|null;pages:{id:string;origin:string}[]}|null>(null);
 const [managerTargetReport,setManagerTargetReport]=useState<UserscriptManagerTargetReport|null>(null);
 const [managerBusy,setManagerBusy]=useState(false);
 const managerTargetGeneration=useRef(new LatestRequestGate());
 const [exceptionEvidence,setExceptionEvidence]=useState<PassivePageExceptionEvidence|null>(null);
 const [exceptionBusy,setExceptionBusy]=useState(false);
 const exceptionGeneration=useRef(new LatestRequestGate());
 const [targetId,setTargetId]=useState('');
 const [siteTestCases,setSiteTestCases]=useState<SiteTestCase[]>([]);
 const [siteTestUrl,setSiteTestUrl]=useState('');
 const [siteTestLabel,setSiteTestLabel]=useState('');
 const [siteTestState,setSiteTestState]=useState<DeclaredPageState>('logged-out');
 const [siteTestSelectedId,setSiteTestSelectedId]=useState('');
 const [siteTestResult,setSiteTestResult]=useState<SiteTestSelection|null>(null);
 const [siteTestBusy,setSiteTestBusy]=useState(false);
 const siteTestGeneration=useRef(new LatestRequestGate());
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
 const [contractExpectation,setContractExpectation]=useState<'exists'|'unique'|'count-changed'>('unique');
 const [contractEvidence,setContractEvidence]=useState<{selectorIndex:number;result:ReadOnlyDomContractResult}|null>(null);
 const contractGeneration=useRef(new LatestRequestGate());
 const contractActive=useRef(false);
 const [manualTransitionEvidence,setManualTransitionEvidence]=useState<{selectorIndex:number;scanId:string;itemIndex:number;targetId:string;result:ManualDomTransitionResult}|null>(null);
 const manualTransitionGeneration=useRef(new LatestRequestGate());
 const manualTransitionActive=useRef(false);
 const [visibilityEvidence,setVisibilityEvidence]=useState<{selectorIndex:number;result:ReadOnlyVisibilityEvidence}|null>(null);
 const visibilityGeneration=useRef(new LatestRequestGate());
 const visibilityActive=useRef(false);
 const [visibleWaitEvidence,setVisibleWaitEvidence]=useState<{selectorIndex:number;result:ReadOnlyVisibilityWaitResult}|null>(null);
 const visibleWaitGeneration=useRef(new LatestRequestGate());
 const visibleWaitActive=useRef(false);
 const [listenerEvidence,setListenerEvidence]=useState<{selectorIndex:number;result:ReadOnlyEventListenerEvidence}|null>(null);
 const listenerGeneration=useRef(new LatestRequestGate());
 const listenerActive=useRef(false);
 const [readinessEvidence,setReadinessEvidence]=useState<{selectorIndex:number;result:ReadOnlyInteractionReadinessResult}|null>(null);
 const readinessGeneration=useRef(new LatestRequestGate());
 const readinessActive=useRef(false);
 const [productAction,setProductAction]=useState<ProductAction>('observe');
 const [productActionEvidence,setProductActionEvidence]=useState<{selectorIndex:number;action:ProductAction;result:ProductActionReview}|null>(null);
 const productActionGeneration=useRef(new LatestRequestGate());
 const productActionActive=useRef(false);
 const [focusEvidence,setFocusEvidence]=useState<{selectorIndex:number;result:ApprovedControlFocusResult}|null>(null);
 const focusGeneration=useRef(new LatestRequestGate());
 const focusActive=useRef(false);
 const [repairCandidates,setRepairCandidates]=useState<VerifiedCandidate[]|null>(null);
 const [bulkRepairResults,setBulkRepairResults]=useState<BulkCandidateResult|null>(null);
 const bulkGeneration=useRef(new LatestRequestGate());
 const bulkActive=useRef(false);
 const probeGeneration=useRef(new LatestRequestGate());
 const probeActive=useRef(false);
 const [repairProposal,setRepairProposal]=useState<{proposalId:string;oldSelector:string;newSelector:string;preview:string;baseHash:string;proposedHash:string}|null>(null);
 const [batchRepairProposal,setBatchRepairProposal]=useState<{proposalId:string;originalHash:string;baseHash:string;proposedHash:string;changes:readonly {selectorIndex:number;method:string;line:number;column:number;oldSelector:string;newSelector:string}[];preview:string;itemIndex:number;scanId:string}|null>(null);
 const [stagedMultiScriptJobs,setStagedMultiScriptJobs]=useState<{itemIndex:number;scriptId:string;proposalId:string;proposedHash:string}[]>([]);
 const [repairApplied,setRepairApplied]=useState<{backupPath:string;managedPath:string;hash:string;itemIndex:number;selectorIndex:number}|null>(null);
 const [repairAudit,setRepairAudit]=useState<AuditTrace|null>(null);
 const [managedRevisions,setManagedRevisions]=useState<ManagedRevision[]|null>(null);
 const [rollbackAuditEvents,setRollbackAuditEvents]=useState<readonly RollbackEvent[]|null>(null);
 const rollbackAuditGeneration=useRef(new LatestRequestGate());
 const [managedHealth,setManagedHealth]=useState<ManagedIntegrityReport|null>(null);
 const [managedActive,setManagedActive]=useState<{hash:string;activePath:string}|null>(null);
 useEffect(()=>{rollbackAuditGeneration.current.invalidate();setRollbackAuditEvents(null);},[result,focused]);
 useEffect(()=>{managerTargetGeneration.current.invalidate();setManagerTargetReport(null);},[cdp,chromePath]);
 useEffect(()=>{exceptionGeneration.current.invalidate();setExceptionEvidence(null);setExceptionBusy(false);},[targetId,cdp,chromePath]);
 useEffect(()=>{
  siteTestGeneration.current.invalidate();
  setSiteTestCases([]);setSiteTestSelectedId('');setSiteTestResult(null);
  setSiteTestBusy(false);
  if(!result||focused===null||!result.items[focused]?.scriptId)return;
  const ticket=siteTestGeneration.current.begin();
  void window.ussm.listSiteTestCases({scanId:result.scanId,itemIndex:focused})
   .then(rows=>siteTestGeneration.current.commit(ticket,()=>setSiteTestCases(rows)))
   .catch(error=>siteTestGeneration.current.commit(ticket,()=>setError('无法读取测试场景：'+summarizeSafeDesktopError(error))));
  return ()=>siteTestGeneration.current.invalidate();
 },[result,focused]);
 useEffect(()=>{siteTestGeneration.current.invalidate();setSiteTestResult(null);setSiteTestBusy(false);},[targetId]);
 useEffect(()=>{void window.ussm.listSiteAdapters().then(setAdapterLibrary).catch(error=>setError('无法读取本地 SiteAdapter 规则：'+summarizeSafeDesktopError(error)));},[]);
 useEffect(()=>{void Promise.all([window.ussm.getAppInfo(),window.ussm.listScripts()]).then(([info,list])=>{setAppInfo(info);setHistory(list);setChromePath(info.preferredChromePath??'');}).catch(e=>setError(summarizeSafeDesktopError(e)));},[]);
 useEffect(()=>{
  // A failed recovery read is NEVER equivalent to "no interrupted writes".
  void window.ussm.getRepairQueueRecovery().then(setRepairQueueRecovery)
   .catch(()=>setRepairQueueRecovery({checkpointFiles:0,completed:0,needsReview:0,uncertain:0,unreadable:1}));
 },[]);
 useEffect(()=>{
  // Main-only, identity-free status; no source paths or approval handles.
  let current=true;
  const refresh=()=>{void window.ussm.getRepairQueueActivity().then(value=>{
   if(current)setRepairQueueActivity(value);
  }).catch(()=>{if(current)setRepairQueueActivity(null);});};
  refresh();
  if(!batchApplying)return ()=>{current=false;};
  const interval=setInterval(refresh,1000);
  return ()=>{current=false;clearInterval(interval);};
 },[batchApplying]);
 useEffect(()=>{void Promise.all([window.ussm.listBrowserProfiles(),window.ussm.browserProfileHealth()])
  .then(([items,health])=>{
   setBrowserProfiles(items);
   setBrowserProfileHealth(health.status);
   setSelectedBrowserProfileId(items.find(item=>item.isDefault)?.id??items[0]?.id??'');
  }).catch(e=>setError('无法读取浏览器配置：'+summarizeSafeDesktopError(e)));},[]);
 const filtered=useMemo(()=>result?.items.map((item,index)=>({...item,index})).filter(item=>item.path.toLowerCase().includes(search.toLowerCase()))??[],[result,search]);
 const siteTrends=useMemo(()=>diagnosisHistory?summarizeSiteTrends(diagnosisHistory):[],[diagnosisHistory]);
 const selectedAdapter=adapterLibrary?.find(a=>a.siteId===adapterSelectedSiteId)??null;
 useEffect(()=>{adapterRoleGeneration.current.invalidate();setAdapterRoleCheck(null);setAdapterRoleBusy(false);},[targetId,adapterSelectedSiteId,adapterSelectedRoleId,adapterDeclaredStateId,adapterLibrary]);
 useEffect(()=>{adapterRepairGeneration.current.invalidate();setAdapterRepairCandidates(null);setAdapterRepairBusy(false);},[targetId,adapterSelectedSiteId,adapterSelectedRoleId,adapterDeclaredStateId,adapterLibrary,focused,repairIndex,result]);
 // Switching site or script revokes a previously granted read-only health watch.
 useEffect(()=>{setWatchEnabled(false);setWatchStatus(null);setWatchCheckedAt('');setWatchError('');},[focused,targetId]);
 useEffect(()=>{bulkGeneration.current.invalidate();if(bulkActive.current){bulkActive.current=false;setBusy(false);}setBulkRepairResults(null);},[focused,targetId,result]);
 useEffect(()=>{setBatchRepairProposal(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{setStagedMultiScriptJobs([]);},[result]);
 useEffect(()=>{batchGeneration.current.invalidate();batchCancel.current=true;batchPauseGate.current?.cancel();batchPauseGate.current=null;setBatchPaused(false);if(batchActive.current){batchActive.current=false;setBatchRunning(false);setBusy(false);}setBatchResult(null);setBatchProgress(0);},[targetId,result]);
 useEffect(()=>{probeGeneration.current.invalidate();if(probeActive.current){probeActive.current=false;setBusy(false);}setPageProbe(null);},[focused,targetId,result]);
 useEffect(()=>{contractGeneration.current.invalidate();if(contractActive.current){contractActive.current=false;setBusy(false);}setContractEvidence(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{manualTransitionGeneration.current.invalidate();if(manualTransitionActive.current){manualTransitionActive.current=false;setBusy(false);}setManualTransitionEvidence(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{visibilityGeneration.current.invalidate();if(visibilityActive.current){visibilityActive.current=false;setBusy(false);}setVisibilityEvidence(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{visibleWaitGeneration.current.invalidate();if(visibleWaitActive.current){visibleWaitActive.current=false;setBusy(false);}setVisibleWaitEvidence(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{listenerGeneration.current.invalidate();if(listenerActive.current){listenerActive.current=false;setBusy(false);}setListenerEvidence(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{readinessGeneration.current.invalidate();if(readinessActive.current){readinessActive.current=false;setBusy(false);}setReadinessEvidence(null);},[focused,targetId,result,repairIndex]);
 useEffect(()=>{productActionGeneration.current.invalidate();if(productActionActive.current){productActionActive.current=false;setBusy(false);}setProductActionEvidence(null);},[focused,targetId,result,repairIndex,productAction]);
 useEffect(()=>{focusGeneration.current.invalidate();if(focusActive.current){focusActive.current=false;setBusy(false);}setFocusEvidence(null);},[focused,targetId,result,repairIndex]);
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
    if(!cancelled){setWatchError('巡检暂停校验：'+summarizeSafeDesktopError(error));setWatchStatus(null);}
   }finally{watchRunning.current=false;}
  }
  void poll();
  const interval=setInterval(()=>void poll(),60_000);
  return ()=>{cancelled=true;clearInterval(interval);};
 },[watchEnabled,focused,targetId,result]);

 async function chooseFiles(){try{const selected=await window.ussm.pickFiles();setPaths(old=>[...new Set([...old,...selected])]);setError('');}catch(e){setError(summarizeSafeDesktopError(e));}}
 async function chooseDirectory(){try{const selected=await window.ussm.pickDirectory();if(selected)setPaths(old=>[...new Set([...old,selected])]);setError('');}catch(e){setError(summarizeSafeDesktopError(e));}}
 function onDrop(event:React.DragEvent<HTMLDivElement>){event.preventDefault();setDragging(false);}
 useEffect(()=>window.ussm.onTrustedDrop(allowed=>{
  setPaths(old=>[...new Set([...old,...allowed])]);
  setError('');setMessage('已接收 '+allowed.length+' 个系统拖放的脚本文件');
 }),[]);
 async function scan(){if(!paths.length)return;setBusy(true);setError('');setMessage('');try{const report=await window.ussm.scan({paths,recursive:true});setResult(report);setFocused(null);setPageProbe(null);setRepairCandidates(null);setRepairProposal(null);setRepairApplied(null);setManagedRevisions(null);setManagedHealth(null);setManagedActive(null);setHistory(await window.ussm.listScripts());setMessage(`已分析 ${report.processedCount} 项 · 不代表网页功能正常`);}catch(e){setError(summarizeSafeDesktopError(e));}finally{setBusy(false);}}
 async function backupRegistry(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const saved=await window.ussm.backupRegistry();
   if(!saved.canceled)setMessage('SQLite 索引备份成功：'+saved.path+' · SHA-256：'+saved.sha256+
    '。注意：仅备份 registry.sqlite，不是完整 Data/ 灾难恢复包。');
  }catch{
   // Do not print raw SQLite/OS errors: they may contain private local paths.
   setError('SQLite 索引备份失败：请选择新的、可写入的 .sqlite 文件名；不会覆盖已有备份。');
  }finally{setBusy(false);}
 }
 async function backupJournal(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const saved=await window.ussm.backupJournal();
   if(!saved.canceled)setMessage('诊断历史 SQLite 备份成功：'+saved.path+' · SHA-256：'+saved.sha256+
    '。仅备份诊断历史，不包含脚本索引和受管修订。');
  }catch{
   // Database and OS errors may include private directory names.
   setError('诊断历史备份失败：请另选新的、可写入的 .sqlite 路径。现有备份不会被覆盖。');
  }finally{setBusy(false);}
 }
 async function exportManagedRecovery(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const saved=await window.ussm.exportManagedRecovery();
   if(!saved.canceled)setMessage('受管修订恢复备份已通过 SHA-256 验证：'+saved.path+
    '（'+saved.files+' 个文件、'+saved.bytes+' 字节）。不等于完整 Data/ 恢复；并未将脚本安装到 Tampermonkey。');
  }catch{
   setError('受管修订备份失败：只接受完整已归档修订；符号链接、写入锁或外部修改均会拒绝。已产生的不完整目录不会自动删除。');
  }finally{setBusy(false);}
 }
 async function createCoreRecovery(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const receipt=await window.ussm.createCoreRecovery();
   if(!receipt.canceled&&receipt.verified){
    setMessage('核心资料组合备份验证通过：'+receipt.path+
     '。总清单 SHA-256：'+receipt.manifestSha256+
     '。这是跨存储非原子快照，不是完整 Data/ 恢复，也不包含浏览器配置或密钥。');
   }
  }catch{
   setError('核心资料组合备份失败。请检查目标目录和资料是否处于写入状态；不完整目录不会自动删除。');
  }finally{setBusy(false);}
 }
 async function verifyCoreRecovery(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const receipt=await window.ussm.verifyCoreRecovery();
   if(!receipt.canceled&&receipt.verified)
    setMessage('已有核心备份只读核验通过：验证了 2 份 SQLite 与受管修订清单（共 '+receipt.files+
     ' 个核心条目）。这不代表完整 Data/ 备份，也不会自动恢复或安装任何脚本。');
  }catch{
   // Untrusted SQLite / manifests may include absolute file paths in errors.
   // Never reflect raw parser or filesystem exceptions into the UI.
   setError('已有核心备份核验失败：可能缺少文件、内容被更改、结构不兼容，或选错目录。没有覆盖、恢复或删除任何资料。');
  }finally{setBusy(false);}
 }
 async function verifyOfflineCoreStage(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const audited=await window.ussm.verifyOfflineCoreStage();
   if(!audited.canceled&&audited.verified&&audited.activated===false)
    setMessage('已有离线暂存核验通过：重新核对了 '+audited.fileCount+
     ' 个文件、来源核心备份 SHA-256：'+audited.sourceManifestSha256+
     '。仅为只读检查，不会自动恢复、启用脚本、修改 Data 或接触浏览器密钥。');
  }catch{
   // Never display raw untrusted SQLite, filesystem or manifest errors.
   setError('已有离线暂存核验失败：文件内容、完成标记或来源备份可能已变化，或目录结构不兼容。只读操作不会自动恢复或覆盖现有 Data。');
  }finally{setBusy(false);}
 }
 async function stageCoreRecovery(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const stage=await window.ussm.stageCoreRecovery();
   if(!stage.canceled&&stage.activated===false){
    setMessage('核心备份已复制到新的离线恢复目录：'+stage.path+
     '（'+stage.fileCount+' 个文件）。来源清单 SHA-256：'+stage.sourceManifestSha256+
     '。仅供离线检查，没有自动启用、覆盖当前 Data 或安装任何油猴脚本；浏览器资料与密钥不在此备份范围内。');
   }
  }catch{
   setError('离线暂存核心备份失败：源文件可能不完整、已更改，或目标不是安全的新目录。不会覆盖当前 Data；不完整的新目录不会自动删除。');
  }finally{setBusy(false);}
 }
 async function exportReport(format:'json'|'markdown'){try{const saved=await window.ussm.exportReport(format);if(!saved.canceled)setMessage(`报告已保存：${saved.path}`);}catch(e){setError(summarizeSafeDesktopError(e));}}
 async function exportDomReport(format:'json'|'markdown'){if(!result||!batchResult||batchRunning)return;try{const saved=await window.ussm.exportDomReport({scanId:result.scanId,targetId:batchResult.pageTargetId,format});if(!saved.canceled)setMessage(`只读 DOM 报告已保存：${saved.path}`);}catch(e){setError(summarizeSafeDesktopError(e));}}
 async function stageSiteAdapterImport(){
  if(adapterBusy)return;
  setAdapterBusy(true);const prior=adapterPreview;setAdapterPreview(null);setError('');
  try{
   if(prior)await window.ussm.discardSiteAdapterPreview({previewId:prior.previewId});
   const preview=await window.ussm.previewSiteAdapterImport();
   if(preview){setAdapterPreview(preview);setMessage('规则文件已解析，仅为预览；需要单独确认才会保存在本机。');}
  }catch(error){setError('SiteAdapter JSON 预览失败：'+summarizeSafeDesktopError(error));}
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
  }catch(error){setAdapterPreview(null);setError('SiteAdapter 导入失败（需重新预览）：'+summarizeSafeDesktopError(error));}
  finally{setAdapterBusy(false);}
 }
 async function cancelSiteAdapterImport(){
  if(adapterBusy||!adapterPreview)return;
  const previewId=adapterPreview.previewId;setAdapterPreview(null);
  try{await window.ussm.discardSiteAdapterPreview({previewId});}
  catch(error){setError('取消 SiteAdapter 预览失败：'+summarizeSafeDesktopError(error));}
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
   adapterRoleGeneration.current.commit(token,()=>setError('SiteAdapter 角色只读核验失败：'+summarizeSafeDesktopError(error)));
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
   adapterRepairGeneration.current.commit(token,()=>setError('SiteAdapter 限定候选检查失败：'+summarizeSafeDesktopError(error)));
  }finally{
   adapterRepairGeneration.current.commit(token,()=>setAdapterRepairBusy(false));
  }
 }
 async function refreshBrowserProfiles(preferredId?:string){
  const [items,health]=await Promise.all([
   window.ussm.listBrowserProfiles(),window.ussm.browserProfileHealth(),
  ]);
  setBrowserProfiles(items);
  setBrowserProfileHealth(health.status);
  setSelectedBrowserProfileId(current=>{
   const wanted=preferredId??current;
   return items.some(item=>item.id===wanted)?wanted:
    items.find(item=>item.isDefault)?.id??items[0]?.id??'';
  });
 }
 async function saveBrowserProfile(){
  try{
   const added=await window.ussm.createBrowserProfile({name:browserProfileName});
   await refreshBrowserProfiles(added.id);
   setBrowserProfileName('');
   setMessage('浏览器配置已保存；未启动浏览器，也未复制或修改已有资料目录。');
   setError('');
  }catch(error){setError('保存浏览器配置失败：'+summarizeSafeDesktopError(error));}
 }
 async function renameSelectedBrowserProfile(){
  if(!selectedBrowserProfileId)return;
  try{
   await window.ussm.renameBrowserProfile({profileId:selectedBrowserProfileId,name:browserProfileName});
   await refreshBrowserProfiles(selectedBrowserProfileId);
   setBrowserProfileName('');
   setMessage('浏览器配置名称已更新。');setError('');
  }catch(error){setError('重命名配置失败：'+summarizeSafeDesktopError(error));}
 }
 async function setSelectedBrowserProfileDefault(){
  if(!selectedBrowserProfileId)return;
  try{
   await window.ussm.defaultBrowserProfile({profileId:selectedBrowserProfileId});
   await refreshBrowserProfiles(selectedBrowserProfileId);
   setMessage('默认浏览器配置已保存；不会自动启动 Chrome。');setError('');
  }catch(error){setError('设置默认配置失败：'+summarizeSafeDesktopError(error));}
 }
 async function deleteSelectedBrowserProfile(){
  if(!selectedBrowserProfileId)return;
  try{
   const result=await window.ussm.removeBrowserProfile({profileId:selectedBrowserProfileId,approved:true});
   if(result.deleted){
    await refreshBrowserProfiles();
    setMessage('仅删除了浏览器配置记录；保留原有浏览器、扩展及配置资料目录。');
   }
   setError('');
  }catch(error){setError('删除配置记录失败：'+summarizeSafeDesktopError(error));}
 }
 async function launchSelectedBrowserProfile(){
  if(!selectedBrowserProfileId)return;
  try{
   await window.ussm.launchBrowserProfile({profileId:selectedBrowserProfileId,approved:true});
   setCdp(null);setTargetId('');setPageProbe(null);setRepairCandidates(null);
   setMessage('指定的独立 Chrome 配置已通过 CDP 握手；请检查当前网页列表。');
   setError('');
  }catch(error){setError('启动浏览器配置失败：'+summarizeSafeDesktopError(error));}
 }
 async function pickChrome(){try{const p=await window.ussm.pickChrome();if(p)setChromePath(p);setError('');}catch(e){setError(summarizeSafeDesktopError(e));}}
 async function startChrome(){try{await window.ussm.launchChrome();setCdp(null);setMessage('选定 Chrome 的 CDP 握手已验证；点击「检查 CDP 连接」刷新可检查的网页列表。');}catch(e){setError(summarizeSafeDesktopError(e));}}
 async function startIsolatedChrome(){try{await window.ussm.launchIsolatedChrome();setCdp(null);setTargetId('');setPageProbe(null);setRepairCandidates(null);setMessage('隔离 Chrome 的 CDP 握手已验证；独立资料目录不包含原有登录信息和扩展。点击「检查 CDP 连接」刷新网页列表。');}catch(e){setError(summarizeSafeDesktopError(e));}}
 async function checkCdp(){
  setManagerTargetReport(null);
  try{setCdp(await window.ussm.getCdpStatus());setPageProbe(null);setRepairCandidates(null);setError('');}
  catch(e){setCdp(null);setError(`CDP 握手失败：${summarizeSafeDesktopError(e)}。Chrome 136+ 对默认资料目录的调试开关有限制。`);}
 }
 async function inspectManagerTargets(){
  if(!cdp||busy||managerBusy)return;
  const token=managerTargetGeneration.current.begin();
  setManagerBusy(true);setError('');setManagerTargetReport(null);
  try{
   const observed=await window.ussm.getManagerTargets({approved:true});
   managerTargetGeneration.current.commit(token,()=>setManagerTargetReport(observed));
   managerTargetGeneration.current.commit(token,()=>setMessage('已检查当前 Chrome 的扩展后台运行目标；未观察到不代表未安装，V4 与 GM_* 行为仍未验证。'));
  }catch(error){
   managerTargetGeneration.current.commit(token,()=>setError('管理器扩展目标检查失败：'+summarizeSafeDesktopError(error)));
  }finally{setManagerBusy(false);}
 }
 async function observePageExceptions(){
  if(!targetId||!cdp||busy||exceptionBusy)return;
  const token=exceptionGeneration.current.begin();
  const target=targetId;
  setExceptionBusy(true);setExceptionEvidence(null);setError('');
  try{
   const report=await window.ussm.observePageExceptions({targetId:target,approved:true});
   if(exceptionGeneration.current.isCurrent(token)){
    setExceptionEvidence(report);
    setMessage('已完成限时网页异常观察；不能证明异常来自油猴脚本。V3/V4 未验证。');
   }
  }catch(error){
   if(exceptionGeneration.current.isCurrent(token))
    setError('只计数异常观察失败：'+summarizeSafeDesktopError(error));
  }finally{
   if(exceptionGeneration.current.isCurrent(token))setExceptionBusy(false);
  }
 }
 async function loadDiagnosisHistory(){
  try{setDiagnosisHistory(await window.ussm.listDiagnosisHistory());}
  catch(error){setError('读取本地诊断历史失败：'+summarizeSafeDesktopError(error));}
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
    setError('批量网页诊断失败，已清除不完整结果：'+summarizeSafeDesktopError(error));
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
   if(probeGeneration.current.isCurrent(token))setError('页面定位器核验失败：'+summarizeSafeDesktopError(error));
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
   if(visibilityGeneration.current.isCurrent(token))setError('CSS 可见性检查失败：'+summarizeSafeDesktopError(error));
  }finally{
   if(visibilityGeneration.current.isCurrent(token)){visibilityActive.current=false;setBusy(false);}
  }
 }
 async function waitUntilElementVisible(){
  if(focused===null||!result||!targetId||busy)return;
  const selector=result.items[focused]?.analysis?.selectorRecords[repairIndex];
  if(!selector||selector.runtimeRequired||selector.receiver!=='document')return;
  const token=visibleWaitGeneration.current.begin();
  const itemIndex=focused,selectorIndex=repairIndex,scanId=result.scanId,target=targetId;
  visibleWaitActive.current=true;setBusy(true);setError('');setVisibleWaitEvidence(null);
  try{
   const evidence=await window.ussm.waitUntilElementVisible({
    scanId,itemIndex,selectorIndex,targetId:target,approved:true,
   });
   if(visibleWaitGeneration.current.isCurrent(token)){
    setVisibleWaitEvidence({selectorIndex,result:evidence});
    setMessage('有界只读等待结束；连续 CSS 可能可见线索仅属 V1，V2 未验证，不能证明用户脚本功能正常。');
   }
  }catch{
   if(visibleWaitGeneration.current.isCurrent(token))
    setError('元素可见性等待失败：页面身份、定位器或用户授权可能已变化。');
  }finally{
   if(visibleWaitGeneration.current.isCurrent(token)){visibleWaitActive.current=false;setBusy(false);}
  }
 }
 async function inspectEventListeners(){
  if(focused===null||!result||!targetId||busy)return;
  const selector=result.items[focused]?.analysis?.selectorRecords[repairIndex];
  if(!selector||selector.runtimeRequired||selector.receiver!=='document')return;
  const token=listenerGeneration.current.begin();
  const itemIndex=focused,selectorIndex=repairIndex,scanId=result.scanId,target=targetId;
  listenerActive.current=true;setBusy(true);setError('');setListenerEvidence(null);
  try{
   const evidence=await window.ussm.inspectEventListeners({scanId,itemIndex,selectorIndex,targetId:target,approved:true});
   if(listenerGeneration.current.isCurrent(token)){
    setListenerEvidence({selectorIndex,result:evidence});
    setMessage('已检查直接 click 监听器；不能证明实际点击或 GM 功能。V2/V3/V4 尚未通过。');
   }
  }catch(error){
   if(listenerGeneration.current.isCurrent(token))setError('事件监听器检查失败：'+summarizeSafeDesktopError(error));
  }finally{
   if(listenerGeneration.current.isCurrent(token)){listenerActive.current=false;setBusy(false);}
  }
 }
 async function inspectInteractionReadiness(){
  if(focused===null||!result||!targetId||busy)return;
  const selector=result.items[focused]?.analysis?.selectorRecords[repairIndex];
  if(!selector||selector.runtimeRequired||selector.receiver!=='document')return;
  const token=readinessGeneration.current.begin();
  const itemIndex=focused,selectorIndex=repairIndex,scanId=result.scanId,target=targetId;
  readinessActive.current=true;setBusy(true);setError('');setReadinessEvidence(null);
  try{
   const evidence=await window.ussm.inspectInteractionReadiness({
    scanId,itemIndex,selectorIndex,targetId:target,approved:true,
   });
   if(readinessGeneration.current.isCurrent(token)){
    setReadinessEvidence({selectorIndex,result:evidence});
    setMessage('双次只读交互条件评估完成，仅用于确定后续核查优先级；V2 未验证，V3/V4 未配置。没有点击页面或执行油猴脚本。');
   }
  }catch{
   if(readinessGeneration.current.isCurrent(token))
    setError('双次交互条件评估失败：页面状态、授权或浏览器证据可能已变化。');
  }finally{
   if(readinessGeneration.current.isCurrent(token)){readinessActive.current=false;setBusy(false);}
  }
 }
  async function reviewSelectedProductAction(){
  if(focused===null||!result||!targetId||busy)return;
  const record=result.items[focused]?.analysis?.selectorRecords[repairIndex];
  if(!record||record.runtimeRequired||record.receiver!=='document')return;
  const token=productActionGeneration.current.begin();
  const scanId=result.scanId,itemIndex=focused,selectorIndex=repairIndex,target=targetId,action=productAction;
  productActionActive.current=true;setBusy(true);setError('');setProductActionEvidence(null);
  try{
   const evidence=await window.ussm.reviewProductAction({
    scanId,itemIndex,selectorIndex,targetId:target,action,approved:true,
   });
   if(productActionGeneration.current.isCurrent(token)){
    setProductActionEvidence({selectorIndex,action,result:evidence});
    setMessage('动作风险审查完成，只读核验；不会自动执行网页操作。V2 未验证，V3/V4 未配置。');
   }
  }catch{
   if(productActionGeneration.current.isCurrent(token))
    setError('动作风险审查失败：授权、页面或只读证据可能变化；没有执行网页操作。');
  }finally{
   if(productActionGeneration.current.isCurrent(token)){productActionActive.current=false;setBusy(false);}
  }
 }
 async function approvedFocusCurrentControl(){
  if(focused===null||!result||!targetId||busy)return;
  const record=result.items[focused]?.analysis?.selectorRecords[repairIndex];
  if(!record||record.runtimeRequired||record.receiver!=='document')return;
  const token=focusGeneration.current.begin();
  const scanId=result.scanId,itemIndex=focused,selectorIndex=repairIndex,target=targetId;
  focusActive.current=true;setBusy(true);setError('');setFocusEvidence(null);
  try{
   const receipt=await window.ussm.approvedControlFocus({
    scanId,itemIndex,selectorIndex,targetId:target,approved:true,
   });
   if(focusGeneration.current.isCurrent(token)){
    setFocusEvidence({selectorIndex,result:receipt});
    setMessage(receipt.status==='focus-observed'?
     '同一个已授权按钮确实获得焦点：只记为单次 V2 聚焦行为，不能证明脚本或业务功能。':
     '聚焦后的独立焦点证据不足：V2 阻断，未确认业务功能。');
   }
  }catch{
   if(focusGeneration.current.isCurrent(token))
    setError('受控控件聚焦未获确认：控件、权限或页面身份可能改变。焦点事件可能已发生，不会自动重试。');
  }finally{
   if(focusGeneration.current.isCurrent(token)){focusActive.current=false;setBusy(false);}
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
    setMessage(expectation==='count-changed'?'双次只读 DOM 数量变化核验完成；即使变化也不证明由用户脚本引起，V2 未验证，V3/V4：未配置。':'双次 DOM 合约核验完成；只证明指定定位器的当前 DOM 状态，不代表脚本业务功能通过。');
   }
  }catch(error){
   if(contractGeneration.current.isCurrent(token))setError('DOM 合约核验失败：'+summarizeSafeDesktopError(error));
  }finally{
   if(contractGeneration.current.isCurrent(token)){contractActive.current=false;setBusy(false);}
  }
 }
  async function observeManualTransition(phase:'start'|'finish'){
  if(focused===null||!result||!targetId||busy)return;
  const locator=result.items[focused]?.analysis?.selectorRecords[repairIndex];
  if(!locator||locator.runtimeRequired||locator.receiver!=='document')return;
  const scanId=result.scanId,itemIndex=focused,selectorIndex=repairIndex,target=targetId;
  if(phase==='finish'&&(
   manualTransitionEvidence?.result.status!=='awaiting-user-action'||
   manualTransitionEvidence.scanId!==scanId||
   manualTransitionEvidence.itemIndex!==itemIndex||
   manualTransitionEvidence.selectorIndex!==selectorIndex||
   manualTransitionEvidence.targetId!==target))return;
  const token=manualTransitionGeneration.current.begin();
  manualTransitionActive.current=true;setBusy(true);setError('');
  if(phase==='start')setManualTransitionEvidence(null);
  try{
   const evidence=await window.ussm.observeManualDomTransition({
    scanId,itemIndex,selectorIndex,targetId:target,phase,approved:true,
   });
   if(manualTransitionGeneration.current.isCurrent(token)){
    setManualTransitionEvidence({selectorIndex,scanId,itemIndex,targetId:target,result:evidence});
    setMessage(phase==='start'?
     '已记录起始 DOM 状态；用户可自行进行安全操作后再复核。程序不会自动点击网页；V2 未验证。':
     '完成两阶段 DOM 数量观察；不能证明由用户脚本引起，也不构成 V2/V3/V4 功能通过。');
   }
  }catch{
   if(manualTransitionGeneration.current.isCurrent(token)){
    setManualTransitionEvidence(null);
    setError('手动前后观察无法完成：页面身份、范围、证据或一分钟有效期可能已变化。');
   }
  }finally{
   if(manualTransitionGeneration.current.isCurrent(token)){manualTransitionActive.current=false;setBusy(false);}
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
   setBulkRepairResults(null);setError('批量候选检查失败：'+summarizeSafeDesktopError(error));
  }finally{if(bulkGeneration.current.isCurrent(token)){bulkActive.current=false;setBusy(false);}}
 }
 async function proposeBatchRepair(){
  if(!result||focused===null||!bulkRepairResults||busy)return;
  const changes=bulkRepairResults.items.filter(x=>x.candidates.length===1).slice(0,8)
   .map(x=>({selectorIndex:x.selectorIndex,newSelector:x.candidates[0]!.expression}));
  if(changes.length<2){setMessage('至少需要两个已唯一验证的 DOM 候选才能准备批量修复；目前没有执行任何写入。');return;}
  setBusy(true);setError('');setBatchRepairProposal(null);
  try{
   const approvalIndex=focused,approvalScanId=result.scanId;
   const reviewed=await window.ussm.proposeBatchRepair({
    scanId:approvalScanId,itemIndex:approvalIndex,changes,
   });
   setBatchRepairProposal({...reviewed,itemIndex:approvalIndex,scanId:approvalScanId});
   setMessage('已生成 '+reviewed.changes.length+' 处选择器的批量修复预览，尚未保存任何修订。V2/V3/V4 未验证。');
  }catch{setError('批量修复预览失败：源文件或已有受管修订可能发生变化，请重新扫描并检查候选。');}
  finally{setBusy(false);}
 }
 function stageCurrentMultiScriptRepair(){
  if(!result||focused===null||!batchRepairProposal||
     batchRepairProposal.itemIndex!==focused||batchRepairProposal.scanId!==result.scanId||
     !result.items[focused]?.scriptId)return;
  const scriptId=result.items[focused]!.scriptId!;
  setStagedMultiScriptJobs(current=>{
   const without=current.filter(row=>row.scriptId.toLowerCase()!==scriptId.toLowerCase());
   return [...without,{itemIndex:focused,scriptId,proposalId:batchRepairProposal.proposalId,
    proposedHash:batchRepairProposal.proposedHash}].slice(0,8);
  });
  setMessage('已暂存该脚本已分别审核的修复预览；尚未写入。请选择其他脚本并审核预览，至少两份不同脚本才能统一提交。');
 }
 async function applyStagedMultiScriptBatch(){
  if(!result||busy||stagedMultiScriptJobs.length<2)return;
  setBusy(true);setBatchApplying(true);setError('');
  try{
   const summary=await window.ussm.applyMultiScriptBatch({
    scanId:result.scanId,approved:true,
    jobs:stagedMultiScriptJobs.map(row=>({itemIndex:row.itemIndex,proposalId:row.proposalId})),
   });
   setStagedMultiScriptJobs([]);
   setBatchRepairProposal(null);setManagedRevisions(null);setManagedHealth(null);
   setMessage('多脚本受管修复完成：成功 '+summary.completed+'，失败 '+summary.failed+
    '，阻止 '+summary.blocked+'，取消 '+summary.cancelled+
    '。仅代表受管写入结果，原始脚本未覆盖；V2/V3/V4 未验证。');
  }catch{
   setStagedMultiScriptJobs([]);
   setError('多脚本原生审批或受管修复失败；旧授权不可重放。请逐份重新检查并生成修复预览。');
  }finally{setBatchApplying(false);setBusy(false);}
 }
 async function pauseCurrentBatchRepair(){
  if(!batchApplying||!batchRepairProposal)return;
  try{
   const accepted=await window.ussm.pauseBatchRepair({proposalId:batchRepairProposal.proposalId});
   if(accepted){
    setManagedBatchPaused(true);
    setMessage('已请求暂停当前批量修复；尚未写入的任务继续等待。恢复时将重新验证受管写入许可、扫描状态和文件哈希。');
   }else setMessage('当前没有可暂停的任务，或此任务已经暂停、进入写入、或已结束。');
  }catch{setError('无法安全暂停当前批量修复。');}
 }
 async function resumeCurrentBatchRepair(){
  if(!batchApplying||!batchRepairProposal)return;
  try{
   const accepted=await window.ussm.resumeBatchRepair({proposalId:batchRepairProposal.proposalId});
   if(accepted){
    setManagedBatchPaused(false);
    setMessage('恢复请求已发送；系统将重新验证许可和扫描状态，旧的写入前检查结果不可复用。');
   }else setMessage('当前没有处于暂停状态的活动批量修复。');
  }catch{setError('无法安全恢复当前批量修复。');}
 }
 async function cancelCurrentBatchRepair(){
  if(!batchApplying||!batchRepairProposal)return;
  try{
   const cancelled=await window.ussm.cancelBatchRepair({proposalId:batchRepairProposal.proposalId});
   if(cancelled)setMessage('已向主进程请求取消当前批量修复；正在写入的修订可能已经完成，请以最终受管修订记录及队列状态为准。');
   else setMessage('没有可取消的当前批量修复；可能仍处于确认流程，或写入已完成。');
  }catch{setError('无法安全取消当前批量修复；请检查最终受管修订状态。');}
 }
 async function applyBatchRepair(){
  if(!result||focused===null||!batchRepairProposal||busy)return;
  setBusy(true);setBatchApplying(true);setManagedBatchPaused(false);setError('');
  try{
   const receipt=await window.ussm.applyBatchRepair({
    scanId:result.scanId,itemIndex:focused,proposalId:batchRepairProposal.proposalId,
    approved:true,
   });
   setManagedActive({hash:receipt.hash,activePath:receipt.activePath});
   setManagedRevisions(null);setRepairApplied(null);
   setBatchRepairProposal(null);setBulkRepairResults(null);
   setMessage('已批准保存多处选择器至同一份受管修订：'+receipt.hash+'。原始脚本未修改，也未自动安装至 Tampermonkey；V2/V3/V4 未验证。');
  }catch{setError('批量修复保存失败：预览已失效、源文件被修改或存在并发修订；不会自动覆盖原始脚本。');}
  finally{setManagedBatchPaused(false);setBatchApplying(false);setBusy(false);}
 }
 async function applyBatchRepairGuarded(){
  if(!result||focused===null||!batchRepairProposal||!targetId||busy)return;
  setWatchEnabled(false);setBusy(true);setBatchApplying(true);setManagedBatchPaused(false);setError('');
  try{
   const evidence=await window.ussm.applyBatchRepairGuarded({
    scanId:result.scanId,itemIndex:focused,proposalId:batchRepairProposal.proposalId,
    targetId,approved:true,
   });
   setBatchRepairProposal(null);setBulkRepairResults(null);setManagedRevisions(null);
   setRepairApplied(null);setManagedActive(null);
   if(evidence.status==='retained-v1'){
    setManagedActive({hash:evidence.appliedHash,activePath:evidence.activePath});
    setMessage('批量修复已保存：共 '+evidence.verifiedIndexes.length+' 处经过双次、唯一节点 V1 核验；只是 DOM 证据，V2/V3/V4 未通过，也没有安装至 Tampermonkey。');
   }else if(evidence.status==='rolled-back-v1'){
    setMessage('批量修复中至少一处未满足 V1 条件，已把整份受管修订回滚到前一哈希 '+evidence.activeHash+'。原始脚本未修改。');
   }else{
    setError('批量修订 V1 检查未通过，且安全回滚被其它修改或文件错误阻断；请检查受管文件，程序不会谎报恢复成功。');
   }
  }catch{
   setError('批量修复 V1 检查无法安全启动：授权、原件、页面或修订可能已变更。');
  }finally{setManagedBatchPaused(false);setBatchApplying(false);setBusy(false);}
 }
 async function suggestRepair(){if(focused===null||!targetId||!result||pageProbe?.probe.checks[repairIndex]?.status!=='missing')return;
  setBusy(true);setError('');setRepairCandidates(null);setRepairProposal(null);
  try{const candidates=await window.ussm.suggestRepair({scanId:result.scanId,itemIndex:focused,selectorIndex:repairIndex,targetId,approved:true});setRepairCandidates(candidates);setMessage(candidates.length?'取得 '+candidates.length+' 个 DOM 匹配的候选；候选不代表功能验证通过。':'当前网页没有足够可靠的唯一候选，请手动输入新选择器。');}
  catch(e){setError('候选定位器提取失败：'+summarizeSafeDesktopError(e));}finally{setBusy(false);}
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
  }catch(error){setError('自动准备修复预览失败：'+summarizeSafeDesktopError(error));}
  finally{setBusy(false);}
 }
 async function proposeRepair(){if(focused===null||!result||!repairNew.trim())return;
  setWatchEnabled(false);setBusy(true);setError('');setRepairProposal(null);setRepairApplied(null);
  try{const r=await window.ussm.proposeRepair({scanId:result.scanId,itemIndex:focused,selectorIndex:repairIndex,newSelector:repairNew.trim()});setRepairProposal(r);setMessage('修复预览已生成；尚未写入任何文件。');}
  catch(e){setError('生成预览失败：'+summarizeSafeDesktopError(e));}finally{setBusy(false);}
 }
 async function applyRepair(){if(!repairProposal||!result)return;
  setWatchEnabled(false);setBusy(true);setError('');
  try{const r=await window.ussm.applyRepair({scanId:result.scanId,proposalId:repairProposal.proposalId,approved:true});setRepairAudit(null);setRepairApplied({...r,itemIndex:focused??-1,selectorIndex:repairIndex});setManagedRevisions(null);setManagedActive({hash:r.hash,activePath:r.activePath});setRepairProposal(null);setMessage('受管修复副本已保存；原始脚本没有被覆盖。');}
  catch(e){setError('修复保存失败：'+summarizeSafeDesktopError(e));}finally{setBusy(false);}
 }
 async function applyRepairGuarded(){
  if(!repairProposal||!result||focused===null||!targetId||busy)return;
  setWatchEnabled(false);setBusy(true);setError('');
  try{
   const guarded=await window.ussm.applyRepairGuarded({
    scanId:result.scanId,proposalId:repairProposal.proposalId,
    itemIndex:focused,selectorIndex:repairIndex,targetId,approved:true,
   });
   setRepairProposal(null);setManagedRevisions(null);setRepairAudit(null);
   if(guarded.status==='retained-v1'){
    setRepairApplied({backupPath:guarded.backupPath,managedPath:guarded.managedPath,
     hash:guarded.appliedHash,itemIndex:focused,selectorIndex:repairIndex});
    setManagedActive(null);
    if(!guarded.auditRevisionId)throw new Error('Retained repair audit identity missing');
    const audit=await window.ussm.getAuditTrace({revisionId:guarded.auditRevisionId});
    if(!audit||audit.revision.id!==guarded.auditRevisionId||audit.revision.revisionSha256!==guarded.appliedHash)
     throw new Error('Retained repair audit readback mismatch');
    setRepairAudit(audit);
    setMessage('修订在真实 Chrome V1 双采样中成立，已保留受管副本并写入可追溯审计链。V2/V3/V4 未验证；尚不能判定油猴脚本功能成功。');
   }else if(guarded.status==='rolled-back-v1'){
    setRepairApplied(null);setManagedActive(null);setRepairAudit(null);
    setMessage('新修订的 V1 证据不成立或无法确认，已自动恢复上一受管修订。V2/V3/V4 未验证，原始脚本未覆盖。');
   }else{
    setRepairApplied(null);setManagedActive(null);setRepairAudit(null);
    setError('自动复核后回滚受阻（rollback-blocked）：未确认当前受管版本；请先检查修订历史和外部编辑，原始脚本保持不变。');
   }
  }catch(error){setError('受管补丁安全保存和 V1 自动复核失败：'+summarizeSafeDesktopError(error));}
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
  }catch(error){setError('受管修订 V1 检查失败：'+summarizeSafeDesktopError(error));}
  finally{setBusy(false);}
 }
 async function inspectManagedHealth(){if(focused===null||!result||busy)return;
  setBusy(true);setError('');setManagedHealth(null);
  try{setManagedHealth(await window.ussm.inspectManagedIntegrity({scanId:result.scanId,itemIndex:focused}));}
  catch(error){setError('检查受管资料完整性失败：'+summarizeSafeDesktopError(error));}
  finally{setBusy(false);}
 }
 async function showManagedHistory(){if(focused===null||!result)return;
  setBusy(true);setError('');
  try{setManagedRevisions(await window.ussm.listManagedRevisions({scanId:result.scanId,itemIndex:focused}));}
  catch(e){setError('加载修订历史失败：'+summarizeSafeDesktopError(e));}finally{setBusy(false);}
 }
 async function showRollbackAuditHistory(){
   if(focused===null||!result||busy)return;
   const ticket=rollbackAuditGeneration.current.begin();
   setBusy(true);setError('');
   try{
    const rows=await window.ussm.listRollbackAuditHistory({scanId:result.scanId,itemIndex:focused});
    rollbackAuditGeneration.current.commit(ticket,()=>setRollbackAuditEvents(rows));
   }catch(error){
    rollbackAuditGeneration.current.commit(ticket,()=>setError('读取回滚审计失败：'+summarizeSafeDesktopError(error)));
   }finally{setBusy(false);}
  }
  async function showManagedAudit(hash:string){
  if(focused===null||!result||busy)return;
  setBusy(true);setError('');setRepairAudit(null);
  try{
   const audit=await window.ussm.getManagedAuditTrace({scanId:result.scanId,itemIndex:focused,revisionHash:hash});
   if(audit){setRepairAudit(audit);setMessage('已从本机审计库回查此受管修订的 FR-041 关联链。');}
   else setMessage('此受管修订没有可关联的 FR-041 审计链；可能是旧修订、原始备份或非受保护写入路径。');
  }catch(error){setError('读取受管修订审计链失败：'+summarizeSafeDesktopError(error));}
  finally{setBusy(false);}
 }
 async function exportManaged(){if(focused===null||!result)return;
  setBusy(true);setError('');
  try{const exported=await window.ussm.exportManaged({scanId:result.scanId,itemIndex:focused});
   if(!exported.canceled)setMessage('已安全导出受管脚本：'+exported.path+'。仍需在 Tampermonkey 导入并验证实际功能。');
  }catch(error){setError('导出受管脚本失败：'+summarizeSafeDesktopError(error));}
  finally{setBusy(false);}
 }
 async function rollbackManaged(hash:string){if(focused===null||!result)return;
  setBusy(true);setError('');setRepairProposal(null);
  try{const restored=await window.ussm.rollbackManaged({scanId:result.scanId,itemIndex:focused,hash,approved:true});setManagedActive(restored);setMessage('当前受管副本已恢复到所选修订；原始脚本不会被覆盖。仍需自行验收脚本行为。');}
  catch(e){setError('恢复受管副本失败：'+summarizeSafeDesktopError(e));}finally{setBusy(false);}
 }
 async function manageSiteTestCase(action:'create'|'remove'|'verify'){
  if(!result||focused===null||siteTestBusy)return;
  if(action!=='create'&&!siteTestSelectedId)return;
  if(action==='verify'&&!targetId)return;
  const scanId=result.scanId,itemIndex=focused,caseId=siteTestSelectedId;
  const token=siteTestGeneration.current.begin();
  setSiteTestBusy(true);setError('');setSiteTestResult(null);
  try{
   if(action==='verify'){
    const evidence=await window.ussm.verifySiteTestCase({scanId,itemIndex,caseId,targetId,approved:true});
    siteTestGeneration.current.commit(token,()=>setSiteTestResult(evidence));
   }else{
    const created=action==='create'?
     await window.ussm.createSiteTestCase({scanId,itemIndex,url:siteTestUrl.trim(),label:siteTestLabel.trim(),stateId:siteTestState,approved:true}):null;
    if(action==='remove'){
     const removal=await window.ussm.removeSiteTestCase({scanId,itemIndex,caseId,approved:true});
     if(!removal.deleted)return;
    }
    const items=await window.ussm.listSiteTestCases({scanId,itemIndex});
    siteTestGeneration.current.commit(token,()=>{
     setSiteTestCases(items);
     setSiteTestSelectedId(created?.id??items[0]?.id??'');
     if(created){setSiteTestUrl('');setSiteTestLabel('');}
     setMessage(action==='create'?'已保存测试页面场景；不执行页面操作或脚本。':'仅删除本地测试场景记录。');
    });
   }
  }catch(error){siteTestGeneration.current.commit(token,()=>setError('测试页面场景操作失败：'+summarizeSafeDesktopError(error)));}
  finally{siteTestGeneration.current.commit(token,()=>setSiteTestBusy(false));}
 }
 const details=focused===null?null:result?.items[focused];
 return <div className="shell">
  <aside className="sidebar"><div className="logo"><span className="logo-icon">✦</span><span>USSHM <small>SELF-HEALING MANAGER</small></span></div>
   <nav><div className="nav-label">工作区</div><div className="nav-item active">▦　脚本资料库</div><div className="nav-item">⌁　页面定位器核验 <span>只读</span></div><div className="nav-item">⚙　受控修复工作台 <span>预览</span></div><div className="nav-label">系统</div><div className="nav-item">◉　Chrome CDP <span>可连接</span></div></nav>
   <div className="sidebar-bottom">V{appInfo?.version??'0.1'} · {appInfo?.distributionMode??'preview'}<div className="dim">本地数据 · 不上传脚本</div></div>
  </aside>
  <main className="main"><header><div><div className="eyebrow">USERSCRIPT MAINTENANCE</div><h1>油猴脚本智能自愈管理器</h1><p>批量检查源码中的 DOM 依赖，定位潜在失效点，记录可追溯的静态分析结果。</p></div><span className="status-dot">●　离线分析模式</span></header>
   {repairQueueRecovery&&(repairQueueRecovery.needsReview>0||repairQueueRecovery.unreadable>0)&&
    <section className="panel" role="status">
     <div className="panel-head"><div><h2>批量修复中断记录 · 需要重新确认</h2>
      <p>发现 {repairQueueRecovery.needsReview} 项需要复核的修复记录、
      {repairQueueRecovery.uncertain} 项可能已写入或写入结果不确定，
      以及 {repairQueueRecovery.unreadable} 个无法安全读取的检查点。</p>
      <p>请检查受管修订完整性，再重新扫描并审批。不会自动恢复旧授权，也不会重新执行原始脚本。</p>
     </div><span className="pill">离线只读 · 禁止自动重放</span></div>
    </section>}
   {repairQueueActivity&&
    (batchApplying||Object.values(repairQueueActivity).some(count=>count>0))&&
    <section className="panel" role="status">
     <div className="panel-head"><div><h2>修复队列进度 · 本次会话</h2>
      <p>排队 {repairQueueActivity.queued} 项 · 写入中 {repairQueueActivity.running} 项 ·
      完成 {repairQueueActivity.completed} 项 · 失败 {repairQueueActivity.failed} 项 ·
      阻断 {repairQueueActivity.blocked} 项 · 取消 {repairQueueActivity.cancelled} 项。</p>
      <p>仅展示主进程的状态汇总，不包含脚本路径或审批身份。完成只表示受管写入，不代表 V2/V3/V4 验收完成。</p>
     </div><span className="pill">只读进度 · 不可重放</span></div>
    </section>}
   {batchApplying&&<section className="panel" role="status">
    <div className="panel-head"><div><h2>当前已审批批量任务</h2>
     <p>取消只阻止尚未开始的写入；正在写入的修订可能已经完成，不能假称回滚。</p>
    </div><div className="toolbar">
     {!managedBatchPaused?<button type="button" onClick={()=>void pauseCurrentBatchRepair()}>暂停当前批量修复</button>:
      <button type="button" onClick={()=>void resumeCurrentBatchRepair()}>恢复当前批量修复</button>}
     <button type="button" onClick={()=>void cancelCurrentBatchRepair()}>取消当前批量修复</button>
    </div></div>
   </section>}
   <section className="stats"><div className="stat"><label>资料库脚本</label><strong>{history.length}</strong><span>SQLite 本地索引</span></div><div className="stat"><label>本次处理</label><strong>{result?.processedCount??0}</strong><span>逐文件隔离</span></div><div className="stat"><label>解析错误</label><strong className={result?.errorCount?'warn':''}>{result?.errorCount??0}</strong><span>待人工检查</span></div><div className="stat"><label>动态 Selector</label><strong>{result?.items.reduce((sum,x)=>sum+x.runtimeRequiredCount,0)??0}</strong><span>需要运行时确认</span></div></section>
   <section className="panel">
    <div className="panel-head"><div><h2>SQLite 索引备份</h2>
     <p>仅备份 SQLite 脚本索引 registry.sqlite，使用一致性 WAL 快照及 SHA-256 校验。不包含受管修订、诊断历史、Chrome 配置和其他 Data/ 文件；不能代替完整恢复包。</p>
    </div><span className="pill">安全不覆盖</span></div>
    <div className="toolbar"><button type="button" className="secondary" disabled={busy} onClick={()=>void backupRegistry()}>另存 SQLite 索引备份</button></div>
    <div className="toolbar"><button type="button" className="secondary" disabled={busy} onClick={()=>void backupJournal()}>另存诊断历史 SQLite 备份</button>
     <p className="dim">仅备份诊断历史数据库，不包含受管修订、浏览器配置或完整 Data/ 资料。</p>
    </div>
    <div className="toolbar"><button type="button" className="secondary" disabled={busy} onClick={()=>void exportManagedRecovery()}>导出受管修订恢复备份</button>
     <p className="dim">仅备份受管修订归档及匹配的 current.user.js，不包含 SQLite 数据库、Chrome 配置或密钥；不等于完整灾难恢复。</p>
    </div>
    <div className="toolbar"><button type="button" className="secondary" disabled={busy} onClick={()=>void createCoreRecovery()}>创建核心资料组合备份</button>
     <button type="button" className="secondary" disabled={busy} onClick={()=>void verifyCoreRecovery()}>核验已有核心备份（只读）</button>
     <button type="button" className="secondary" disabled={busy} onClick={()=>void stageCoreRecovery()}>离线暂存核心备份（不覆盖）</button>
     <button type="button" className="secondary" disabled={busy} onClick={()=>void verifyOfflineCoreStage()}>核验离线暂存（只读）</button>
     <p className="dim">组合 registry.sqlite、诊断历史和受管修订，并生成 SHA-256 总清单。跨存储非原子快照；不是完整 Data/ 灾难恢复，不包含站点规则、Chrome 配置和密钥，也不会自动恢复脚本。</p>
    </div>
   </section>
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
     <button type="button" className="secondary" disabled={adapterBusy} onClick={()=>void window.ussm.listSiteAdapters().then(setAdapterLibrary).catch(error=>setError(summarizeSafeDesktopError(error)))}>刷新本地规则</button>
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
    <div className="actions" style={{justifyContent:'flex-start',flexWrap:'wrap'}}><button className="secondary" onClick={()=>void pickChrome()}>选择 Chrome</button><button className="secondary" disabled={!chromePath} onClick={()=>void startChrome()}>启动浏览器调试</button><button className="secondary" disabled={!chromePath} onClick={()=>void startIsolatedChrome()}>启动隔离调试 Chrome</button><button onClick={()=>void checkCdp()}>检查 CDP 连接</button><button className="secondary" disabled={!cdp||busy||managerBusy} onClick={()=>void inspectManagerTargets()}>检查油猴管理器扩展目标（只读）</button></div>
    {managerTargetReport&&<div className="notice">
     <p><b>扩展运行目标观察（不是安装或 V4 证明）</b></p>
     <p>Tampermonkey Stable：{managerTargetReport.observed.includes('tampermonkey-stable')?'观察到后台运行目标':'没有观察到运行目标（不代表未安装）'}；
      Tampermonkey Beta：{managerTargetReport.observed.includes('tampermonkey-beta')?'观察到后台运行目标':'没有观察到运行目标（不代表未安装）'}；
      Violentmonkey：{managerTargetReport.observed.includes('violentmonkey')?'观察到后台运行目标':'没有观察到运行目标（不代表未安装）'}。</p>
     <p>V4 未验证／未配置：无法据此证明脚本注入、GM_* 权限、储存或网络请求工作正常；不会执行脚本或读取扩展数据。</p>
    </div>}
    <p className="dim" style={{overflowWrap:'anywhere',marginTop:12}}>{chromePath||'尚未选择浏览器 EXE（可选择便携版 Chrome）'}</p>
    <div className="actions" style={{justifyContent:'flex-start',flexWrap:'wrap',marginTop:12}}>
     <input aria-label="浏览器配置名称" maxLength={40} value={browserProfileName}
      onChange={event=>setBrowserProfileName(event.target.value)}
      placeholder="新配置名称／重命名" style={{maxWidth:220}}/>
     <button className="secondary" disabled={!chromePath||!browserProfileName.trim()} onClick={()=>void saveBrowserProfile()}>保存浏览器配置</button>
     <select aria-label="已保存的浏览器配置" value={selectedBrowserProfileId}
      onChange={event=>{setSelectedBrowserProfileId(event.target.value);setBrowserProfileName('');}}>
      <option value="">选择已保存的配置</option>
      {browserProfiles.map(item=><option key={item.id} value={item.id}>{item.name}{item.isDefault?'（默认）':''}</option>)}
     </select>
     <button className="secondary" disabled={!selectedBrowserProfileId} onClick={()=>void launchSelectedBrowserProfile()}>启动选定配置</button>
     <button className="secondary" disabled={!selectedBrowserProfileId||!browserProfileName.trim()} onClick={()=>void renameSelectedBrowserProfile()}>重命名配置</button>
     <button className="secondary" disabled={!selectedBrowserProfileId} onClick={()=>void setSelectedBrowserProfileDefault()}>设为默认</button>
     <button className="secondary" disabled={!selectedBrowserProfileId} onClick={()=>void deleteSelectedBrowserProfile()}>删除配置记录</button>
    </div>
    <p className="dim">{browserProfileHealth==='invalid'||browserProfileHealth==='write-locked'?'配置状态异常，暂不显示正常数量':`已保存 ${browserProfiles.length}/16 个独立配置`}；每个配置使用 Data/Chrome-Profiles/ 下独立资料目录。删除配置只删除记录，不删除浏览器或资料。启动前重新核实浏览器 EXE 与 CDP 握手。</p>
    {browserProfileHealth==='invalid'&&<p className="notice">浏览器配置文件损坏或不安全：程序不会清空或覆盖原文件，请保留 Data/browser-profiles.json 以便恢复。</p>}
    {browserProfileHealth==='write-locked'&&<p className="notice">浏览器配置正在写入或存在遗留锁：为保护资料，当前不进行配置修改，也不会自动清除锁；请先确认所有程序实例已关闭。</p>}
    {browserProfiles.find(item=>item.id===selectedBrowserProfileId)&&
     <p className="dim" style={{overflowWrap:'anywhere'}}>已选浏览器：{browserProfiles.find(item=>item.id===selectedBrowserProfileId)?.executablePath}</p>}

     <p className="dim">如 Chrome 136+ 的现有资料目录禁用远程调试，可主动使用隔离模式；资料保存在本软件 Data/Chrome-CDP-Profile。不会使用原有 Chrome 的登录状态或扩展，需要自行安装 Tampermonkey 与测试脚本。</p>
    {cdp&&<div className="notice">检测到本机 CDP：{cdp.browser} · 当前可见 Page Targets：{cdp.pages.length} · Protocol {cdp.protocolVersion||'未知'} · 未验证是否为已选择的 Chrome</div>}
    {cdp&&cdp.pages.length>0&&<div className="toolbar"><label htmlFor="cdp-page">选择正在浏览的网页：</label><select id="cdp-page" aria-label="CDP 页面目标" value={targetId} onChange={e=>{setTargetId(e.target.value);setPageProbe(null);setRepairCandidates(null);setRepairNew('');setRepairProposal(null);}}><option value="">— 请明确选择目标网页 —</option>{cdp.pages.map((p,i)=><option key={p.id} value={p.id}>{p.origin.slice(0,130)} · 页面 {i+1}</option>)}</select></div>}
    <div className="toolbar">
     <button className="secondary" disabled={!targetId||!cdp||busy||exceptionBusy}
      onClick={()=>void observePageExceptions()}>{exceptionBusy?'观察中…':'观察网页异常（只计数）'}</button>
     <span className="dim">只对选定网页进行短时被动计数；CDP 事件可能含异常详情，但不会保存、展示或回传异常文字与堆栈，也不会读取页面 DOM；不能证明异常来自油猴脚本。</span>
    </div>
    {exceptionEvidence&&<div className="notice">
     <b>网页异常计数：</b>{exceptionEvidence.status==='observed'?String(exceptionEvidence.observedCount)+' 个被观察事件':
      exceptionEvidence.status==='none-observed'?'观察窗口内未见异常（不代表脚本正常）':'证据超限或无法确认'}
     · 来源未知；不代表网页或油猴脚本责任。V3/V4 未验证。
    </div>}
    <div className="toolbar"><button disabled={!cdp||!targetId||!result||busy} onClick={()=>void batchDiagnose()}>批量网页诊断（只读）</button>{batchRunning&&<button className="secondary" onClick={()=>{const active=batchPauseGate.current;if(!active)return;if(batchPaused){active.resume();setBatchPaused(false);}else if(active.pause())setBatchPaused(true);}}>{batchPaused?'继续检查':'暂停后续检查'}</button>}{batchRunning&&<button className="secondary" onClick={()=>{batchCancel.current=true;batchPauseGate.current?.cancel();setBatchPaused(false);if(result&&targetId)void window.ussm.cancelDiagnosis({scanId:result.scanId,targetId}).catch(error=>setError('取消诊断请求失败：'+summarizeSafeDesktopError(error)));}}>取消剩余检查</button>}<span className="dim">自动每批处理 25 份，按顺序完成所有已导入脚本；已检查 {batchProgress}/{result?.items.length??0}。{batchPaused?'已暂停下一批调度；当前请求完成后生效。':''}</span></div>
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
      <div className="notice">批量诊断结果：已完成 {batchResult.totalItems} 份 · 网站来源：{safeDomReportPageOrigin(batchResult.pageUrl)} · {batchResult.remainingItems>0?`还有 ${batchResult.remainingItems} 份等待处理（自动分批，每批 25 份）`:'本次扫描范围已全部处理'}</div>
      <div className="table-wrapper"><table><thead><tr><th>脚本</th><th>结果（仅 DOM）</th><th>已检查</th><th>匹配</th><th>缺失</th><th>需复核</th><th>验证等级</th></tr></thead><tbody>
       {batchResult.items.map(row=><tr key={row.index}><td>{nameOf(row.path)}</td><td>{row.status==='locator-missing'?'有选择器缺失':row.status==='dom-present'?'DOM 有匹配':row.status==='out-of-scope'?'不在脚本匹配范围':row.status==='needs-review'?'需要运行时复核':row.status==='skipped'?'跳过':row.status==='error'?'检查失败':'无定位器证据'}{row.reason&&<small>{row.reason}</small>}</td><td>{row.checked}</td><td>{row.found}</td><td>{row.missing}</td><td>{row.needsReview}</td><td><small>V0：{row.verification?.V0??'blocked'} · V1：{row.verification?.V1??'blocked'} · V2：{row.verification?.V2??'blocked'} · V3/V4：{row.verification?.V3??'not-configured'} / {row.verification?.V4??'not-configured'}</small></td></tr>)}
      </tbody></table></div>
    </div>}
   </section>
   {(error||message)&&<div role="status" className={'notice '+(error?'error':'')}>{error||message}</div>}
   <section className="panel"><div className="panel-head"><div><h2>静态诊断结果</h2><p>每个脚本独立显示解析状态与需要运行时确认的定位器。</p></div><div className="actions small"><button disabled={!result} className="secondary" onClick={()=>void exportReport('json')}>导出 JSON</button><button disabled={!result} className="secondary" onClick={()=>void exportReport('markdown')}>导出 Markdown</button></div></div>
   {result?<><input aria-label="筛选脚本" className="search" placeholder="搜索脚本名称或路径" value={search} onChange={e=>setSearch(e.target.value)}/><div className="table-wrapper"><table><thead><tr><th>文件</th><th>状态</th><th>Selectors</th><th>动态表达式</th><th></th></tr></thead><tbody>{filtered.map(item=><tr key={item.index}><td><b>{nameOf(item.path)}</b><small>{item.path}</small></td><td><span className={'tag '+(item.status==='parsed'?'ok':'bad')}>{item.status==='parsed'?'静态解析完成':item.status==='parse-error'?'语法错误':item.status==='unreadable'?'无法读取':'已跳过'}</span></td><td>{item.selectorCount}</td><td>{item.runtimeRequiredCount?`需要运行时确认 × ${item.runtimeRequiredCount}`:'—'}</td><td><button className="link" onClick={()=>{setFocused(item.index);setPageProbe(null);setRepairCandidates(null);setRepairProposal(null);setRepairApplied(null);setRepairAudit(null);setManagedRevisions(null);setManagedHealth(null);setManagedActive(null);setRepairIndex(0);setRepairNew('');}}>详情 ›</button></td></tr>)}</tbody></table></div></>:<div className="empty"><span>⌕</span><b>尚未开始诊断</b><p>先添加脚本，然后开始静态扫描。</p></div>}
   </section>
   {details?.scriptId&&result&&focused!==null&&<section className="panel">
    <div className="panel-head"><div><h2>FR-014 · 明确测试页面场景</h2>
     <p>保存多个测试 URL 和声明页面状态，仅作为本机配置。不会自动打开网站、注入脚本或执行点击。</p>
    </div><span className="pill">配置级 · 不执行</span></div>
    <div className="toolbar" style={{flexWrap:'wrap'}}>
     <input aria-label="测试页面 URL" type="url" value={siteTestUrl} maxLength={2048}
      onChange={e=>setSiteTestUrl(e.target.value)}
      placeholder="https://example.invalid/app/dashboard" style={{minWidth:260}}/>
     <input aria-label="场景名称" value={siteTestLabel} maxLength={60}
      onChange={e=>setSiteTestLabel(e.target.value)} placeholder="名称（不含账号或凭证）"/>
     <select aria-label="声明页面状态" value={siteTestState}
      onChange={e=>setSiteTestState(e.target.value as DeclaredPageState)}>
      <option value="logged-out">用户声明：未登录</option>
      <option value="logged-in">用户声明：已登录</option>
      <option value="custom">用户声明：自定义</option>
     </select>
     <button disabled={siteTestBusy||busy||!siteTestUrl.trim()||!siteTestLabel.trim()}
      onClick={()=>void manageSiteTestCase('create')}>保存测试页面场景</button>
    </div>
    <p className="dim">仅允许脚本 @match/@include 范围内的 HTTP(S) URL；不保存 URL 用户名、密码、查询参数或片段。最多每脚本 16 个场景。状态由用户声明，未经运行时验证。</p>
    <div className="toolbar" style={{flexWrap:'wrap'}}>
     <select aria-label="已保存测试场景" value={siteTestSelectedId}
      onChange={e=>{setSiteTestSelectedId(e.target.value);setSiteTestResult(null);}}>
      <option value="">— 选择已保存场景（{siteTestCases.length}）—</option>
      {siteTestCases.map(entry=><option value={entry.id} key={entry.id}>{entry.label} · {entry.stateId} · {entry.url}</option>)}
     </select>
     <button disabled={!targetId||!cdp||!siteTestSelectedId||siteTestBusy||busy}
      onClick={()=>void manageSiteTestCase('verify')}>检查已选 Chrome 页面与场景</button>
     <button className="secondary" disabled={!siteTestSelectedId||siteTestBusy||busy}
      onClick={()=>void manageSiteTestCase('remove')}>删除场景记录（再次确认）</button>
    </div>
    {siteTestResult&&<div className="notice"><b>页面匹配：</b>
     {siteTestResult.status==='matched'?'已选网页与配置的 URL 精确匹配':
      siteTestResult.status==='scope-blocked'?'脚本作用域不再许可此配置':'选定网页与配置不一致或包含私密参数'}
     <p className="dim">只读比较当前已选 CDP 页面与测试配置；声明的登录状态未经证明。
      V2 未验证 · V3/V4 未配置；没有运行油猴脚本或 GM API，不代表功能通过。</p>
    </div>}
   </section>}
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
    <div className="toolbar">
     <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired||details.analysis?.selectorRecords[repairIndex]?.receiver!=='document'}
      onClick={()=>void observeManualTransition('start')}>记录手动操作前 DOM 状态</button>
     <button disabled={busy||manualTransitionEvidence?.result.status!=='awaiting-user-action'||manualTransitionEvidence.selectorIndex!==repairIndex||manualTransitionEvidence.scanId!==result?.scanId||manualTransitionEvidence.itemIndex!==focused||manualTransitionEvidence.targetId!==targetId}
      onClick={()=>void observeManualTransition('finish')}>复核手动操作后 DOM 状态</button>
     <span className="dim">两阶段最多相隔一分钟；只读观察当前 document。程序不会自动点击网页；V2 未验证，V3/V4 未配置。</span>
    </div>
    {manualTransitionEvidence&&manualTransitionEvidence.selectorIndex===repairIndex&&<div className="notice">
     <b>用户操作前后 DOM 观察（非功能测试）：</b>
     {manualTransitionEvidence.result.status==='awaiting-user-action'?'起始样本已记录，等待用户自行操作':
      manualTransitionEvidence.result.status==='changed-observed'?'匹配数量发生变化':'匹配数量未变化'}
     · 起始 {manualTransitionEvidence.result.beforeCount}
     {manualTransitionEvidence.result.afterCount===null?'':<> → 结束 {manualTransitionEvidence.result.afterCount}</>}
     · V2 未验证 · V3/V4 未配置；不证明脚本触发事件或业务功能正常。
    </div>}
    <div className="toolbar"><button disabled={!cdp||!targetId||busy||(!watchEnabled&&!pageProbe)} onClick={()=>setWatchEnabled(old=>!old)}>{watchEnabled?'停止巡检':'启动每分钟只读巡检'}</button><span className="dim">只有窗口运行、目标页面保持匹配时定期复核；不写入脚本、不自动修复。</span></div>
    <p className="dim">巡检只用于 DOM 检测，不代表 Tampermonkey 功能通过。</p>
    {watchStatus&&<div className="notice">最近巡检：{watchCheckedAt} · {watchStatus.status==='locator-missing'?'当前页面存在未匹配的选择器':watchStatus.status==='dom-present'?'当前 DOM 有匹配节点（非功能通过）':watchStatus.status==='needs-review'?'当前结果需人工确认':'当前没有可检查的定位器'} · 匹配 {watchStatus.found} · 缺失 {watchStatus.missing} · 未确定 {watchStatus.needsReview}</div>}
    {watchError&&<div className="notice error">{watchError}</div>}
   {pageProbe&&<div className="notice"><b>DOM 文档节点：</b>{pageProbe.summary.nodeCount} · 文档：{pageProbe.summary.documentCount} · 作者 Shadow Tree 节点：{pageProbe.summary.authorShadowTreeNodes} · 已检查 {pageProbe.checkedLocators}/{pageProbe.totalLocators} 个定位器；仅当前 document 作用域，不代表油猴脚本功能通过。{pageProbe.summary.authorShadowTreeNodes>0&&<strong> Shadow DOM 内的定位器未被顶层 document 检查覆盖，需复核。</strong>}</div>}
   {pageProbe?.probe.checks.map((check,index)=><div className="selector" key={index}><div className="selector-top"><span>{check.method}</span><b>{check.status==='found'?'当前匹配':check.status==='missing'&&pageProbe.summary.authorShadowTreeNodes>0?'需复核（Shadow DOM）':check.status==='missing'?'无匹配':check.status==='ambiguous'?'多重匹配':check.status==='blocked'?'无法核验':'需要运行时确认'}</b></div><code>{check.expression}</code><small>匹配数：{check.matchCount===null?'未知':check.matchCount} · {check.reason}</small></div>)}
   <div className="toolbar">
    <label>DOM 合约预期<select aria-label="DOM 合约条件" value={contractExpectation} onChange={e=>{contractGeneration.current.invalidate();if(contractActive.current){contractActive.current=false;setBusy(false);}setContractExpectation(e.target.value as 'exists'|'unique'|'count-changed');setContractEvidence(null);}}>
     <option value="unique">唯一匹配</option><option value="exists">至少一个匹配</option><option value="count-changed">DOM 匹配数量变化（V1，只读）</option>
    </select></label>
    <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired||details.analysis?.selectorRecords[repairIndex]?.receiver!=='document'}
     onClick={()=>void runDomContract()}>双次 DOM 合约核验（V1，只读）</button>
    <span className="dim">仅当前顶层 document、连续两次 CDP 只读检查；V2 未验证，V3/V4：未配置。不执行脚本，也不触发按钮操作。</span>
   </div>
   {contractEvidence&&contractEvidence.selectorIndex===repairIndex&&<div className="notice">
    <b>命名 DOM 合约：</b>{contractEvidence.result.caseId} · 结果：{contractEvidence.result.status==='passed'?'通过（仅 DOM）':contractEvidence.result.status==='failed'?'未满足 DOM 条件':'需要复核'}
    · 连续检查 {contractEvidence.result.attempts} 次
    {contractEvidence.result.expectation==='count-changed'?
     (contractEvidence.result.initialMatchCount!==null&&contractEvidence.result.matchCount!==null?
      <> · 初次匹配数 {contractEvidence.result.initialMatchCount} → 最终匹配数 {contractEvidence.result.matchCount}</>:
      <> · 数量变化无法确认（证据不足）</>):
     <> · 匹配数量 {contractEvidence.result.matchCount??'不确定'}</>}
    · 等级 {contractEvidence.result.evidenceLevel} · V3/V4：未配置
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
   <div className="toolbar">
    <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired||details.analysis?.selectorRecords[repairIndex]?.receiver!=='document'}
     onClick={()=>void waitUntilElementVisible()}>等待 CSS 可能可见（V1，只读）</button>
    <span className="dim">最多四次有界 CDP 只读采样，需要连续两次同节点可见；不点击、不执行脚本、不在后台重试。V2 未验证。</span>
   </div>
   {visibleWaitEvidence&&visibleWaitEvidence.selectorIndex===repairIndex&&<div className="notice">
    <b>有界可见等待：</b>{visibleWaitEvidence.result.status==='potentially-visible-v1'?'连续可见线索（CSS/盒模型可能可见，仅 V1）':'未取得连续稳定 CSS 可能可见证据，需复核'}
    · 已采样 {visibleWaitEvidence.result.samples} 次
    · V2 未验证 · V3/V4 未配置
    <small>{visibleWaitEvidence.result.reason}；不能证明用户脚本已注入或实际功能已修复。</small>
   </div>}
   <div className="toolbar">
    <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired||details.analysis?.selectorRecords[repairIndex]?.receiver!=='document'}
     onClick={()=>void inspectEventListeners()}>检查事件监听器（只读）</button>
    <span className="dim">仅查询直接 click 监听器。无点击、无事件派发、无脚本执行；委托监听和油猴沙箱可能无法观察。</span>
   </div>
   {listenerEvidence&&listenerEvidence.selectorIndex===repairIndex&&<div className="notice">
    <b>直接 click 监听器：</b>{listenerEvidence.result.status==='registered'?'发现直接监听器':listenerEvidence.result.status==='none-observed'?'未观察到直接监听器（不等于没有功能）':listenerEvidence.result.status==='missing'?'顶层 DOM 未匹配':listenerEvidence.result.status==='ambiguous'?'选择器匹配多个元素':'证据不足'}
    · 数量 {listenerEvidence.result.listenerCount??'未知'}
    · V2 未验证；不能证明实际点击或 GM 功能，也不能证明业务操作成功。
   </div>}
   <div className="toolbar">
    <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired||details.analysis?.selectorRecords[repairIndex]?.receiver!=='document'}
     onClick={()=>void inspectInteractionReadiness()}>双次交互条件评估（只读）</button>
    <span className="dim">关联同一个 DOM 节点的唯一指纹、可见性、直接禁用属性和 click 监听器。仅提示潜在条件；不派发事件、不执行脚本、V2 未验证。</span>
   </div>
   {readinessEvidence&&readinessEvidence.selectorIndex===repairIndex&&<div className="notice">
    <b>交互前置条件：</b>{readinessEvidence.result.status==='potentially-ready'?'只读条件可能具备（非点击成功）':readinessEvidence.result.status==='blocked'?'已观察到控件阻断条件':'证据不完整／条件需要复核'}
    · 连续采样 {readinessEvidence.result.samples} 次
    · 直接 click 监听器 {readinessEvidence.result.directClickListeners??'未知'}
    · V2 未验证 · V3/V4 未配置
    <small>{readinessEvidence.result.reason}。不代表用户脚本已注入、控件实际可交互或任何业务操作成功。</small>
   </div>}
       <div className="toolbar">
     <label>拟测试动作<select aria-label="拟测试动作风险" value={productAction} onChange={e=>setProductAction(e.target.value as ProductAction)}>
      <option value="observe">只读观察</option><option value="focus">聚焦控件（低影响）</option>
      <option value="click">点击（可能改变状态）</option><option value="type">输入文字（可能改变状态）</option>
      <option value="submit">提交（危险）</option><option value="send">发送（危险）</option>
      <option value="delete">删除（危险）</option><option value="payment">付款（危险）</option>
     </select></label>
     <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||
      details.analysis.selectorRecords[repairIndex]?.runtimeRequired||details.analysis.selectorRecords[repairIndex]?.receiver!=='document'}
      onClick={()=>void reviewSelectedProductAction()}>动作风险审查（只读）</button>
     <span className="dim">所有动作默认拒绝执行，仅输出审查结果。V2 未验证。</span>
    </div>
    {productActionEvidence&&productActionEvidence.selectorIndex===repairIndex&&
     productActionEvidence.action===productAction&&<div className="notice">
      <b>动作审查：</b>{productActionEvidence.result.action} ·
      {productActionEvidence.result.risk==='DESTRUCTIVE'?'DESTRUCTIVE（危险）':
       productActionEvidence.result.risk==='STATE_CHANGING'?'STATE_CHANGING（状态变更）':
       productActionEvidence.result.risk==='LOW_IMPACT'?'LOW_IMPACT（低影响）':'READ_ONLY（只读）'}
      · 准备度 {productActionEvidence.result.readinessStatus}
      · 拒绝执行 · V2 未验证，V3/V4 未配置。
      <small>{productActionEvidence.result.reason}。不会自动执行网页操作，也不发放动作执行令牌。</small>
     </div>}
     <div className="toolbar">
      <button disabled={busy||!targetId||!cdp||!details.analysis?.selectorRecords[repairIndex]||
       details.analysis.selectorRecords[repairIndex]?.runtimeRequired||details.analysis.selectorRecords[repairIndex]?.receiver!=='document'}
       onClick={()=>void approvedFocusCurrentControl()}>确认聚焦此网页控件（单次 V2 行为）</button>
      <span className="dim">可能触发网页的 focus 事件与用户脚本监听器；每次需要额外明确确认。只允许普通非提交按钮，不执行 click、type、submit、send、delete 或 payment。没有可保证的焦点回滚。</span>
     </div>
     {focusEvidence&&focusEvidence.selectorIndex===repairIndex&&<div className="notice">
      <b>已批准聚焦：</b>{focusEvidence.result.status==='focus-observed'?'CDP 后置状态确认同一按钮获得焦点':'CDP 后置焦点证据不足'}
      · V2 {focusEvidence.result.V2==='focus-observed-only'?'仅观察到聚焦':'阻断'} · V3/V4 未配置 · 不能证明任何油猴或业务功能
      <small>{focusEvidence.result.reason}</small>
     </div>}
<div className="repair-section"><h3>修复工作台 · 受控副本</h3>
    <p className="dim">输入一个新的静态选择器，先生成修复预览，再人工审核并保存受管副本。不会覆盖原始脚本；不会自动修改 Tampermonkey 扩展内的代码。</p>
    <div className="actions" style={{justifyContent:'flex-start',flexWrap:'wrap'}}>
     <label>旧选择器<select aria-label="选择需要替换的静态定位器" value={repairIndex} onChange={e=>{setRepairIndex(Number(e.target.value));setRepairProposal(null);setRepairCandidates(null);setRepairNew('');}}>{details.analysis?.selectorRecords.map((s,i)=><option key={i} value={i} disabled={s.runtimeRequired}>{s.method} · {s.expression.slice(0,90)}{s.runtimeRequired?'（动态，不可直接补丁）':''}</option>)}</select></label>
     <label>新的方法参数<input aria-label="输入新选择器" value={repairNew} onChange={e=>{setRepairNew(e.target.value);setRepairProposal(null);}} placeholder={getRepairInputHint(details.analysis?.selectorRecords[repairIndex]?.method)} /></label>
     <button type="button" disabled={busy||!targetId||!details.analysis} onClick={()=>void suggestBulkRepairs()}>批量生成修复候选（最多 8 处）</button>
      <button type="button" disabled={busy||!bulkRepairResults||bulkRepairResults.items.filter(x=>x.candidates.length===1).length<2} onClick={()=>void proposeBatchRepair()}>生成批量修复预览（最多 8 处）</button>
     <button disabled={busy||!targetId||!pageProbe||pageProbe.probe.targetId!==targetId||pageProbe.probe.checks[repairIndex]?.status!=='missing'} onClick={()=>void suggestRepair()}>生成候选定位器（只读）</button>
     <button disabled={busy||!result||focused===null||!targetId||!pageProbe||pageProbe.probe.targetId!==targetId||pageProbe.probe.checks[repairIndex]?.status!=='missing'} onClick={()=>void prepareVerifiedPreview()}>自动准备唯一候选的受管修复预览</button>
     <button disabled={busy||!repairNew.trim()||!details.analysis?.selectorRecords[repairIndex]||details.analysis?.selectorRecords[repairIndex]?.runtimeRequired} onClick={()=>void proposeRepair()}>生成修复预览</button>
    </div>
    {batchRepairProposal&&<div className="notice">
     <b>批量修复预览 · {batchRepairProposal.changes.length} 处</b>
     <p>一次归档并激活受管修订；原脚本不会覆盖，需单独批准。仅静态 AST 替换，V2/V3/V4 尚未验证。</p>
     <div className="dim">基础 SHA-256：{batchRepairProposal.baseHash} · 预期修订 SHA-256：{batchRepairProposal.proposedHash}</div>
     {batchRepairProposal.changes.map((x,i)=><p key={i}>源码选择器 #{x.selectorIndex+1} · 第 {x.line} 行、第 {x.column} 列 · {x.method}：<code>{x.oldSelector}</code> → <code>{x.newSelector}</code></p>)}
     <pre>{batchRepairProposal.preview}</pre>
     <button type="button" disabled={busy||focused===null||batchRepairProposal.itemIndex!==focused||batchRepairProposal.scanId!==result?.scanId} onClick={stageCurrentMultiScriptRepair}>添加当前修复预览到多脚本队列</button>
     <button type="button" disabled={busy} onClick={()=>void applyBatchRepair()}>批准保存批量修复（受管副本）</button>
     <button type="button" disabled={busy||!targetId||!cdp} onClick={()=>void applyBatchRepairGuarded()}>批准保存并双次核验批量修复（V1）</button>
    </div>}
    {stagedMultiScriptJobs.length>0&&<div className="notice">
     <b>多脚本受管修复队列 · 已分别审核 {stagedMultiScriptJobs.length} 份脚本</b>
     <p>每份脚本的选择器预览须分别审核；统一批准前由 Main 再次核验每份授权、原脚本哈希和预览差异，不运行网页脚本，不覆盖原件。</p>
     {stagedMultiScriptJobs.map(row=><p key={row.proposalId}>脚本 #{row.itemIndex+1} · 预期修订 SHA-256：<code>{row.proposedHash}</code>
      <button type="button" className="secondary" disabled={busy} onClick={()=>setStagedMultiScriptJobs(prev=>prev.filter(x=>x.proposalId!==row.proposalId))}>移出队列</button></p>)}
     <button type="button" disabled={busy||stagedMultiScriptJobs.length<2} onClick={()=>void applyStagedMultiScriptBatch()}>统一批准执行多脚本修复</button>
     <small>V2/V3/V4 未验证。任一任务失败仍由独立受管检查点记录，取消的旧审批不能重放。</small>
    </div>}
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
    {repairAudit&&<div className="notice"><b>FR-041 审计链：</b>job → finding → candidate → test → approval → revision<p>Job：<code>{repairAudit.job.id}</code></p><p>Revision：<code>{repairAudit.revision.id}</code> · SHA-256 <code>{repairAudit.revision.revisionSha256}</code></p><p className="dim">这是 Main 从本机 append-only SQLite 只读回查的关联证据；不包含脚本源码、DOM、URL、凭据或异常正文。</p></div>}
    <section className="managed-history"><h3>受管修订历史与恢复</h3><p className="dim">只恢复软件自己管理的 current.user.js；原始脚本不会被覆盖，也不会直接修改 Tampermonkey 扩展内容。</p>
     <button className="secondary" type="button" disabled={busy} onClick={()=>void inspectManagedHealth()}>检查受管资料完整性</button>
     <button className="secondary" type="button" disabled={busy} onClick={()=>void showManagedHistory()}>查看受管历史</button>
     <button className="secondary" type="button" disabled={busy} onClick={()=>void showRollbackAuditHistory()}>查看回滚审计记录</button>
     {rollbackAuditEvents!==null&&<div className="notice"><b>FR-041 回滚操作审计（只读）</b>
      {rollbackAuditEvents.length===0?<p>此脚本暂无持久回滚操作记录。</p>:
       rollbackAuditEvents.map(event=><p key={event.id}><code>{event.id}</code> ·
        {event.outcome==='committed'?'已验证完成':event.outcome==='uncertain'?'结果不确定，需离线复核':'未完成，需要离线复核'} ·
        {event.previousHash?.slice(0,12)??'当前缺失'} → {event.targetHash.slice(0,12)} · {event.createdAt}
       </p>)}
      <p className="dim">只显示修订哈希、审计标识及操作状态；未完成或结果不确定不等于恢复成功。不存储源码、URL 或凭据。</p>
     </div>}
     {managedHealth&&<p className={managedHealth.status==='healthy'?'dim':'warn'}>完整性检查：{managedHealthDescription[managedHealth.status]} · 归档 {managedHealth.archiveCount} 份{managedHealth.activeHash?' · 已验证当前 SHA256 '+managedHealth.activeHash.slice(0,16)+'…':''}。这是只读检查；不会自动删除锁、覆盖修订或恢复文件。</p>}
     <button className="secondary" type="button" disabled={busy||(!managedActive&&!(managedRevisions?.length))} onClick={()=>void exportManaged()}>安全导出 .user.js</button>
     <p className="dim">导出仅复制已归档并校验的受管 current.user.js，必须另行导入 Tampermonkey；原始文件及现有文件均不会被覆盖。</p>
     {managedActive&&<p className="dim">当前受管副本：<code>{managedActive.activePath}</code> · SHA256 {managedActive.hash.slice(0,12)}…</p>}
     {managedRevisions!==null&&<div>{managedRevisions.length===0?<p>尚无保存的修订。</p>:managedRevisions.map(item=><div className="selector" key={item.fileName}><code>{item.kind==='original'?'原始备份':'修复修订'} · {item.hash.slice(0,16)}…</code><button type="button" className="secondary" disabled={busy} onClick={()=>void showManagedAudit(item.hash)}>查看审计链</button><button type="button" className="secondary" disabled={busy} onClick={()=>void rollbackManaged(item.hash)}>恢复此受管副本</button></div>)}</div>}
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
