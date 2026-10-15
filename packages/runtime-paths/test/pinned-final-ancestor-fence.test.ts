import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('RG-06 pinned reads revalidate unlinked parent after descriptor and path checks',async()=>{
 const source=await readFile(new URL('../src/pinned-file.ts',import.meta.url),'utf8');
 const preflight=source.indexOf('await assertUnlinkedRecoveryDirectory(dirname(resolve(path)));');
 const pathFence=source.indexOf('if(!same(before,after))');
 const finalFence=source.lastIndexOf('await assertUnlinkedRecoveryDirectory(dirname(resolve(path)));');
 const returnBytes=source.indexOf('return bytes;',pathFence);
 assert.ok(preflight>=0&&pathFence>preflight,'required preflight and descriptor/path checks');
 assert.ok(finalFence>pathFence&&finalFence<returnBytes,
  'a post-read linked-ancestor fence must run before returning verified bytes');
});
