import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diagnoseScriptsOnPage} from '../src/batch-dom.ts';

const page={
 type:'page',id:'controlled-tab',url:'https://fixture.example.test/page',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/controlled-tab',
};
const script=[{
 path:'test.user.js',scriptId:'test',status:'parsed',
 analysis:{
  metadata:{match:['https://fixture.example.test/*'],include:[],raw:{}},
  selectorRecords:[{method:'querySelector',expression:'#target',receiver:'document',runtimeRequired:false}],
 },
}] as any;

async function inspect(check:Record<string,unknown>,recheck=false){
 let probes=0;
 return diagnoseScriptsOnPage({
  items:script,target:page,consent:true,
  deps:{
   confirm:async()=>({targetId:page.id,confirmedUrl:page.url,frameId:'main',loaderId:'fixed'}),
   ...(recheck?{waitBeforeMissingRecheck:async()=>{}}:{}),
   probe:async()=>({
    targetId:page.id,url:page.url,validationLevel:'dom-only' as const,
    checks:[{
     method:'querySelector',expression:'#target',
     ...(recheck&&++probes===1?
      {status:'missing',matchCount:0}:check),
    }],
   }) as any,
   summarize:async()=>({targetId:page.id,url:page.url,authorShadowTreeNodes:0}),
  },
 });
}

test('inconsistent CDP found statuses cannot grant V1 pass',async()=>{
 const invalid=[
  {status:'found',matchCount:0},
  {status:'found',matchCount:2},
  {status:'found',matchCount:10001},
  {status:'found',matchCount:null},
  {status:'found',matchCount:1.5},
  {status:'found',matchCount:'1'},
  {status:'found',matchCount:-1},
  {status:'invented',matchCount:1},
 ];
 for(const check of invalid){
  const result=await inspect(check);
  assert.equal(result.items[0]?.status,'needs-review',JSON.stringify(check));
  assert.equal(result.items[0]?.verification?.V1,'blocked',JSON.stringify(check));
  assert.equal(result.items[0]?.missing,0,JSON.stringify(check));
  assert.equal(result.items[0]?.found,0,JSON.stringify(check));
 }
});

test('contradictory missing and ambiguous evidence cannot be recorded as a definite missing locator',async()=>{
 for(const check of [
  {status:'missing',matchCount:2},
  {status:'missing',matchCount:null},
  {status:'ambiguous',matchCount:1},
  {status:'ambiguous',matchCount:0},
 ]){
  const result=await inspect(check);
  assert.equal(result.items[0]?.status,'needs-review',JSON.stringify(check));
  assert.equal(result.items[0]?.verification?.V1,'blocked',JSON.stringify(check));
  assert.equal(result.items[0]?.missing,0,JSON.stringify(check));
 }
});

test('second recheck cannot promote an impossible match count into V1',async()=>{
 const result=await inspect({status:'found',matchCount:2},true);
 assert.equal(result.items[0]?.status,'needs-review');
 assert.equal(result.items[0]?.verification?.V1,'blocked');
 assert.equal(result.items[0]?.found,0);
});

test('internally consistent found, missing, and ambiguous observations retain their existing semantics',async()=>{
 const found=await inspect({status:'found',matchCount:1});
 assert.equal(found.items[0]?.status,'dom-present');
 assert.equal(found.items[0]?.verification?.V1,'passed');
 const missing=await inspect({status:'missing',matchCount:0});
 assert.equal(missing.items[0]?.status,'locator-missing');
 assert.equal(missing.items[0]?.verification?.V1,'failed');
 const ambiguous=await inspect({status:'ambiguous',matchCount:2});
 assert.equal(ambiguous.items[0]?.status,'needs-review');
 assert.equal(ambiguous.items[0]?.verification?.V1,'blocked');
});
