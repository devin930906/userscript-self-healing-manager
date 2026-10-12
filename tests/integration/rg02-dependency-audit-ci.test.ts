import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../../.github/workflows/dev-ci.yml',import.meta.url),'utf8');

test('RG-02 development verify job fails closed on high/critical locked dependency audit findings',()=>{
 const verify=workflow.split(/\n  chrome155:/)[0]!;
 const install=verify.indexOf('run: npm ci');
 const audit=verify.indexOf('run: npm audit --audit-level=high --ignore-scripts');
 const tests=verify.indexOf('run: npm test');
 assert.ok(install>=0&&audit>install&&tests>audit,
  'dependency security audit must run after npm ci and before tests in the Windows verify job');
 const auditStep=verify.slice(verify.lastIndexOf('      - name:',audit),tests);
 assert.doesNotMatch(auditStep,/continue-on-error\s*:\s*true/i,
  'a high-severity advisory must fail CI, never be reported as informational success');
 assert.doesNotMatch(auditStep,/\|\|\s*true|exit\s+0|\$\?\s*-eq\s*false/i,
  'do not hide audit command failures with shell success fallbacks');
 assert.match(verify,/Development CI \(no intermediate installers\)/);
 assert.doesNotMatch(auditStep,/dist:win|electron-builder|upload-artifact|publish/i,
  'dependency audit must never package or upload intermediate installers');
});
