import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ensureWritableDataRoot,
  resolveLauncherDataRoot,
  type DistributionMode,
} from '../../../../packages/runtime-paths/src/index';

export interface BootstrapPaths {
  /** Trusted, build-time distribution identity; do not infer from env or folder name. */
  distributionMode: DistributionMode;
  /** Real process executable directory; portable-exe may instead point to temp unpack. */
  exeDirectory: string;
  /** Captured OS-backed app.getPath('userData') before path override. */
  osUserDataDirectory: string;
  /** Inject app during early Main setup; bootstrap before ready/session/DB. */
  electronApp: { setPath(name: 'userData', value: string): void };
  /** Injectable launcher environment for testing. */
  env?: NodeJS.ProcessEnv;
}

export interface BootstrapResult {
  dataRoot: string;
  logsDirectory: string;
  cacheDirectory: string;
}

/**
 * Call early in Electron Main, before opening sessions or SQLite.
 * Phase 1 Task 3 only: lifecycle caller (index.ts) belongs to another task.
 */
export async function bootstrapApplication(input: BootstrapPaths): Promise<BootstrapResult> {
  const dataRoot = resolveLauncherDataRoot(input);
  await ensureWritableDataRoot(dataRoot);
  // Do not redirect userData before writable-path validation succeeds.
  input.electronApp.setPath('userData', dataRoot);
  const logsDirectory = path.join(dataRoot, 'logs');
  const cacheDirectory = path.join(dataRoot, 'cache');
  // Symlinks are never accepted as persistence roots.
  await ensureWritableDataRoot(logsDirectory);
  await ensureWritableDataRoot(cacheDirectory);
  return { dataRoot, logsDirectory, cacheDirectory };
}
