import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

/**
 * Configuration contracts only. These tests MUST NOT build or distribute
 * installers. A Stable release separately requires real three-edition smoke.
 */
test('Windows release config declares the required installer, portable and unpacked ZIP targets',async()=>{
 const yaml=await readFile('build/electron-builder.yml','utf8');
 const win=yaml.split(/^win:\s*$/m)[1]?.split(/^(?:nsis|portable|mac|linux):\s*$/m)[0]??'';
 assert.match(win,/target:\s*nsis\s*\n\s*arch:\s*\[x64\]/);
 assert.match(win,/target:\s*portable\s*\n\s*arch:\s*\[x64\]/);
 assert.match(win,/target:\s*zip\s*\n\s*arch:\s*\[x64\]/);
 assert.match(win,/artifactName:\s*Userscript-Self-Healing-Manager-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/);
 assert.match(yaml,/nsis:\s*\n\s*oneClick:\s*false/);
 assert.match(yaml,/portable:\s*\n\s*artifactName:\s*Userscript-Self-Healing-Manager-Portable-/);
});
test('Windows release command requests all three targets, without allowing a partial Stable artifact set',async()=>{
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.match(pkg.scripts['dist:win'],/--win\s+nsis\s+portable\s+zip\s+--x64/);
 assert.match(pkg.scripts['dist:win'],/--publish\s+never/);
 assert.ok(!pkg.scripts.test.includes('dist:win'),'Development test must not generate installer previews');
});
