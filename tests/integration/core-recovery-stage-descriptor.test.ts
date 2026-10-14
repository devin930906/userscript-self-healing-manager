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

test('RG-06 stage copy source uses pinned native identity and bounded descriptor transfer',async()=>{
 const source=await readFile('packages/repair-workflow/src/core-recovery-stage.ts','utf8');
 const start=source.indexOf('async function copyChecked(');
 const end=source.indexOf('\n/**',start);
 assert.ok(start>=0&&end>start,'staging source copier is required');
 const copier=source.slice(start,end);
 assert.match(copier,/await lstat\(source,\{bigint:true\}\)/,
  'copy must capture exact source file identity');
 assert.match(copier,/await open\(source,constants\.O_RDONLY/,
  'source must be opened once through non-following file handle');
 assert.match(copier,/sameCoreRecoveryNativeIdentity\(nativeBefore,nativeOpened\)/,
  'source descriptor must be the preflight-inspected file');
 assert.match(copier,/sourceHandle\.createReadStream\(\{autoClose:false\}\)/,
  'source must stream from the checked handle, not a second pathname open');
 assert.doesNotMatch(copier,/\bcopyFile\(source,destination/,
  'path-based copy can open a different source after the approval gate');
 assert.match(copier,/constants\.O_WRONLY\|constants\.O_CREAT\|constants\.O_EXCL/,
  'stage target must be claimed exclusively, never overwrite an existing file');
 assert.match(copier,/copied>expected\.bytes/,
  'copy must stop at the signed manifest byte budget');
 assert.match(copier,/hash\.digest\('hex'\)!==expected\.sha256/,
  'do not retain a source copy that fails the approved digest');
 assert.match(copier,/sameCoreRecoveryNativeIdentity\(nativeBefore,nativeAfter\)/,
  'source handle identity must remain stable');
 assert.match(copier,/sameCoreRecoveryNativeIdentity\(nativeBefore,pathAfter\)/,
  'source pathname identity must still match the original handle at completion');
 assert.match(copier,/await destinationHandle\.sync\(\)/,
  'copied bytes should be flushed before the stage can be declared complete');
 assert.match(copier,/finally\s*\{\s*await sourceHandle\.close\(\)/,
  'source handle must be closed after both successful and failed copies');
});
