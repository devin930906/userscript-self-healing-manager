import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TrustedDropSequence} from '../src/preload/trusted-drop-sequence.ts';

test('older native drop IPC reply cannot supersede a newer drop result',()=>{
 const sequence=new TrustedDropSequence();
 const first=sequence.begin();
 const second=sequence.begin();
 assert.equal(sequence.isCurrent(second),true);
 assert.equal(sequence.isCurrent(first),false,'old asynchronous grant must not dispatch after a later drop');
});
test('subscription revocation invalidates in-flight drop replies',()=>{
 const sequence=new TrustedDropSequence();
 const pending=sequence.begin();
 sequence.invalidate();
 assert.equal(sequence.isCurrent(pending),false);
});
