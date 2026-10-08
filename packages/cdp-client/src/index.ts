import {spawn,type ChildProcess} from 'node:child_process';
import {isAbsolute,win32} from 'node:path';
import {ensureWritableDataRoot} from '../../runtime-paths/src/index.ts';
import {lstat} from 'node:fs/promises';
import {validateCdpPageSocket,validateCdpBrowserSocket} from './endpoint.ts';

export interface ChromeTarget {type:string;id:string;url:string;webSocketDebuggerUrl?:string|undefined}
export interface ChromeStatus {browser:string;protocolVersion:string|null;pages:ChromeTarget[];browserSocket:string|null}
export function buildChromeLaunchArgs(port=9223,options:{isolatedProfileDir?:string|undefined}={}):string[]{
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid CDP port');
 const flags=[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'];
 if(options.isolatedProfileDir!==undefined){
  if(!options.isolatedProfileDir||!(isAbsolute(options.isolatedProfileDir)||win32.isAbsolute(options.isolatedProfileDir)))
   throw new Error('Isolated Chrome profile directory must be absolute');
  flags.push('--user-data-dir='+options.isolatedProfileDir);
 }
 return flags;
}
function validPort(value:number){if(!Number.isInteger(value)||value<1024||value>65535)throw new Error('Invalid CDP port');}
export async function getChromeStatus({port=9223,host='127.0.0.1'}:{port?:number;host?:string}={}):Promise<ChromeStatus>{
 validPort(port);if(host!=='127.0.0.1'&&host!=='localhost')throw new Error('CDP connections are localhost only');
 const url=`http://127.0.0.1:${port}`;
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),3500);
 try {
  async function getJson(path:string):Promise<unknown>{const r=await fetch(url+path,{signal:controller.signal,cache:'no-store',redirect:'error'});if(!r.ok)throw new Error(`CDP responded ${r.status} for ${path}`);return r.json();}
  const info=await getJson('/json/version') as Record<string,unknown>;
  const list=await getJson('/json/list');
  if(typeof info.Browser!=='string'||!Array.isArray(list))throw new Error('Invalid Chrome CDP version or target response');
  const pages:ChromeTarget[]=[];
  for(const entry of list){if(!entry||typeof entry!=='object')continue;
   const t=entry as Record<string,unknown>;
   if(t.type==='page'&&typeof t.id==='string'&&typeof t.url==='string'){
    const ws=typeof t.webSocketDebuggerUrl==='string'?t.webSocketDebuggerUrl:undefined;
    if(ws)validateCdpPageSocket({id:t.id,webSocketDebuggerUrl:ws},port);
    pages.push({type:'page',id:t.id,url:t.url,webSocketDebuggerUrl:ws});
   }
  }
  const browserSocket=typeof info.webSocketDebuggerUrl==='string'?info.webSocketDebuggerUrl:null;
  if(browserSocket)validateCdpBrowserSocket(browserSocket,port);
  return {browser:info.Browser,protocolVersion:typeof info['Protocol-Version']==='string'?info['Protocol-Version']:null,pages,browserSocket};
 }finally{clearTimeout(timeout);}
}
export async function launchSelectedChrome({executablePath,port=9223,isolatedProfileDir}:{executablePath:string;port?:number;isolatedProfileDir?:string|undefined}):Promise<ChildProcess>{
 validPort(port);if(!isAbsolute(executablePath))throw new Error('Chrome executable path must be absolute');
 const item=await lstat(executablePath);if(!item.isFile())throw new Error('Selected Chrome path is not a file');
 // Chrome >=136 may ignore debugging switches for its default profile: verify getChromeStatus after launch.
 if(isolatedProfileDir!==undefined)await ensureWritableDataRoot(isolatedProfileDir);
 const child=spawn(executablePath,buildChromeLaunchArgs(port,{isolatedProfileDir}),{detached:false,stdio:'ignore',windowsHide:false});
 return child;
}
