import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {isAbsolute,win32} from 'node:path';
import {ensureWritableDataRoot} from '../../runtime-paths/src/index.ts';
import {lstat} from 'node:fs/promises';
import {validateCdpPageSocket,validateCdpBrowserSocket} from './endpoint.ts';
import type {SocketLike} from './snapshot.ts';

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

/**
 * Prove that the advertised browser WebSocket actually handles a read-only
 * CDP Browser.getVersion command; /json/version alone is not a WebSocket
 * handshake. Never expose user-agent, page source or arbitrary CDP commands.
 */
export async function verifyBrowserCdpHandshake({
 endpoint,port=9223,socketFactory,timeoutMs=4000,
}:{
 endpoint:string;port?:number;socketFactory?:(url:string)=>SocketLike;timeoutMs?:number;
}):Promise<string>{
 const trusted=validateCdpBrowserSocket(endpoint,port);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)
  throw new Error('Invalid CDP browser handshake timeout');
 const socket=(socketFactory??((url:string)=>new WebSocket(url) as unknown as SocketLike))(trusted);
 return await new Promise<string>((resolve,reject)=>{
  let finished=false;
  const finish=(error?:Error,product?:string)=>{
   if(finished)return;
   finished=true;clearTimeout(timer);
   for(const [event,listener] of handlers)socket.removeEventListener(event,listener);
   try{socket.close();}catch{}
   if(error)reject(error);
   else if(product)resolve(product);
   else reject(new Error('CDP browser handshake did not confirm a Chrome product'));
  };
  const onOpen=()=>{try{socket.send(JSON.stringify({id:1,method:'Browser.getVersion'}));}
   catch{finish(new Error('CDP browser handshake could not send Browser.getVersion'));}};
  const onMessage=(event:{data:unknown})=>{
   try{
    if(typeof event.data!=='string'||event.data.length>64000)
     throw new Error('Invalid CDP browser handshake response size');
    const response=JSON.parse(event.data);
    if(response.id!==1)return;
    if(response.error)throw new Error('CDP browser handshake command rejected');
    const product=response.result?.product;
    if(typeof product!=='string'||product.length>128||
       !/^(?:Chrome|Chromium|HeadlessChrome)\/[0-9]+(?:\.[0-9]+)*$/.test(product))
     throw new Error('Invalid CDP browser product/version response');
    finish(undefined,product);
   }catch(error){
    finish(error instanceof Error?error:new Error('Invalid CDP browser handshake response'));
   }
  };
  const onError=()=>finish(new Error('CDP browser handshake socket error'));
  const onClose=()=>finish(new Error('CDP browser handshake socket closed'));
  const handlers:Array<['open'|'message'|'error'|'close',(event:any)=>void]>=[
   ['open',onOpen],['message',onMessage],['error',onError],['close',onClose],
  ];
  const timer=setTimeout(()=>finish(new Error('CDP browser handshake timeout')),timeoutMs);
  for(const [event,listener] of handlers)socket.addEventListener(event,listener);
 });
}

/**
 * Every privileged desktop CDP discovery must repeat the live browser
 * WebSocket handshake. Reading HTTP /json/version alone is not an identity
 * check: the owner of localhost port 9223 may have changed since launch.
 *
 * This verifies protocol-level identity, NOT OS-process PID ownership.
 * User approval and page scope are enforced separately by Electron Main.
 */
export async function getVerifiedChromeStatus({
 port=9223,inspect=getChromeStatus,
 verifySocket=async(endpoint:string,port:number)=>verifyBrowserCdpHandshake({endpoint,port}),
}:{
 port?:number;
 inspect?:(input:{port:number})=>Promise<ChromeStatus>;
 verifySocket?:(endpoint:string,port:number)=>Promise<string>;
}={}):Promise<ChromeStatus>{
 validPort(port);
 const status=await inspect({port});
 if(!status||typeof status.browser!=='string'||
    !/^(?:Chrome|Chromium|HeadlessChrome)\/[0-9]+(?:\.[0-9]+)*$/.test(status.browser)||
    typeof status.browserSocket!=='string')
  throw new Error('CDP browser identity cannot be verified from HTTP discovery alone');
 const trustedEndpoint=validateCdpBrowserSocket(status.browserSocket,port);
 const liveProduct=await verifySocket(trustedEndpoint,port);
 if(liveProduct!==status.browser)
  throw new Error('CDP browser identity mismatch between HTTP and live WebSocket');
 return status;
}

/** Only a live, authenticated Chrome debugger proves startup. A child-process
 * "spawn" event alone does not: Chrome 136+ can ignore the remote debugging
 * flags for an existing/default profile.
 */
