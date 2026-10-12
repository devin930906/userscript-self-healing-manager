import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reserveManagedScriptWrites} from '../src/main/managed-script-lease.ts';

async function fixture(body:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(process.env.RUNNER_TEMP??tmpdir(),'usshm-fr030-process-'));
 try{await body(root);}finally{await rm(root,{recursive:true,force:true});}
}
const worker=fileURLToPath(new URL('./managed-write-lock-worker.mjs',import.meta.url));

async function childAttempt(root:string,script:string){
 const child=spawn(process.execPath,['--experimental-strip-types',worker],{
  env:{...process.env,USSHM_LEASE_ROOT:root,USSHM_LEASE_SCRIPT:script},
  stdio:['pipe','pipe','pipe'],windowsHide:true,
 });
 let status='';
 const first=await new Promise<string>((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Bounded worker lease response timed out')),15000);
  let output='';
  child.stdout.on('data',(chunk:Buffer)=>{
   output+=String(chunk);
   if(output.includes('\n')){
    clearTimeout(timeout);
    resolve(output.split('\n',1)[0]!);
   }
  });
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{if(!output.includes('\n')){clearTimeout(timeout);reject(new Error('Worker exited before lease result: '+code));}});
 });
 status=first;
 const close=async()=>{
  if(status==='ACQUIRED'){
   child.stdin.write('release\n');
  }else child.stdin.end();
  const code=await new Promise<number|null>((resolve,reject)=>{
   if(child.exitCode!==null){resolve(child.exitCode);return;}
   const timeout=setTimeout(()=>{child.kill();reject(new Error('Bounded worker lease cleanup timed out'));},15000);
   child.once('exit',code=>{clearTimeout(timeout);resolve(code);});
  });
  assert.equal(code,0,'synthetic worker must release cleanly');
 };
 const terminate=async()=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Abnormal worker exit timed out')),15000);
   child.once('exit',()=>{clearTimeout(timeout);resolve();});
  });
  child.kill();
  await exited;
 };
 return {status,close,terminate};
}

test('FR-030 a different real Node process cannot acquire the same managed source lease',async()=>fixture(async root=>{
 const holding=await childAttempt(root,'managed-a');
 try{
  assert.equal(holding.status,'ACQUIRED','first process must hold actual lease');
  let unexpectedRelease:(()=>void)|undefined;
  let refusal:unknown;
  try{unexpectedRelease=reserveManagedScriptWrites(root,['managed-a']);}
  catch(error){refusal=error;}
  finally{unexpectedRelease?.();}
  assert.equal(unexpectedRelease,undefined,'second process must never gain concurrent lease');
  assert.match(String(refusal),/concurrent|already active|locked/i);
 }finally{await holding.close();}
 const release=reserveManagedScriptWrites(root,['managed-a']);
 release();
}));

test('FR-030 existing parent Main lease denies child process and releases on success',async()=>fixture(async root=>{
 const release=reserveManagedScriptWrites(root,['managed-b']);
 try{
  const contender=await childAttempt(root,'managed-b');
  try{assert.equal(contender.status,'DENIED','separate process must observe global ownership');}
  finally{await contender.close();}
 }finally{release();}
 const fresh=await childAttempt(root,'managed-b');
 try{assert.equal(fresh.status,'ACQUIRED','new review after process exit can get lease');}
 finally{await fresh.close();}
}));

test('FR-030 independent managed scripts keep independent OS-level leases',async()=>fixture(async root=>{
 const release=reserveManagedScriptWrites(root,['managed-a']);
 try{
  const other=await childAttempt(root,'managed-b');
  try{assert.equal(other.status,'ACQUIRED','different script must not be blocked by an unrelated lease');}
  finally{await other.close();}
 }finally{release();}
}));

test('FR-030 kernel-backed SQLite lock is released after abnormal child process termination',async()=>fixture(async root=>{
 const holder=await childAttempt(root,'managed-crash');
 try{
  assert.equal(holder.status,'ACQUIRED');
  assert.throws(()=>reserveManagedScriptWrites(root,['managed-crash']),
   /concurrent|unsafe|already active|fresh review/i);
  // No graceful release IPC. OS must free SQLite locks when child exits.
  await holder.terminate();
  const release=reserveManagedScriptWrites(root,['managed-crash']);
  release();
 }finally{await holder.terminate();}
}));
