import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDataRoot } from '../src/index.ts';

const common = {
  distributionMode: 'portable-exe' as const,
  osUserDataDirectory: 'C:\\Users\\测试 用户\\AppData\\Roaming\\USSHM',
};

test('portable EXE refuses identical external and unpacked Windows directories', () => {
  assert.throws(
    () => resolveDataRoot({
      ...common,
      exeDirectory: 'C:\\Users\\测试 用户\\AppData\\Local\\Temp\\app-123',
      portableExternalDirectory: 'C:\\Users\\测试 用户\\AppData\\Local\\Temp\\app-123',
    }),
    /PORTABLE_EXECUTABLE_DIR.*unpacked/i,
  );
});

test('portable EXE refuses normalized, case-insensitive aliases of unpacked directory', () => {
  assert.throws(
    () => resolveDataRoot({
      ...common,
      exeDirectory: 'C:\\Temp\\App Unpacked\\',
      portableExternalDirectory: 'c:/temp/other/../app unpacked/.',
    }),
    /PORTABLE_EXECUTABLE_DIR.*unpacked/i,
  );
});

test('portable EXE still accepts a distinct Chinese-and-space external directory', () => {
  assert.equal(
    resolveDataRoot({
      ...common,
      exeDirectory: 'C:\\Users\\测试 用户\\AppData\\Local\\Temp\\app-123',
      portableExternalDirectory: 'D:\\便携 软件\\管理器',
    }),
    'D:\\便携 软件\\管理器\\Data',
  );
});

test('installed and portable ZIP retain their independent data root policies', () => {
  assert.equal(resolveDataRoot({
    distributionMode: 'installed', exeDirectory: 'C:\\Program Files\\USSHM',
    osUserDataDirectory: 'C:\\Users\\测试 用户\\AppData\\Roaming\\USSHM',
  }), 'C:\\Users\\测试 用户\\AppData\\Roaming\\USSHM');
  assert.equal(resolveDataRoot({
    distributionMode: 'portable-zip', exeDirectory: 'D:\\解压 目录\\USSHM',
    osUserDataDirectory: 'C:\\Users\\测试 用户\\AppData\\Roaming\\USSHM',
  }), 'D:\\解压 目录\\USSHM\\Data');
});

test('portable EXE rejects Data inside unpacked directory subtree', () => {
  assert.throws(() => resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\App',
    portableExternalDirectory: 'C:\\Temp\\App\\Data',
  }), /PORTABLE_EXECUTABLE_DIR.*unpacked/i);
  assert.throws(() => resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\App',
    portableExternalDirectory: 'C:\\Temp\\App\\nested\\Data',
  }), /PORTABLE_EXECUTABLE_DIR.*unpacked/i);
});

test('portable EXE accepts a sibling sharing only the path prefix', () => {
  assert.equal(resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\App',
    portableExternalDirectory: 'C:\\Temp\\Application',
  }), 'C:\\Temp\\Application\\Data');
});

test('portable EXE fails closed for extended-length device alias paths', () => {
  assert.throws(() => resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\App',
    portableExternalDirectory: '\\\\?\\C:\\Temp\\App',
  }), /PORTABLE_EXECUTABLE_DIR.*(unpacked|ambiguous)/i);
  assert.throws(() => resolveDataRoot({
    ...common, exeDirectory: '\\\\?\\C:\\Temp\\App',
    portableExternalDirectory: 'C:\\Temp\\App',
  }), /PORTABLE_EXECUTABLE_DIR.*(unpacked|ambiguous)/i);
});

test('portable EXE fails closed for Windows trailing-dot aliases', () => {
  assert.throws(() => resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\App',
    portableExternalDirectory: 'C:\\Temp\\App.',
  }), /PORTABLE_EXECUTABLE_DIR.*(unpacked|ambiguous)/i);
  assert.throws(() => resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\App.',
    portableExternalDirectory: 'C:\\Temp\\App',
  }), /PORTABLE_EXECUTABLE_DIR.*(unpacked|ambiguous)/i);
});
