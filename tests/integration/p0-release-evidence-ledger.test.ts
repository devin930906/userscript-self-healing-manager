import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=(name:string)=>readFileSync(resolve(root,name),'utf8');

test('RG-01 ledger enumerates every specified P0 FR including Stable-only P0 without inventing passed status',()=>{
 const specification=read('docs/requirements/product-requirements.md');
 const ledger=read('docs/quality/p0-evidence-ledger.md');
 const expected=[...specification.matchAll(/^\|\s*(FR-\d{3})\s*\|\s*P0(?:（稳定版）)?\s*\|/gm)]
  .map(entry=>entry[1]!);
 const documented=[...ledger.matchAll(/^\|\s*(FR-\d{3})\s*\|\s*`([^`]+)`\s*\|\s*(PARTIAL|BLOCKED)\s*\|/gm)]
  .map(entry=>({id:entry[1]!,path:entry[2]!,state:entry[3]!}));
 assert.equal(expected.length,34,'source specification changed; review P0 scope before release');
 assert.deepEqual(documented.map(row=>row.id).sort(),expected.sort(),
  'each spec P0 must have exactly one evidence row, no missing or invented FR');
 for(const row of documented){
  assert.equal(existsSync(resolve(root,row.path)),true,
   row.id+' points to a non-existent code anchor; do not invent implementation');
  if(Number(row.id.slice(3))>=45)
   assert.equal(row.state,'BLOCKED','Stable-only FRs cannot pass without real three-package evidence');
 }
 assert.match(ledger,/FR-026[\s\S]*?BLOCKED/,'GM-dependent conditional manager gate must remain explicit');
 assert.match(ledger,/Tampermonkey/);
 assert.match(ledger,/NOT STABLE/);
});

test('RG-01 ledger never claims a full P0 pass based only on CI contract or synthetic fixture',()=>{
 const ledger=read('docs/quality/p0-evidence-ledger.md');
 const rows=ledger.split('\n').filter(line=>/^\| FR-\d{3} \|/.test(line));
 assert.equal(rows.length,34);
 assert.ok(rows.every(line=>/\| (PARTIAL|BLOCKED) \|/.test(line)));
 assert.match(ledger,/QA-010/);
 assert.match(ledger,/QA-034/);
 assert.match(ledger,/GM/);
 assert.match(ledger,/Windows 10\/11/);
});
