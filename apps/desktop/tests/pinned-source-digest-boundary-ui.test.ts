import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

/** RG-06: a rescan-approved digest must be checked INSIDE the descriptor
 * reader, not solely by a later caller-side hash comparison. This is
 * defense in depth for source replacement and review-to-activation races. */
test('RG-06 each approval-bound desktop source read pins the scanned SHA-256 in the descriptor read',()=>{
 const src=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const calls=[...src.matchAll(/readPinnedRegularFile\((item\.path|row\.sourcePath),\{maxBytes:512\*1024,expected:[^;]+?\}\)/gs)];
 assert.ok(calls.length>=8,'Expected source-read operations must remain visible to this regression check');
 for(const [i,match] of calls.entries()){
  const call=match[0];
  assert.match(call,/expectedNative:/,'native identity must remain pinned at source read '+i);
  assert.match(call,/expectedSha256:(?:item\.analysis!?\.sourceSha256|row\.sourceHash)/,
   'source read '+i+' must verify its scanned SHA-256 before releasing descriptor bytes');
 }
});
