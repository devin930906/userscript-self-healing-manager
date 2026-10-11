import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {getVerifiedChromeStatus,type ChromeStatus} from '../src/index.ts';

const valid:ChromeStatus={browser:'Chrome/155.0.8059.39',protocolVersion:'1.3',
 pages:[{id:'tab',type:'page',url:'http://127.0.0.1/fixture'}],
 browserSocket:'ws://127.0.0.1:9223/devtools/browser/verified-token'};

test('verified discovery demands the live Browser.getVersion WebSocket, not just plausible HTTP headers',async()=>{
 let calls=0;
 await assert.rejects(getVerifiedChromeStatus({
  port:9223,inspect:async()=>valid,
  verifySocket:async()=>{calls++;throw new Error('fake debugger has no CDP WebSocket');},
 }),/CDP|WebSocket|browser|debugger/i);
 assert.equal(calls,1);
});

test('verified discovery rejects HTTP/WebSocket product mismatches and unverified browser socket',async()=>{
 for(const advertised of [
  {...valid,browserSocket:null},
  {...valid,browser:'NotChrome/155'},
  {...valid,browserSocket:'ws://127.0.0.1:9333/devtools/browser/wrong-port'},
 ]){
  await assert.rejects(getVerifiedChromeStatus({
   port:9223,inspect:async()=>advertised,
   verifySocket:async()=>valid.browser,
  }),/CDP|browser|socket|port|identity|mismatch/i);
 }
 await assert.rejects(getVerifiedChromeStatus({
  port:9223,inspect:async()=>valid,
  verifySocket:async()=> 'Chrome/154.0.0.0',
 }),/mismatch|identity|product/i);
});

test('verified discovery returns the exact bounded status only after matching live identity',async()=>{
 const checked:string[]=[];
 const output=await getVerifiedChromeStatus({
  port:9223,inspect:async({port})=>{checked.push('http:'+port);return valid;},
  verifySocket:async(ws,port)=>{checked.push('ws:'+ws+':'+port);return valid.browser;},
 });
 assert.equal(output,valid);
 assert.deepEqual(checked,['http:9223','ws:'+valid.browserSocket+':9223']);
});

test('a localhost HTTP service spoofing Chrome JSON without WebSocket cannot become a trusted browser',async()=>{
 const paths:string[]=[];
 const server=createServer((req,res)=>{
  paths.push(req.url??'');
  const endpoint=server.address();
  if(!endpoint||typeof endpoint==='string')throw new Error('Missing local port');
  res.setHeader('Content-Type','application/json');
  res.end(req.url==='/json/version'?
   JSON.stringify({Browser:'Chrome/155.0.8059.39','Protocol-Version':'1.3',
    webSocketDebuggerUrl:'ws://127.0.0.1:'+endpoint.port+'/devtools/browser/spoofed'}):
   JSON.stringify([]));
 });
 server.on('upgrade',(_request,socket)=>socket.destroy());
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const addr=server.address();
  if(!addr||typeof addr==='string')throw new Error('Server port unavailable');
  await assert.rejects(getVerifiedChromeStatus({port:addr.port}),
   /CDP|socket|WebSocket|browser|handshake/i);
  assert.deepEqual(paths,['/json/version','/json/list']);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});
