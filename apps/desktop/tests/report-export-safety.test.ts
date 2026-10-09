import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

test('all desktop report exports use verified exclusive publication instead of truncating user files',async()=>{
 const src=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const dom=src.split("ipcMain.handle('usshm:export-dom-report'")[1]?.split("ipcMain.handle('usshm:export'")[0]??'';
 const stat=src.split("ipcMain.handle('usshm:export'")[1]?.split('\n}')[0]??'';
 assert.match(dom,/writeExclusiveReport\(\{destinationPath:selection\.filePath,content\}\)/);
 assert.match(stat,/writeExclusiveReport\(\{destinationPath:result\.filePath,content\}\)/);
 assert.doesNotMatch(dom,/\bwriteFile\(|flag:\s*'w'/);
 assert.doesNotMatch(stat,/\bwriteFile\(|flag:\s*'w'/);
});
test('static report export rejects a scan replaced while OS Save dialog was visible',async()=>{
 const src=await readFile(new URL('../src/main/index.ts',import.meta.url),'utf8');
 const stat=src.split("ipcMain.handle('usshm:export'")[1]?.split('\n}')[0]??'';
 assert.match(stat,/const scanSnapshot=lastScan/);
 assert.match(stat,/serializeStaticReport\(scanSnapshot,format\)/);
 assert.match(stat,/lastScan!==scanSnapshot/);
 assert.match(stat,/writeExclusiveReport\(/);
});
