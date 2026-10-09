import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {inspectReadOnlyElementVisibility,qualifyTopDocumentVisibility} from '../src/read-only-visibility.ts';
class FakeSocket extends EventEmitter{
 sent:Array<{id:number;method:string;params:any}>=[];
 private readonly steps:Record<string,(params:any)=>any>;
 constructor(steps:Record<string,(params:any)=>any>){super();this.steps=steps;queueMicrotask(()=>this.emit('open'));}
 addEventListener(name:string,cb:(data:any)=>void){this.on(name,cb);}
 removeEventListener(name:string,cb:(data:any)=>void){this.off(name,cb);}
 send(payload:string){
  const m=JSON.parse(payload);this.sent.push(m);
  queueMicrotask(()=>{let output:any;try{output={id:m.id,result:this.steps[m.method]?.(m.params)??{}};}
   catch(e){output={id:m.id,error:{message:String(e)}};}this.emit('message',{data:JSON.stringify(output)});});
 }
 close(){this.emit('close');}
}
const target={type:'page',id:'a',url:'https://example.org/page',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/a'};
const locator={method:'querySelector',expression:'#action',runtimeRequired:false};
const styles=(display='block',visibility='visible',opacity='1',pointer='auto')=>({computedStyle:[
 {name:'display',value:display},{name:'visibility',value:visibility},{name:'opacity',value:opacity},{name:'pointer-events',value:pointer},
]});
function socket(style=styles(),size={width:110,height:33},nodeIds=[32]){
 return new FakeSocket({
  'DOM.getDocument':()=>({root:{nodeId:7}}),
  'DOM.querySelectorAll':()=>({nodeIds}),
  'CSS.enable':()=>({}),
  'CSS.getComputedStyleForNode':()=>style,
  'DOM.getBoxModel':()=>({model:size}),
 });
}
test('CDP read-only visibility samples only safe DOM/CSS methods and never upgrades V2/V3/V4',async()=>{
 const s=socket();
 const out=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>s});
 assert.equal(out.status,'potentially-visible');
 assert.equal(out.matchCount,1);
 assert.equal(out.pointerBlocked,false);
 assert.equal(out.V2,'blocked');
 assert.equal(out.V3,'not-configured');
 assert.equal(out.V4,'not-configured');
 assert.equal(JSON.stringify(out).includes('#action'),false);
 assert.deepEqual(s.sent.map(x=>x.method),['DOM.getDocument','DOM.querySelectorAll','CSS.enable','CSS.getComputedStyleForNode','DOM.getBoxModel']);
 assert.ok(s.sent.every(x=>!/^Runtime\.|^Input\.|^DOM\.set|^Page\./.test(x.method)));
});
test('hidden style or zero box yields hidden, not successful interactive validation',async()=>{
 // Construct each socket only when a listener is ready: an already-open
 // test socket cannot be expected to emit a second open event.
 for(const create of [()=>socket(styles('none')),()=>socket(styles('block','hidden')),
  ()=>socket(styles('block','visible','0')),()=>socket(styles(),{width:0,height:33})]){
  const s=create();
  const out=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>s});
  assert.equal(out.status,'hidden');
  assert.equal(out.V2,'blocked');
 }
});
test('pointer-events none is not mistaken for proven clickability',async()=>{
 const out=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>socket(styles('block','visible','1','none'))});
 assert.equal(out.status,'potentially-visible');
 assert.equal(out.pointerBlocked,true);
 assert.equal(out.interactionVerified,false);
});
test('missing or multiple targets do not inspect computed styles and cannot claim visibility',async()=>{
 for(const [nodes,expected] of [[[],'missing'],[[10,11],'ambiguous']] as const){
  const s=socket(styles(),{width:22,height:22},[...nodes]);
  const out=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>s});
  assert.equal(out.status,expected);
  assert.deepEqual(s.sent.map(x=>x.method),['DOM.getDocument','DOM.querySelectorAll']);
 }
});
test('missing styles or unreadable layout fail closed as unknown',async()=>{
 const noStyle=socket({computedStyle:[]});
 assert.equal((await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>noStyle})).status,'unknown');
 const failedBox=new FakeSocket({
  'DOM.getDocument':()=>({root:{nodeId:7}}),'DOM.querySelectorAll':()=>({nodeIds:[32]}),
  'CSS.enable':()=>({}),'CSS.getComputedStyleForNode':()=>styles(),
  'DOM.getBoxModel':()=>{throw new Error('layout unavailable');},
 });
 assert.equal((await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>failedBox})).status,'unknown');
});
test('no arbitrary JS, dynamic locators, external endpoints, invalid CSS or selector mutations',async()=>{
 await assert.rejects(inspectReadOnlyElementVisibility(target,{...locator,runtimeRequired:true}),/static|literal/i);
 await assert.rejects(inspectReadOnlyElementVisibility(target,{...locator,expression:''}),/static|selector|literal/i);
 await assert.rejects(inspectReadOnlyElementVisibility({...target,webSocketDebuggerUrl:'ws://evil.example/devtools/page/a'},locator),/loopback/i);
 const s=new FakeSocket({'DOM.getDocument':()=>({root:{nodeId:7}}),'DOM.querySelectorAll':()=>{throw new Error('invalid CSS');}});
 const out=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>s});
 assert.equal(out.status,'unknown');
});
test('static getElementById is converted to a safe CSS selector, not executed JS',async()=>{
 const s=socket();
 const out=await inspectReadOnlyElementVisibility(target,{method:'getElementById',expression:'9 action',runtimeRequired:false},{socketFactory:()=>s});
 assert.equal(out.status,'potentially-visible');
 assert.equal(s.sent[1]?.params.selector,'#\\39 \\ action');
});

