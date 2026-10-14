import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {verifySiteTestCaseSelection} from '../src/site-test-cases.ts';

const metadata={match:['https://example.invalid/app/*'],include:[],raw:{match:['https://example.invalid/app/*']}};
test('FR-014 site scene verification compares pinned live main-frame URL, never stale Chrome inventory URL',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const marker="ipcMain.handle('usshm:site-test-case-verify'";
 const start=main.indexOf(marker);
 const end=main.indexOf("ipcMain.handle('usshm:run-dom-contract'",start);
 assert.ok(start>=0&&end>start,'verify Main IPC must remain available');
 const handler=main.slice(start,end);
 assert.match(handler,/const before=await confirmPageIdentity\(selected\)/);
 assert.match(handler,/selectedUrl:before\.confirmedUrl/,
  'the verified CDP frame URL is the only admissible source for site-case equality');
 assert.doesNotMatch(handler,/selectedUrl:selected\.url/,
  'Chrome /json/list can be stale following a main-frame navigation');
 assert.match(handler,/assertStablePageDocument\(before,after\)/,
  'the final live loader/frame identity fence must remain');
 const entry={id:'synthetic',scriptId:'script-test-one',label:'Safe scene',
  url:'https://example.invalid/app/dashboard',stateId:'custom' as const};
 const actual=verifySiteTestCaseSelection({
  entry,selectedUrl:'https://example.invalid/app/other',metadata,
 });
 assert.equal(actual.status,'mismatch');
 assert.equal(actual.functionalVerified,false);
});
