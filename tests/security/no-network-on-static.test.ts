import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import http,{request as esmHttpRequest} from 'node:http';
import dns from 'node:dns';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createScriptRepository,migrateDatabase,openDatabase} from '../../packages/persistence/src/index.ts';
import {runStaticScan} from '../../packages/scan-service/src/index.ts';

/**
 * Deny outbound attempts as well as count them: a swallowed network error
 * must still fail the assertion. Patch only inside this test and restore
 * original property descriptors in reverse order, even on a failed scan.
 *
 * Node's --test runner isolates test files in processes. This test is not
 * safe to embed in an application process or run concurrently with other
 * tests within the same process.
 */
test('Task 12: real offline static scan avoids instrumented fetch/http/dns/udp/tcp/tls entrypoints',
  {concurrency:false},async()=>{
    const directory=await mkdtemp(join(tmpdir(),'usshm-offline-network-'));
    const restore:Array<()=>void>=[];
    const cleanupErrors:unknown[]=[];
    let scanError:unknown;
    const attempts:string[]=[];
    let db:ReturnType<typeof openDatabase>|undefined;
    const deny=(label:string)=>(..._args:unknown[]):never=>{
      attempts.push(label);
      throw new Error(`Unexpected offline network attempt: ${label}`);
    };
    const hook=(target:object,key:string,label:string):void=>{
      const previous=Object.getOwnPropertyDescriptor(target,key);
      if(previous && !previous.configurable && !previous.writable)
        throw new Error(`Cannot safely instrument ${label}`);
      Object.defineProperty(target,key,{configurable:true,writable:true,value:deny(label)});
      restore.push(()=>{
        if(previous)Object.defineProperty(target,key,previous);
        else Reflect.deleteProperty(target,key);
      });
    };
    try{
      const file=join(directory,'fictional-offline.user.js');
      await writeFile(file,[
        '// ==UserScript==',
        '// @name Offline Security Fixture',
        '// @match https://fixture.example.invalid/*',
        '// @grant none',
        '// @run-at document-idle',
        '// @require https://fixture.example.invalid/do-not-fetch.js',
        '// ==/UserScript==',
        'const target = document.querySelector("#fictional");',
        'const fallback = document.querySelector(`[data-key="${unknownKey}"]`);',
        '',
      ].join('\n'));
      db=openDatabase(join(directory,'registry.sqlite'));
      migrateDatabase(db);
      const repository=createScriptRepository(db);

      // Install after local database creation, before the real scan entrypoint.
      hook(globalThis,'fetch','global.fetch');
      if('WebSocket' in globalThis)hook(globalThis,'WebSocket','global.WebSocket');
      for(const [target,methods,prefix] of [
        [http,['request','get'],'http'],
        [https,['request','get'],'https'],
        [http2,['connect'],'http2'],
        [net,['connect','createConnection'],'net'],
        [tls,['connect'],'tls'],
        [dns,['lookup','resolve','resolve4','resolve6'],'dns'],
        [dgram,['createSocket'],'dgram'],
      ] as const){
        for(const method of methods)hook(target,method,`${prefix}.${method}`);
      }

      // Builtin ESM named exports otherwise retain references to unpatched functions.
      syncBuiltinESMExports();
      assert.equal(esmHttpRequest,http.request,'ESM named import must be intercepted');
      assert.throws(()=>esmHttpRequest('http://127.0.0.1/'),/Unexpected offline network attempt/);
      assert.deepEqual(attempts,['http.request'],'ESM interception probe must hit hook');
      attempts.length=0;

      const result=await runStaticScan({
        paths:[file],recursive:false,maxFiles:10,
      },{repository});
      assert.equal(result.scanMode,'static-only');
      assert.equal(result.processedCount,1);
      assert.equal(result.items[0]?.status,'parsed');
      assert.equal(result.items[0]?.selectorCount,2);
      assert.equal(result.items[0]?.runtimeRequiredCount,1);
      assert.deepEqual(result.items[0]?.analysis?.metadata.raw.require,
        ['https://fixture.example.invalid/do-not-fetch.js'],
        '@require must be parsed but never downloaded');
      assert.deepEqual(attempts,[],
        'static analysis attempted outbound AI/CDP or network I/O');
    }catch(error){
      scanError=error;
    }finally{
      // Each restoration is independent: one failure must never skip others.
      for(const undo of restore.reverse()){
        try{undo();}catch(error){cleanupErrors.push(error);}
      }
      try{syncBuiltinESMExports();}catch(error){cleanupErrors.push(error);}
      try{db?.close();}catch(error){cleanupErrors.push(error);}
      try{await rm(directory,{recursive:true,force:true});}catch(error){cleanupErrors.push(error);}
    }
    if(scanError!==undefined){
      if(cleanupErrors.length)throw new AggregateError([scanError,...cleanupErrors],
        'Offline scan failed and cleanup also failed');
      throw scanError;
    }
    if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Offline scan cleanup failed');
  });
