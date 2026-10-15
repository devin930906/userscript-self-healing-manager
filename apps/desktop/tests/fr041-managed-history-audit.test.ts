import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('FR-041 managed revision history can read back only its own durable audit chain',async()=>{
 const main=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../src/preload/index.ts',import.meta.url),'utf8');
 const renderer=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');

 assert.match(main,/ipcMain\.handle\('usshm:managed-audit-trace'/);
 assert.match(main,/scanSessions\.require\(q\.scanId\)/);
 assert.match(main,/listManagedRevisions\(\{managedRoot:dataRoot,scriptId:item\.scriptId\}\)/);
 assert.match(main,/revisions\.some\(revision=>revision\.hash===q\.revisionHash\)/,
  'renderer hash must first be proven to belong to the selected managed script history');
 assert.match(main,/auditJournal\.getByManagedRevision\(\{scriptId:item\.scriptId,revisionSha256:q\.revisionHash\}\)/);

 assert.match(preload,/getManagedAuditTrace:\(input:\{scanId:string;itemIndex:number;revisionHash:string\}\)=>ipcRenderer\.invoke\('usshm:managed-audit-trace',input\)/);
 assert.match(renderer,/getManagedAuditTrace:\(input:\{scanId:string;itemIndex:number;revisionHash:string\}\)=>Promise<AuditTrace\|null>/);
 assert.match(renderer,/window\.ussm\.getManagedAuditTrace\(\{scanId:result\.scanId,itemIndex:focused,revisionHash:hash\}\)/);
 assert.match(renderer,/查看审计链/,'managed history must expose durable trace lookup after restart');
});
