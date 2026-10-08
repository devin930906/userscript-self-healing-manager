import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';
test('Windows build command performs test/build/package and checksum before exit',async()=>{
 const script=await readFile('build-windows.cmd','utf8');
 for(const required of ['npm install','npm test','npm run build','npm run dist:win','CreateFromDirectory','Get-FileHash','win-unpacked','Portable','Setup'])assert.ok(script.includes(required),required);
});
