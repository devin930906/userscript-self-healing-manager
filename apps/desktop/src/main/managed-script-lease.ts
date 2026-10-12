import {isAbsolute,resolve} from 'node:path';

/**
 * Main-process singleflight lease shared by both existing single-script and
 * new multi-script durable managed-revision writers. It reserves the *whole*
 * approved set synchronously, before any async disk operation can yield.
 *
 * This is not an interprocess lock: Windows distribution still requires the
 * Electron single-instance gate and independent release qualification.
 * Never use this as permission to write original userscripts.
 */
const activeManagedScripts=new Set<string>();
const SCRIPT=/^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS=64;

export function reserveManagedScriptWrites(dataRoot:string,scriptIds:readonly string[]):()=>void{
 if(typeof dataRoot!=='string'||!isAbsolute(dataRoot)||dataRoot.length>4096||
    !Array.isArray(scriptIds)||scriptIds.length<1||scriptIds.length>MAX_ITEMS||
    scriptIds.some(id=>typeof id!=='string'||!SCRIPT.test(id)))
  throw new Error('Invalid managed script lease identity');
 const normalizedRoot=resolve(dataRoot);
 // Windows paths (and managed script IDs) cannot bypass an active write merely
 // by switching letter case. Never place file paths in public error messages.
 const rootKey=process.platform==='win32'?normalizedRoot.toLowerCase():normalizedRoot;
 const keys=scriptIds.map(id=>rootKey+'\u0000'+id.toLowerCase());
 if(new Set(keys).size!==keys.length)
  throw new Error('Duplicate managed script lease identity');
 if(keys.some(key=>activeManagedScripts.has(key)))
  throw new Error('Concurrent managed script repair already active');
 for(const key of keys)activeManagedScripts.add(key);
 let released=false;
 return ()=>{
  if(released)return;
  released=true;
  for(const key of keys)activeManagedScripts.delete(key);
 };
}
