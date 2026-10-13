import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,rm,symlink,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {writeExclusiveReport} from '../src/exclusive-report.ts';

/** Synthetic directories only: never use a real export folder or user profile. */
async function redirectedReportDirectory(
 t:TestContext,kind:'leaf'|'ancestor',
 run:(destination:string,physical:string)=>Promise<void>,
):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'usshm-report-ancestor-'));
 try{
  const physical=join(root,'physical');
  const parent=kind==='leaf'?physical:join(physical,'reports');
  await mkdir(parent,{recursive:true});
  await writeFile(join(parent,'preserve.txt'),'never overwrite');
  const alias=join(root,'linked');
  try{await symlink(kind==='leaf'?physical:physical,alias,
   process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('Directory symlinks or Junctions unavailable');
    return;
   }
   throw error;
  }
  const destination=kind==='leaf'?join(alias,'report.md'):join(alias,'reports','report.json');
  await run(destination,parent);
 }finally{await rm(root,{recursive:true,force:true});}
}

for(const kind of ['leaf','ancestor'] as const){
 test('RG-07 exclusive report refuses '+kind+' symlink/Junction before any stage is created',async t=>
  redirectedReportDirectory(t,kind,async(destination,physical)=>{
   await assert.rejects(
    writeExclusiveReport({destinationPath:destination,content:'SYNTHETIC REPORT ONLY\\n'}),
    /unsafe|symlink|junction|ancestor/i,
    'destination aliases must not redirect an approved report outside its directory');
   assert.deepEqual(await readdir(physical),['preserve.txt'],
    'no stage or report may be published in the redirected directory');
   assert.equal(await readFile(join(physical,'preserve.txt'),'utf8'),'never overwrite');
  }),
 );
}
