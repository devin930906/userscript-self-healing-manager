import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDataRoot, ensureWritableDataRoot } from '../src/index.ts';
import { mkdtemp, mkdir, readFile, readdir, lstat, symlink, unlink, rmdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


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

test('portable EXE fails closed on possible Windows 8.3 short-name aliases', () => {
  assert.throws(() => resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\Application Long Name',
    portableExternalDirectory: 'C:\\Temp\\APPLIC~1',
  }), /PORTABLE_EXECUTABLE_DIR.*ambiguous/i);
  assert.throws(() => resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\APPLIC~1',
    portableExternalDirectory: 'D:\\真实 便携目录',
  }), /PORTABLE_EXECUTABLE_DIR.*ambiguous/i);
});

test('ordinary literal tilde names are not presumed to be 8.3 aliases', () => {
  assert.equal(resolveDataRoot({
    ...common, exeDirectory: 'C:\\Temp\\App',
    portableExternalDirectory: 'D:\\Tools\\release~candidate',
  }), 'D:\\Tools\\release~candidate\\Data');
});

test('Windows junction cannot redirect portable Data writes outside its selected directory', {
  skip: process.platform !== 'win32' ? 'Windows junction behavior requires a real Windows filesystem' : false,
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'usshm-junction-boundary-'));
  const link = join(workspace, 'external-junction');
  const realTarget = join(workspace, 'real-target');
  const marker = join(realTarget, 'existing-settings.txt');
  let junctionCreated = false;
  try {
    await mkdir(realTarget);
    await writeFile(marker, 'unchanged source data', 'utf8');

    // A Windows directory junction is a real reparse point, not a string alias.
    // On Windows, setup errors MUST fail this test (no permission-based skip).
    await symlink(realTarget, link, 'junction');
    junctionCreated = true;
    assert.equal((await lstat(link)).isSymbolicLink(), true, 'fixture must be a real directory reparse point');

    await assert.rejects(
      ensureWritableDataRoot(join(link, 'Data')),
      /symlink|reparse|junction/i,
      'a Junction ancestor must cause the data-root initialization to reject',
    );
    assert.equal(await readFile(marker, 'utf8'), 'unchanged source data');
    assert.deepEqual(await readdir(realTarget), ['existing-settings.txt'],
      'real target must contain neither a Data directory nor a write probe');
  } finally {
    // Never recursively delete through a junction. Remove ONLY the link itself
    // before cleaning the dedicated temporary parent and target directory.
    if (junctionCreated) {
      try {
        await unlink(link);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EPERM' &&
            (error as NodeJS.ErrnoException).code !== 'EISDIR') throw error;
        await rmdir(link); // Junction entry only; never pass recursive:true.
      }
    }
    await rm(workspace, { recursive: true, force: true });
  }
});
