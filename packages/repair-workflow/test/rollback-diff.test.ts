import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildManagedRollbackDiff} from '../src/rollback-diff.ts';
import {activateManagedRevision} from '../src/history.ts';

const hash=(data:string)=>createHash('sha256').update(data).digest('hex');
const PREVIOUS='// ==UserScript==\n// @name synthetic\n// ==/UserScript==\nconst node = document.querySelector("#old");\n';
const SELECTED='// ==UserScript==\n// @name synthetic\n// ==/UserScript==\nconst node = document.querySelector("#new");\n';

async function fixture(run:(args:{root:string;folder:string;oldHash:string;newHash:string})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-diff-'));
 const folder=join(root,'managed','synthetic');
 const oldHash=hash(PREVIOUS),newHash=hash(SELECTED);
 try{
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'revision-'+oldHash+'.user.js'),PREVIOUS);
  await writeFile(join(folder,'revision-'+newHash+'.user.js'),SELECTED);
  await activateManagedRevision({managedRoot:root,scriptId:'synthetic',hash:oldHash,approved:true});
  await run({root,folder,oldHash,newHash});
 }finally{await rm(root,{recursive:true,force:true})}
}

test('FR-028 displays actual verified changed source lines, not only hashes, before rollback',async()=>fixture(async({root,oldHash,newHash,folder})=>{
 const diff=await buildManagedRollbackDiff({managedRoot:root,scriptId:'synthetic',currentHash:oldHash,targetHash:newHash});
 assert.match(diff,/差异|diff/i);
 assert.ok(diff.includes('#old'));
 assert.ok(diff.includes('#new'));
 assert.match(diff,/- /);
 assert.match(diff,/^\+ /m);
 assert.doesNotMatch(diff,/\\\"@name synthetic\\\"/,'unchanged script metadata should not be copied into rollback diff');
 assert.equal(await readFile(join(folder,'current.user.js'),'utf8'),PREVIOUS,'preview must never activate the selected revision');
}));

test('FR-028 incomplete current is an explicitly labeled recovery, not a fabricated before/after diff',async()=>fixture(async({root,newHash})=>{
 const diff=await buildManagedRollbackDiff({managedRoot:root,scriptId:'synthetic',currentHash:null,targetHash:newHash});
 assert.match(diff,/当前.*缺失|缺失.*当前/);
 assert.doesNotMatch(diff,/^- /m,'missing current must not be shown as a verified old source');
}));

test('FR-028 fails closed on a forged hash, altered archived bytes and linked archives',async()=>fixture(async({root,folder,oldHash,newHash})=>{
 await assert.rejects(buildManagedRollbackDiff({managedRoot:root,scriptId:'synthetic',currentHash:oldHash,targetHash:'f'.repeat(64)}),/revision|archive|hash|missing|found/i);
 const target=join(folder,'revision-'+newHash+'.user.js');
 await writeFile(target,'// altered synthetic bytes');
 await assert.rejects(buildManagedRollbackDiff({managedRoot:root,scriptId:'synthetic',currentHash:oldHash,targetHash:newHash}),/mismatch|corrupt|unsafe/i);
 await rm(target);
 await symlink(join(folder,'revision-'+oldHash+'.user.js'),target);
 await assert.rejects(buildManagedRollbackDiff({managedRoot:root,scriptId:'synthetic',currentHash:oldHash,targetHash:newHash}),/unsafe|symlink/i);
 await rm(target);
 await link(join(folder,'revision-'+oldHash+'.user.js'),target);
 await assert.rejects(buildManagedRollbackDiff({managedRoot:root,scriptId:'synthetic',currentHash:oldHash,targetHash:newHash}),/hardlink|unsafe/i);
}));

test('FR-028 escapes control and bidi payloads instead of injecting misleading native-dialog lines',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-diff-controls-'));
 const folder=join(root,'managed','synthetic');
 const a='const mode = "a";\n',b='const mode = "new\u202e\u001b\u2028\u200fline";\n';
 const oldHash=hash(a),newHash=hash(b);
 try{
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'revision-'+oldHash+'.user.js'),a);
  await writeFile(join(folder,'revision-'+newHash+'.user.js'),b);
  const diff=await buildManagedRollbackDiff({managedRoot:root,scriptId:'synthetic',currentHash:oldHash,targetHash:newHash});
  assert.ok(diff.includes('\\u202e'));
  assert.ok(diff.includes('\\u001b'));
  assert.ok(diff.includes('\\u2028'));
  assert.ok(diff.includes('\\u200f'));
  assert.ok(!diff.includes('\u202e')&&!diff.includes('\u001b')&&!diff.includes('\u2028')&&!diff.includes('\u200f'));
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-028 long changes are visibly truncated instead of masquerading as a complete diff',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-diff-large-'));
 const folder=join(root,'managed','synthetic');
 const old=Array.from({length:160},(_,i)=>'const before_'+i+' = '+i+';').join('\n');
 const updated=Array.from({length:160},(_,i)=>'const after_'+i+' = '+i+';').join('\n');
 const oldHash=hash(old),newHash=hash(updated);
 try{
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'revision-'+oldHash+'.user.js'),old);
  await writeFile(join(folder,'revision-'+newHash+'.user.js'),updated);
  const diff=await buildManagedRollbackDiff({managedRoot:root,scriptId:'synthetic',currentHash:oldHash,targetHash:newHash});
  assert.ok(diff.length<2400,'native review must have a strict display budget');
  assert.match(diff,/^- /m,'large removal must remain visible');
  assert.match(diff,/^\+ /m,'large addition must remain visible');
  assert.match(diff,/截断|省略|不完整/);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('FR-028 desktop native approval actually displays locally verified rollback difference',async()=>{
 const main=await readFile(new URL('../../../apps/desktop/src/main/index.ts',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:rollback-managed'");
 const end=main.indexOf("ipcMain.handle('usshm:export-dom-report'",start);
 const handler=main.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(handler,/buildManagedRollbackDiff\(\{/);
 assert.match(handler,/detail:.*review\.currentHash/s);
 assert.match(handler,/diff/);
 assert.match(handler,/expectedCurrentHash/,'actual activation must keep existing predecessor CAS');
});
