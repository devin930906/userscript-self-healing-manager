import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
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
test('Task 12: real offline static scan never attempts AI/CDP or outbound network I/O',
  {concurrency:false},async()=>{
    const directory=await mkdtemp(join(tmpdir(),'usshm-offline-network-'));
    const restore:Array<()=>void>=[];
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
        '// ==/UserScript==',
        'const target = document.querySelector("#fictional");',
        'const fallback = document.querySelector(`[data-key="${unknownKey}"]`);',
        '// @require https://fixture.example.invalid/do-not-fetch.js',
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
      ] as const){
        for(const method of methods)hook(target,method,`${prefix}.${method}`);
      }

      const result=await runStaticScan({
        paths:[file],recursive:false,maxFiles:10,
      },{repository});
      assert.equal(result.scanMode,'static-only');
      assert.equal(result.processedCount,1);
      assert.equal(result.items[0]?.status,'parsed');
      assert.equal(result.items[0]?.selectorCount,2);
      assert.equal(result.items[0]?.runtimeRequiredCount,1);
      assert.deepEqual(attempts,[],
        'static analysis attempted outbound AI/CDP or network I/O');
    }finally{
      // Revert every network hook before any other process cleanup.
      for(const undo of restore.reverse())undo();
      try{db?.close();}finally{await rm(directory,{recursive:true,force:true});}
    }
  });
