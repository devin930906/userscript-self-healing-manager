import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('FR-041 guarded retained repair is durably audited from trusted Main state before returning success',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 assert.match(main,/openAuditJournal\(join\(dataRoot,'audit-journal\.sqlite'\)\)/,
  'Main must open a private durable audit journal under Data');
 assert.match(main,/persistRetainedRepairAudit/,
  'Main must use the rollback-capable FR-041 retained repair audit bridge');
 assert.match(main,/auditJournal\.close\(\)/,
  'the audit SQLite handle must close with the app lifecycle');

 const start=main.indexOf("ipcMain.handle('usshm:apply-repair-guarded'");
 const end=main.indexOf("ipcMain.handle('usshm:apply-repair'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/auditApproval\s*=\s*pendingApprovals\.require\(proposalId,scanSnapshot\.scanId\)/,
  'the audit must capture a trusted Main freshness receipt at write preflight');
 assert.match(handler,/if\(safety\.status==='retained-v1'\)[\s\S]*persistRetainedRepairAudit\(\{/,
  'only a V1 revision that remains active is recorded as the retained revision');
 for(const binding of [
  /journal:auditJournal/,
  /jobId:proposalId/,
  /scriptId:item\.scriptId/,
  /attemptId:scanSnapshot\.scanId/,
  /sourceSha256:item\.analysis\.sourceSha256/,
  /revisionSha256:applied\.hash/,
  /previousHash:trusted\.previousHash/,
  /approval:auditApproval/,
  /expectedCurrentHash:applied\.hash/,
 ]){
  assert.match(handler,binding);
 }
});
