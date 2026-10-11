import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {TrustedDropSequence} from '../src/preload/trusted-drop-sequence.ts';

test('newer trusted drop response is current and older response is ignored when replies arrive out of order',()=>{
 const sequence=new TrustedDropSequence();
 const older=sequence.begin();
 assert.equal(sequence.isCurrent(older),true);
 const newer=sequence.begin();
 assert.equal(sequence.isCurrent(newer),true);
 assert.equal(sequence.isCurrent(older),false,'older IPC reply must not dispatch after newer native drop');
 assert.equal(sequence.isCurrent(newer),true,'newer IPC reply remains deliverable after older is rejected');
});
test('preload verifies generation before notifying trusted-drop UI listeners',async()=>{
 const preload=await readFile('apps/desktop/src/preload/index.ts','utf8');
 const generation=preload.indexOf('const dropGeneration=trustedDropSequence.begin()');
 const invoke=preload.indexOf("ipcRenderer.invoke('usshm:grant-drops',paths)");
 const check=preload.indexOf('trustedDropSequence.isCurrent(dropGeneration)');
 const dispatch=preload.indexOf('for(const listener of trustedDropListeners)');
 assert.ok(generation>=0&&generation<invoke,'start generation before trusted IPC request');
 assert.ok(invoke<check&&check<dispatch,'reject stale response before notifying UI listeners');
});
