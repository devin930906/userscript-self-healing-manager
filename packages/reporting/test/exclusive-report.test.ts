import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeExclusiveReport} from '../src/exclusive-report.ts';

async function withRoot(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-report-safe-'));
 try{await run(root)}finally{await rm(root,{recursive:true,force:true})}
}
test('serialized reports appear only after an entire staged, verified write',async()=>withRoot(async root=>{
 const destinationPath=join(root,'export.json');
 const content='{"report":"'+('v'.repeat(150000))+'"}';
 let writes=0;
 await writeExclusiveReport({destinationPath,content,writeChunk:async(file,bytes,position)=>{
  if(++writes===1)await assert.rejects(readFile(destinationPath),{code:'ENOENT'});
  return (await file.write(bytes,0,bytes.length,position)).bytesWritten;
 }});
 assert.ok(writes>=3);
 assert.equal(await readFile(destinationPath,'utf8'),content);
 assert.ok(!(await readdir(root)).some(x=>x.includes('.staging-')));
}));
test('interrupted report generation never leaves a truncated visible output',async()=>withRoot(async root=>{
 const destinationPath=join(root,'report.md');
 let chunks=0;
 await assert.rejects(writeExclusiveReport({destinationPath,content:'a'.repeat(140000),
  writeChunk:async(file,bytes,position)=>{
   if(++chunks===2)throw Object.assign(new Error('disk quota reached'),{code:'ENOSPC'});
   return (await file.write(bytes,0,bytes.length,position)).bytesWritten;
  },
 }),/quota reached/i);
 await assert.rejects(readFile(destinationPath),{code:'ENOENT'});
 assert.deepEqual(await readdir(root),[]);
}));
test('existing reports are never overwritten, including an entry created during staging',async()=>withRoot(async root=>{
 const path=join(root,'report.json');await writeFile(path,'previous report');
 await assert.rejects(writeExclusiveReport({destinationPath:path,content:'next report'}),/exists|overwrite/i);
 assert.equal(await readFile(path,'utf8'),'previous report');
 const late=join(root,'late.json');
 await assert.rejects(writeExclusiveReport({destinationPath:late,content:'newer report',
  beforePublish:async()=>{await writeFile(late,'another writer');},
 }),/exists|overwrite/i);
 assert.equal(await readFile(late,'utf8'),'another writer');
 assert.ok(!(await readdir(root)).some(x=>x.includes('.staging-')));
}));
test('only bounded absolute Markdown/JSON report paths may be exported',async()=>withRoot(async root=>{
 for(const path of [join(root,'secret.user.js'),join(root,'archive.zip'),'relative.json',join(root,'wrong.txt')]){
  await assert.rejects(writeExclusiveReport({destinationPath:path,content:'hello'}),/report|format|extension|absolute|destination/i);
 }
 await assert.rejects(writeExclusiveReport({destinationPath:join(root,'too-large.json'),content:'b'.repeat(8*1024*1024+1)}),/size|budget|large/i);
 assert.deepEqual(await readdir(root),[]);
}));
