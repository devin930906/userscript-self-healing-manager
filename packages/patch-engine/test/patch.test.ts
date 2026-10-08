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
