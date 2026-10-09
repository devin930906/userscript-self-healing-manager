import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getChromeStatus,buildChromeLaunchArgs,launchSelectedChrome,waitForChromeDebugger} from '../src/index.ts';

test('launch args bind Chrome CDP to localhost without auto-adding user-data-dir',()=>{
 const args=buildChromeLaunchArgs(9223);
 assert.deepEqual(args,['--remote-debugging-port=9223','--remote-debugging-address=127.0.0.1']);
});
test('status uses real /json/version and /json/list evidence',async()=>{
 const server=createServer((req,res)=>{const a=server.address();if(!a||typeof a==='string')throw Error('server');res.setHeader('Content-Type','application/json');res.end(req.url==='/json/version'?JSON.stringify({Browser:'Chrome/155',webSocketDebuggerUrl:`ws://127.0.0.1:${a.port}/devtools/browser/abc`}):JSON.stringify([{type:'page',id:'page1',url:'https://example.com/',webSocketDebuggerUrl:`ws://127.0.0.1:${a.port}/devtools/page/page1`}]));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {const address=server.address();if(!address||typeof address==='string')throw Error('port');
 const value=await getChromeStatus({port:address.port});assert.equal(value.browser,'Chrome/155');assert.equal(value.pages.length,1);assert.equal(value.pages[0]?.url,'https://example.com/');}
 finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('refuses arbitrary IP and out-of-range debugging port',async()=>{
 await assert.rejects(getChromeStatus({port:9223,host:'8.8.8.8'}),/localhost only/);
 assert.throws(()=>buildChromeLaunchArgs(0),/port/);
});

test('CDP target from /json/list cannot redirect probes to another local port',async()=>{
 const server=createServer((req,res)=>{
  const address=server.address();if(!address||typeof address==='string')throw Error('server');
  res.setHeader('Content-Type','application/json');
  res.end(req.url==='/json/version'?JSON.stringify({Browser:'Chrome/155'}):JSON.stringify([{type:'page',id:'p1',url:'https://example.org/',webSocketDebuggerUrl:`ws://127.0.0.1:${address.port+1}/devtools/page/p1`}]));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address();if(!address||typeof address==='string')throw Error('server');
  await assert.rejects(getChromeStatus({port:address.port}),/port/i);}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('explicit isolated Chrome profile can be enabled without changing default Chrome launch flags',()=>{
 const defaults=buildChromeLaunchArgs(9223);
 assert.equal(defaults.some(x=>x.startsWith('--user-data-dir=')),false);
 const args=buildChromeLaunchArgs(9223,{isolatedProfileDir:'C:\\\\USSHM Data\\\\Chrome-CDP-Profile'});
 assert.ok(args.some(x=>x.startsWith('--user-data-dir=')));
 assert.equal(args.filter(x=>x.startsWith('--user-data-dir=')).length,1);
 assert.throws(()=>buildChromeLaunchArgs(9223,{isolatedProfileDir:'relative/profile'}),/absolute/i);
});

test('launching malformed chosen Chrome EXE rejects instead of reporting a started browser',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-invalid-exe-'));
 const fake=join(root,'Invalid Chrome.exe');
 try{
  await writeFile(fake,'not a Windows executable');
  await assert.rejects(launchSelectedChrome({executablePath:fake,port:9223}),
   /spawn|exec|executable|format|permission|access|invalid/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('CDP discovery refuses oversized localhost JSON and excessive tab listings',async()=>{
 let mode:'version'|'list'|'tabs'='version';
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/json/version'){
   res.end(mode==='version'?JSON.stringify({Browser:'Chrome/155',padding:'x'.repeat(100000)}):JSON.stringify({Browser:'Chrome/155'}));
  }else if(mode==='list'){
   res.end(JSON.stringify([{type:'page',id:'a',url:'https://example.org/',padding:'x'.repeat(1_500_000)}]));
  }else{
   res.end(JSON.stringify(Array.from({length:257},(_,n)=>({type:'page',id:'tab'+n,url:'https://example.org/'}))));
  }
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('port');
  const port=address.port;
  await assert.rejects(getChromeStatus({port}),/size|limit/i);
  mode='list';
  await assert.rejects(getChromeStatus({port}),/size|limit/i);
  mode='tabs';
  await assert.rejects(getChromeStatus({port}),/tabs|target|limit/i);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('Chrome launcher refuses an occupied local debugger port instead of claiming a different browser',async()=>{
 const server=createServer((_req,res)=>res.end('wrong debugger'));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root=await mkdtemp(join(tmpdir(),'usshm-port-check-'));
 const fake=join(root,'Fake Chrome.exe');
 try{
  await writeFile(fake,'an executable-looking file that must never launch');
  const addr=server.address();if(!addr||typeof addr==='string')throw Error('port');
  await assert.rejects(launchSelectedChrome({executablePath:fake,port:addr.port}),/port.*(occupied|in use)|already.*used/i);
 }finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await rm(root,{recursive:true,force:true});
 }
});
test('Chrome handshake must see a validated browser socket, not only a successful process spawn',async()=>{
 let attempts=0;
 const validPort=9223;
 const status={browser:'Chrome/155',protocolVersion:'1.3',pages:[],
  browserSocket:'ws://127.0.0.1:9223/devtools/browser/valid'};
 const got=await waitForChromeDebugger({port:validPort,timeoutMs:1000,pollMs:1,
  inspect:async()=>{attempts++;if(attempts<3)throw Error('CDP not ready');return status;},
  delay:async()=>{},
 });
 assert.equal(got.browser,'Chrome/155');
 assert.equal(attempts,3);
 await assert.rejects(waitForChromeDebugger({port:9223,timeoutMs:30,pollMs:1,
  inspect:async()=>({...status,browserSocket:null}),delay:async()=>new Promise(r=>setTimeout(r,2)),
 }),/handshake|CDP|browser/i);
 await assert.rejects(waitForChromeDebugger({port:9223,timeoutMs:30,pollMs:1,
  inspect:async()=>({...status,browser:'Other/155'}),delay:async()=>new Promise(r=>setTimeout(r,2)),
 }),/handshake|CDP|browser/i);
});
test('Chrome handshake detects a launch that exits without exposing CDP',async()=>{
 await assert.rejects(waitForChromeDebugger({port:9223,timeoutMs:1000,pollMs:1,
  inspect:async()=>{throw Error('not started');},delay:async()=>{},
  hasExited:()=>true,
 }),/exited|closed|early/i);
});
