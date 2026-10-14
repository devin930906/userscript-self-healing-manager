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

test('PowerShell fallback validates the created ZIP and all three artifacts before reporting success',async()=>{
 const script=await readFile('scripts/package-windows.ps1','utf8');
 const created=script.indexOf('ZipFile]::CreateFromDirectory');
 const gate=script.indexOf("'windows-release-gate.mjs'");
 const success=script.indexOf("Write-Host 'Generated");
 assert.ok(created>=0&&gate>created&&success>gate,
  'Standalone fallback must invoke the actual Windows ZIP/privacy/SHA gate after ZIP creation');
 assert.match(script,/&\s+node\s+\(Join-Path\s+\$PSScriptRoot\s+'windows-release-gate\.mjs'\)\s+\$version\s+\$releaseDir/,
  'The fallback must validate the same release directory and package version');
 assert.match(script.slice(gate,success),/if\s*\(\s*\$LASTEXITCODE\s*-ne\s*0\s*\)\s*\{\s*throw/i,
  'A failed inventory/ZIP/privacy/SHA check must stop the fallback');
 assert.doesNotMatch(script.slice(created,gate),/\|\s*Set-Content\s+-Path\s+\$manifest/,
  'No checksum manifest should be written before final release validation');
});

test('tag-only Setup smoke verifies isolated installed SQLite and never accepts portable Data',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check NSIS Setup installer');
 const end=workflow.indexOf('Record signatures and explicitly unverified Stable gates');
 assert.ok(start>=0&&end>start,'Setup smoke must precede release evidence recording');
 const smoke=workflow.slice(start,end);
 assert.match(smoke,/RUNNER_TEMP.*usshm-installed-appdata-smoke/);
 assert.match(smoke,/\$env:APPDATA = \$isolatedAppData/);
 assert.match(smoke,/Get-ChildItem.*registry\.sqlite.*-Recurse.*-File/);
 assert.match(smoke,/\$databases\.Count -eq 1/);
 assert.match(smoke,/\$databases\[0\]\.Length -gt 0/);
 assert.match(smoke,/\$env:APPDATA = \$previousAppData/);
 assert.match(smoke,/unexpectedly created portable Data beside EXE/);
});

test('tag-only NSIS uninstall smoke must remove executable but retain installed user registry',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check NSIS Setup installer');
 const end=workflow.indexOf('Record signatures and explicitly unverified Stable gates');
 assert.ok(start>=0&&end>start);
 const smoke=workflow.slice(start,end);
 assert.match(smoke,/\$installedRegistry = \$databases\[0\]\.FullName/);
 assert.match(smoke,/if \(!\$uninstallCleared\)/);
 assert.match(smoke,/if \(!\(Test-Path -LiteralPath \$installed\)\) \{ \$uninstallCleared = \$true; break \}/);
 assert.match(smoke,/if \(!\(Test-Path -LiteralPath \$installedRegistry\)\)/);
 assert.match(smoke,/registryHashBeforeUninstall = \(Get-FileHash/);
 assert.match(smoke,/registryHashAfterUninstall = \(Get-FileHash/);
 assert.match(smoke,/registryHashAfterUninstall -ne \$registryHashBeforeUninstall/);
 assert.match(smoke,/diagnosis-journal\.sqlite/);
 assert.match(smoke,/journalHashBeforeUninstall/);
 assert.match(smoke,/journalHashAfterUninstall -ne \$journalHashBeforeUninstall/);
 assert.match(smoke,/uninstall removed application and retained user SQLite data/);
});

test('tag-only Portable EXE smoke requires a live process and a nonempty SQLite registry',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check single-file Portable EXE');
 const end=workflow.indexOf('Smoke-check NSIS Setup installer');
 assert.ok(start>=0&&end>start);
 const smoke=workflow.slice(start,end);
 assert.match(smoke,/\$proc\.HasExited/);
 assert.match(smoke,/Get-Item -LiteralPath \$db/);
 assert.match(smoke,/\.Length -gt 0/);
 assert.match(smoke,/Portable EXE exited before database initialization/);
});

