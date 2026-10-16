import {link,rename} from 'node:fs/promises';

/**
 * Publish a same-directory, caller-owned staged settings file.
 * On FIRST creation, an atomic hard link fails with EEXIST if another process
 * published after our ENOENT preflight; unlike rename, it cannot clobber them.
 * Callers unlink the staged path in finally, leaving the destination durable.
 * An update of a previously validated existing file retains legacy rename;
 * this is not an atomic compare-and-swap for non-cooperating external writers.
 * Never fall back to rename if link is unavailable on the filesystem.
 */
export async function publishRegistrySettingsFile(
 stagedPath:string,targetPath:string,previouslyPresent:boolean,
):Promise<void>{
 if(typeof previouslyPresent!=='boolean')
  throw new Error('Invalid registry publication preflight');
 if(previouslyPresent){
  await rename(stagedPath,targetPath);
  return;
 }
 await link(stagedPath,targetPath);
}
