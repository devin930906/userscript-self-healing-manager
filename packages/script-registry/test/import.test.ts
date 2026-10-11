import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,mkdir,writeFile,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {enumerateScripts,importPaths} from '../src/index.ts';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../persistence/src/index.ts';

test('walk directories without traversing symlink cycles or escaping root',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-scan-'));
 try {await mkdir(join(root,'scripts'));await writeFile(join(root,'scripts','a.user.js'),'const x=1');try {await symlink(root,join(root,'scripts','loop'));}catch(error){if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('Windows runner cannot create symlink without privilege');return;}throw error;}
 const files=await enumerateScripts({paths:[root],recursive:true,followSymlinks:false});
 assert.deepEqual(files.filter(x=>x.status==='found').map(x=>x.path),[join(root,'scripts','a.user.js')]);}
 finally{await rm(root,{recursive:true,force:true});}
});
test('import isolates syntax errors and preserves distinct identical script names',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-unique-'));
 try {await mkdir(join(root,'你好'));await mkdir(join(root,'world'));
 const a=join(root,'你好','a.user.js'),b=join(root,'world','a.user.js'),bad=join(root,'bad.user.js');
 await writeFile(a,'document.querySelector(".a")');await writeFile(b,'document.querySelector(".b")');await writeFile(bad,'const (');
 const db=openDatabase(':memory:');migrateDatabase(db);const repo=createScriptRepository(db);
 const results=await importPaths({paths:[a,b,bad],recursive:false,repository:repo});
 assert.deepEqual(results.map(x=>x.status),['imported','imported','parse-error']);
 assert.notEqual(results[0]?.scriptId,results[1]?.scriptId);assert.equal(repo.list().length,3);
 assert.equal(await readFile(a,'utf8'),'document.querySelector(".a")');db.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
test('explicit input only accepts .user.js files and limits size',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-limits-'));
 try {const other=join(root,'danger.js');const big=join(root,'huge.user.js');await writeFile(other,'');await writeFile(big,'x'.repeat(513*1024));
 const db=openDatabase(':memory:');migrateDatabase(db);
 const results=await importPaths({paths:[other,big],recursive:false,repository:createScriptRepository(db)});
 assert.deepEqual(results.map(x=>x.status),['invalid-extension','too-large']);db.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
