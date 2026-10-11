import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('Chrome selection is restored from local preferences and exposed through narrow app info',()=>{
 const main=readFileSync('apps/desktop/src/main/index.ts','utf8');
 const renderer=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(main,/approvedChromePath=await loadPreferredChromePath\(\{dataRoot\}\)/);
 assert.match(main,/await savePreferredChromePath\(\{dataRoot,executablePath:picked\}\)/);
 assert.match(main,/preferredChromePath:approvedChromePath/);
 assert.match(renderer,/setChromePath\(info\.preferredChromePath\?\?''\)/);
});
