import {spawn,type ChildProcess} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {lstat} from 'node:fs/promises';

export interface ChromeTarget {type:string;id:string;url:string;webSocketDebuggerUrl?:string|undefined}
export interface ChromeStatus {browser:string;protocolVersion:string|null;pages:ChromeTarget[];browserSocket:string|null}
export function buildChromeLaunchArgs(port=9223):string[]{
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid CDP port');
 return [`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'];
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
    if(ws){const parsed=new URL(ws);if(parsed.protocol!=='ws:'||!['localhost','127.0.0.1'].includes(parsed.hostname))throw new Error('CDP page socket not local');}
    pages.push({type:'page',id:t.id,url:t.url,webSocketDebuggerUrl:ws});
   }
  }
  const browserSocket=typeof info.webSocketDebuggerUrl==='string'?info.webSocketDebuggerUrl:null;
  if(browserSocket){const parsed=new URL(browserSocket);if(parsed.protocol!=='ws:'||!['localhost','127.0.0.1'].includes(parsed.hostname))throw new Error('CDP browser socket not local');}
  return {browser:info.Browser,protocolVersion:typeof info['Protocol-Version']==='string'?info['Protocol-Version']:null,pages,browserSocket};
 }finally{clearTimeout(timeout);}
}
export async function launchSelectedChrome({executablePath,port=9223}:{executablePath:string;port?:number}):Promise<ChildProcess>{
 validPort(port);if(!isAbsolute(executablePath))throw new Error('Chrome executable path must be absolute');
 const item=await lstat(executablePath);if(!item.isFile())throw new Error('Selected Chrome path is not a file');
 // Chrome >=136 may ignore debugging switches for its default profile: verify getChromeStatus after launch.
 const child=spawn(executablePath,buildChromeLaunchArgs(port),{detached:false,stdio:'ignore',windowsHide:false});
 return child;
}
