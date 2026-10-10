import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';
test('offline library interface has user actions and marks functional validation unverified',async()=>{
 const s=await readFile('apps/desktop/src/renderer/App.tsx','utf8');
 for(const label of ['选择脚本','选择文件夹','开始静态诊断','导出 JSON','需要运行时确认','尚未验证网页功能'])assert.ok(s.includes(label),label);
 assert.doesNotMatch(s,/dangerouslySetInnerHTML|eval\s*\(/);
});
