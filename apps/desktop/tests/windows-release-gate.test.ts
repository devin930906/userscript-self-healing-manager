import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateWindowsReleaseLayout} from '../../../scripts/windows-release-gate.mjs';
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
