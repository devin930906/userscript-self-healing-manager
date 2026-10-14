import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {runApprovedControlFocus} from '../src/approved-focus.ts';

const url='http://127.0.0.1:50125/fixture',target={
 id:'approvedFocusFixture',type:'page',url,
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/approvedFocusFixture',
};
const frame={targetId:target.id,confirmedUrl:url,frameId:'mainframe',loaderId:'mainloader'};
const locator={method:'querySelector',expression:'#safe-focus',runtimeRequired:false};
class FocusSocket extends EventEmitter{
 readonly methods:string[]=[];readonly inputs:any[]=[];
 readonly opts:{disabled?:boolean;submit?:boolean;ambiguous?:boolean;focusMissing?:boolean;changed?:boolean;lateSubmit?:boolean;lateDisabled?:boolean};
 focused=false;
 constructor(opts:{disabled?:boolean;submit?:boolean;ambiguous?:boolean;focusMissing?:boolean;changed?:boolean;lateSubmit?:boolean;lateDisabled?:boolean}={}){
  super();this.opts=opts;this.focused=opts.initiallyFocused===true;setImmediate(()=>this.emit('open'));
 }
 addEventListener(name:string,fn:(e:any)=>void){this.on(name,fn);}
 removeEventListener(name:string,fn:(e:any)=>void){this.off(name,fn);}
 send(raw:string){
  const msg=JSON.parse(raw);this.methods.push(msg.method);this.inputs.push(msg.params);
  const ids=msg.params?.selector===':focus'?
   (this.opts.focusMissing?[]:this.focused?[42]:[]):(this.opts.ambiguous?[42,43]:[42]);
  const result=msg.method==='DOM.getDocument'?{root:{nodeId:1}}:
   msg.method==='DOM.querySelectorAll'?{nodeIds:this.opts.changed&&this.methods.filter(x=>x==='DOM.querySelectorAll').length===2?[57]:ids}:
   msg.method==='DOM.describeNode'?{node:{nodeName:'BUTTON',nodeId:42}}:
   msg.method==='DOM.getAttributes'?{attributes:['id','safe-focus','type',this.opts.submit||this.opts.lateSubmit&&this.methods.filter(x=>x==='DOM.getAttributes').length>1?'submit':'button',...(this.opts.disabled||this.opts.lateDisabled&&this.methods.filter(x=>x==='DOM.getAttributes').length>1?['disabled','']:[])]}:
   msg.method==='DOM.focus'?{}:{};
  if(msg.method==='DOM.focus')this.focused=true;
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:msg.id,result})}));
 }
 close(){this.emit('close');}
}
const run=async(socket:FocusSocket,confirm=async()=>frame,approved=true)=>runApprovedControlFocus({
 approved,target,locator,
 confirm,socketFactory:()=>socket,timeoutMs:2000,
});
test('FR-024 actual approved focus uses only DOM CDP and proves the same button became :focus',async()=>{
 const socket=new FocusSocket();
 const result=await run(socket);
 assert.equal(result.status,'focus-observed');
 assert.equal(result.V2,'focus-observed-only');
 assert.equal(result.interactionVerified,true);
 assert.equal(result.functionalVerified,false);
 assert.equal(result.V3,'not-configured');
 assert.equal(result.V4,'not-configured');
 assert.equal(result.managerVerified,false);
 assert.deepEqual(socket.methods,[
  'DOM.getDocument','DOM.querySelectorAll','DOM.describeNode','DOM.getAttributes',
  'DOM.querySelectorAll','DOM.getAttributes','DOM.querySelectorAll','DOM.focus','DOM.querySelectorAll',
 ]);
 assert.equal(socket.inputs[4].selector,'#safe-focus');
 assert.equal(socket.inputs[6].selector,':focus');
 assert.equal(socket.inputs[7].nodeId,42);
 assert.equal(socket.inputs[8].selector,':focus');
 assert.equal(socket.methods.some(x=>x.startsWith('Runtime.')||x.startsWith('Input.')),false);
});
test('FR-024 missing actual focus is inconclusive and never a false V2 result',async()=>{
 const s=new FocusSocket({focusMissing:true});
 const result=await run(s);
 assert.equal(result.status,'needs-review');
 assert.equal(result.V2,'blocked');
 assert.equal(result.interactionVerified,false);
});
test('FR-024 disables submit, blocked, ambiguous, or swapped controls before any DOM.focus',async()=>{
 for(const options of [{submit:true},{disabled:true},{ambiguous:true},{changed:true}]){
  const s=new FocusSocket(options);
  await assert.rejects(run(s),/button|blocked|ambiguous|changed|unique|focus|control/i);
  assert.equal(s.methods.includes('DOM.focus'),false);
 }
});
test('FR-024 refuses unauthenticated request, untrusted page sockets and navigation before action',async()=>{
 const s=new FocusSocket();
 await assert.rejects(run(s,async()=>frame,false),/approval/i);
 assert.deepEqual(s.methods,[]);
 await assert.rejects(runApprovedControlFocus({approved:true,target:{...target,url:'https://bank.invalid/pay'},
  locator,confirm:async()=>frame,socketFactory:()=>s}),/identity|page|target|URL/i);
 await assert.rejects(runApprovedControlFocus({approved:true,target:{...target,webSocketDebuggerUrl:'ws://evil.invalid/devtools/page/approvedFocusFixture'},
  locator,confirm:async()=>frame,socketFactory:()=>s}),/CDP|loopback|socket/i);
 let calls=0;const moved=new FocusSocket();
 await assert.rejects(run(moved,async()=>++calls===1?frame:{...frame,loaderId:'navigated'}),/document|identity|navigation|changed/i);
 assert.equal(moved.methods.includes('DOM.focus'),false);
});
test('FR-024 approved focus must be available from authorized Main, limited Preload and visibly consented UI',async()=>{
 const [main,preload,ui]=await Promise.all([
  readFile('apps/desktop/src/main/index.ts','utf8'),
  readFile('apps/desktop/src/preload/index.ts','utf8'),
  readFile('apps/desktop/src/renderer/App.tsx','utf8'),
 ]);
 assert.match(main,/ipcMain\.handle\('usshm:approved-control-focus'/);
 assert.match(main,/scanSessions\.require/);
 assert.match(main,/checkUserscriptPageScope/);
 assert.match(main,/runApprovedControlFocus/);
 assert.match(preload,/ipcRenderer\.invoke\('usshm:approved-control-focus'/);
 assert.match(ui,/确认聚焦此网页控件/);
 assert.match(ui,/可能触发网页的 focus 事件/);
 assert.match(ui,/focus-observed-only/);
});

test('FR-024 expired consent budget during slow document recheck can never dispatch DOM.focus',async()=>{
 const socket=new FocusSocket();
 let calls=0;
 await assert.rejects(runApprovedControlFocus({
  approved:true,target,locator,timeoutMs:100,
  confirm:async()=>{
   calls++;
   if(calls===2)await new Promise(resolve=>setTimeout(resolve,180));
   return frame;
  },
  socketFactory:()=>socket,
 }),/timed out|expired|deadline|timeout/i);
 assert.ok(calls>=2,'fault injection must delay the final pre-action identity check');
 assert.equal(socket.methods.includes('DOM.focus'),false,'no action after authorization deadline');
});

test('FR-024 only native Main-owned OS confirmation may authorize a production focus action',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const start=main.indexOf("ipcMain.handle('usshm:approved-control-focus'");
 const end=main.indexOf("ipcMain.handle('usshm:product-action-review'",start);
 assert.ok(start>=0&&end>start);
 const body=main.slice(start,end);
 assert.match(body,/dialog\.showMessageBox\(mainWindow/);
 assert.match(body,/decision\.response!==1/);
 assert.ok(body.indexOf('decision.response!==1')<body.indexOf('runApprovedControlFocus('),
  'a forged renderer-approved boolean cannot bypass native user permission');
 assert.match(body,/assertStablePageDocument\(beforePrompt,afterPrompt\)/);
 assert.match(body,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.match(body,/focusActionBusy/,
  'native focus dialogs must not allow concurrent duplicate execution');
 assert.ok(body.indexOf('focusActionBusy=true')>=0&&body.indexOf('focusActionBusy=true')<body.indexOf('await getVerifiedChromeStatus'),
  'Main must acquire the one-action lock before any asynchronous target lookup');
});

test('FR-024 fail closed if an ordinary button becomes submit or disabled before the approved DOM.focus',async()=>{
 for(const option of [{lateSubmit:true},{lateDisabled:true}]){
  const socket=new FocusSocket(option);
  await assert.rejects(run(socket),/button|disabled|changed|unsafe|focus/i);
  assert.ok(socket.methods.filter(x=>x==='DOM.getAttributes').length>=2,
   'control safety must be revalidated at the final focus boundary');
  assert.equal(socket.methods.includes('DOM.focus'),false,
   'never dispatch focus after dynamic mutation to unsafe control');
 }
});

test('FR-024 a button already focused before authorization cannot earn a new V2 focus transition',async()=>{
 const socket=new FocusSocket({initiallyFocused:true});
 await assert.rejects(run(socket),/already focused|no focus transition|pre-action focus/i);
 assert.equal(socket.methods.includes('DOM.focus'),false,
  'do not send an observable focus command when there is no possible before/after transition');
});
