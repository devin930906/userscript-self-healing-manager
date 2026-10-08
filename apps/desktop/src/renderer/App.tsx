import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {ScanBatchResult} from '../../../../packages/scan-service/src/index.ts';
import type {ScriptRecord} from '../../../../packages/persistence/src/index.ts';

declare global {interface Window{ussm:{
 getAppInfo:()=>Promise<{version:string;distributionMode:string;dataRoot:string}>;
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
 useEffect(()=>{void Promise.all([window.ussm.getAppInfo(),window.ussm.listScripts()]).then(([info,list])=>{setAppInfo(info);setHistory(list);}).catch(e=>setError(String(e)));},[]);
 const filtered=useMemo(()=>result?.items.map((item,index)=>({...item,index})).filter(item=>item.path.toLowerCase().includes(search.toLowerCase()))??[],[result,search]);
 async function chooseFiles(){try{const selected=await window.ussm.pickFiles();setPaths(old=>[...new Set([...old,...selected])]);setError('');}catch(e){setError(String(e));}}
 async function chooseDirectory(){try{const selected=await window.ussm.pickDirectory();if(selected)setPaths(old=>[...new Set([...old,selected])]);setError('');}catch(e){setError(String(e));}}
 async function onDrop(event:React.DragEvent<HTMLDivElement>){event.preventDefault();setDragging(false);try{const files=Array.from(event.dataTransfer.files);const allowed=await window.ussm.grantDroppedFiles(files);setPaths(old=>[...new Set([...old,...allowed])]);setMessage(`已接收 ${allowed.length} 个脚本文件`);}catch(e){setError(String(e));}}
 async function scan(){if(!paths.length)return;setBusy(true);setError('');setMessage('');try{const report=await window.ussm.scan({paths,recursive:true});setResult(report);setFocused(null);setHistory(await window.ussm.listScripts());setMessage(`已分析 ${report.processedCount} 项 · 不代表网页功能正常`);}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function exportReport(format:'json'|'markdown'){try{const saved=await window.ussm.exportReport(format);if(!saved.canceled)setMessage(`报告已保存：${saved.path}`);}catch(e){setError(String(e));}}
 async function pickChrome(){try{const p=await window.ussm.pickChrome();if(p)setChromePath(p);setError('');}catch(e){setError(String(e));}}
 async function startChrome(){try{await window.ussm.launchChrome();setMessage('已请求启动选定 Chrome；请点击检查 CDP 连接确认握手成功。');}catch(e){setError(String(e));}}
 async function checkCdp(){try{setCdp(await window.ussm.getCdpStatus());setError('');}catch(e){setCdp(null);setError(`CDP 握手失败：${String(e)}。Chrome 136+ 对默认资料目录的调试开关有限制。`);}}
 const details=focused===null?null:result?.items[focused];
 return <div className="shell">
  <aside className="sidebar"><div className="logo"><span className="logo-icon">✦</span><span>USSHM <small>SELF-HEALING MANAGER</small></span></div>
   <nav><div className="nav-label">工作区</div><div className="nav-item active">▦　脚本资料库</div><div className="nav-item mute">⌁　DOM 动态检测 <span>规划中</span></div><div className="nav-item mute">⚙　修复工作台 <span>规划中</span></div><div className="nav-label">系统</div><div className="nav-item mute">◉　Chrome CDP <span>规划中</span></div></nav>
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
   <section className="panel"><div className="panel-head"><div><h2>Chrome CDP 浏览器连接</h2><p>仅连接本机 127.0.0.1:9223，不自动更改浏览器资料目录；此阶段仅验证握手。</p></div><span className="pill">受控连接</span></div>
    <div className="actions" style={{justifyContent:'flex-start',flexWrap:'wrap'}}><button className="secondary" onClick={()=>void pickChrome()}>选择 Chrome</button><button className="secondary" disabled={!chromePath} onClick={()=>void startChrome()}>启动浏览器调试</button><button onClick={()=>void checkCdp()}>检查 CDP 连接</button></div>
    <p className="dim" style={{overflowWrap:'anywhere',marginTop:12}}>{chromePath||'尚未选择浏览器 EXE（可选择便携版 Chrome）'}</p>
    {cdp&&<div className="notice">检测到本机 CDP：{cdp.browser} · 当前可见 Page Targets：{cdp.pages.length} · Protocol {cdp.protocolVersion||'未知'} · 未验证是否为已选择的 Chrome</div>}
   </section>
   {(error||message)&&<div role="status" className={'notice '+(error?'error':'')}>{error||message}</div>}
   <section className="panel"><div className="panel-head"><div><h2>静态诊断结果</h2><p>每个脚本独立显示解析状态与需要运行时确认的定位器。</p></div><div className="actions small"><button disabled={!result} className="secondary" onClick={()=>void exportReport('json')}>导出 JSON</button><button disabled={!result} className="secondary" onClick={()=>void exportReport('markdown')}>导出 Markdown</button></div></div>
   {result?<><input aria-label="筛选脚本" className="search" placeholder="搜索脚本名称或路径" value={search} onChange={e=>setSearch(e.target.value)}/><div className="table-wrapper"><table><thead><tr><th>文件</th><th>状态</th><th>Selectors</th><th>动态表达式</th><th></th></tr></thead><tbody>{filtered.map(item=><tr key={item.index}><td><b>{nameOf(item.path)}</b><small>{item.path}</small></td><td><span className={'tag '+(item.status==='parsed'?'ok':'bad')}>{item.status==='parsed'?'静态解析完成':item.status==='parse-error'?'语法错误':item.status==='unreadable'?'无法读取':'已跳过'}</span></td><td>{item.selectorCount}</td><td>{item.runtimeRequiredCount?`需要运行时确认 × ${item.runtimeRequiredCount}`:'—'}</td><td><button className="link" onClick={()=>setFocused(item.index)}>详情 ›</button></td></tr>)}</tbody></table></div></>:<div className="empty"><span>⌕</span><b>尚未开始诊断</b><p>先添加脚本，然后开始静态扫描。</p></div>}
   </section>
   {details&&<section className="panel"><div className="panel-head"><div><h2>{nameOf(details.path)} · Selector 清单</h2><p>静态 AST 证据；尚未连接真实浏览器页面。</p></div><button className="secondary" onClick={()=>setFocused(null)}>关闭</button></div>
   {details.analysis?.selectorRecords.map((s,i)=><div className="selector" key={i}><div className="selector-top"><span>{s.method} · 源码第 {s.sourceRange.start.line} 行</span><span className={s.runtimeRequired?'warn':''}>{s.runtimeRequired?'需要运行时确认':'静态字面量'}</span></div><code>{s.expression}</code><small>函数：{s.functionName||'顶层'} {s.alternateSelectors.length?`｜备用选择器：${s.alternateSelectors.join('、')}`:''}</small></div>)}
   {details.diagnostics.map((d,i)=><p className="error-text" key={i}>{d}</p>)}
   {!details.selectorCount&&<div className="dim">未找到内置规则覆盖的 DOM 选择器；不代表该脚本没有 DOM 依赖。</div>}
   </section>}
   <footer>DreamMovie Studio · 本地优先 · 当前版本仅支持静态诊断　　<span title={appInfo?.dataRoot}>数据位置：{appInfo?.dataRoot??'检测中'}</span></footer>
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
