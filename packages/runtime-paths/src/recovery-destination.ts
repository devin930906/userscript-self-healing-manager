import {realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';

/** A child starting with ".." is NOT a parent traversal unless followed by
 * a platform path separator. This matters for folders such as "..backups". */
function isWithin(root:string,candidate:string):boolean{
 const rel=relative(root,candidate);
 return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));
}

/**
 * Prevent exporting a backup into the Data tree being backed up.
 *
 * Check both lexical names and canonical physical parents: on Windows a
 * junction in an ancestor (and on POSIX a directory symlink) can make a
 * syntactically external path lead back into Data. The destination parent
 * must already exist. Fail closed on realpath errors. This is a preflight,
 * not a hostile concurrent filesystem-rename transaction; callers still
 * claim the new destination exclusively and never overwrite existing data.
 */
export async function assertRecoveryDestinationOutsideSource(
 sourceDirectory:string,destination:string,
):Promise<void>{
 if(typeof sourceDirectory!=='string'||typeof destination!=='string'||
    !isAbsolute(sourceDirectory)||!isAbsolute(destination))
  throw new Error('Absolute source and backup destination are required');
 const source=resolve(sourceDirectory),target=resolve(destination);
 if(isWithin(source,target))
  throw new Error('Recovery backup destination cannot be inside source Data');
 const [canonicalSource,canonicalParent]=await Promise.all([
  realpath(source),realpath(dirname(target))
 ]);
 const canonicalTarget=join(canonicalParent,basename(target));
 if(isWithin(canonicalSource,canonicalTarget))
  throw new Error('Recovery backup destination resolves inside source Data');
}