export async function waitForChromeDebugger({
 port,timeoutMs=15000,pollMs=350,inspect=getChromeStatus,
 verifySocket=async(endpoint:string,port:number)=>verifyBrowserCdpHandshake({endpoint,port}),
 delay=async(ms:number)=>{await new Promise<void>(resolve=>setTimeout(resolve,ms));},
 hasExited=()=>false,
}:{
 port:number;timeoutMs?:number;pollMs?:number;
 inspect?:(input:{port:number})=>Promise<ChromeStatus>;
 verifySocket?:(endpoint:string,port:number)=>Promise<string>;
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
      validateCdpBrowserSocket(status.browserSocket,port)===status.browserSocket){
    const product=await verifySocket(status.browserSocket,port);
    if(product===status.browser)return status;
    lastError='CDP WebSocket browser identity does not match HTTP debugger discovery';
   }else lastError='Invalid Chrome browser identity or browser debugger socket';
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

/**
 * Prevent a failed CDP startup from leaving a browser process open (and
 * potentially holding its Data/Chrome-Profiles folder). Only terminate the
 * exact child created by THIS attempt; a preexisting user's Chrome process
 * must never be killed to "repair" debugger connectivity.
 */
export async function startVerifiedChromeChild({spawnChrome,handshake,terminateChrome}:{
 spawnChrome:()=>ChildProcess;
 handshake:(child:ChildProcess,hasExited:()=>boolean)=>Promise<void>;
 terminateChrome:(child:ChildProcess)=>Promise<void>;
}):Promise<ChildProcess>{
 const child=spawnChrome();
 let spawned=false;
 let processError:Error|null=null;
 // Keep this listener after successful readiness: delayed spawn/process errors
 // must never crash the Electron main process as an unhandled error event.
 child.on('error',(error:Error)=>{processError=error;});
 try{
  await new Promise<void>((resolve,reject)=>{
   const failed=(error:Error)=>{child.off('spawn',started);reject(error);};
   const started=()=>{child.off('error',failed);spawned=true;resolve();};
   child.once('spawn',started);
   child.once('error',failed);
  });
  if(processError)throw processError;
  await handshake(child,()=>processError!==null||
   child.exitCode!==null||child.signalCode!==null);
  if(processError)throw processError;
  if(child.exitCode!==null||child.signalCode!==null)
   throw new Error('Selected Chrome exited immediately after CDP handshake');
  return child;
 }catch(error){
  if(spawned){
   try{await terminateChrome(child);}
   catch(cleanupError){
    throw new AggregateError([error,cleanupError],
     'Chrome startup failed and the newly launched browser could not be cleaned up');
   }
  }
  throw error;
 }
}
/** @internal Shared with Windows CI fixture to exercise the exact production teardown. */
export async function terminateFailedChromeLaunch(child:ChildProcess):Promise<void>{
 // Do not accidentally kill a different process after a PID is recycled.
 if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
 if(process.platform==='win32'){
  // On Windows the Chrome browser process spawns subprocesses. taskkill /T
  // terminates only this verified child tree, never other existing browsers.
  await new Promise<void>((resolve,reject)=>{
   execFile('taskkill',['/PID',String(child.pid),'/T','/F'],
    {timeout:12000,windowsHide:true},error=>{
     if(error&&child.exitCode===null&&child.signalCode===null)reject(error);
     else resolve();
    });
  });
 }else if(!child.kill('SIGTERM')){
  throw new Error('Cannot terminate newly spawned failed Chrome process');
 }
}
export async function launchSelectedChrome({executablePath,port=9223,isolatedProfileDir}:{executablePath:string;port?:number;isolatedProfileDir?:string|undefined}):Promise<ChildProcess>{
 validPort(port);if(!isAbsolute(executablePath))throw new Error('Chrome executable path must be absolute');
 const item=await lstat(executablePath);if(!item.isFile())throw new Error('Selected Chrome path is not a file');
 // Do not mistake a pre-existing debugger (or another loopback service) for
 // the newly requested Chrome process.
 await assertChromeDebuggerPortFree(port);
 if(isolatedProfileDir!==undefined)await ensureWritableDataRoot(isolatedProfileDir);
 return startVerifiedChromeChild({
  spawnChrome:()=>spawn(executablePath,buildChromeLaunchArgs(port,{isolatedProfileDir}),
   {detached:false,stdio:'ignore',windowsHide:false}),
  handshake:async(_child,hasExited)=>{
   await waitForChromeDebugger({port,hasExited});
  },
  terminateChrome:terminateFailedChromeLaunch,
 });
}
