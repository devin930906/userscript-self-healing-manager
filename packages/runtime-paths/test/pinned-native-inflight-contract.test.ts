import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readPinnedRegularFile} from '../src/pinned-file.ts';

test('RG-06 snapshot-free pinned reads have an exact native identity fence on Windows',async()=>{
 // Runtime regression also covers the ordinary import path without any
 // approved external file identity snapshot (real temporary bytes only).
 const root=await mkdtemp(join(tmpdir(),'usshm-native-snapshot-free-'));
 try{
  const selected=join(root,'plain.user.js');
  const bytes=Buffer.from('SYNTHETIC_NATIVE_SNAPSHOT_FREE');
  await writeFile(selected,bytes);
  for(let i=0;i<3;i++)
   assert.deepEqual(await readPinnedRegularFile(selected,{maxBytes:1024}),bytes);
  assert.deepEqual(await readFile(selected),bytes);
 }finally{await rm(root,{recursive:true,force:true});}
 // A deterministic active Win32 rename race cannot be synthesized without
 // a native controlled file-system seam. Preserve a source-level CI contract
 // that Windows performs real bigint path/open/read comparisons even when
 // the caller had no independent snapshot. This is not a V4 or native-API pass.
 const source=await readFile(new URL('../src/pinned-file.ts',import.meta.url),'utf8');
 assert.match(source,/const trackNative\s*=\s*process\.platform\s*===\s*'win32'\s*\|\|\s*expectedNative\s*!==\s*undefined/);
 assert.match(source,/const nativeBefore\s*=\s*trackNative\s*\?\s*await lstat\(path,\{bigint:true\}\)/);
 assert.match(source,/const nativeOpened\s*=\s*trackNative\s*\?\s*await handle\.stat\(\{bigint:true\}\)/);
 assert.match(source,/if\(trackNative\s*&&\s*\(!nativeBefore\|\|!nativeOpened/);
 assert.match(source,/if\(trackNative\s*&&\s*\(!nativeOpened/);
 assert.match(source,/if\(trackNative\s*&&\s*\(!nativeBefore/);
});