test('top-document misses are inconclusive around iframes and author Shadow DOM',()=>{
 const missing={targetId:'a',url:'https://example.org/page',validationLevel:'css-box-read-only' as const,
  status:'missing' as const,matchCount:0,pointerBlocked:null,interactionVerified:false as const,
  V2:'blocked' as const,V3:'not-configured' as const,V4:'not-configured' as const};
 assert.equal(qualifyTopDocumentVisibility(missing,0,0).status,'missing');
 for(const [frames,roots] of [[1,0],[0,1],[2,5],[0,null],[0,-1],[-1,0]] as const){
  const qualified=qualifyTopDocumentVisibility(missing,frames,roots);
  assert.equal(qualified.status,'unknown');
  assert.equal(qualified.matchCount,null);
  assert.equal(qualified.V2,'blocked');
  assert.equal(qualified.V4,'not-configured');
 }
 assert.deepEqual(missing.matchCount,0,'The raw top-document observation stays unmodified');
});
test('context uncertainty does not hide an observed element or fabricate interactivity',()=>{
 const observed={targetId:'a',url:'https://example.org/page',validationLevel:'css-box-read-only' as const,
  status:'potentially-visible' as const,matchCount:1,pointerBlocked:true,interactionVerified:false as const,
  V2:'blocked' as const,V3:'not-configured' as const,V4:'not-configured' as const};
 assert.deepEqual(qualifyTopDocumentVisibility(observed,2,null),observed);
});

test('read-only CDP identifies a visible native disabled control without claiming it is interactive',async()=>{
 const s=new FakeSocket({
  'DOM.getDocument':()=>({root:{nodeId:7}}),
  'DOM.querySelectorAll':()=>({nodeIds:[32]}),
  'DOM.getAttributes':()=>({attributes:['id','action','disabled','','data-secret','never-return-this']}),
  'CSS.enable':()=>({}),
  'CSS.getComputedStyleForNode':()=>styles(),
  'DOM.getBoxModel':()=>({model:{width:110,height:33}}),
 });
 const out=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>s});
 assert.equal(out.status,'potentially-visible');
 assert.equal(out.controlBlocker,'disabled-attribute');
 assert.equal(out.interactionVerified,false);
 assert.equal(out.V2,'blocked');
 assert.equal(JSON.stringify(out).includes('never-return-this'),false);
 assert.deepEqual(s.sent.map(x=>x.method),['DOM.getDocument','DOM.querySelectorAll','DOM.getAttributes',
  'CSS.enable','CSS.getComputedStyleForNode','DOM.getBoxModel']);
});
test('aria-disabled and readonly attributes are separately reported as non-clickability evidence',async()=>{
 for(const [attrs,blocker] of [
  [['aria-disabled','true'],'aria-disabled'],
  [['readonly',''],'readonly-attribute'],
  [['aria-disabled','false'],'none-detected'],
  [['disabled','','aria-disabled','false'],'disabled-attribute'],
 ] as const){
  const s=new FakeSocket({
   'DOM.getDocument':()=>({root:{nodeId:7}}),
   'DOM.querySelectorAll':()=>({nodeIds:[32]}),
   'DOM.getAttributes':()=>({attributes:[...attrs]}),
   'CSS.enable':()=>({}),
   'CSS.getComputedStyleForNode':()=>styles(),
   'DOM.getBoxModel':()=>({model:{width:110,height:33}}),
  });
  const got=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>s});
  assert.equal(got.controlBlocker,blocker);
  assert.equal(got.V2,'blocked');
 }
});
test('failed or malformed DOM attributes never imply that a visible target is enabled',async()=>{
 for(const attrs of [null,['disabled'],['aria-disabled','not-a-boolean'],Array(300).fill('a')]){
  const s=new FakeSocket({
   'DOM.getDocument':()=>({root:{nodeId:7}}),
   'DOM.querySelectorAll':()=>({nodeIds:[32]}),
   'DOM.getAttributes':()=>attrs===null?{attributes:null}:{attributes:attrs},
   'CSS.enable':()=>({}),
   'CSS.getComputedStyleForNode':()=>styles(),
   'DOM.getBoxModel':()=>({model:{width:110,height:33}}),
  });
  const got=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>s});
  assert.equal(got.controlBlocker,'unknown');
  assert.equal(got.V2,'blocked');
 }
});
test('zero or multiple matches do not read attributes of arbitrary elements',async()=>{
 for(const nodes of [[],[11,12]]){
  const s=socket(styles(),{width:60,height:20},nodes);
  const got=await inspectReadOnlyElementVisibility(target,locator,{socketFactory:()=>s});
  assert.equal(got.controlBlocker,'unknown');
  assert.ok(!s.sent.some(x=>x.method==='DOM.getAttributes'));
 }
});
