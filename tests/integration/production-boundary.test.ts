import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 assertProductionModuleGraph,verifyProductionBundles,
} from '../../scripts/production-boundary.mjs';

const fixtures=['main.cjs','preload.cjs','renderer.js'] as const;
async function withDist(work:(dir:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-production-boundary-'));
 const dir=join(root,'dist');
 try{
  await mkdir(dir);
  for(const name of fixtures)
   await writeFile(join(dir,name),'/* synthetic safe bundle */\nconsole.log("safe");\n');
  await work(dir);
 }finally{await rm(root,{recursive:true,force:true});}
}

test('production bundle check approves only the three required regular JS payloads',async()=>withDist(async dir=>{
 assert.deepEqual(await verifyProductionBundles(dir),{
  valid:true,checkedFiles:3,
 });
}));

test('production bundle scan fails closed on test-only CDP script execution or input dispatch',async()=>withDist(async dir=>{
 for(const disallowed of [
  'Runtime.evaluate',
  'Input.dispatchMouseEvent',
  'runIsolatedFixtureBehavior',
  'runIsolatedFixtureInteraction',
  'runSyntheticFunctionalLifecycle',
 ]){
  await writeFile(join(dir,'main.cjs'),'const suspicious="'+disallowed+'";');
  await assert.rejects(verifyProductionBundles(dir),/test-only|unsafe|forbidden|CDP|bundle/i,disallowed);
 }
}));

test('production boundary rejects missing, symlinked or empty compiled bundles',async()=>withDist(async dir=>{
 const main=join(dir,'main.cjs');
 await writeFile(main,'');
 await assert.rejects(verifyProductionBundles(dir),/bundle|empty|invalid|unsafe/i);
 await writeFile(main,'console.log("ok")');
 await rm(join(dir,'preload.cjs'));
 await assert.rejects(verifyProductionBundles(dir),/ENOENT|missing|bundle/i);
}));

test('esbuild metafile importer guard blocks test harnesses from all production graphs',()=>{
 const safe={
  inputs:{
   'apps/desktop/src/main/index.ts':{bytes:100,imports:[]},
   'packages/cdp-client/src/index.ts':{bytes:100,imports:[]},
  },
 };
 assert.doesNotThrow(()=>assertProductionModuleGraph(safe,'main'));
 for(const forbidden of [
  'scripts/local-fixture-behavior.ts',
  'scripts/local-fixture-interaction.ts',
  'scripts/synthetic-functional-lifecycle.ts',
  'tests/integration/synthetic-functional-lifecycle.test.ts',
  'apps/desktop/tests/security.test.ts',
 ]){
  assert.throws(()=>assertProductionModuleGraph({
   inputs:{...safe.inputs,[forbidden]:{bytes:100,imports:[]}},
  },'renderer'),/test-only|forbidden|production|build/i,forbidden);
 }
});

test('development CI must independently inspect compiled artifacts, not only source text',async()=>{
 const {readFile}=await import('node:fs/promises');
 const build=await readFile(new URL('../../scripts/build.mjs',import.meta.url),'utf8');
 const ci=await readFile(new URL('../../.github/workflows/dev-ci.yml',import.meta.url),'utf8');
 assert.match(build,/assertProductionModuleGraph/);
 assert.match(build,/verifyProductionBundles/);
 assert.match(ci,/node scripts\/production-boundary\.mjs dist/);
});
