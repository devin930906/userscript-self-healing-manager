/**
 * Development CI only. Launches the actual built Electron app without making
 * an installer. Uses disposable portable Data and Windows AppData/LocalAppData and a local CDP
 * page-list check to confirm that the React renderer opened.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {access,mkdir,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
if(process.platform!=='win32')throw new Error('Electron GUI smoke requires Windows runner');
const exe=resolve('node_modules','electron','dist','electron.exe');
await access(exe);
await access(resolve('dist','index.html'));
await access(resolve('dist','main.cjs'));
const root=await mkdtemp(join(tmpdir(),'usshm-electron-gui-'));
const roaming=join(root,'Roaming'),local=join(root,'Local');
let appProcess,stderr='';
try{
 await mkdir(roaming,{recursive:true});await mkdir(local,{recursive:true});
 const env={...process.env,APPDATA:roaming,LOCALAPPDATA:local,
  // Use the application's own explicitly portable data-root contract. Windows
  // Known Folder paths are not guaranteed to obey overridden APPDATA.
  PORTABLE_EXECUTABLE_DIR:root};
 delete env.ELECTRON_RUN_AS_NODE;
 // This is the installed Electron executable shipped with npm dependencies,
 // never a preview installer. CDP is exclusively bound to loopback.
 appProcess=spawn(exe,['.','--remote-debugging-port=9224',
  '--remote-debugging-address=127.0.0.1','--disable-gpu'],
  {cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','ignore','pipe']});
 let launchError=null,exitStatus=null;
 appProcess.on('error',error=>{launchError=error;});
 appProcess.on('exit',(code,signal)=>{exitStatus={code,signal};});
 appProcess.stderr?.on('data',data=>{stderr=(stderr+String(data)).slice(-2500);});
 async function hasSqliteDataRoot(dir,depth=0){
  if(depth>5)return false;
  const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]);
  for(const e of entries){
   if(e.name==='registry.sqlite'&&e.isFile())return true;
   if(e.isDirectory()&&await hasSqliteDataRoot(join(dir,e.name),depth+1))return true;
  }
  return false;
 }
 let seenDb=false,seenRenderer=false;
 for(let i=0;i<80;i++){
  if(launchError)throw launchError;
  if(exitStatus)throw new Error('Electron quit before GUI verification: '+JSON.stringify(exitStatus));
  if(!seenDb)seenDb=await hasSqliteDataRoot(join(root,'Data'));
  if(!seenRenderer)try{
   const response=await fetch('http://127.0.0.1:9224/json/list',{signal:AbortSignal.timeout(700)});
   if(response.ok){
    const pages=await response.json();
    seenRenderer=Array.isArray(pages)&&pages.some(p=>
     p?.type==='page'&&typeof p.url==='string'&&
     p.url.startsWith('file://')&&p.url.replaceAll('\\','/').endsWith('/dist/index.html'));
   }
  }catch{/* The Electron CDP socket can start after the main process. */}
  if(seenDb&&seenRenderer)break;
  await sleep(250);
 }
 assert.ok(seenDb,'Electron did not initialize portable Data/registry.sqlite');
 assert.ok(seenRenderer,'Electron did not open the packaged React renderer file://dist/index.html');
 console.log('PASS real Windows Electron: isolated portable Data/registry.sqlite and live file:// renderer loaded (no installers).');
}catch(error){
 console.error('FAIL Electron dev startup:',error,stderr);
 process.exitCode=1;
}finally{
 if(appProcess?.pid)
  spawnSync('taskkill',['/PID',String(appProcess.pid),'/T','/F'],{stdio:'ignore',timeout:15000});
 await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
