import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {commitManagedCurrent} from '../../packages/repair-workflow/src/current-activation.ts';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/**
 * Separate Node processes, not merely two async operations sharing a Set.
 * The competing process must fail before the paused writer publishes.
 */
test('two native OS processes cannot overwrite the same managed current with stale approval',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-os-process-lock-'));
 const current=join(root,'current.user.js');
 try{
  const initial=Buffer.from('archived-original-revision');
  const winner=Buffer.from('approved-parent-revision');
  await writeFile(current,initial);
  const moduleUrl=new URL('../../packages/repair-workflow/src/current-activation.ts',import.meta.url).href;
  let attempted=false;
  await commitManagedCurrent({
   activePath:current,bytes:winner,expectedActiveHash:sha(initial),
   beforePublish:()=>new Promise<void>((resolve,reject)=>{
    // The parent holds an exclusive directory lease here. A second Node
    // process must receive the lock error, not silently replace current.
    const source=`import {commitManagedCurrent} from ${JSON.stringify(moduleUrl)};
try{await commitManagedCurrent({activePath:process.argv[1],
 bytes:Buffer.from('forbidden-child-revision'),expectedActiveHash:process.argv[2]});
 process.stdout.write('UNEXPECTED_CHILD_SUCCESS');}
catch(error){process.stderr.write(String(error));process.exitCode=37;}`;
    execFile(process.execPath,['--experimental-strip-types','--input-type=module','-e',source,current,sha(initial)],
     {timeout:15000,maxBuffer:64*1024},(error,stdout,stderr)=>{
      if(!error)return reject(new Error('The competing child illegally activated the stale revision: '+stdout));
      if(!/writer holds the filesystem lock|another managed current writer/i.test(stderr))
       return reject(new Error('Child failed for an unrelated reason: '+String(stderr).slice(0,400)));
      attempted=true;resolve();
     });
   }),
  });
  assert.equal(attempted,true);
  assert.deepEqual(await readFile(current),winner);
  assert.deepEqual(await readdir(root),['current.user.js'],'lease and private staging files must be removed');
 }finally{await rm(root,{recursive:true,force:true});}
});
