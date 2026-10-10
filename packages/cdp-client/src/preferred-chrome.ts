import {randomUUID} from 'node:crypto';
import {lstat,writeFile,rename,unlink} from 'node:fs/promises';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {isAbsolute,join} from 'node:path';

const PREFERENCE_FILE='preferred-chrome.json';
type PreferredChromeState={schemaVersion:1;executablePath:string};

async function isValidChromeExe(executablePath:string):Promise<boolean>{
 if(!isAbsolute(executablePath)||!/\.exe$/i.test(executablePath))return false;
 try{
  const info=await lstat(executablePath);
  return info.isFile()&&!info.isSymbolicLink();
 }catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return false;
  throw error;
 }
}
async function checkConfigPath(path:string):Promise<boolean>{
 let stat:Awaited<ReturnType<typeof lstat>>;
 try{stat=await lstat(path);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
 if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Unsafe Chrome settings file: symlink or non-regular file');
 if(stat.size>4096)throw new Error('Chrome settings file exceeds safe length');
 return true;
}
/** Remember a user-picked executable, but never start it during boot. */
export async function savePreferredChromePath({dataRoot,executablePath}:{
 dataRoot:string;executablePath:string;
}):Promise<void>{
 if(!isAbsolute(dataRoot))throw new Error('Absolute application data root required');
 if(!isAbsolute(executablePath))throw new Error('Absolute Chrome executable path required');
 if(!/\.exe$/i.test(executablePath))throw new Error('Selected Chrome executable must be an EXE');
 if(!await isValidChromeExe(executablePath))throw new Error('Chrome executable must be a regular file, not a symlink');
 const state:PreferredChromeState={schemaVersion:1,executablePath};
 const config=join(dataRoot,PREFERENCE_FILE),temp=join(dataRoot,'.chrome-preference-'+randomUUID()+'.tmp');
 await checkConfigPath(config);
 try{
  await writeFile(temp,JSON.stringify(state)+'\n',{flag:'wx',mode:0o600});
  // Only replace settings that are regular files; do not overwrite a link.
  await checkConfigPath(config);
  await rename(temp,config);
 }finally{await unlink(temp).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
}
/** Missing, invalid or moved Chrome binaries are unselected; never autorun paths read from disk. */
export async function loadPreferredChromePath({dataRoot}:{dataRoot:string}):Promise<string|null>{
 if(!isAbsolute(dataRoot))throw new Error('Absolute application data root required');
 const config=join(dataRoot,PREFERENCE_FILE);
 // A damaged, oversized or symlinked optional preference must not brick startup.
 try{if(!await checkConfigPath(config))return null;}
 catch{return null;}
 let parsed:unknown;
 // The preference is optional. A file that changes or grows after the
 // preliminary path check must not be reopened via unbounded path read or
 // break application startup. Treat all pin/parse failures as unselected.
 try{
  const bytes=await readPinnedRegularFile(config,{maxBytes:4096});
  parsed=JSON.parse(bytes.toString('utf8'));
 }catch{return null;}
 if(!parsed||typeof parsed!=='object')return null;
 const record=parsed as Partial<PreferredChromeState>;
 if(record.schemaVersion!==1||typeof record.executablePath!=='string')return null;
 return await isValidChromeExe(record.executablePath)?record.executablePath:null;
}
