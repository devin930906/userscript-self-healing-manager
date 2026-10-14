import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

/** The renderer can forge approved:true. A persistent configuration delete
 * must be authorized by Main's native OS dialog, not by renderer JavaScript. */
test('FR-014 P0 scenario deletion requires native Main confirmation and revalidates exact selection',async()=>{
 const main=await readFile('apps/desktop/src/main/index.ts','utf8');
 const start=main.indexOf("ipcMain.handle('usshm:site-test-case-remove'");
 const end=main.indexOf("ipcMain.handle('usshm:site-test-case-verify'",start);
 assert.ok(start>=0&&end>start,'scenario removal must remain in the Main-only IPC handler');
 const body=main.slice(start,end);
 assert.match(body,/dialog\.showMessageBox\(mainWindow/,'Main must own a native confirmation dialog');
 assert.match(body,/buttons:\['取消','仅删除此场景'\]/,
  'the default action must be cancellation, not permanent deletion');
 assert.match(body,/defaultId:0,cancelId:0/);
 assert.match(body,/decision\.response!==1/);
 assert.match(body,/return \{deleted:false\}/,'cancellation must be a successful safe no-op');
 const firstLookup=body.indexOf('await listSiteTestCases(');
 const dialog=body.indexOf('dialog.showMessageBox(');
 const decision=body.indexOf('decision.response!==1');
 const lastLookup=body.lastIndexOf('await listSiteTestCases(');
 const deleteAt=body.indexOf('await removeSiteTestCase(');
 assert.ok(firstLookup>=0&&firstLookup<dialog&&dialog<decision&&
  decision<lastLookup&&lastLookup<deleteAt,
  'select existing scene, ask native approval, re-read exact case, then delete');
 assert.match(body,/scanSessions\.assertCurrent\(scanSnapshot\)/,
  'authorization must still apply after the asynchronous native prompt');
 assert.match(body,/siteTestRemoveBusy=true/,'prevent concurrent native dialogs for same mutation');
 assert.match(body,/finally\s*\{\s*siteTestRemoveBusy=false/,'release Main mutex on cancel/error');
 assert.match(body,/selected\.id===q\.caseId|c\.id===q\.caseId/);
 assert.match(body,/still\.label!==selected\.label/,'case changed during dialog must be rejected');
 assert.match(body,/still\.url!==selected\.url/,'do not delete a different page scenario');
});

test('FR-014 renderer treats cancelled Main-owned deletion as no-op and never reports deleted',async()=>{
 const app=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 const start=app.indexOf("async function manageSiteTestCase(");
 const end=app.indexOf('async function ',start+20);
 assert.ok(start>=0&&end>start);
 const body=app.slice(start,end);
 assert.match(body,/const removal=await window\.ussm\.removeSiteTestCase/);
 assert.match(body,/if\(!removal\.deleted\)return/,'native cancellation must not emit a success notice');
});