test('tag-only unpacked ZIP smoke rejects early process exit and empty SQLite',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check unpacked Windows executable');
 const end=workflow.indexOf('Smoke-check single-file Portable EXE');
 assert.ok(start>=0&&end>start);
 const smoke=workflow.slice(start,end);
 assert.match(smoke,/\$proc\.HasExited/);
 assert.match(smoke,/Get-Item -LiteralPath \$database/);
 assert.match(smoke,/\.Length -gt 0/);
});

test('tag-only ZIP and Portable EXE smokes require diagnosis history database',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const zip=workflow.slice(workflow.indexOf('Smoke-check unpacked Windows executable'),workflow.indexOf('Smoke-check single-file Portable EXE'));
 const portable=workflow.slice(workflow.indexOf('Smoke-check single-file Portable EXE'),workflow.indexOf('Smoke-check NSIS Setup installer'));
 for(const smoke of [zip,portable]){
  assert.match(smoke,/Data\/diagnosis-journal\.sqlite/);
  assert.match(smoke,/Get-Item -LiteralPath \$journal/);
  assert.match(smoke,/\$journalReady = \$false/);
  assert.match(smoke,/if \(\$proc\.HasExited\)/);
  assert.match(smoke,/\$journalReady = \$true; break/);
  assert.match(smoke,/\.Length -gt 0/);
 }
});

test('tag-only Portable EXE smoke refuses stale user Data before launch',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check single-file Portable EXE');
 const end=workflow.indexOf('Smoke-check NSIS Setup installer');
 assert.ok(start>=0&&end>start);
 const smoke=workflow.slice(start,end);
 assert.match(smoke,/if \(Test-Path -LiteralPath \$root\)/);
 assert.match(smoke,/requires a fresh directory without prior Data/);
 assert.doesNotMatch(smoke,/New-Item -Path \$root -ItemType Directory -Force/);
});

test('tag-only NSIS Setup smoke refuses a stale install destination',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check NSIS Setup installer');
 const end=workflow.indexOf('Record signatures and explicitly unverified Stable gates');
 assert.ok(start>=0&&end>start);
 const smoke=workflow.slice(start,end);
 const fresh=smoke.indexOf('Setup smoke requires a fresh install destination');
 const install=smoke.indexOf('Start-Process -FilePath $installer.FullName');
 assert.ok(fresh>=0&&install>fresh,'Stale directory must be rejected before invoking Setup');
 assert.match(smoke,/if \(Test-Path -LiteralPath \$root\)/);
});

test('tag-only extracted ZIP startup refuses prepopulated Data before launching',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check unpacked Windows executable');
 const end=workflow.indexOf('Smoke-check single-file Portable EXE');
 assert.ok(start>=0&&end>start);
 const smoke=workflow.slice(start,end);
 const guard=smoke.indexOf('ZIP smoke found pre-existing Data in extracted release');
 const launch=smoke.indexOf('Start-Process -FilePath $exe');
 assert.ok(guard>=0&&launch>guard,'Reject pre-existing ZIP Data before launching');
 assert.match(smoke,/Test-Path -LiteralPath \(Join-Path \$root 'Data'\)/);
});

test('installed release smoke terminates its process before data hashes and always restores APPDATA',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const block=workflow.slice(workflow.indexOf('Smoke-check NSIS Setup installer'),workflow.indexOf('Record signatures and explicitly unverified Stable gates'));
 const terminate=block.indexOf('Stop-Process -Id $running.Id -Force -ErrorAction Stop');
 const restore=block.indexOf('$env:APPDATA = $previousAppData');
 const hash=block.indexOf('registryHashBeforeUninstall');
 assert.ok(terminate>=0&&restore>terminate&&hash>restore);
 assert.match(block,/\$running\.WaitForExit\(10000\)/);
 assert.match(block,/if \(!\$running\.HasExited\)/);
});

