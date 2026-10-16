import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeSafeDesktopError} from '../src/renderer/safe-error.ts';

const fallback='操作未完成，请检查当前授权、源文件和浏览器状态后重试。';

test('RG-07 renderer treats throwing Error.message getters as untrusted data',()=>{
 const hostile=new Error('private source URL');
 Object.defineProperty(hostile,'message',{get(){throw new Error('https://private.invalid/?token=secret');}});
 assert.doesNotThrow(()=>summarizeSafeDesktopError(hostile));
 assert.equal(summarizeSafeDesktopError(hostile),fallback);
});

test('RG-07 renderer rejects non-string Error.message without coercion',()=>{
 const hostile=new Error('private source URL');
 Object.defineProperty(hostile,'message',{get(){return {toString(){throw new Error('private token');}};}});
 assert.equal(summarizeSafeDesktopError(hostile),fallback);
});

test('RG-07 renderer reads a stateful message getter at most once',()=>{
 const hostile=new Error('private');
 let reads=0;
 Object.defineProperty(hostile,'message',{get(){
  reads++;
  return reads===1?'CDP locator probe timeout':{toString(){throw new Error('private token');}};
 }});
 assert.equal(summarizeSafeDesktopError(hostile),'页面 DOM 检查超时，请刷新目标页状态后重试。');
 assert.equal(reads,1);
});
