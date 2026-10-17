import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
 downloadPinnedZip,VIOLENTMONKEY_RELEASE_URL,VIOLENTMONKEY_RELEASE_SHA256,
} from '../../scripts/download-violentmonkey-release.mjs';
import {VIOLENTMONKEY_CFT_RELEASE} from '../../scripts/violentmonkey-v4-contract.ts';

const digest=(value: string|Buffer)=>createHash('sha256').update(value).digest('hex');
const isolated=async(t: import('node:test').TestContext)=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-pinned-download-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return join(dir,'official.zip');
};
const response=(bytes:Buffer|null,status=200)=>
 new Response(status===200?bytes:null,{status});

test('500 then 502 then official bytes: only the fully pinned download is exposed',async(t)=>{
 const destination=await isolated(t),payload=Buffer.from('exact verified official fixture bytes');
 const statuses=[500,502,200],waits:number[]=[],urls:string[]=[];
 const result=await downloadPinnedZip({url:'https://github.com/fixed/archive.zip',
  expectedSha256:digest(payload),destination,
  fetchImpl:async(url:string)=>{urls.push(url);return response(payload,statuses.shift());},
  delay:async(ms:number)=>{waits.push(ms);}});
 assert.equal(urls.length,3);
 assert.deepEqual(waits,[500,1000]);
 assert.deepEqual(await readFile(destination),payload);
 assert.equal(result.sha256,digest(payload));
 assert.equal(result.attempts,3);
});

test('wrong SHA-256 is fatal, cannot retry or publish an archive',async(t)=>{
 const destination=await isolated(t);let attempts=0;
 await assert.rejects(downloadPinnedZip({url:'https://github.com/fixed/archive.zip',
  expectedSha256:digest('correct'),destination,
  fetchImpl:async()=>{attempts++;return response(Buffer.from('tampered'));},
  delay:async()=>{}}),/sha-256|digest|integrity/i);
 assert.equal(attempts,1);
 await assert.rejects(stat(destination),{code:'ENOENT'});
 assert.deepEqual(await readdir(join(destination,'..')),[]);
});

test('permanent HTTP 404 never retries or produces a falsely successful artifact',async(t)=>{
 const destination=await isolated(t);let attempts=0;
 await assert.rejects(downloadPinnedZip({url:'https://github.com/fixed/archive.zip',
  expectedSha256:digest('fixture'),destination,
  fetchImpl:async()=>{attempts++;return response(null,404);},
  delay:async()=>{}}),/404/);
 assert.equal(attempts,1);
 await assert.rejects(stat(destination),{code:'ENOENT'});
});

test('transient HTTP 503 fails closed after exactly three bounded requests',async(t)=>{
 const destination=await isolated(t);let attempts=0;const waits:number[]=[];
 await assert.rejects(downloadPinnedZip({url:'https://github.com/fixed/archive.zip',
  expectedSha256:digest('fixture'),destination,
  fetchImpl:async()=>{attempts++;return response(null,503);},
  delay:async(ms:number)=>{waits.push(ms);}}),/503/);
 assert.equal(attempts,3);
 assert.deepEqual(waits,[500,1000]);
 await assert.rejects(stat(destination),{code:'ENOENT'});
});

test('oversized response fails before publication and does not retry',async(t)=>{
 const destination=await isolated(t);let attempts=0;
 await assert.rejects(downloadPinnedZip({url:'https://github.com/fixed/archive.zip',
  expectedSha256:digest('0123456789'),destination,maxBytes:5,
  fetchImpl:async()=>{attempts++;return response(Buffer.from('0123456789'));},
  delay:async()=>{}}),/limit|size|large/i);
 assert.equal(attempts,1);
 await assert.rejects(stat(destination),{code:'ENOENT'});
 assert.deepEqual(await readdir(join(destination,'..')),[]);
});

test('a pre-existing CI archive is preserved and never overwritten',async(t)=>{
 const destination=await isolated(t);await writeFile(destination,'retain');let attempts=0;
 await assert.rejects(downloadPinnedZip({url:'https://github.com/fixed/archive.zip',
  expectedSha256:digest('fixture'),destination,
  fetchImpl:async()=>{attempts++;return response(Buffer.from('fixture'));},
  delay:async()=>{}}),/exist|destination/i);
 assert.equal(attempts,0);
 assert.equal(await readFile(destination,'utf8'),'retain');
});

test('official fixed URL and SHA match the manager contract and workflow invokes verified helper',async()=>{
 const workflow=await readFile('.github/workflows/stable-rg05-gate.yml','utf8');
 assert.equal(VIOLENTMONKEY_RELEASE_SHA256,VIOLENTMONKEY_CFT_RELEASE.archiveSha256);
 assert.match(VIOLENTMONKEY_RELEASE_URL,/violentmonkey\/violentmonkey\/releases\/download\/v2\.49\.0\/Violentmonkey-mv3-v2\.49\.0\.zip/);
 assert.match(workflow,/node scripts\/download-violentmonkey-release\.mjs \$archive/);
 assert.match(workflow,new RegExp(VIOLENTMONKEY_RELEASE_SHA256));
 assert.doesNotMatch(workflow,/Invoke-WebRequest -Uri 'https:\/\/github\.com\/violentmonkey/);
 // Download integrity, SHA verification and real GM acceptance must never be
 // suppressed in the dedicated fail-closed Stable RG-05 workflow.
 const fetch=workflow.indexOf('name: Fetch pinned official Violentmonkey 2.49.0 MV3 release');
 const official=workflow.indexOf('name: Real Violentmonkey 2.49.0 GM API integration');
 assert.ok(fetch>=0&&official>fetch,'pinned official download must precede GM smoke');
 assert.doesNotMatch(workflow.slice(fetch,official),/continue-on-error:\s*true/,
  'a pinned manager archive failure must block release integrity acceptance');
});
