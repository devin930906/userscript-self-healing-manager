import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

/**
 * RG-06: stage creation and later offline review must hash the same open file
 * descriptor whose native identity is verified, never reopen a filename for
 * the bulk read. Existing temporary SQLite and managed script fixture suites
 * exercise the actual backup and stage lifecycle.
 */
test('RG-06 staged recovery hashes identity-pinned descriptor bytes, never a reopened pathname',async()=>{
 const source=await readFile('packages/repair-workflow/src/core-recovery-stage.ts','utf8');
 const start=source.indexOf('async function assertStagedCopy(');
 const end=source.indexOf('\nasync function readBoundedManifest(',start);
 assert.ok(start>=0&&end>start,'offline staged byte audit is required');
 const audit=source.slice(start,end);
 assert.match(audit,/await lstat\(path,\{bigint:true\}\)/,
  'capture exact native identity for staged file before opening');
 assert.match(audit,/await open\(path,\s*constants\.O_RDONLY/,
  'open one read-only descriptor, refusing unintended symlink following');
 assert.match(audit,/await handle\.stat\(\{bigint:true\}\)/,
  'compare native identity from actual open descriptor');
 assert.match(audit,/sameCoreRecoveryNativeIdentity\(before,\s*opened\)/,
  'a swapped file must be rejected before reading any bytes');
 assert.match(audit,/handle\.createReadStream\(\{autoClose:false\}\)/,
  'hash bytes from the validated descriptor, not a second pathname open');
 assert.doesNotMatch(audit,/\bcreateReadStream\(path\)/,
  'pathname stream bypasses verified open-descriptor identity');
 assert.match(audit,/sameCoreRecoveryNativeIdentity\(before,\s*after\)/,
  'descriptor identity must remain stable after streamed hashing');
 assert.match(audit,/sameCoreRecoveryNativeIdentity\(before,\s*pathAfter\)/,
  'pathname still must resolve to the same file at completion');
 assert.match(audit,/finally\s*\{\s*await handle\.close\(\)/,
  'descriptor must be closed even when hashing, identity or digest fails');
 assert.match(audit,/copied\s*!==\s*expected\.bytes/);
 assert.match(audit,/hash\.digest\('hex'\)\s*!==\s*expected\.sha256/);
});
