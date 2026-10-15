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
