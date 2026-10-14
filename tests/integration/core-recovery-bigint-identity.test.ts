import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,lstat,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as recovery from '../../packages/repair-workflow/src/core-recovery.ts';

test('RG-06 core recovery large SQLite stream compares exact BigInt identity, not rounded inode numbers',async()=>{
 const same=(recovery as Record<string,unknown>).sameCoreRecoveryNativeIdentity;
 assert.equal(typeof same,'function','missing precise recovery streaming file identity');
 const compare=same as (left:unknown,right:unknown)=>boolean;
 const tmp=await mkdtemp(join(tmpdir(),'usshm-core-native-'));
 try{
  const file=join(tmp,'recovery.sqlite');
  await writeFile(file,'SYNTHETIC_SQLITE_IDENTITY_FIXTURE');
  const native=await lstat(file,{bigint:true});
  assert.equal(compare(native,native),true);
  for(const key of ['ino','dev','birthtimeNs','mtimeNs','ctimeNs','mode','nlink','size'] as const){
   const forged=Object.create(native) as typeof native;
   Object.defineProperty(forged,key,{value:native[key]+(key==='ino'?(1n<<53n):1n)});
   assert.equal(compare(native,forged),false,
    key+' mismatch must reject even when numeric Windows file stats are rounded');
  }
  assert.deepEqual(await readFile(file),Buffer.from('SYNTHETIC_SQLITE_IDENTITY_FIXTURE'));
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('RG-06 core backup manifest stream binds before/open/after descriptor and pathname native snapshots',async()=>{
 const source=await readFile('packages/repair-workflow/src/core-recovery.ts','utf8');
 assert.match(source,/lstat\(file,\{bigint:true\}\)/);
 assert.match(source,/handle\.stat\(\{bigint:true\}\)/);
 assert.match(source,/sameCoreRecoveryNativeIdentity\(nativeBefore,nativeOpened\)/);
 assert.match(source,/sameCoreRecoveryNativeIdentity\(nativeBefore,nativeAfter\)/);
 assert.match(source,/sameCoreRecoveryNativeIdentity\(nativeBefore,nativePathAfter\)/);
});
