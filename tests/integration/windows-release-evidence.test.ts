import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,readFile,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertFinalBuildIdentity} from '../../scripts/final-build-authorization.mjs';
import {verifyExtractedWindowsZip} from '../../scripts/windows-release-gate.mjs';

test('final tag authorization binds actual checked-out commit, Actions SHA and peeled tag',()=>{
 const sha='a'.repeat(40);
 assert.equal(assertFinalBuildIdentity({checkoutSha:sha,eventSha:sha,tagCommitSha:sha}),sha);
 for(const input of [
  {checkoutSha:sha,eventSha:'b'.repeat(40),tagCommitSha:sha},
  {checkoutSha:sha,eventSha:sha,tagCommitSha:'b'.repeat(40)},
  {checkoutSha:'not-a-sha',eventSha:sha,tagCommitSha:sha},
  {checkoutSha:sha,eventSha:sha,tagCommitSha:sha+'other'},
 ]) assert.throws(()=>assertFinalBuildIdentity(input),/SHA|commit|tag|checkout|identity/i);
});

async function fixture(root){
 for(const [file,bytes] of [
  ['Userscript-Self-Healing-Manager.exe','exe'],['resources/app.asar','asar'],
  ['locales/en-US.pak','locale'],['ffmpeg.dll','dll'],['chrome_100_percent.pak','pak'],
  ['.usshm-portable','zip-portable-v1'],
 ]){
  const path=join(root,file);
  await mkdir(join(path,'..'),{recursive:true});
  await writeFile(path,bytes);
 }
}
test('actual extracted complete ZIP and build directory agree byte-for-byte',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-edition-match-'));
 const source=join(root,'source'),extracted=join(root,'extracted');
 try{
  await mkdir(source);await mkdir(extracted);
  await fixture(source);await fixture(extracted);
  const proof=await verifyExtractedWindowsZip({sourceDirectory:source,extractedDirectory:extracted});
  assert.equal(proof.fileCount,6);
  assert.match(proof.appAsarSha256,/^[0-9a-f]{64}$/);
  await writeFile(join(extracted,'resources/app.asar'),'tampered');
  await assert.rejects(verifyExtractedWindowsZip({sourceDirectory:source,extractedDirectory:extracted}),/mismatch|hash|different/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('extracted ZIP verification rejects missing, extra, private Data and unsafe links',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-edition-unsafe-'));
 const source=join(root,'source'),extracted=join(root,'extracted');
 try{
  await mkdir(source);await mkdir(extracted);
  await fixture(source);await fixture(extracted);
  await rm(join(extracted,'locales/en-US.pak'));
  await assert.rejects(verifyExtractedWindowsZip({sourceDirectory:source,extractedDirectory:extracted}),/missing|mismatch|different/i);
  await writeFile(join(extracted,'locales/en-US.pak'),'locale');
  await mkdir(join(extracted,'Data'));
  await writeFile(join(extracted,'Data/registry.sqlite'),'private');
  await assert.rejects(verifyExtractedWindowsZip({sourceDirectory:source,extractedDirectory:extracted}),/Data|private|forbidden/i);
  await rm(join(extracted,'Data'),{recursive:true});
  await writeFile(join(extracted,'extra.bin'),'extra');
  await assert.rejects(verifyExtractedWindowsZip({sourceDirectory:source,extractedDirectory:extracted}),/extra|mismatch|different/i);
  await rm(join(extracted,'extra.bin'));
  await rm(join(extracted,'ffmpeg.dll'));
  await symlink(join(source,'ffmpeg.dll'),join(extracted,'ffmpeg.dll'));
  await assert.rejects(verifyExtractedWindowsZip({sourceDirectory:source,extractedDirectory:extracted}),/symbolic|link|unsafe/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Windows PR gate executes release unit tests only; installer job remains manual-tag only',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 assert.match(workflow,/pull_request:\s*\n\s*branches:\s*\[feat\/v01-continuation\]/);
 assert.match(workflow,/windows:\s*\n\s*if:\s*github\.event_name == 'workflow_dispatch'/);
 assert.match(workflow,/release-contracts:\s*\n\s*if:\s*github\.event_name == 'pull_request'/);
 assert.match(workflow,/--test tests\/integration\/windows-release-evidence\.test\.ts/);
 assert.match(workflow,/USSHM_BUILD_SHA:\s*\$\{\{ github\.sha \}\}/);
});

test('PowerShell fallback packager must authorize the real final tag before writing its ZIP',async()=>{
 const script=await readFile('scripts/package-windows.ps1','utf8');
 const auth=script.indexOf('final-build-authorization.mjs');
 const mutation=script.indexOf('Set-Content -NoNewline');
 assert.ok(auth>=0 && mutation>auth,'Standalone packager must invoke final tag guard before touching unpacked files');
 assert.match(script,/LASTEXITCODE/,'Nonzero authorization must stop PowerShell independently');
});
