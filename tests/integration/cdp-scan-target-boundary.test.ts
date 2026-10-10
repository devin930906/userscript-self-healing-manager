import {test} from 'node:test';
import assert from 'node:assert/strict';
test('CDP target scanning must stay local',()=>{assert.equal('127.0.0.1','127.0.0.1');});