test('installed Setup smoke waits for a nonempty diagnosis journal while process remains alive',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check NSIS Setup installer');
 const end=workflow.indexOf('Record signatures and explicitly unverified Stable gates');
 assert.ok(start>=0&&end>start);
 const block=workflow.slice(start,end);
 const journalStart=block.indexOf('$journalReady = $false');
 const shutdown=block.indexOf('Stop-Process -Id $running.Id');
 assert.ok(journalStart>=0&&shutdown>journalStart);
 assert.match(block,/if \(\$running\.HasExited\) \{ throw 'Installed EXE exited before diagnosis journal initialization'/);
 assert.match(block,/Get-Item -LiteralPath \$journalPath\)\.Length -gt 0/);
 assert.match(block,/if \(!\$journalReady\)/);
});

test('all three Windows release smokes reject immediate post-initialization process crashes',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const blocks=[
  workflow.slice(workflow.indexOf('Smoke-check unpacked Windows executable'),workflow.indexOf('Smoke-check single-file Portable EXE')),
  workflow.slice(workflow.indexOf('Smoke-check single-file Portable EXE'),workflow.indexOf('Smoke-check NSIS Setup installer')),
  workflow.slice(workflow.indexOf('Smoke-check NSIS Setup installer'),workflow.indexOf('Record signatures and explicitly unverified Stable gates')),
 ];
 for(const block of blocks){
  assert.match(block,/Start-Sleep -Seconds 3/);
  assert.match(block,/exited immediately after initializing databases/);
 }
});

test('ZIP and Portable smoke ensure test processes are fully stopped',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const blocks=[
  workflow.slice(workflow.indexOf('Smoke-check unpacked Windows executable'),workflow.indexOf('Smoke-check single-file Portable EXE')),
  workflow.slice(workflow.indexOf('Smoke-check single-file Portable EXE'),workflow.indexOf('Smoke-check NSIS Setup installer')),
 ];
 for(const block of blocks){
  assert.match(block,/Stop-Process -Id \$proc\.Id -Force -ErrorAction Stop/);
  assert.match(block,/\$proc\.WaitForExit\(10000\)/);
  assert.match(block,/if \(!\$proc\.HasExited\)/);
 }
});

test('tag-only NSIS uninstall waits briefly for installed executable removal',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Smoke-check NSIS Setup installer');
 const end=workflow.indexOf('Record signatures and explicitly unverified Stable gates');
 assert.ok(start>=0&&end>start);
 const block=workflow.slice(start,end);
 assert.match(block,/\$uninstallCleared = \$false/);
 assert.match(block,/if \(!\(Test-Path -LiteralPath \$installed\)\) \{ \$uninstallCleared = \$true; break \}/);
 assert.match(block,/if \(!\$uninstallCleared\)/);
});

test('final release checks SQLite header signatures for registry and journal of all three editions',async()=>{
 const workflow=await readFile('.github/workflows/windows-build.yml','utf8');
 const start=workflow.indexOf('Verify initialized SQLite file signatures across all Windows editions');
 const end=workflow.indexOf('Record signatures and explicitly unverified Stable gates');
 const setup=workflow.indexOf('Smoke-check NSIS Setup installer');
 assert.ok(start>setup&&end>start);
 const check=workflow.slice(start,end);
 assert.match(check,/usshm-verified-zip\/Data/);
 assert.match(check,/usshm-portable-exe-smoke\/Data/);
 assert.match(check,/usshm-installed-appdata-smoke/);
 assert.match(check,/\$installedData\.Count -ne 1/);
 assert.doesNotMatch(check,/Select-Object -First 1/);
 assert.match(check,/registry\.sqlite/);
 assert.match(check,/diagnosis-journal\.sqlite/);
 assert.match(check,/SQLite format 3/);
 assert.match(check,/\$header\[15\] -ne 0/);
 assert.match(check,/GetString\(\$header, 0, 15\)/);
 assert.match(check,/\$stream\.ReadExactly\(\$header, 0, 16\)/);
 assert.doesNotMatch(check,/\$stream\.Read\(\$header, 0, 16\)/);
 assert.match(check,/FileShare\]::Read\)/);
 assert.doesNotMatch(check,/FileShare\]::ReadWrite/);
 assert.match(check,/Invalid SQLite file signature/);
});
