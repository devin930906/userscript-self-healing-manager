import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureWritableDataRoot, resolveDataRoot } from '../../packages/runtime-paths/src/index';
import { bootstrapApplication } from '../../apps/desktop/src/main/bootstrap';

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });

async function temp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ussm-root-'));
  cleanup.push(dir);
  return dir;
}

describe('portable data root safety', () => {
  it('resolveDataRoot_usesExternalPortableDirectory for Chinese and spaces', async () => {
    const base = await temp();
    const external = path.join(base, '我的 便携 工具');
    const unpack = path.join(base, 'temp unpack');
    expect(resolveDataRoot({ distributionMode: 'portable-exe', exeDirectory: unpack, portableExternalDirectory: external, osUserDataDirectory: path.join(base, 'user') }))
      .toBe(path.join(external, 'Data'));
    await ensureWritableDataRoot(path.join(external, 'Data'));
    expect((await fs.stat(path.join(external, 'Data'))).isDirectory()).toBe(true);
    await expect(fs.stat(path.join(unpack, 'Data'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a path which is a file, without AppData fallback', async () => {
    const base = await temp();
    const file = path.join(base, 'read-only-target');
    await fs.writeFile(file, 'not a directory');
    await expect(ensureWritableDataRoot(path.join(file, 'Data')))
      .rejects.toMatchObject({ code: 'PORTABLE_DATA_DIRECTORY_NOT_WRITABLE' });
  });

  it('rejects a symlink escaping the portable root', async () => {
    const base = await temp();
    const outside = await temp();
    await fs.symlink(outside, path.join(base, 'Data'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(ensureWritableDataRoot(path.join(base, 'Data')))
      .rejects.toMatchObject({ code: 'DATA_ROOT_SYMLINK_FORBIDDEN' });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('sets userData before creating cache and logs', async () => {
    const base = await temp();
    const chosen = path.join(base, '便携 程序');
    const events: string[] = [];
    const root = await bootstrapApplication({
      distributionMode: 'portable-zip',
      exeDirectory: chosen,
      osUserDataDirectory: path.join(base, 'profile'),
      electronApp: { setPath: (name, value) => { events.push(name + ':' + value); } },
    });
    expect(events).toEqual(['userData:' + path.join(chosen, 'Data')]);
    expect(root.dataRoot).toBe(path.join(chosen, 'Data'));
    expect((await fs.stat(root.logsDirectory)).isDirectory()).toBe(true);
  });
});
