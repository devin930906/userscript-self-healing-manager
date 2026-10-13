import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=(name:string)=>readFileSync(resolve(root,name),'utf8');
const ledgerRows=(ledger:string)=>ledger.split('\n')
 .filter(line=>/^\|\s*FR-\d{3}\s*\|/.test(line))
 .map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));

test('RG-01 ledger maps every specified P0 FR to existing code and automated-test anchors',()=>{
 const specification=read('docs/requirements/product-requirements.md');
 const ledger=read('docs/quality/p0-evidence-ledger.md');
 const expected=[...specification.matchAll(/^\|\s*(FR-\d{3})\s*\|\s*P0(?:（稳定版）)?\s*\|/gm)]
  .map(entry=>entry[1]!);
 const rows=ledgerRows(ledger);
 assert.equal(expected.length,34,'source specification changed; review P0 scope before release');
 assert.equal(rows.length,34,'the evidence ledger must contain exactly one row for every P0 FR');
 assert.ok(rows.every(row=>row.length===6),'every P0 row needs code, test, test-scope, fixture-evidence and status/gap fields');
 const documented=rows.map(row=>({id:row[0]!,code:row[1]!,tests:row[2]!,scope:row[3]!,fixture:row[4]!,status:row[5]!}));
 assert.deepEqual(documented.map(row=>row.id).sort(),expected.sort(),
  'each spec P0 must have exactly one evidence row, no missing or invented FR');
 for(const row of documented){
  const codePaths=[...row.code.matchAll(/`([^`]+)`/g)].map(entry=>entry[1]!);
  assert.ok(codePaths.length>0,row.id+' must name its source anchor');
  for(const path of codePaths)assert.equal(existsSync(resolve(root,path)),true,
   row.id+' points to a non-existent code anchor; do not invent implementation');
  const testPaths=[...row.tests.matchAll(/`([^`]+\.test\.ts)`/g)].map(entry=>entry[1]!);
  assert.ok(testPaths.length>0,row.id+' must map to a test file or explicitly named gap');
  for(const path of testPaths)assert.equal(existsSync(resolve(root,path)),true,
   row.id+' points to a non-existent automated test');
  assert.ok(row.scope.length>0,row.id+' must state whether the test is direct, module-level or contract-only');
  assert.match(row.fixture,/^(RECORDED|MISSING|BLOCKED):/,
   row.id+' must distinguish recorded fixture evidence from missing or blocked environment evidence');
  assert.match(row.status,/^(PARTIAL|BLOCKED)\b/,
   row.id+' must not infer a full pass from code or automated test presence');
  assert.match(row.status,/\[(?:CODE GAP|TEST GAP|ENV BLOCKED)\]/,
   row.id+' must label its remaining code, test or environment gap');
 }
 for(const id of ['FR-045','FR-046','FR-047','FR-048']){
  const row=documented.find(item=>item.id===id)!;
  assert.match(row.status,/^BLOCKED\b/,'Stable-only '+id+' cannot pass without final package evidence');
  assert.match(row.fixture,/^(?:MISSING|BLOCKED):/,'Stable-only '+id+' needs an explicit missing real-package environment record');
 }
 for(const [qa,commit,run] of [
  ['QA-010','5afa48e9efb629d16d31ff7f882271fc2c8f0273','38143874876'],
  ['QA-034','53b837678f42325c4f9a225d6289c8bc215b5542','38144816252'],
 ]){
  const row=documented.find(item=>item.fixture.includes(qa));
  assert.ok(row,qa+' must remain linked to its limited fixture evidence');
  assert.ok(row.fixture.includes(commit),qa+' must name its evidence commit');
  assert.ok(row.fixture.includes(run),qa+' must name its Development CI run');
  assert.match(row.fixture,/SYNTHETIC|合成/i,qa+' synthetic data must not be described as real user data');
 }
 assert.match(ledger,/NOT STABLE/);
});

test('RG-01 ledger keeps manager and Windows real-environment blockers explicit',()=>{
 const ledger=read('docs/quality/p0-evidence-ledger.md');
 const conditional=ledger.split('## 条件阻断')[1]??'';
 assert.match(conditional,/FR-026[\s\S]*?BLOCKED/,'GM-dependent conditional manager gate must remain explicit');
 assert.match(conditional,/packages\/source-analyzer\/test\/manager-api-inventory\.test\.ts/,
  'static GM API inventory tests are not real manager integration evidence');
 assert.match(conditional,/MISSING:|BLOCKED:/,
  'real Tampermonkey/Violentmonkey GM evidence must be marked missing or blocked');
 assert.match(ledger,/Tampermonkey/);
 assert.match(ledger,/Windows 10\/11/);
 assert.doesNotMatch(ledger,/\|\s*(?:PASS|VERIFIED)\s*\|/,
  'contract CI or synthetic fixtures cannot mark a P0 as fully accepted');
});
