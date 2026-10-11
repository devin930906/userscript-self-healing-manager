import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';
test('Windows build command performs test/build/package and checksum before exit',async()=>{
 const script=await readFile('build-windows.cmd','utf8');
 for(const required of ['npm ci','npm test','npm run typecheck','npm run build','npm run dist:win','CreateFromDirectory','Get-FileHash','win-unpacked','Portable','Setup'])assert.ok(script.includes(required),required);
});

test('Windows release helper refuses mutable dependency installation and enforces strict typecheck',async()=>{
 const script=await readFile('build-windows.cmd','utf8');
 assert.match(script,/call npm ci\s*\|\| exit \/b 1/);
 assert.doesNotMatch(script,/call npm install\b/i);
 assert.match(script,/call npm run typecheck\s*\|\| exit \/b 1/);
 assert.ok(script.indexOf('npm run typecheck')<script.indexOf('npm run dist:win'),
  'release compilation must never bypass TypeScript checks');
});
