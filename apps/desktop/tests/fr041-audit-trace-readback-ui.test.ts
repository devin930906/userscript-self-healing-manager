import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('FR-041 retained repair exposes a read-only durable audit trace through desktop product flow',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const renderer=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');

 assert.match(main,/let auditReceipt[^\n]*null/,
  'guarded apply must retain the durable audit append receipt');
 assert.match(main,/auditReceipt\s*=\s*await persistRetainedRepairAudit\(/,
  'successful retained V1 repair must keep the exact persisted audit receipt');
 assert.match(main,/auditRevisionId\s*:\s*auditReceipt\?\.revisionId\s*\?\?\s*null/,
  'guarded apply result must expose only the persisted audit revision identity');

 assert.match(main,/ipcMain\.handle\('usshm:audit-trace',[\s\S]*auditJournal\.getByRevision\(revisionId\)/,
  'Main must expose a read-only audit lookup backed by the private audit journal');
 assert.match(main,/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$/,
  'audit lookup must require one canonical lowercase UUID before journal access');

 assert.match(preload,/getAuditTrace:\(input:\{revisionId:string\}\)=>ipcRenderer\.invoke\('usshm:audit-trace',input\)/,
  'Preload must expose only the typed revision-id lookup, never a filesystem path');

 assert.match(renderer,/getAuditTrace:\(input:\{revisionId:string\}\)=>Promise<AuditTrace\|null>/,
  'Renderer contract must make audit readback explicit and read-only');
 assert.match(renderer,/auditRevisionId:string\|null/,
  'guarded apply result must carry the audit revision link');
 assert.match(renderer,/window\.ussm\.getAuditTrace\(\{revisionId:guarded\.auditRevisionId\}\)/,
  'retained repair UI must read back the exact durable audit revision returned by Main');
 assert.match(renderer,/job\s*→\s*finding\s*→\s*candidate\s*→\s*test\s*→\s*approval\s*→\s*revision/,
  'UI must present the full FR-041 chain rather than a generic success label');
});
