import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveDataRoot, ensureWritableDataRoot} from '../src/index.ts';
import {mkdtemp, mkdir, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, win32} from 'node:path';

const userData = 'C:\\Users\\Test\\AppData\\Roaming\\USSHM';
const unc = '\\\\server\\share\\USSHM';

test('portable ZIP preserves a UNC path at resolution rather than declaring all shares unsafe', () => {
  assert.equal(resolveDataRoot({
    distributionMode: 'portable-zip', exeDirectory: unc, osUserDataDirectory: userData,
  }), win32.join(unc, 'Data'));
});

test('portable EXE permits distinct UNC external directories subject to writable probe', () => {
  assert.equal(resolveDataRoot({
    distributionMode: 'portable-exe', exeDirectory: 'C:\\Temp\\unpacked',
    portableExternalDirectory: unc, osUserDataDirectory: userData,
  }), win32.join(unc, 'Data'));
});

test('installed mode does not impose portable-only UNC policy on OS userData', () => {
  assert.equal(resolveDataRoot({
    distributionMode: 'installed', exeDirectory: 'C:\\Program Files\\USSHM',
    osUserDataDirectory: unc,
  }), unc);
});

test('existing writable-probe recognizes a genuine writable directory without destroying data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'usshm-writable-probe-'));
  try {
    const data = join(root, 'Data');
    await mkdir(data);
    await writeFile(join(data, 'settings.json'), '{"intact":true}');
    await ensureWritableDataRoot(data);
    assert.equal(await readFile(join(data, 'settings.json'), 'utf8'), '{"intact":true}');
  } finally {
    await rm(root, {recursive:true, force:true});
  }
});
