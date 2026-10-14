import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';

const fixtureUrl='http://127.0.0.1:43219/fixture';
const target={id:'synthetic-fixture',type:'page' as const,url:fixtureUrl,
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/synthetic-fixture'};
class ResetSocket extends EventEmitter{
 readonly calls:string[]=[];
 private readonly rejectReload:boolean;
 constructor(rejectReload=false){super();this.rejectReload=rejectReload;queueMicrotask(()=>this.emit('open'));}
 addEventListener(name:string,fn:(e:any)=>void){this.on(name,fn);}
 removeEventListener(name:string,fn:(e:any)=>void){this.off(name,fn);}
 send(value:string){const message=JSON.parse(value);this.calls.push(message.method);
  queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:message.id,
   ...(this.rejectReload?{error:{code:-32000,message:'test-only-error'}}:{result:{}})})}));}
 close(){this.emit('close');}
}
async function load(){
 const api=await import('../../scripts/local-fixture-reset.ts').catch(()=>({} as Record<string,unknown>));
 assert.equal(typeof (api as any).reloadOwnedSyntheticFixture,'function',
  'Fixture-only safe reload adapter not implemented');
 return (api as any).reloadOwnedSyntheticFixture as (v:any)=>Promise<void>;
}
test('RG-03 isolated cleanup sends ONLY a single Page.reload on the pinned app-owned fixture',async()=>{
 const reset=await load();let socket!:ResetSocket;
 await reset({approved:true,target,fixtureUrl,
  socketFactory:()=>{socket=new ResetSocket();return socket;}});
 assert.deepEqual(socket.calls,['Page.reload']);
});
test('RG-03 cleanup never opens CDP when page is not the canonical pinned local fixture',async()=>{
 const reset=await load();
 for(const values of [
  {approved:false,target,fixtureUrl},
  {approved:true,target:{...target,url:'https://account.example/settings'},fixtureUrl:'https://account.example/settings'},
  {approved:true,target,fixtureUrl:fixtureUrl+'#send'},
  {approved:true,target:{...target,webSocketDebuggerUrl:'ws://evil.example:9223/devtools/page/synthetic-fixture'},fixtureUrl},
 ]){
  let touched=false;
  await assert.rejects(reset({...values,socketFactory:()=>{touched=true;return new ResetSocket();}}),
   /approval|fixture|URL|CDP|local|identity|scope/i);
  assert.equal(touched,false);
 }
});
test('RG-03 CDP reload error fails cleanup, never logs or executes page script',async()=>{
 const reset=await load();let socket!:ResetSocket;
 await assert.rejects(reset({approved:true,target,fixtureUrl,
  socketFactory:()=>{socket=new ResetSocket(true);return socket;}}),
  /fixture|reload|CDP|cleanup/i);
 assert.deepEqual(socket.calls,['Page.reload']);
});
