import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
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
  async function getJson(path:string,maxBytes:number):Promise<unknown>{
   const r=await fetch(url+path,{signal:controller.signal,cache:'no-store',redirect:'error'});
   if(!r.ok)throw new Error(`CDP responded ${r.status} for ${path}`);
   const reported=r.headers.get('content-length');
   if(reported!==null&&Number(reported)>maxBytes)
    throw new Error('CDP discovery JSON response size limit exceeded');
   if(!r.body)throw new Error('CDP discovery response has no body');
   const reader=r.body.getReader();
   const decoder=new TextDecoder('utf-8',{fatal:true});
   const fragments:string[]=[];
   let size=0;
   try{
    while(true){
     const part=await reader.read();
     if(part.done)break;
     size+=part.value.byteLength;
     if(size>maxBytes)throw new Error('CDP discovery JSON response size limit exceeded');
     fragments.push(decoder.decode(part.value,{stream:true}));
    }
    fragments.push(decoder.decode());
   }catch(error){
    try{await reader.cancel();}catch{}
    throw error;
   }finally{reader.releaseLock();}
   try{return JSON.parse(fragments.join(''));}
   catch{throw new Error('Invalid CDP discovery JSON document');}
  }
  // The localhost debugger is still a network peer: never parse an unbounded
  // /json/list response or let a huge target catalog hang the renderer.
  const info=await getJson('/json/version',64_000) as Record<string,unknown>;
  const list=await getJson('/json/list',1_000_000);
  if(typeof info.Browser!=='string'||info.Browser.length>128||!Array.isArray(list))
   throw new Error('Invalid Chrome CDP version or target response');
  if(list.length>256)throw new Error('CDP target list limit exceeded');
  const pages:ChromeTarget[]=[];
  for(const entry of list){if(!entry||typeof entry!=='object')continue;
   const t=entry as Record<string,unknown>;
   if(t.type==='page'&&typeof t.id==='string'&&t.id.length>0&&t.id.length<=128&&
      typeof t.url==='string'&&t.url.length>0&&t.url.length<=8192){
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
/**
 * Fail before spawning when an existing process owns the requested loopback
 * debugger port. A successful bind is a best-effort preflight, not proof of
 * Chrome ownership; the post-spawn CDP handshake is mandatory as well.
 */
export async function assertChromeDebuggerPortFree(port:number):Promise<void>{
 validPort(port);
 const server=createServer();
 let bound=false;
 try{
  await new Promise<void>((resolve,reject)=>{
   server.once('error',reject);
   server.listen({port,host:'127.0.0.1',exclusive:true},()=>{
    server.removeAllListeners('error');
    bound=true;
    resolve();
   });
  });
 }catch{
  throw new Error('Chrome CDP port '+port+' already in use or unavailable on 127.0.0.1');
 }finally{
  if(bound)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 }
}

/** Only a live, authenticated Chrome debugger proves startup. A child-process
 * "spawn" event alone does not: Chrome 136+ can ignore the remote debugging
 * flags for an existing/default profile.
 */
export async function waitForChromeDebugger({
 port,timeoutMs=15000,pollMs=350,inspect=getChromeStatus,
 delay=async(ms:number)=>{await new Promise<void>(resolve=>setTimeout(resolve,ms));},
 hasExited=()=>false,
}:{
 port:number;timeoutMs?:number;pollMs?:number;
 inspect?:(input:{port:number})=>Promise<ChromeStatus>;
 delay?:(ms:number)=>Promise<void>;
 hasExited?:()=>boolean;
}):Promise<ChromeStatus>{
 validPort(port);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<25||timeoutMs>30000||
    !Number.isSafeInteger(pollMs)||pollMs<1||pollMs>5000)
  throw new Error('Invalid Chrome CDP handshake timeout');
 const deadline=Date.now()+timeoutMs;
 let lastError='CDP debugger not ready';
 while(true){
  if(hasExited())throw new Error('Selected Chrome exited before a verified CDP handshake');
  try{
   const status=await inspect({port});
   if(status&&/^(?:Chrome|Chromium|HeadlessChrome)\//.test(status.browser)&&
      typeof status.browserSocket==='string'&&
      validateCdpBrowserSocket(status.browserSocket,port)===status.browserSocket)
    return status;
   lastError='Invalid Chrome browser identity or browser debugger socket';
  }catch(error){
   lastError=error instanceof Error?error.message.slice(0,180):'CDP debugger probe failed';
  }
  if(hasExited())throw new Error('Selected Chrome exited before a verified CDP handshake');
  const remaining=deadline-Date.now();
  if(remaining<=0)break;
  await delay(Math.min(remaining,pollMs));
 }
 throw new Error('Chrome CDP handshake not verified on localhost port '+port+
  '. Chrome may ignore debugging with the default profile; use isolated debugging Chrome. Last check: '+lastError);
}

export async function launchSelectedChrome({executablePath,port=9223,isolatedProfileDir}:{executablePath:string;port?:number;isolatedProfileDir?:string|undefined}):Promise<ChildProcess>{
 validPort(port);if(!isAbsolute(executablePath))throw new Error('Chrome executable path must be absolute');
 const item=await lstat(executablePath);if(!item.isFile())throw new Error('Selected Chrome path is not a file');
 // Do not mistake a pre-existing debugger (or another loopback service) for
 // the newly requested Chrome process.
 await assertChromeDebuggerPortFree(port);
 if(isolatedProfileDir!==undefined)await ensureWritableDataRoot(isolatedProfileDir);
 const child=spawn(executablePath,buildChromeLaunchArgs(port,{isolatedProfileDir}),{detached:false,stdio:'ignore',windowsHide:false});
 // Keep a permanent error listener so a delayed spawn/process error cannot
 // crash Electron; the handshake also checks whether the child has exited.
 let processError:Error|null=null;
 child.on('error',error=>{processError=error;});
 await new Promise<void>((resolve,reject)=>{
  const failed=(error:Error)=>{child.off('spawn',started);reject(error);};
  const started=()=>{child.off('error',failed);resolve();};
  child.once('spawn',started);
  child.once('error',failed);
 });
 await waitForChromeDebugger({port,hasExited:()=>
  processError!==null||child.exitCode!==null||child.signalCode!==null});
 return child;
}
