/** Reject CDP redirects to unrelated services on the same computer. */
function assertLocalDebuggerSocket(endpoint:string,port:number):URL {
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid CDP port');
 const parsed=new URL(endpoint);
 if(parsed.protocol!=='ws:'||!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.username||parsed.password||parsed.search||parsed.hash)
  throw new Error('CDP WebSocket must use a credential-free loopback endpoint');
 if(parsed.port!==String(port))throw new Error('CDP debugger socket port mismatch');
 return parsed;
}
export function validateCdpPageSocket(target:{id:string;webSocketDebuggerUrl?:string|undefined},port=9223):string{
 const endpoint=target.webSocketDebuggerUrl;
 if(!endpoint)throw new Error('CDP page target has no debugger socket');
 const parsed=assertLocalDebuggerSocket(endpoint,port);
 if(!target.id||parsed.pathname!=='/devtools/page/'+encodeURIComponent(target.id))throw new Error('CDP page target identity mismatch');
 return endpoint;
}
export function validateCdpBrowserSocket(endpoint:string,port=9223):string{
 const parsed=assertLocalDebuggerSocket(endpoint,port);
 if(!/^\/devtools\/browser\/[^/]+$/.test(parsed.pathname))throw new Error('CDP browser socket identity mismatch');
 return endpoint;
}
