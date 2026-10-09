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
 assert.doesNotMatch(win,/target:\s*zip\s*\n\s*arch:\s*\[x64\]/,
  'ZIP must have a single producer: post-package full win-unpacked directory, not electron-builder zip target');
 assert.match(win,/artifactName:\s*Userscript-Self-Healing-Manager-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/);
 assert.match(yaml,/nsis:\s*\n\s*oneClick:\s*false/);
 assert.match(yaml,/portable:\s*\n\s*artifactName:\s*Userscript-Self-Healing-Manager-Portable-/);
});
test('Windows release command requests all three targets, without allowing a partial Stable artifact set',async()=>{
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.match(pkg.scripts['dist:win'],/--win\s+nsis\s+portable\s+--x64/);
 assert.match(pkg.scripts['dist:win'],/--publish\s+never/);
 assert.ok(!pkg.scripts.test.includes('dist:win'),'Development test must not generate installer previews');
});

test('complete Windows ZIP is produced only after unpacked application resources exist',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const script=await readFile('scripts/package-windows.ps1','utf8');
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.doesNotMatch(pkg.scripts['dist:win'],/--win[^\n]*\bzip\b/i);
 assert.match(workflow,/CreateFromDirectory\(\$unpacked,\s*\$zip\)/);
 assert.match(script,/CreateFromDirectory\(\$unpacked,\s*\$zip\)/);
 assert.doesNotMatch(script,/Remove-Item\s+\$zip\s+-Force/i,'do not delete existing archive without user recovery');
 assert.match(script,/if\s*\(Test-Path\s+\$zip\)\s*\{\s*throw\b/i,'existing release archive must stop the build');
});
