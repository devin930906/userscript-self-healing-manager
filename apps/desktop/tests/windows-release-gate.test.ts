import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertStablePackageVersion,isWindowsX64Pe,validateWindowsReleaseLayout} from '../../../scripts/windows-release-gate.mjs';
const base='Userscript-Self-Healing-Manager';
const good={
 version:'1.0.0',
 artifactNames:[base+'-Setup-1.0.0-win-x64.exe',base+'-Portable-1.0.0-win-x64.exe',base+'-1.0.0-win-x64.zip'],
 zipEntries:[
  'Userscript-Self-Healing-Manager.exe',
  'resources/app.asar',
  'locales/en-US.pak',
  'ffmpeg.dll',
  'chrome_100_percent.pak',
  'icudtl.dat',
 ],
};
test('final Windows release inventory requires all three exact versioned x64 files and a full unpacked app ZIP',()=>{
 const result=validateWindowsReleaseLayout(good);
 assert.equal(result.version,'1.0.0');
 assert.equal(result.artifacts.length,3);
 assert.ok(result.artifacts.every(name=>name.includes('1.0.0')));
});
test('missing or duplicate artifact formats never qualify as stable release',()=>{
 for(const artifactNames of [
  good.artifactNames.slice(0,2),
  [good.artifactNames[0],good.artifactNames[1],good.artifactNames[1]],
  [good.artifactNames[0],good.artifactNames[1],base+'-0.9.0-win-x64.zip'],
  [...good.artifactNames,base+'-Extra-1.0.0-win-x64.zip'],
 ]){
  assert.throws(()=>validateWindowsReleaseLayout({...good,artifactNames}),/artifact|missing|duplicate|format|version|ZIP|release/i);
 }
});
test('ZIP must contain the unpacked Electron app, never only a Portable.exe wrapper',()=>{
 for(const zipEntries of [
  [base+'-Portable-1.0.0-win-x64.exe'],
  ['Userscript-Self-Healing-Manager.exe'],
  ['Userscript-Self-Healing-Manager.exe','resources/app.asar','locales/en-US.pak'],
  ['Userscript-Self-Healing-Manager.exe','resources/app.asar','ffmpeg.dll'],
 ]){
  assert.throws(()=>validateWindowsReleaseLayout({...good,zipEntries}),/ZIP|unpacked|resource|locales|DLL|pak|portable|content/i);
 }
});
test('ZIP must reject directory traversal, private data, userscripts and hidden key files',()=>{
 for(const entry of [
  '../outside.txt',
  '/absolute/evil',
  'C:/drive/evil',
  'Data/state.sqlite',
  'folder/Data/user-settings.json',
  'example.user.js',
  'resources/.env',
  'resources/api-key.txt',
  'bin\\..\\Data\\secret',
 ]){
  assert.throws(()=>validateWindowsReleaseLayout({...good,zipEntries:[...good.zipEntries,entry]}),
   /unsafe|private|data|user|script|path|secret|credential|forbidden/i,entry);
 }
});
test('release contract rejects invalid versions, suspicious archive entry counts and illegal archive types',()=>{
 for(const version of ['1.0.0/../evil','1.0.0;rm','v1.0.0','']){
  assert.throws(()=>validateWindowsReleaseLayout({...good,version}),/version/i);
 }
 assert.throws(()=>validateWindowsReleaseLayout({...good,zipEntries:[]}),/ZIP|archive|empty|content/i);
 assert.throws(()=>validateWindowsReleaseLayout({...good,zipEntries:[...good.zipEntries,'userscript-self-healing-manager-Portable-1.0.0-win-x64.exe']}),/portable|ZIP/i);
});

test('Windows ZIP inventory rejects NTFS alternate streams and reserved DOS device paths',()=>{
 for(const entry of [
  'resources/app.asar:evil',
  'resources/invalid<name.dll',
  'resources/invalid>name.dll',
  'resources/invalid"name.dll',
  'resources/invalid|name.dll',
  'resources/invalid?name.dll',
  'resources/invalid*name.dll',
  'resources/a.txt:private:$DATA',
  'CON',
  'NUL.txt',
  'resources/AUX.dll',
  'resources/LPT1.log',
  'resources/COM9.txt',
  'resources/COM¹.txt',
  'resources/ＣＯＮ.txt',
  'resources/COM１.txt',
  'resources/com²',
  'resources/LPT³.log',
  'folder/trailing.',
  'folder/trailing ',
  'Userscript-Self-Healing-Manager-Setup-1.0.0-win-x64.exe',
 ]){
  assert.throws(()=>validateWindowsReleaseLayout({...good,zipEntries:[...good.zipEntries,entry]}),
   /unsafe|private|device|windows|path|zip|forbidden|portable|installer|stream/i,entry);
 }
});

test('release ZIP forbids files masquerading as ancestor directories',()=>{
 for(const zipEntries of [
  [...good.zipEntries,'resources'],
  [...good.zipEntries,'locales'],
  [...good.zipEntries,'resources/sub','resources/sub/file.dll'],
 ]){
  assert.throws(()=>validateWindowsReleaseLayout({...good,zipEntries}),/collid|duplicate|path|ZIP/i);
 }
});

