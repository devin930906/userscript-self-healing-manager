import {readdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildTestBatches,assertTestSourceBudget} from './test-batches.mjs';
async function collect(dir){const entries=await readdir(dir,{withFileTypes:true});
 const paths=[];for(const entry of entries){const path=resolve(dir,entry.name);if(entry.isDirectory()&&!['node_modules','dist','.worktrees','.git'].includes(entry.name))paths.push(...await collect(path));else if(entry.isFile()&&entry.name.endsWith('.test.ts'))paths.push(path);}return paths;}
const files=[...await collect('packages'),...await collect('apps'),...await collect('tests')];
if(files.length===0)throw Error('No test files discovered');
// Guard against accidental test file duplication before launching subprocesses.
// 128 KiB is well above the current largest legitimate test source.
const maxTestSourceBytes=128*1024;
for(const file of files){
 const info=await stat(file);
 try{assertTestSourceBudget({size:info.size,isFile:info.isFile()},maxTestSourceBytes);}
 catch{throw Error('Test source exceeds 128 KiB safety budget: '+file);}
}
console.log(`Running ${files.length} TypeScript test files`);
const batches=buildTestBatches(files);
let failed=false;
for(let i=0;i<batches.length;i++){
 const batch=batches[i];
 console.log(`Test batch ${i+1}/${batches.length} (${batch.length} test files)`);
 const result=spawnSync(process.execPath,['--experimental-strip-types','--test',...batch],{stdio:'inherit'});
 if(result.error){
  // Never discard a test batch when the subprocess cannot be spawned.
  console.error('Test batch subprocess could not start: '+(result.error.code??'unknown'));
  failed=true;
 }else if(result.status!==0){
  failed=true;
 }
}
if(failed)process.exitCode=1;
