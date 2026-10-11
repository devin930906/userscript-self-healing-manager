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
  if (input.distributionMode === 'portable-exe') {
    // Lexical containment is not enough to prove Windows filesystem identity.
    // Reject device namespaces and Win32 trailing-dot/space components until
    // Windows-native canonical-handle checks can safely support them.
    const unpacked = input.exeDirectory;
    const ambiguous = (value: string) =>
      /^[\\\\/]{2}[?.][\\\\/]/.test(value) ||
      value.split(/[\\/]+/).some(part => part !== '.' && part !== '..' &&
        (/[. ]$/.test(part) || /^[^\\/.]{1,6}~[1-9][0-9]*(?:\.[^\\/.]{0,3})?$/.test(part)));
    if (!unpacked || !win32.isAbsolute(unpacked) || !win32.isAbsolute(base) ||
        ambiguous(unpacked) || ambiguous(base)) {
      throw new Error('PORTABLE_EXECUTABLE_DIR has ambiguous Windows path identity; refusing unpacked data root');
    }
    const external = win32.resolve(base);
    const extraction = win32.resolve(unpacked);
    const relative = win32.relative(extraction, external);
    // win32.relative is component-aware: App\\Data is inside App,
    // while Application is a sibling and must remain permitted.
    if (relative === '' ||
        (relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative))) {
      throw new Error('PORTABLE_EXECUTABLE_DIR is inside unpacked executable directory; refusing temporary data root');
    }
  }
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
