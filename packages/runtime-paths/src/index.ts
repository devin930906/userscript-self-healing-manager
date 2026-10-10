import { constants } from 'node:fs';
import { access, lstat, mkdir, writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';

export type DistributionMode = 'installed' | 'portable-exe' | 'portable-zip';
export interface DataRootInput {
  distributionMode: DistributionMode;
  exeDirectory: string;
  osUserDataDirectory: string;
  portableExternalDirectory?: string | undefined;
}

function pathModule(path: string) {
  return /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path) ? win32 : { join, isAbsolute, parse };
}

export function resolveDataRoot(input: DataRootInput): string {
  if (input.distributionMode === 'installed') {
    if (!pathModule(input.osUserDataDirectory).isAbsolute(input.osUserDataDirectory)) throw new Error('User data root must be absolute');
    return input.osUserDataDirectory;
  }
  const base = input.distributionMode === 'portable-exe' ? input.portableExternalDirectory : input.exeDirectory;
  if (!base && input.distributionMode === 'portable-exe') throw new Error('PORTABLE_EXECUTABLE_DIR is unavailable; portable data directory cannot be determined');
  if (!base || !pathModule(base).isAbsolute(base)) throw new Error('Portable data root must be absolute');
  return pathModule(base).join(base, 'Data');
}

/** Never silently fall back to AppData; even an existing link is disallowed. */
export async function ensureWritableDataRoot(dataRoot: string): Promise<void> {
  if (!isAbsolute(dataRoot)) throw new Error('Data root must be an absolute local path');
  let current = parse(dataRoot).root;
  const segments = dataRoot.slice(current.length).split(/[\\/]+/).filter(Boolean);
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const item = await lstat(current);
      if (item.isSymbolicLink()) throw new Error(`Data root cannot contain symlinks: ${current}`);
      if (!item.isDirectory()) throw new Error(`Data path is not a directory: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(current);
    }
  }
  await access(dataRoot, constants.W_OK);
  const probe = join(dataRoot, `.write-probe-${randomUUID()}`);
  try { await writeFile(probe, '', {flag:'wx', mode:0o600}); }
  finally { await unlink(probe).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;}); }
}
