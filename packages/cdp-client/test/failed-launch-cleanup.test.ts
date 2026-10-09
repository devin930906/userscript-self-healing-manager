import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {startVerifiedChromeChild} from '../src/index.ts';

class FakeChromeChild extends EventEmitter {
 pid=1097;exitCode:null|number=null;signalCode:null|string=null;
 kill(){this.exitCode=0;return true;}
}
const spawn=(child:FakeChromeChild)=>()=>{
 queueMicrotask(()=>child.emit('spawn'));
 return child as unknown as ChildProcess;
};

test('Chrome child is stopped when CDP handshake fails after a successful spawn',async()=>{
 const child=new FakeChromeChild();
 let terminated=0;
 await assert.rejects(startVerifiedChromeChild({
  spawnChrome:spawn(child),
  handshake:async()=>{throw new Error('CDP socket never appeared');},
  terminateChrome:async process=>{
   assert.equal(process,child);
   terminated++;
   child.kill();
  },
 }),/CDP socket never appeared/);
 assert.equal(terminated,1,'the newly spawned Chrome must not be orphaned');
});

test('Chrome remains running only after its CDP handshake succeeds',async()=>{
 const child=new FakeChromeChild();let stopped=false;
 const got=await startVerifiedChromeChild({
  spawnChrome:spawn(child),handshake:async()=>{},
  terminateChrome:async()=>{stopped=true;},
 });
 assert.equal(got,child);
 assert.equal(stopped,false);
});

test('delayed process error during handshake also cleans up the spawned child',async()=>{
 const child=new FakeChromeChild();let terminated=0;
 await assert.rejects(startVerifiedChromeChild({
  spawnChrome:spawn(child),
  handshake:async()=>{child.emit('error',new Error('Chrome process crashed'));throw new Error('handshake interrupted');},
  terminateChrome:async()=>{terminated++;},
 }),/handshake interrupted|Chrome process crashed/);
 assert.equal(terminated,1);
});

test('failed launch does not hide cleanup failure or report successful startup',async()=>{
 const child=new FakeChromeChild();
 await assert.rejects(startVerifiedChromeChild({
  spawnChrome:spawn(child),
  handshake:async()=>{throw new Error('CDP timeout');},
  terminateChrome:async()=>{throw new Error('Chrome cleanup failed');},
 }),e=>e instanceof AggregateError&&
   e.errors.some((x:unknown)=>x instanceof Error&&/CDP timeout/.test(x.message))&&
   e.errors.some((x:unknown)=>x instanceof Error&&/cleanup failed/.test(x.message)));
});

test('spawn error before a child exists cannot terminate an unrelated Chrome process',async()=>{
 const child=new FakeChromeChild();let cleanupCalls=0;
 await assert.rejects(startVerifiedChromeChild({
  spawnChrome:()=>{
   queueMicrotask(()=>child.emit('error',new Error('EXE blocked by Windows')));
   return child as unknown as ChildProcess;
  },
  handshake:async()=>{throw new Error('handshake must not run');},
  terminateChrome:async()=>{cleanupCalls++;},
 }),/EXE blocked by Windows/);
 assert.equal(cleanupCalls,0);
});


test('launchSelectedChrome rejects a linked executable before touching CDP',async(t)=>{
 if(process.platform==='win32'){
  t.skip('Windows symlink creation depends on runner privileges');
  return;
 }
 const {mkdtemp,writeFile,symlink,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');
 const {tmpdir}=await import('node:os');
 const {launchSelectedChrome}=await import('../src/index.ts');
 const root=await mkdtemp(join(tmpdir(),'usshm-chrome-linked-'));
 try{
  const executable=join(root,'real.exe'),linked=join(root,'linked.exe');
  await writeFile(executable,'fixture only');
  await symlink(executable,linked);
  await assert.rejects(launchSelectedChrome({executablePath:linked,port:9239}),/symlink|regular executable/i);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('direct Chrome launch refuses regular non-EXE before probing a debugger',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');
 const {tmpdir}=await import('node:os');
 const {launchSelectedChrome}=await import('../src/index.ts');
 const root=await mkdtemp(join(tmpdir(),'usshm-chrome-non-exe-'));
 try{
  const fake=join(root,'not-chrome.txt');
  await writeFile(fake,'fixture only');
  await assert.rejects(launchSelectedChrome({executablePath:fake,port:9239}),/EXE executable/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Chrome direct launch rejects a trivially short EXE before CDP work',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');
 const {tmpdir}=await import('node:os');
 const {launchSelectedChrome}=await import('../src/index.ts');
 const root=await mkdtemp(join(tmpdir(),'usshm-chrome-short-exe-'));
 try{
  const executable=join(root,'broken.exe');
  await writeFile(executable,'not a valid exe');
  await assert.rejects(launchSelectedChrome({executablePath:executable,port:9239}),/too small/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
