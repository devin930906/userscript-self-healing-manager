import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type DistributionMode = 'installed' | 'portable-exe' | 'portable-zip';

export interface DataRootInput {
  distributionMode: DistributionMode;
  exeDirectory: string;
  osUserDataDirectory: string;
  /** From electron-builder's external Portable.exe launcher, NOT the unpacked app. */
  portableExternalDirectory?: string;
}

export class DataRootError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_DATA_ROOT'
      | 'PORTABLE_EXTERNAL_DIRECTORY_REQUIRED'
      | 'PORTABLE_TEMP_DIRECTORY_FORBIDDEN'
      | 'PORTABLE_DATA_DIRECTORY_NOT_WRITABLE'
      | 'DATA_DIRECTORY_NOT_WRITABLE'
      | 'DATA_ROOT_SYMLINK_FORBIDDEN',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DataRootError';
  }
}

function pathModuleFor(value: string): typeof path.win32 | typeof path.posix {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
    ? path.win32
    : path.posix;
}

function normalizeDirectory(value: string, field: string): string {
  if (!value || !value.trim() || value.includes('\0')) {
    throw new DataRootError('INVALID_DATA_ROOT', `Invalid or missing ${field}`);
  }
  const api = pathModuleFor(value);
  if (!api.isAbsolute(value)) {
    throw new DataRootError('INVALID_DATA_ROOT', `${field} must be absolute`);
  }
  return api.normalize(value);
}

function isSameDirectory(a: string, b: string): boolean {
  if (pathModuleFor(a) !== pathModuleFor(b)) return false;
  const api = pathModuleFor(a);
  const clean = (s: string) => api.normalize(s).replace(/[\\/]+$/, '').toLowerCase();
  return clean(a) === clean(b);
}

/** Pure policy resolution; safe to call before Electron's ready event. */
export function resolveDataRoot(input: DataRootInput): string {
  switch (input.distributionMode) {
    case 'installed':
      return normalizeDirectory(input.osUserDataDirectory, 'osUserDataDirectory');
    case 'portable-exe': {
      if (!input.portableExternalDirectory) {
        throw new DataRootError(
          'PORTABLE_EXTERNAL_DIRECTORY_REQUIRED',
          'Portable EXE requires its original external directory (PORTABLE_EXECUTABLE_DIR); refusing unpacked temp fallback.',
        );
      }
      const external = normalizeDirectory(input.portableExternalDirectory, 'portableExternalDirectory');
      const unpacked = normalizeDirectory(input.exeDirectory, 'exeDirectory');
      if (isSameDirectory(external, unpacked)) {
        throw new DataRootError(
          'PORTABLE_TEMP_DIRECTORY_FORBIDDEN',
          'Portable EXE external directory matches the unpacked executable directory.',
        );
      }
      return pathModuleFor(external).join(external, 'Data');
    }
    case 'portable-zip': {
      const exe = normalizeDirectory(input.exeDirectory, 'exeDirectory');
      return pathModuleFor(exe).join(exe, 'Data');
    }
    default:
      throw new DataRootError('INVALID_DATA_ROOT', 'Unrecognized distribution mode');
  }
}

async function assertNoSymlinkComponents(directory: string): Promise<void> {
  const full = path.resolve(directory);
  const parsed = path.parse(full);
  let current = parsed.root;
  for (const part of full.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new DataRootError('DATA_ROOT_SYMLINK_FORBIDDEN', `Symlink in data root path: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new DataRootError('INVALID_DATA_ROOT', `Not a directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
}

/**
 * Fail closed. Verify symlink-free ancestry before/after creation, then probe
 * actual write + unlink instead of trusting fs.access() (which can lie under ACLs).
 * No silent AppData fallback. Call before any DB/session/cache initialization.
 */
export async function ensureWritableDataRoot(dataRoot: string): Promise<void> {
  const root = normalizeDirectory(dataRoot, 'dataRoot');
  if (pathModuleFor(root) !== pathModuleFor(process.cwd())) {
    // Windows dataRoot is only usable on Windows; guard accidental cross-platform use.
    throw new DataRootError('INVALID_DATA_ROOT', 'Data root path is not native to this platform');
  }
  const probe = path.join(root, `.ussm-write-probe-${randomUUID()}`);
  try {
    await assertNoSymlinkComponents(root);
    await fs.mkdir(root, { recursive: true });
    await assertNoSymlinkComponents(root);
    const handle = await fs.open(probe, 'wx', 0o600);
    try {
      await handle.writeFile('ok', 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.unlink(probe);
  } catch (error) {
    if (error instanceof DataRootError && error.code === 'DATA_ROOT_SYMLINK_FORBIDDEN') throw error;
    throw new DataRootError(
      'PORTABLE_DATA_DIRECTORY_NOT_WRITABLE',
      `Cannot initialize writable data directory "${root}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    // Best effort probe cleanup, including failures during write or fsync.
    await fs.unlink(probe).catch(() => undefined);
  }
}

/** Process env is only a launcher hint; distributionMode must be trusted build metadata. */
export function resolveLauncherDataRoot(input: Omit<DataRootInput, 'portableExternalDirectory'> & {
  env?: NodeJS.ProcessEnv;
}): string {
  return resolveDataRoot({
    ...input,
    portableExternalDirectory: input.env?.PORTABLE_EXECUTABLE_DIR,
  });
}
