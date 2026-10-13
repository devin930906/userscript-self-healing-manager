import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {assertUnlinkedRecoveryDirectory} from '../src/recovery-directory.ts';

async function temp<T>(f:(root:string)=>Promise<T>):Promise<T>{
 const root=await mkdtemp(join(tmpdir(),'usshm-recovery-lexical-'));
 try{return await f(root);}finally{await rm(root,{recursive:true,force:true});}
}
test('RG-06 central recovery preflight rejects linked ancestor erased by lexical parent traversal',async t=>
 temp(async root=>{
  const external=join(root,'external'),child=join(external,'nested');
  const lexical=join(root,'approved'),outside=join(external,'approved');
  await mkdir(child,{recursive:true});
  await mkdir(lexical);
  await mkdir(outside);
  await writeFile(join(outside,'sentinel.txt'),'outside is untouched');
  const alias=join(root,'linked');
  try{await symlink(child,alias,process.platform==='win32'?'junction':'dir');}
  catch(e){
   if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((e as NodeJS.ErrnoException).code??'')){
    t.skip('Directory links unavailable on runner');return;
   }
   throw e;
  }
  // Deliberately preserve '..': resolve() erases this linked component
  // although the filesystem resolves the alias before stepping back.
  const disguised=alias+sep+'..'+sep+'approved';
  await assert.rejects(assertUnlinkedRecoveryDirectory(disguised),
   /unsafe|traversal|symlink|junction|ancestor/i);
  assert.equal(await readFile(join(outside,'sentinel.txt'),'utf8'),'outside is untouched');
 }));
test('RG-06 central recovery preflight refuses lexical parent traversal even without a link',async()=>
 temp(async root=>{
  const approved=join(root,'approved');
  await mkdir(approved);
  const disguised=approved+sep+'..'+sep+'approved';
  await assert.rejects(assertUnlinkedRecoveryDirectory(disguised),
   /unsafe|parent traversal|traversal/i);
 }));
test('RG-06 central recovery preflight accepts existing ordinary nested directory',async()=>
 temp(async root=>{
  const ordinary=join(root,'ordinary','nested');
  await mkdir(ordinary,{recursive:true});
  await assert.doesNotReject(assertUnlinkedRecoveryDirectory(ordinary));
 }));
