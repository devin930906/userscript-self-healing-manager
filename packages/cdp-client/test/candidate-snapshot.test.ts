import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {captureCandidateNodes} from '../src/candidate-snapshot.ts';
class FakeSocket extends EventEmitter {
 readonly sent:Array<{id:number;method:string;params:any}>=[];
 private readonly payload:unknown;
 constructor(payload:unknown){super();this.payload=payload;queueMicrotask(()=>this.emit('open'));}
 addEventListener(name:string,cb:(event:any)=>void){this.on(name,cb);}
 removeEventListener(name:string,cb:(event:any)=>void){this.off(name,cb);}
 send(raw:string){const req=JSON.parse(raw);this.sent.push(req);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:req.id,result:this.payload})}));}
 close(){this.emit('close');}
}
const target={id:'p1',type:'page',url:'https://example.org',webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/p1'};
const snapshot={strings:['DIV','BUTTON','id','submit-v2','data-testid','submit-button','aria-label','Alice Example','INPUT','value','secretPass','data-qa','search-box'],documents:[{nodes:{nodeName:[0,1,8],attributes:[[],[2,3,4,5,6,7],[9,10,11,12]]}},{nodes:{nodeName:[1],attributes:[[2,3]]}}]};
test('DOM snapshot yields only approved stable attributes from top document',async()=>{
 const socket=new FakeSocket(snapshot);const result=await captureCandidateNodes(target,{socketFactory:()=>socket});
 assert.equal(result.scope,'top-document');assert.equal(result.nodeCount,3);
 assert.deepEqual(result.nodes,[{tagName:'BUTTON',attributes:{id:'submit-v2','data-testid':'submit-button'}},{tagName:'INPUT',attributes:{'data-qa':'search-box'}}]);
 assert.equal(JSON.stringify(result).includes('Alice'),false);
 assert.equal(JSON.stringify(result).includes('secretPass'),false);
 assert.deepEqual(socket.sent.map(s=>s.method),['DOMSnapshot.captureSnapshot']);
 assert.ok(!socket.sent[0]?.params.includeDOMRects);
});
test('target socket must use loopback and match page identity',async()=>{
 await assert.rejects(captureCandidateNodes({...target,webSocketDebuggerUrl:'ws://evil.example/devtools/page/p1'}),/loopback/i);
 await assert.rejects(captureCandidateNodes({...target,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/other'}),/target/i);
});
test('invalid snapshot and oversized documents must not produce guessed candidates',async()=>{
 await assert.rejects(captureCandidateNodes(target,{socketFactory:()=>new FakeSocket({strings:[],documents:[]})}),/snapshot/i);
 const huge={strings:['BUTTON'],documents:[{nodes:{nodeName:Array.from({length:5001},()=>0),attributes:Array.from({length:5001},()=>[])}}]};
 await assert.rejects(captureCandidateNodes(target,{socketFactory:()=>new FakeSocket(huge)}),/limit/i);
});

test('candidate snapshot blocks cross-port local CDP target redirect',async()=>{
 await assert.rejects(captureCandidateNodes({...target,webSocketDebuggerUrl:'ws://localhost:9224/devtools/page/p1'}),/port/i);
});
