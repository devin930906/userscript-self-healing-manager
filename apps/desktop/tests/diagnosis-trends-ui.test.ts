import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
test('history page groups persisted scan summaries into explicitly limited read-only site trends',()=>{
 const ui=readFileSync('apps/desktop/src/renderer/App.tsx','utf8');
 assert.match(ui,/summarizeSiteTrends/);
 assert.match(ui,/最近站点诊断趋势/);
 assert.match(ui,/缺失记录增加/);
 assert.match(ui,/缺失记录减少/);
 assert.match(ui,/批次不可比较/);
 assert.match(ui,/不能证明.*网站更新/);
 assert.match(ui,/diagnosisHistory/);
});
