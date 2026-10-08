import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {ScanBatchResult} from '../../../../packages/scan-service/src/index.ts';
import type {ScriptRecord} from '../../../../packages/persistence/src/index.ts';
import type {LocatorProbeResult} from '../../../../packages/cdp-client/src/locator-probe.ts';
import type {DomSummary} from '../../../../packages/cdp-client/src/snapshot.ts';

declare global {interface Window{ussm:{
 getAppInfo:()=>Promise<{version:string;distributionMode:string;dataRoot:string}>;
 probeLocators:(input:{itemIndex:number;targetId:string;approved:true})=>Promise<{summary:DomSummary;probe:LocatorProbeResult;totalLocators:number;checkedLocators:number}>;
 pickChrome:()=>Promise<string|null>;launchChrome:()=>Promise<{started:boolean;port:number}>;getCdpStatus:()=>Promise<{browser:string;protocolVersion:string|null;pages:{id:string;url:string}[]}>;
 pickFiles:()=>Promise<string[]>;pickDirectory:()=>Promise<string|null>;
 grantDroppedFiles:(files:File[])=>Promise<string[]>;
 scan:(request:{paths:string[];recursive:boolean})=>Promise<ScanBatchResult>;
 listScripts:()=>Promise<ScriptRecord[]>;
 exportReport:(format:'json'|'markdown')=>Promise<{canceled:boolean;path?:string}>;
}}}
const nameOf=(path:string)=>path.replace(/\\/g,'/').split('/').at(-1)||path;
function App(){
 const [appInfo,setAppInfo]=useState<{version:string;distributionMode:string;dataRoot:string}|null>(null);
 const [paths,setPaths]=useState<string[]>([]);const [result,setResult]=useState<ScanBatchResult|null>(null);
 const [history,setHistory]=useState<ScriptRecord[]>([]);const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');const [message,setMessage]=useState('');const [focused,setFocused]=useState<number|null>(null);
 const [search,setSearch]=useState('');const [dragging,setDragging]=useState(false);
 const [chromePath,setChromePath]=useState('');const [cdp,setCdp]=useState<{browser:string;protocolVersion:string|null;pages:{id:string;url:string}[]}|null>(null);
 const [targetId,setTargetId]=useState('');
 const [pageProbe,setPageProbe]=useState<{summary:DomSummary;probe:LocatorProbeResult;totalLocators:number;checkedLocators:number}|null>(null);
 useEffect(()=>{void Promise.all([window.ussm.getAppInfo(),window.ussm.listScripts()]).then(([info,list])=>{setAppInfo(info);setHistory(list);}).catch(e=>setError(String(e)));},[]);
 const filtered=useMemo(()=>result?.items.map((item,index)=>({...item,index})).filter(item=>item.path.toLowerCase().includes(search.toLowerCase()))??[],[result,search]);
 async function chooseFiles(){try{const selected=await window.ussm.pickFiles();setPaths(old=>[...new Set([...old,...selected])]);setError('');}catch(e){setError(String(e));}}
 async function chooseDirectory(){try{const selected=await window.ussm.pickDirectory();if(selected)setPaths(old=>[...new Set([...old,selected])]);setError('');}catch(e){setError(String(e));}}
 async function onDrop(event:React.DragEvent<HTMLDivElement>){event.preventDefault();setDragging(false);try{const files=Array.from(event.dataTransfer.files);const allowed=await window.ussm.grantDroppedFiles(files);setPaths(old=>[...new Set([...old,...allowed])]);setMessage(`已接收 ${allowed.length} 个脚本文件`);}catch(e){setError(String(e));}}
 async function scan(){if(!paths.length)return;setBusy(true);setError('');setMessage('');try{const report=await window.ussm.scan({paths,recursive:true});setResult(report);setFocused(null);setPageProbe(null);setHistory(await window.ussm.listScripts());setMessage(`已分析 ${report.processedCount} 项 · 不代表网页功能正常`);}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function exportReport(format:'json'|'markdown'){try{const saved=await window.ussm.exportReport(format);if(!saved.canceled)setMessage(`报告已保存：${saved.path}`);}catch(e){setError(String(e));}}
 async function pickChrome(){try{const p=await window.ussm.pickChrome();if(p)setChromePath(p);setError('');}catch(e){setError(String(e));}}
 async function startChrome(){try{await window.ussm.launchChrome();setMessage('已请求启动选定 Chrome；请点击检查 CDP 连接确认握手成功。');}catch(e){setError(String(e));}}
 async function checkCdp(){try{setCdp(await window.ussm.getCdpStatus());setPageProbe(null);setError('');}catch(e){setCdp(null);setError(`CDP 握手失败：${String(e)}。Chrome 136+ 对默认资料目录的调试开关有限制。`);}}
 async function probePage(){if(focused===null||!targetId)return;
  setBusy(true);setError('');setPageProbe(null);
  try{const r=await window.ussm.probeLocators({itemIndex:focused,targetId,approved:true});setPageProbe(r);setMessage('只读页面定位器核验完成；不代表油猴脚本功能通过。');}
  catch(e){setError('页面定位器核验失败：'+String(e));}finally{setBusy(false);}
 }
 const details=focused===null?null:result?.items[focused];
 return <div className="shell">
  <aside className="sidebar"><div className="logo"><span className="logo-icon">✦</span><span>USSHM <small>SELF-HEALING MANAGER</small></span></div>
   <nav><div className="nav-label">工作区</div><div className="nav-item active">▦　脚本资料库</div><div className="nav-item">⌁　页面定位器核验 <span>只读</span></div><div className="nav-item mute">⚙　修复工作台 <span>规划中</span></div><div className="nav-label">系统</div><div className="nav-item">◉　Chrome CDP <span>可连接</span></div></nav>
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
   <section className="panel"><div className="panel-head"><div><h2>Chrome CDP 浏览器连接</h2><p>仅连接本机 127.0.0.1:9223；可进行人工授权的只读 DOM 快照和定位器匹配，不执行用户脚本。</p></div><span className="pill">受控连接</span></div>
    <div className="actions" style={{justifyContent:'flex-start',flexWrap:'wrap'}}><button className="secondary" onClick={()=>void pickChrome()}>选择 Chrome</button><button className="secondary" disabled={!chromePath} onClick={()=>void startChrome()}>启动浏览器调试</button><button onClick={()=>void checkCdp()}>检查 CDP 连接</button></div>
    <p className="dim" style={{overflowWrap:'anywhere',marginTop:12}}>{chromePath||'尚未选择浏览器 EXE（可选择便携版 Chrome）'}</p>
    {cdp&&<div className="notice">检测到本机 CDP：{cdp.browser} · 当前可见 Page Targets：{cdp.pages.length} · Protocol {cdp.protocolVersion||'未知'} · 未验证是否为已选择的 Chrome</div>}
    {cdp&&cdp.pages.length>0&&<div className="toolbar"><label htmlFor="cdp-page">选择正在浏览的网页：</label><select id="cdp-page" aria-label="CDP 页面目标" value={targetId} onChange={e=>{setTargetId(e.target.value);setPageProbe(null);}}><option value="">— 请明确选择目标网页 —</option>{cdp.pages.map(p=><option key={p.id} value={p.id}>{p.url.slice(0,130)}</option>)}</select></div>}
   </section>
   {(error||message)&&<div role="status" className={'notice '+(error?'error':'')}>{error||message}</div>}
   <section className="panel"><div className="panel-head"><div><h2>静态诊断结果</h2><p>每个脚本独立显示解析状态与需要运行时确认的定位器。</p></div><div className="actions small"><button disabled={!result} className="secondary" onClick={()=>void exportReport('json')}>导出 JSON</button><button disabled={!result} className="secondary" onClick={()=>void exportReport('markdown')}>导出 Markdown</button></div></div>
   {result?<><input aria-label="筛选脚本" className="search" placeholder="搜索脚本名称或路径" value={search} onChange={e=>setSearch(e.target.value)}/><div className="table-wrapper"><table><thead><tr><th>文件</th><th>状态</th><th>Selectors</th><th>动态表达式</th><th></th></tr></thead><tbody>{filtered.map(item=><tr key={item.index}><td><b>{nameOf(item.path)}</b><small>{item.path}</small></td><td><span className={'tag '+(item.status==='parsed'?'ok':'bad')}>{item.status==='parsed'?'静态解析完成':item.status==='parse-error'?'语法错误':item.status==='unreadable'?'无法读取':'已跳过'}</span></td><td>{item.selectorCount}</td><td>{item.runtimeRequiredCount?`需要运行时确认 × ${item.runtimeRequiredCount}`:'—'}</td><td><button className="link" onClick={()=>{setFocused(item.index);setPageProbe(null);}}>详情 ›</button></td></tr>)}</tbody></table></div></>:<div className="empty"><span>⌕</span><b>尚未开始诊断</b><p>先添加脚本，然后开始静态扫描。</p></div>}
   </section>
   {details&&<section className="panel"><div className="panel-head"><div><h2>{nameOf(details.path)} · Selector 清单</h2><p>先选目标网页，再点击授权核验；不代表油猴脚本功能通过。</p></div><button className="secondary" onClick={()=>{setFocused(null);setPageProbe(null);}}>关闭</button></div>
   <div className="toolbar"><button disabled={!cdp||!targetId||busy} onClick={()=>void probePage()}>页面定位器核验（只读）</button><span className="dim">每次最多检查前 50 个定位器；不执行脚本、不自动修改文件。</span></div>
   {pageProbe&&<div className="notice"><b>DOM 文档节点：</b>{pageProbe.summary.nodeCount} · 文档：{pageProbe.summary.documentCount} · 已检查 {pageProbe.checkedLocators}/{pageProbe.totalLocators} 个定位器；仅当前 document 作用域，不代表油猴脚本功能通过。</div>}
   {pageProbe?.probe.checks.map((check,index)=><div className="selector" key={index}><div className="selector-top"><span>{check.method}</span><b>{check.status==='found'?'当前匹配':check.status==='missing'?'无匹配':check.status==='ambiguous'?'多重匹配':check.status==='blocked'?'无法核验':'需要运行时确认'}</b></div><code>{check.expression}</code><small>匹配数：{check.matchCount===null?'未知':check.matchCount} · {check.reason}</small></div>)}
   {details.analysis?.selectorRecords.map((s,i)=><div className="selector" key={i}><div className="selector-top"><span>{s.method} · 源码第 {s.sourceRange.start.line} 行</span><span className={s.runtimeRequired?'warn':''}>{s.runtimeRequired?'需要运行时确认':'静态字面量'}</span></div><code>{s.expression}</code><small>函数：{s.functionName||'顶层'} {s.alternateSelectors.length?`｜备用选择器：${s.alternateSelectors.join('、')}`:''}</small></div>)}
   {details.diagnostics.map((d,i)=><p className="error-text" key={i}>{d}</p>)}
   {!details.selectorCount&&<div className="dim">未找到内置规则覆盖的 DOM 选择器；不代表该脚本没有 DOM 依赖。</div>}
   </section>}
   <footer>DreamMovie Studio · 本地优先 · 静态诊断 + 人工授权的 DOM 只读核验　　<span title={appInfo?.dataRoot}>数据位置：{appInfo?.dataRoot??'检测中'}</span></footer>
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
