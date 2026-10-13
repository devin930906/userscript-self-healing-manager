import assert from 'node:assert/strict';
import {link,lstat,mkdtemp,readFile,readdir,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {UntrustedReportPublicationError,writeExclusiveReport} from '../src/exclusive-report.ts';

async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-report-hardlink-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}

test('RG-07 report staging refuses a byte-identical external alias before atomic publication',async()=>fixture(async root=>{
 const path=join(root,'diagnostic.json'),alias=join(root,'external-alias.json');
 const content='{"synthetic":"REDACTED_DIAGNOSTIC"}';
 let aliased=false;
 await assert.rejects(writeExclusiveReport({destinationPath:path,content,
  beforePublish:async()=>{
   const names=await readdir(root);
   const staging=names.filter(name=>name.includes('.staging-'));
   assert.equal(staging.length,1);
   await link(join(root,staging[0]!),alias);
   aliased=true;
   assert.equal((await lstat(alias)).nlink,2);
  },
 }),/hard.?link|alias|unsafe|report/i,
 'a private staged report must not be linked to an external filename before publish');
 assert.equal(aliased,true);
 await assert.rejects(readFile(path),{code:'ENOENT'},
  'failed publication may never make a report visible at its approved destination');
 assert.equal(await readFile(alias,'utf8'),content,
  'must not delete a third-party pathname during failed report cleanup');
 assert.deepEqual(await readdir(root),['external-alias.json']);
}));

test('RG-07 report publication reports a hardlink created after linking as untrusted',async()=>fixture(async root=>{
 const path=join(root,'diagnostic.md'),alias=join(root,'other-reader.md');
 const content='SYNTHETIC PRIVATE REPORT';
 await assert.rejects(writeExclusiveReport({destinationPath:path,content,
  afterPublish:async()=>{
   await link(path,alias);
   assert.equal((await lstat(path)).nlink,3,
    'publisher staging + approved destination + outside alias share an inode');
  },
 }),error=>{
  assert.ok(error instanceof UntrustedReportPublicationError);
  assert.equal(error.code,'REPORT_PUBLICATION_UNTRUSTED');
  assert.equal(error.destinationPath,path);
  return true;
 });
 assert.equal(await readFile(path,'utf8'),content);
 assert.equal(await readFile(alias,'utf8'),content);
 assert.equal((await lstat(path)).nlink,2,'cleanup never deletes foreign hardlink aliases');
 await unlink(alias);
 assert.equal((await lstat(path)).nlink,1);
}));

test('RG-07 approved report leaves only one link after staging cleanup',async()=>fixture(async root=>{
 const path=join(root,'diagnostic.json');
 await writeExclusiveReport({destinationPath:path,content:'{"safe":true}'});
 assert.deepEqual(await readdir(root),['diagnostic.json']);
 assert.equal((await lstat(path)).nlink,1);
 assert.equal(await readFile(path,'utf8'),'{"safe":true}');
}));
