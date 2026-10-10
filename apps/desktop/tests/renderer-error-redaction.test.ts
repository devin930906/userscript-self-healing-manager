import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {summarizeSafeDesktopError} from '../src/renderer/safe-error.ts';

test('renderer error formatting never exposes source paths, selectors, cookies, tokens, private URLs, or thrown objects',()=>{
 const sensitive=[
  new Error('EACCES: C:\\Users\\PrivateName\\Desktop\\my-script.user.js'),
  new Error('https://example.org/account?token=abc123&session=secret'),
  new Error('DOM.querySelectorAll #user-email@private.example'),
  new Error('SQLite disk failed: /Users/alice/secret/registry.sqlite'),
  {message:'Bearer super-secret-123',stack:'C:\\Vault\\hidden.user.js'},
  'password=42 private-page-body',
  null,
  undefined,
 ];
 for(const error of sensitive){
  const safe=summarizeSafeDesktopError(error);
  assert.equal(typeof safe,'string');
  assert.ok(safe.length>0&&safe.length<=180);
  assert.doesNotMatch(safe,/PrivateName|secret|example|alice|abc123|token|session|password|\.user\.js|registry\.sqlite|@private|42/i);
 }
});

test('only exact known transport error codes preserve generic actionability without raw exception text',()=>{
 assert.equal(summarizeSafeDesktopError(new Error('CDP page identity timeout')),
  '浏览器页面连接超时，请检查 Chrome 调试连接与目标标签页。');
 assert.equal(summarizeSafeDesktopError(new Error('CDP locator probe timeout')),
  '页面 DOM 检查超时，请刷新目标页状态后重试。');
 assert.equal(summarizeSafeDesktopError(new Error("Error invoking remote method 'usshm:batch-diagnose': Error: CDP locator probe timeout")),
  '页面 DOM 检查超时，请刷新目标页状态后重试。');
 for(const raw of [
  'CDP locator probe timeout; password=123',
  "Error invoking remote method 'other': Error: CDP locator probe timeout",
  'CDP locator probe timeout\\nC:\\secrets\\tokens',
 ]){
  assert.equal(summarizeSafeDesktopError(new Error(raw)),
   '操作未完成，请检查当前授权、源文件和浏览器状态后重试。');
 }
});

test('all renderer error fallbacks use a safe formatter, never stringify untrusted IPC exceptions',async()=>{
 const source=await readFile(new URL('../src/renderer/App.tsx',import.meta.url),'utf8');
 assert.match(source,/summarizeSafeDesktopError/);
 assert.doesNotMatch(source,/String\(error\)|String\(e\)|String\(err\)/,
  'Raw exceptions may contain private paths, URLs, DOM data or auth tokens');
});
