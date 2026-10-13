import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {readPinnedRegularFile} from '../src/pinned-file.ts';

/** Synthetic-only evidence for Windows file-ID rounding / timestamp collisions.
 * Never log paths, source text, browser state or real user metadata.
 */
test('RG-06 32 rapid same-size replacements reject an old approved pinned snapshot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-synthetic-pinned-windows-'));
 try{
  let numericCollision=0,bigintCollision=0;
  for(let trial=0;trial<32;trial++){
   const path=join(dir,'reused.user.js'),moved=join(dir,'preserved.user.js');
   const approved=Buffer.from('SAFE_SYNTHETIC_'+String(trial).padStart(4,'0'));
   const substitute=Buffer.from('EVIL_SYNTHETIC_'+String(trial).padStart(4,'0'));
   assert.equal(approved.byteLength,substitute.byteLength);
   await writeFile(path,approved);
   const before=await lstat(path),nativeBefore=await lstat(path,{bigint:true});
   await rename(path,moved);
   await writeFile(path,substitute);
   const after=await lstat(path),nativeAfter=await lstat(path,{bigint:true});
   const numericSame=['dev','ino','size','mode','birthtimeMs','mtimeMs','ctimeMs']
    .every(k=>Object.is((before as unknown as Record<string,unknown>)[k],
                         (after as unknown as Record<string,unknown>)[k]));
   const exactSame=['dev','ino','size','mode','birthtimeNs','mtimeNs','ctimeNs']
    .every(k=>(nativeBefore as unknown as Record<string,unknown>)[k]===
              (nativeAfter as unknown as Record<string,unknown>)[k]);
   if(numericSame)numericCollision++;
   if(exactSame)bigintCollision++;
   let readAccepted=false;
   try{await readPinnedRegularFile(path,{maxBytes:512*1024,expected:before});readAccepted=true;}
   catch(error){
    assert.match(String((error as Error).message),/identity|replaced|changed|snapshot|stale|unsafe/i);
   }
   if(readAccepted){
    // The only permissible output is bounded SYNTHETIC numeric evidence.
    throw new Error('Pinned reader accepted stale synthetic snapshot: trial='+trial+
     ' numericCollision='+numericSame+' bigintCollision='+exactSame+
     ' inoNumericallySame='+(before.ino===after.ino)+
     ' birthtimeMsSame='+(before.birthtimeMs===after.birthtimeMs)+
     ' ctimeMsSame='+(before.ctimeMs===after.ctimeMs));
   }
   assert.deepEqual(await readFile(moved),approved);
   await rm(path);await rm(moved);
  }
  // No production assumptions are drawn from a passing synthetic stress run.
  if(process.platform==='win32')
   console.log('Synthetic Windows pinned swap fingerprints: trials=32 numericCollisions='+
    numericCollision+' exactBigIntCollisions='+bigintCollision);
 }finally{await rm(dir,{recursive:true,force:true});}
});
