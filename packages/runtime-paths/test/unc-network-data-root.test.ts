import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveDataRoot, ensureWritableDataRoot} from '../src/index.ts';

const userData = 'C:\\Users\\Test\\AppData\\Roaming\\USSHM';

test('portable ZIP cannot place persistent Data on a Windows UNC network share', () => {
  assert.throws(() => resolveDataRoot({
    distributionMode: 'portable-zip',
    exeDirectory: '\\\\server\\share\\USSHM',
    osUserDataDirectory: userData,
  }), /network|UNC|local/i);
});

test('portable EXE cannot select a UNC external persistent directory', () => {
  assert.throws(() => resolveDataRoot({
    distributionMode: 'portable-exe',
    exeDirectory: 'C:\\Temp\\unpacked',
    portableExternalDirectory: '\\\\server\\share\\USSHM',
    osUserDataDirectory: userData,
  }), /network|UNC|local/i);
});

test('writable Data initialization fails before attempting access to a UNC share', async () => {
  await assert.rejects(
    ensureWritableDataRoot('\\\\server\\share\\USSHM\\Data'),
    /network|UNC|local/i,
  );
});
