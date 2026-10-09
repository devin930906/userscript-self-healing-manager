import assert from 'node:assert/strict';import {test} from 'node:test';
import {createHash} from 'node:crypto';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {proposeLiteralPatch,applyManagedPatch} from '../src/index.ts';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

test('generates a source-targeted patch without executing or mutating input',()=>{
 const src='function x(){ return document.querySelector("#old") }';const bytes=new TextEncoder().encode(src);
 const draft=proposeLiteralPatch({sourceBytes:bytes,oldSelector:'#old',newSelector:'[data-testid="send"]'});
 assert.equal(draft.baseHash,sha(bytes));assert.match(draft.proposedSource,/querySelector\("\[data-testid=\\"send\\"\]"\)/);
 assert.equal(new TextDecoder().decode(bytes),src);
});
test('refuses dynamic or ambiguous replacements',()=>{
 const encoder=new TextEncoder();
 assert.throws(()=>proposeLiteralPatch({sourceBytes:encoder.encode('document.querySelector(`#${x}`);'),oldSelector:'#old',newSelector:'.new'}),/exactly one/);
 assert.throws(()=>proposeLiteralPatch({sourceBytes:encoder.encode('document.querySelector("#old");document.querySelector("#old");'),oldSelector:'#old',newSelector:'.new'}),/exactly one/);
});
test('managed apply preserves original file, creates backup and enforces hash conflict',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-patch-'));
 try {const original=join(root,'source.user.js');const managed=join(root,'Data');const bytes=new TextEncoder().encode('document.querySelector("#old")');await writeFile(original,bytes);
 const draft=proposeLiteralPatch({sourceBytes:bytes,oldSelector:'#old',newSelector:'.new'});
 await assert.rejects(applyManagedPatch({sourcePath:original,managedRoot:managed,scriptId:'test-script',draft,expectedHash:'fake-hash',approved:true}),/hash mismatch/);
 await assert.rejects(applyManagedPatch({sourcePath:original,managedRoot:managed,scriptId:'test-script',draft,expectedHash:draft.baseHash,approved:false}),/approval/);
 const receipt=await applyManagedPatch({sourcePath:original,managedRoot:managed,scriptId:'test-script',draft,expectedHash:draft.baseHash,approved:true});
 assert.equal(await readFile(original,'utf8'),'document.querySelector("#old")');assert.equal(sha(await readFile(receipt.backupPath)),draft.baseHash);assert.match(await readFile(receipt.managedPath,'utf8'),/\.new/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('managed patch rejects symlink redirection to another directory',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-patch-link-'));
 try {const external=join(root,'external');const managed=join(root,'Data');const source=join(root,'source.user.js');
 const {mkdir,symlink}=await import('node:fs/promises');await mkdir(external);await mkdir(managed);await writeFile(source,'document.querySelector("#old")');
 const {readFile}=await import('node:fs/promises');const bytes=await readFile(source);
 const draft=proposeLiteralPatch({sourceBytes:bytes,oldSelector:'#old',newSelector:'.new'});
 try{await symlink(external,join(managed,'managed'));}catch(e){if(['EPERM','EACCES'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('Cannot create symlink');return;}throw e;}
 await assert.rejects(applyManagedPatch({sourcePath:source,managedRoot:managed,scriptId:'demo',draft,expectedHash:draft.baseHash,approved:true}),/symlink/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('same selector in multiple calls can patch only the explicitly selected AST location',()=>{
 const src='document.querySelector("#old");\ndocument.querySelector("#old");';
 const bytes=new TextEncoder().encode(src);
 const selected={method:'querySelector',line:2,column:1};
 const draft=proposeLiteralPatch({sourceBytes:bytes,oldSelector:'#old',newSelector:'#new',selectorLocation:selected});
 assert.equal(draft.proposedSource,'document.querySelector("#old");\ndocument.querySelector("#new");');
 assert.throws(()=>proposeLiteralPatch({sourceBytes:bytes,oldSelector:'#old',newSelector:'#new',selectorLocation:{method:'getElementById',line:2,column:1}}),/exactly one|location/i);
});

test('patch refuses non-UTF-8 source bytes instead of silently replacing invalid characters',()=>{
 const a=new TextEncoder().encode('document.querySelector("#old");');
 const input=new Uint8Array([...a,0xff]);
 assert.throws(()=>proposeLiteralPatch({sourceBytes:input,oldSelector:'#old',newSelector:'#new'}),/UTF-8/i);
});
test('no-substitution template literal is precisely patchable without running script code',()=>{
 const source='document.querySelector(`#old`);\nconst untouched=`keep`;\n';
 const d=proposeLiteralPatch({sourceBytes:new TextEncoder().encode(source),oldSelector:'#old',newSelector:'#new'});
 assert.equal(d.proposedSource,'document.querySelector("#new");\nconst untouched=`keep`;\n');
});

test('managed patch supports literal getElementsByName and getElementsByClassName AST calls',()=>{
 for(const method of ['getElementsByName','getElementsByClassName']){
  const source='document.'+method+'("old-item");\n';
  const bytes=new TextEncoder().encode(source);
  const draft=proposeLiteralPatch({
   sourceBytes:bytes,oldSelector:'old-item',newSelector:'new-item',
   selectorLocation:{method,line:1,column:1},
  });
  assert.equal(draft.proposedSource,'document.'+method+'("new-item");\n');
  assert.equal(draft.baseHash,sha(bytes));
 }
});

test('patch generator refuses a pre-existing JavaScript parse error instead of offering a misleading preview',()=>{
 const malformed='const broken = ;\ndocument.querySelector("#old");\n';
 const original=new TextEncoder().encode(malformed);
 assert.throws(()=>proposeLiteralPatch({sourceBytes:original,oldSelector:'#old',newSelector:'#new'}),
  /syntax|parse|invalid|malformed/i);
 assert.equal(new TextDecoder().decode(original),malformed);
});
test('valid userscript headers and modern JavaScript syntax remain patchable',()=>{
 const source='// ==UserScript==\n// @name Smoke\n// ==/UserScript==\n'+
  'const send=()=>document.querySelector("#old");\n';
 const original=new TextEncoder().encode(source);
 const draft=proposeLiteralPatch({sourceBytes:original,oldSelector:'#old',newSelector:'#new'});
 assert.match(draft.proposedSource,/document\.querySelector\("#new"\)/);
 assert.match(draft.proposedSource,/\/\/ @name Smoke/);
 assert.equal(new TextDecoder().decode(original),source);
});

test('approved managed patch rejects a forged hash-consistent draft that injects code outside the chosen selector',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-forged-draft-'));
 try{
  const sourcePath=join(root,'input.user.js'),managedRoot=join(root,'Data');
  const original=Buffer.from('// ==UserScript==\n// @name Example\n// ==/UserScript==\ndocument.querySelector("#old");\n');
  await writeFile(sourcePath,original);
  const good=proposeLiteralPatch({sourceBytes:original,oldSelector:'#old',newSelector:'#new'});
  for(const forgedSource of [
   good.proposedSource+'\nwindow.__injected = true;\n',
   good.proposedSource.replace('// @name Example','// @name Impersonated'),
   good.proposedSource.replace('document.querySelector("#new")','window.location.assign("https://attacker.invalid"); document.querySelector("#new")'),
  ]){
   const forged={...good,proposedSource:forgedSource,proposedHash:sha(Buffer.from(forgedSource))};
   await assert.rejects(applyManagedPatch({sourcePath,managedRoot,scriptId:'forged',draft:forged,
    expectedHash:good.baseHash,approved:true}),/draft|minimal|selector|mismatch|tamper|patch/i);
  }
  assert.deepEqual(await readFile(sourcePath),original);
  await assert.rejects(readFile(join(managedRoot,'managed','forged','current.user.js')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('approved managed patch rejects a forged sourceRange even if the new source and SHA are valid',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-forged-location-'));
 try{
  const sourcePath=join(root,'input.user.js'),managedRoot=join(root,'Data');
  const original=Buffer.from('document.querySelector("#old");');
  await writeFile(sourcePath,original);
  const good=proposeLiteralPatch({sourceBytes:original,oldSelector:'#old',newSelector:'#new'});
  for(const sourceRange of [{start:good.sourceRange.start+1,end:good.sourceRange.end},
    {start:-1,end:good.sourceRange.end},{start:0,end:10_000}]){
   await assert.rejects(applyManagedPatch({sourcePath,managedRoot,scriptId:'location',
    draft:{...good,sourceRange},expectedHash:good.baseHash,approved:true}),
    /draft|range|selector|mismatch|location|patch/i);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('approved managed patch still supports an explicitly selected duplicate AST call with UTF-8 BOM',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-exact-bom-'));
 try{
  const sourcePath=join(root,'original.user.js'),managedRoot=join(root,'Data');
  const original=Buffer.from('\ufeffdocument.querySelector("#old");\ndocument.querySelector("#old");\n');
  await writeFile(sourcePath,original);
  const draft=proposeLiteralPatch({sourceBytes:original,oldSelector:'#old',newSelector:'#new',
   selectorLocation:{method:'querySelector',line:2,column:1}});
  const receipt=await applyManagedPatch({sourcePath,managedRoot,scriptId:'exact-bom',draft,
   expectedHash:draft.baseHash,approved:true});
  assert.deepEqual(await readFile(sourcePath),original);
  assert.equal((await readFile(receipt.managedPath,'utf8')),
   '\ufeffdocument.querySelector("#old");\ndocument.querySelector("#new");\n');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('managed patch rejects runtime-forged base revision kind before any backup path escapes managed root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-unsafe-revision-kind-'));
 try{
  const sourcePath=join(root,'input.user.js'),managedRoot=join(root,'Data');
  const bytes=Buffer.from('document.querySelector("#old");');
  await writeFile(sourcePath,bytes);
  const draft=proposeLiteralPatch({sourceBytes:bytes,oldSelector:'#old',newSelector:'#new'});
  for(const badKind of ['../../../escaped','..\\..\\escaped','original/../../escaped','','ORIGINAL']){
   await assert.rejects(applyManagedPatch({
    sourcePath,managedRoot,scriptId:'guarded',draft,expectedHash:draft.baseHash,approved:true,
    baseRevisionKind:badKind as 'original',
   }),/revision|kind|invalid|unsafe/i,badKind);
  }
  assert.deepEqual(await readFile(sourcePath),bytes);
  await assert.rejects(readFile(join(root,'escaped-'+draft.baseHash+'.user.js')),{code:'ENOENT'});
  await assert.rejects(readFile(join(managedRoot,'managed','guarded','current.user.js')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
