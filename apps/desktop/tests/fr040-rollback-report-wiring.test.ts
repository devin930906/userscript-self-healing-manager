import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('FR-040 rollback report export uses authorized Main-owned durable history and safe exclusive save only',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const renderer=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('usshm:export-rollback-audit'");
 const end=main.indexOf("ipcMain.handle('usshm:rollback-managed'",start);
 assert.ok(start>=0&&end>start,'report handler must be after authorized rollback-history read and before write');
 const handler=main.slice(start,end);
 assert.match(handler,/Object\.keys\(q\)\.sort\(\)\.join\(','\)/,'reject arbitrary renderer-supplied data and paths');
 assert.match(handler,/scanSessions\.require\(q\.scanId\)/);
 assert.match(handler,/withinAuthorized\(item\.path\)/);
 assert.match(handler,/rollbackAuditJournal\.listByScript\(item\.scriptId\)/);
 assert.match(handler,/serializeRollbackAuditReport\(/);
 assert.match(handler,/showSaveDialog/);
 assert.match(handler,/scanSessions\.assertCurrent\(scanSnapshot\)/,'reject stale scan after OS dialog');
 assert.match(handler,/rollbackAuditJournal\.listByScript\(item\.scriptId\)/,'read journal again on dialog completion');
 assert.match(handler,/writeExclusiveReport\(\{destinationPath:selection\.filePath,content\}\)/);
 assert.doesNotMatch(handler,/writeFile\(|\.user\.js|db\.prepare\(/);
 assert.match(preload,/exportRollbackAudit:[^\n]*ipcRenderer\.invoke\('usshm:export-rollback-audit',input\)/);
 assert.match(renderer,/window\.ussm\.exportRollbackAudit\(\{scanId:result\.scanId,itemIndex:focused,format\}\)/);
 assert.match(renderer,/导出回滚审计 JSON/);
 assert.match(renderer,/导出回滚审计 Markdown/);
});
