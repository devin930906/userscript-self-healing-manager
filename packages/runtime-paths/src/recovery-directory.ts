import {lstat} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';

/**
 * Fail closed when any existing ancestor of a trusted recovery directory is
 * a symlink / Windows Junction. Checking only the leaf lstat() follows parent
 * reparse points and can read or write outside the chosen directory tree.
 *
 * This is a path preflight, not an atomic defense against concurrent renames.
 * Callers must still claim destination directories exclusively and pin reads.
 */
export async function assertUnlinkedRecoveryDirectory(path:string):Promise<void>{
 if(typeof path!=='string'||!isAbsolute(path))
  throw new Error('Unsafe core recovery directory path');
 const chain:string[]=[];
 for(let current=resolve(path);;){
  chain.push(current);
  const parent=dirname(current);
  if(parent===current)break;
  current=parent;
 }
 for(const component of chain.reverse()){
  const stat=await lstat(component);
  if(!stat.isDirectory()||stat.isSymbolicLink())
   throw new Error('Unsafe core recovery directory: symlink or junction ancestor');
 }
}
