import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

function withReleaseDatabases(run){
 const base=mkdtempSync(join(tmpdir(),'usshm-sqlite-release-'));
 const roots=['setup','portable','zip'].map(edition=>{
  const root=join(base,edition);mkdirSync(root);
  for(const name of ['registry.sqlite','diagnosis-journal.sqlite']){
   const db=new DatabaseSync(join(root,name));
   try{db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));');}
   finally{db.close();}
  }
  return root;
 });
 try{return run(roots);}finally{rmSync(base,{recursive:true,force:true});}
}
function verify(roots){
 return spawnSync(process.execPath,['scripts/verify-release-sqlite.mjs',...roots],{encoding:'utf8'});
}

test('Windows release SQLite verifier accepts all six real databases',()=>{
 withReleaseDatabases(roots=>{
  const result=verify(roots);
  assert.equal(result.status,0,result.stderr);
  assert.equal((result.stdout.match(/integrity_check and foreign_key_check PASS:/g)||[]).length,6);
 });
});

test('Windows release SQLite verifier fails if a required database is missing',()=>{
 withReleaseDatabases(roots=>{
  unlinkSync(join(roots[2],'registry.sqlite'));
  const result=verify(roots);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Missing or empty release SQLite database/);
 });
});

test('Windows release SQLite verifier fails for a corrupt database',()=>{
 withReleaseDatabases(roots=>{
  writeFileSync(join(roots[1],'diagnosis-journal.sqlite'),'corrupt SQLite evidence');
  const result=verify(roots);
  assert.notEqual(result.status,0);
 });
});

test('Windows release SQLite verifier fails on broken foreign keys',()=>{
 withReleaseDatabases(roots=>{
  const db=new DatabaseSync(join(roots[0],'registry.sqlite'));
  try{db.exec('PRAGMA foreign_keys=OFF; INSERT INTO child(id,parent_id) VALUES(1,999)');}
  finally{db.close();}
  const result=verify(roots);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/foreign_key_check failed/);
 });
});

test('Windows release SQLite verifier rejects a symlinked database', (t)=>{
 withReleaseDatabases(roots=>{
  const target=join(roots[0],'registry.sqlite');
  const link=join(roots[1],'registry.sqlite');
  unlinkSync(link);
  try{symlinkSync(target,link,'file');}
  catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Windows user lacks symlink privilege');return;}throw error;}
  const result=verify(roots);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Missing or empty release SQLite database/);
 });
});

test('Windows release SQLite verifier rejects a symlinked edition directory', (t)=>{
 withReleaseDatabases(roots=>{
  const link=join(roots[0],'linked-zip');
  try{symlinkSync(roots[2],link,process.platform==='win32'?'junction':'dir');}
  catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Windows user lacks directory link privilege');return;}throw error;}
  const result=verify([roots[0],roots[1],link]);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Unsafe release SQLite ancestor directory/);
 });
});
