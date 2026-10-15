/**
 * Test-only QA-048 iframe injection using Chrome's DOM protocol instead of
 * running frame navigation during a pending Runtime.evaluate.
 *
 * DOM.setOuterHTML is a document mutation in the disposable Electron renderer
 * only. It cannot confer IPC capability. The caller MUST still prove the
 * loaded frame marker, CDP isolated child context and absent native bridges.
 */
export async function attachSyntheticSecurityIframeViaCdp(options:{
 expectedUrl:string;
 call:(method:string,params?:Record<string,unknown>)=>Promise<Record<string,unknown>>;
 assertAlive:()=>void;
}):Promise<void>{
 const fail=(reason:'document'|'host'):never=>{
  throw new Error(reason==='document'
   ?'QA-048 trusted renderer document changed before synthetic iframe attachment'
   :'QA-048 synthetic fixture host is unavailable');
 };
 if(!options||typeof options.call!=='function'||typeof options.assertAlive!=='function'||
    typeof options.expectedUrl!=='string'||!options.expectedUrl.startsWith('file://'))
  fail('document');
 options.assertAlive();
 const response=await options.call('DOM.getDocument',{depth:0});
 options.assertAlive();
 const root=response?.root as {nodeId?:unknown;documentURL?:unknown}|undefined;
 if(root?.documentURL!==options.expectedUrl||
    !Number.isSafeInteger(root?.nodeId)||Number(root?.nodeId)<1)
  fail('document');
 const host=await options.call('DOM.querySelector',{
  nodeId:root.nodeId as number,selector:'#usshm-security-probe-host',
 });
 options.assertAlive();
 if(!Number.isSafeInteger(host?.nodeId)||Number(host.nodeId)<1)fail('host');
 // Only a literal, synthetic marker. No external script, user DOM or URL.
 // srcdoc is entity-encoded so the parser gives the child its own document.
 const outerHTML='<iframe id="usshm-security-probe" '+
  'srcdoc="&lt;!doctype html&gt;&lt;html&gt;&lt;body&gt;'+
  '&lt;span id=&quot;proof&quot;&gt;FRAME_MARKER_44&lt;/span&gt;'+
  '&lt;/body&gt;&lt;/html&gt;"></iframe>';
 await options.call('DOM.setOuterHTML',{nodeId:host.nodeId,outerHTML});
 options.assertAlive();
}
