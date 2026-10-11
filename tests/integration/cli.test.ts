import assert from 'node:assert/strict';import {test} from 'node:test';import {spawnSync} from 'node:child_process';import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('diagnose CLI generates a parseable static-only report without changing userscript',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-cli-'));try{
 const target=join(dir,'x.user.js');const file=join(dir,'report.json');const script='const x = document.querySelector("#x")';await writeFile(target,script);
 const cmd=spawnSync(process.execPath,['--experimental-strip-types','scripts/diagnose.ts','--output',file,target],{encoding:'utf8'});
 assert.equal(cmd.status,0,cmd.stderr);const r=JSON.parse(await readFile(file,'utf8'));assert.equal(r.items[0].selectorCount,1);assert.equal(r.scanMode,'static-only');assert.equal(await readFile(target,'utf8'),script);
 }finally{await rm(dir,{recursive:true,force:true});}
});
