/** Reject CDP redirects to unrelated services on the same computer. */
function assertLocalDebuggerSocket(endpoint:string,port:number):URL {
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid CDP port');
 if(typeof endpoint!=='string'||endpoint.length<1||endpoint.length>2048)throw new Error('Invalid CDP debugger socket length');
 let parsed:URL;
 try { parsed=new URL(endpoint); }
 catch { throw new Error('Invalid CDP debugger socket URL'); }
 // Reject URL parser normalization (including dot segments and percent-encoded
 // traversal) before binding any browser/page target to a debugger socket.
 if(parsed.href!==endpoint)throw new Error('Noncanonical CDP debugger socket URL');
 if(parsed.protocol!=='ws:'||!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.username||parsed.password||parsed.search||parsed.hash)
  throw new Error('CDP WebSocket must use a credential-free loopback endpoint');
 if(parsed.port!==String(port))throw new Error('CDP debugger socket port mismatch');
 return parsed;
}
export function validateCdpPageSocket(target:{id:string;webSocketDebuggerUrl?:string|undefined},port=9223):string{
 if(!target||typeof target!=='object'||Array.isArray(target))
  throw new Error('CDP page target identity mismatch');
 // CDP /json/list is a JSON own-data object. Never invoke accessors or
 // authenticate inherited fields from a forged target before opening a socket.
 let id:unknown;
 try {
  const field=Object.getOwnPropertyDescriptor(target,'id');
  if(!field||!field.enumerable||!Object.hasOwn(field,'value'))
   throw new Error('Missing own page identity');
  id=field.value;
 }catch{throw new Error('CDP page target identity mismatch');}
 let endpoint:unknown;
 try {
  const field=Object.getOwnPropertyDescriptor(target,'webSocketDebuggerUrl');
  if(field&&(!field.enumerable||!Object.hasOwn(field,'value')))
   throw new Error('Invalid own debugger socket');
  endpoint=field?.value;
 }catch{throw new Error('Invalid CDP debugger socket length');}
 if(endpoint===undefined||endpoint===null||endpoint==='')throw new Error('CDP page target has no debugger socket');
 if(typeof endpoint!=='string')throw new Error('Invalid CDP debugger socket length');
 const parsed=assertLocalDebuggerSocket(endpoint,port);
 if(typeof id!=='string'||id.length>128||!/^[A-Za-z0-9_-]+$/.test(id)||parsed.pathname!=='/devtools/page/'+id)throw new Error('CDP page target identity mismatch');
 return endpoint;
}
export function validateCdpBrowserSocket(endpoint:string,port=9223):string{
 const parsed=assertLocalDebuggerSocket(endpoint,port);
 if(parsed.pathname.length>146||!/^\/devtools\/browser\/[A-Za-z0-9_-]+$/.test(parsed.pathname))throw new Error('CDP browser socket identity mismatch');
 return endpoint;
}
