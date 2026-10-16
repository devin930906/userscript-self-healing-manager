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
 readonly opts:{disabled?:boolean;submit?:boolean;ambiguous?:boolean;focusMissing?:boolean;changed?:boolean;lateSubmit?:boolean;lateDisabled?:boolean;mutateDisabledOnPreFocus?:boolean;initiallyFocused?:boolean;htmlHidden?:boolean;cssHidden?:boolean;cssTransparent?:boolean;zeroBox?:boolean};
 focused=false;
 constructor(opts:{disabled?:boolean;submit?:boolean;ambiguous?:boolean;focusMissing?:boolean;changed?:boolean;lateSubmit?:boolean;lateDisabled?:boolean;mutateDisabledOnPreFocus?:boolean;initiallyFocused?:boolean;htmlHidden?:boolean;cssHidden?:boolean;cssTransparent?:boolean;zeroBox?:boolean}={}){
  super();this.opts=opts;this.focused=opts.initiallyFocused===true;setImmediate(()=>this.emit('open'));
 }
 addEventListener(name:string,fn:(e:any)=>void){this.on(name,fn);}
 removeEventListener(name:string,fn:(e:any)=>void){this.off(name,fn);}
 send(raw:string){
  const msg=JSON.parse(raw);this.methods.push(msg.method);this.inputs.push(msg.params);
  if(msg.method==='DOM.querySelectorAll'&&msg.params?.selector===':focus'&&
     this.opts.mutateDisabledOnPreFocus&&!this.focused)this.opts.lateDisabled=true;
  const ids=msg.params?.selector===':focus'?
   (this.opts.focusMissing?[]:this.focused?[42]:[]):(this.opts.ambiguous?[42,43]:[42]);
  const result=msg.method==='DOM.getDocument'?{root:{nodeId:1}}:
   msg.method==='DOM.querySelectorAll'?{nodeIds:this.opts.changed&&this.methods.filter(x=>x==='DOM.querySelectorAll').length===2?[57]:ids}:
   msg.method==='DOM.describeNode'?{node:{nodeName:'BUTTON',nodeId:42}}:
   msg.method==='DOM.getAttributes'?{attributes:['id','safe-focus','type',this.opts.submit||this.opts.lateSubmit&&this.methods.filter(x=>x==='DOM.getAttributes').length>1?'submit':'button',...(this.opts.disabled||this.opts.lateDisabled&&this.methods.filter(x=>x==='DOM.getAttributes').length>1?['disabled','']:[]),...(this.opts.htmlHidden?['hidden','']:[])]}:
   msg.method==='CSS.getComputedStyleForNode'?{computedStyle:[
    {name:'display',value:'inline-block'},
    {name:'visibility',value:this.opts.cssHidden?'hidden':'visible'},
    {name:'opacity',value:this.opts.cssTransparent?'0':'1'},
    {name:'content-visibility',value:'visible'},
   ]}:
   msg.method==='DOM.getBoxModel'?{model:{width:this.opts.zeroBox?0:96,height:24}}:
   msg.method==='DOM.focus'?{}:{};
  if(msg.method==='DOM.focus')this.focused=true;
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:msg.id,result})}));
 }
 close(){this.emit('close');}
}
const run=async(socket:FocusSocket,confirm=async()=>frame,approved=true)=>runApprovedControlFocus({approvedDocument:frame,
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
  'DOM.getDocument','CSS.enable','DOM.querySelectorAll','DOM.describeNode','DOM.getAttributes',
  'CSS.getComputedStyleForNode','DOM.getBoxModel',
  'DOM.querySelectorAll','CSS.getComputedStyleForNode','DOM.getBoxModel',
  'DOM.querySelectorAll','DOM.getAttributes','DOM.focus','DOM.querySelectorAll',
 ]);
 assert.equal(socket.inputs[7].selector,'#safe-focus');
 assert.equal(socket.inputs[10].selector,':focus');
 assert.equal(socket.inputs[11].nodeId,42);
 assert.equal(socket.inputs[12].nodeId,42);
 assert.equal(socket.inputs[13].selector,':focus');
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
 await assert.rejects(runApprovedControlFocus({approvedDocument:frame,
 approved:true,target:{...target,url:'https://bank.invalid/pay'},
  locator,confirm:async()=>frame,socketFactory:()=>s}),/identity|page|target|URL/i);
 await assert.rejects(runApprovedControlFocus({approvedDocument:frame,
 approved:true,target:{...target,webSocketDebuggerUrl:'ws://evil.invalid/devtools/page/approvedFocusFixture'},
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
 await assert.rejects(runApprovedControlFocus({approvedDocument:frame,
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

test('FR-024 revoked scan during CDP preparation cannot dispatch an observable focus',async()=>{
 const socket=new FocusSocket();
 let checks=0;
 await assert.rejects(runApprovedControlFocus({approvedDocument:frame,
 approved:true,target,locator,confirm:async()=>frame,timeoutMs:2000,
  socketFactory:()=>socket,
  assertAuthorizedBeforeAction:()=>{
   checks++;
   throw new Error('Trusted scan authorization revoked before DOM.focus');
  },
 }),/revoked/i);
 assert.equal(checks,1,'the privileged authorization was actually checked at the action boundary');
 assert.equal(socket.methods.includes('DOM.focus'),false,
  'revocation must be checked before the potentially observable browser action');
});

test('FR-024 production Main connects final focus authorization to current scan and source root',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const start=main.indexOf("ipcMain.handle('usshm:approved-control-focus'");
 const end=main.indexOf("ipcMain.handle('usshm:product-action-review'",start);
 assert.ok(start>=0&&end>start);
 const body=main.slice(start,end);
 const callback=body.indexOf('assertAuthorizedBeforeAction:');
 const action=body.indexOf('runApprovedControlFocus(');
 assert.ok(action>=0&&callback>action,
  'only trusted Main may provide the just-in-time focus authorization');
 const guard=body.slice(callback);
 assert.match(guard,/scanSessions\.assertCurrent\(scanSnapshot\)/);
 assert.match(guard,/withinAuthorized\(item\.path\)/);
});

test('FR-024 unrendered or invisible approved controls never dispatch DOM.focus or gain V2 credit',async()=>{
 for(const [label,opts] of [
  ['HTML hidden',{htmlHidden:true}],
  ['computed visibility hidden',{cssHidden:true}],
  ['fully transparent',{cssTransparent:true}],
  ['zero-size layout',{zeroBox:true}],
 ] as const){
  const socket=new FocusSocket(opts);
  await assert.rejects(run(socket),/focus|hidden|visible|visibility|layout|opacity|render|control/i,
   label+' must fail closed before any observable focus side effect');
  assert.equal(socket.methods.includes('DOM.focus'),false,label+' must never be focused');
 }
});

test('FR-024 actual Chrome isolation smoke must exercise a hidden target denial, not mock-only evidence',async()=>{
 const smoke=await readFile('scripts/smoke-chrome.mjs','utf8');
 assert.match(smoke,/PASS real Chrome FR-024 hidden.*blocked/i,
  'the product flow must also refuse a genuinely hidden browser node');
});

test('FR-024 mutation during final page identity recheck cannot dispatch DOM.focus',async()=>{
 const options:{lateDisabled?:boolean}={};
 const socket=new FocusSocket(options);
 let confirms=0;
 await assert.rejects(runApprovedControlFocus({approvedDocument:frame,
 approved:true,target,locator,timeoutMs:2000,
  confirm:async()=>{
   confirms++;
   if(confirms===2)options.lateDisabled=true;
   return frame;
  },
  socketFactory:()=>socket,
 }),/button|disabled|changed|unsafe|focus/i,
 'page mutation while the final identity guard yields must be revalidated before action');
 assert.ok(confirms>=2,'fault injection must occur during the final pre-action identity guard');
 assert.equal(socket.methods.includes('DOM.focus'),false,
  'never dispatch the observable focus after a control changes during identity recheck');
});

test('FR-024 mutation during pre-action focus evidence cannot dispatch DOM.focus',async()=>{
 const socket=new FocusSocket({mutateDisabledOnPreFocus:true});
 await assert.rejects(run(socket),/button|disabled|changed|unsafe|focus/i,
  'a control that becomes disabled while collecting pre-action focus evidence must be revalidated');
 assert.ok(socket.methods.includes('DOM.querySelectorAll'),
  'fault injection must occur during the final pre-action focus evidence query');
 assert.equal(socket.methods.includes('DOM.focus'),false,
  'never dispatch the observable focus after a control changes during pre-action evidence');
});

test('FR-024 initial page identity verification consumes the consent time budget',async()=>{
 const socket=new FocusSocket();
 let created=0,checks=0;
 await assert.rejects(runApprovedControlFocus({approvedDocument:frame,
 approved:true,target,locator,timeoutMs:100,
  confirm:async()=>{
   checks++;
   await new Promise(resolve=>setTimeout(resolve,200));
   return frame;
  },
  socketFactory:()=>{created++;return socket;},
 }),/timed out|expired|deadline|timeout/i);
 assert.equal(checks,1,'the original document identity was verified once');
 assert.equal(created,0,'an expired approval must not even open a CDP action socket');
 assert.deepEqual(socket.methods,[],'no CDP command may be sent after slow initial identity');
});

test('FR-024 a non-settling initial identity check must time out without opening a focus socket',async()=>{
 const socket=new FocusSocket();
 let sockets=0;
 let fallback:ReturnType<typeof setTimeout>|undefined;
 try{
  const observed=await Promise.race([
   runApprovedControlFocus({approvedDocument:frame,
 approved:true,target,locator,timeoutMs:100,
    confirm:async()=>new Promise<never>(()=>{}),
    socketFactory:()=>{sockets++;return socket;},
   }).then(()=> 'unexpected-success',(error:unknown)=>
    error instanceof Error?error.message:'unexpected-error'),
   new Promise<string>(resolve=>{
    fallback=setTimeout(()=>resolve('identity-never-settled'),350);
   }),
  ]);
  assert.equal(observed,'Approved focus timed out',
   'the approval must expire even if the first CDP identity confirmation never settles');
  assert.equal(sockets,0);
  assert.deepEqual(socket.methods,[]);
 }finally{
  if(fallback!==undefined)clearTimeout(fallback);
 }
});

test('FR-024 a stalled pre-action identity recheck expires without dispatching focus',async()=>{
 const socket=new FocusSocket();
 let confirmations=0;
 let watchdog:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=await Promise.race([
   runApprovedControlFocus({approvedDocument:frame,
 approved:true,target,locator,timeoutMs:100,
    confirm:async()=>{
     confirmations++;
     if(confirmations===1)return frame;
     return new Promise<never>(()=>{});
    },
    socketFactory:()=>socket,
   }).then(()=> 'unexpected-success',(error:unknown)=>
    error instanceof Error?error.message:'unexpected-error'),
   new Promise<string>(resolve=>{
    watchdog=setTimeout(()=>resolve('pre-action-identity-never-settled'),350);
   }),
  ]);
  assert.equal(result,'Approved focus timed out');
  assert.ok(confirmations>=2,'initial identity passes; stalled pre-action check is actually reached');
  assert.ok(socket.methods.includes('DOM.getDocument'),'the CDP verification path was exercised');
  assert.equal(socket.methods.includes('DOM.focus'),false,
   'an indefinitely pending frame recheck must never authorize an action');
 }finally{
  if(watchdog!==undefined)clearTimeout(watchdog);
 }
});

test('FR-024 rejects any CDP error envelope even when its error value is falsy',async()=>{
 for(const method of ['DOM.getDocument','DOM.focus'] as const){
  for(const errorField of [null,false,0,''] as const){
   class MalformedEnvelopeSocket extends FocusSocket{
    override send(raw:string){
     const message=JSON.parse(raw);
     if(message.method!==method)return super.send(raw);
     this.methods.push(message.method);
     this.inputs.push(message.params);
     const result=method==='DOM.getDocument'?{root:{nodeId:1}}:{};
     queueMicrotask(()=>this.emit('message',{data:JSON.stringify({
      id:message.id,result,error:errorField,
     })}));
    }
   }
   const socket=new MalformedEnvelopeSocket();
   await assert.rejects(()=>run(socket),/CDP focus command did not return a valid result/,
    'a forged '+method+' result with an error property must not be accepted');
   if(method==='DOM.getDocument')
    assert.equal(socket.methods.includes('DOM.focus'),false,
     'reject a malformed preflight before dispatching the observable action');
  }
 }
});

test('FR-024 a same-URL document changed after native consent cannot establish a fresh focus baseline',async()=>{
 const nativeApproved={...frame,loaderId:'native-approved-before-reload'};
 const socket=new FocusSocket();
 const args={
  approved:true,target,locator,approvedDocument:nativeApproved,
  confirm:async()=>frame,socketFactory:()=>socket,timeoutMs:2000,
 } as Parameters<typeof runApprovedControlFocus>[0];
 await assert.rejects(runApprovedControlFocus(args),/document|identity|navigation|reload|changed/i,
  'the first post-consent identity must be compared against the native approved document');
 assert.equal(socket.methods.includes('DOM.focus'),false,
  'a same-URL reload may not inherit prior native consent');
});

test('FR-024 trusted Main must pass the post-dialog approved document to focus execution',async()=>{
 const main=await readFile(new URL('../../../apps/desktop/src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:approved-control-focus'");
 const end=main.indexOf("ipcMain.handle('usshm:product-action-review'",start);
 assert.ok(start>=0&&end>start);
 const section=main.slice(start,end);
 assert.match(section,/assertStablePageDocument\(beforePrompt,afterPrompt\)/);
 assert.match(section,/approvedDocument:afterPrompt/,
  'native-approved identity must not be replaced by the first post-modal CDP response');
});