test('Windows release ZIP rejects bidirectional display spoofing and C1 control paths',()=>{
 for(const entry of [
  'resources/evil\u202Eexe.txt',
  'resources/\u2066spoof\u2069.dll',
  'resources/hidden\u0085name.dll',
 ]){
  assert.throws(()=>validateWindowsReleaseLayout({...good,zipEntries:[...good.zipEntries,entry]}),
   /unsafe|ZIP|path|name/i);
 }
});

test('large ZIP inventory remains bounded and detects a deep file-directory collision',()=>{
 const many=Array.from({length:12000},(_,i)=>'resources/generated/file-'+i+'.bin');
 const valid=validateWindowsReleaseLayout({...good,zipEntries:[...good.zipEntries,...many]});
 assert.equal(valid.zipEntryCount,good.zipEntries.length+many.length);
 assert.throws(()=>validateWindowsReleaseLayout({
  ...good,zipEntries:[...good.zipEntries,...many,'resources/generated'],
 }),/collid|path|ZIP/i);
});

test('Stable release inventory rejects prerelease and mismatched application versions',()=>{
 assert.equal(assertStablePackageVersion('1.0.0','1.0.0'),true);
 for(const appVersion of ['0.1.0-alpha.5','1.0.0-rc.1','1.0.1','v1.0.0','']){
  assert.throws(()=>assertStablePackageVersion('1.0.0',appVersion),/version|prerelease/i);
 }
});

test('Stable executable gate verifies PE signature and x64 architecture, not just MZ',()=>{
 const executable=Buffer.alloc(512);
 executable.writeUInt16LE(0x5a4d,0);
 executable.writeUInt32LE(0x80,0x3c);
 executable.writeUInt32LE(0x00004550,0x80);
 executable.writeUInt16LE(0x8664,0x84);
 executable.writeUInt16LE(0xf0,0x94);
 executable.writeUInt16LE(0x20b,0x98);
 assert.equal(isWindowsX64Pe(executable),true);
 const absentOptional=Buffer.from(executable);
 absentOptional.writeUInt16LE(0,0x94);
 assert.equal(isWindowsX64Pe(absentOptional),false);
 const pe32=Buffer.from(executable);
 pe32.writeUInt16LE(0x10b,0x98);
 assert.equal(isWindowsX64Pe(pe32),false);
 const x86=Buffer.from(executable);
 x86.writeUInt16LE(0x14c,0x84);
 assert.equal(isWindowsX64Pe(x86),false);
 const arm64=Buffer.from(executable);
 arm64.writeUInt16LE(0xaa64,0x84);
 assert.equal(isWindowsX64Pe(arm64),false);
 const mzOnly=Buffer.from(executable);
 mzOnly.fill(0,0x80,0x84);
 assert.equal(isWindowsX64Pe(mzOnly),false);
 const invalidOffset=Buffer.from(executable);
 invalidOffset.writeUInt32LE(0xffffffff,0x3c);
 assert.equal(isWindowsX64Pe(invalidOffset),false);
 assert.equal(isWindowsX64Pe(Buffer.from('MZ')),false);
 assert.equal(isWindowsX64Pe(executable.subarray(0,0x80+25)),false);
 assert.equal(isWindowsX64Pe(executable.subarray(0,0x80+26)),true);
});

test('final release gate creates a missing SHA256SUMS and preserves an existing equivalent manifest',async()=>{
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'usshm-final-manifest-'));
 const file=join(root,'SHA256SUMS.txt');
 const hashes=good.artifactNames.map((name,i)=>String(i+1).repeat(64)+'  '+name);
 try{
  const gate=await import('../../../scripts/windows-release-gate.mjs');
  const preserve=(gate as any).writeOrVerifyChecksumManifest;
  assert.equal(typeof preserve,'function','Stable release gate must safely verify existing manifests');
  assert.equal(await preserve(file,hashes),'created');
  assert.equal(await readFile(file,'utf8'),hashes.join('\n')+'\n');
  const equivalent='\ufeff'+[...hashes].reverse().join('\r\n')+'\r\n';
  await writeFile(file,equivalent);
  assert.equal(await preserve(file,hashes),'verified');
  assert.equal(await readFile(file,'utf8'),equivalent,'never overwrite an already valid signed checksum list');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('final release gate rejects tampered, duplicate and extra checksum entries without overwriting',async()=>{
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'usshm-manifest-tamper-'));
 const file=join(root,'SHA256SUMS.txt');
 const hashes=good.artifactNames.map((name,i)=>String(i+1).repeat(64)+'  '+name);
 try{
  const gate=await import('../../../scripts/windows-release-gate.mjs');
  const preserve=(gate as any).writeOrVerifyChecksumManifest;
  assert.equal(typeof preserve,'function','Stable release gate must verify existing manifests');
  for(const attack of [
   [hashes[0]!.replace(/^1{64}/,'f'.repeat(64)),hashes[1]!,hashes[2]!].join('\n')+'\n',
   [hashes[0]!,hashes[0]!,hashes[2]!].join('\n')+'\n',
   hashes.join('\n')+'\n'+'0'.repeat(64)+'  unexpected.exe\n',
   hashes.join('\n').replace('  ',' *')+'\n',
  ]){
   await writeFile(file,attack);
   await assert.rejects(preserve(file,hashes),/checksum|manifest|mismatch|unexpected|duplicate|invalid/i);
   assert.equal(await readFile(file,'utf8'),attack,'reject without overwriting manifest');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
