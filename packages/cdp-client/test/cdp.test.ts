import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {getChromeStatus,buildChromeLaunchArgs} from '../src/index.ts';

test('launch args bind Chrome CDP to localhost without auto-adding user-data-dir',()=>{
 const args=buildChromeLaunchArgs(9223);
 assert.deepEqual(args,['--remote-debugging-port=9223','--remote-debugging-address=127.0.0.1']);
});
test('status uses real /json/version and /json/list evidence',async()=>{
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(req.url==='/json/version'?JSON.stringify({Browser:'Chrome/155',webSocketDebuggerUrl:'ws://127.0.0.1:12345/devtools/browser/abc'}):JSON.stringify([{type:'page',id:'page1',url:'https://example.com/',webSocketDebuggerUrl:'ws://127.0.0.1:12345/devtools/page/page1'}]));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {const address=server.address();if(!address||typeof address==='string')throw Error('port');
 const value=await getChromeStatus({port:address.port});assert.equal(value.browser,'Chrome/155');assert.equal(value.pages.length,1);assert.equal(value.pages[0]?.url,'https://example.com/');}
 finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('refuses arbitrary IP and out-of-range debugging port',async()=>{
 await assert.rejects(getChromeStatus({port:9223,host:'8.8.8.8'}),/localhost only/);
 assert.throws(()=>buildChromeLaunchArgs(0),/port/);
});
