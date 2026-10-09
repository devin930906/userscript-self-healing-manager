/**
 * Fail-closed packaging INVENTORY gate for a future Windows Stable release.
 * Does not build artifacts, launch executables, or publish a GitHub Release.
 * It is only one RG-09 prerequisite: installation, migration, signing and
 * Windows 10/11 real launch tests remain separately mandatory.
 *
 * CLI (only after all three builds exist on a Windows release runner):
 *   node scripts/windows-release-gate.mjs <VERSION> <RELEASE_DIRECTORY>
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {open,readdir,stat,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const PREFIX='Userscript-Self-Healing-Manager';
const STRICT_VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ENTRY_MAX=20_000;

export function expectedWindowsArtifacts(version){
 if(typeof version!=='string'||!STRICT_VERSION.test(version))
  throw new Error('Invalid Stable release version: exact x.y.z required');
 return [
  `${PREFIX}-Setup-${version}-win-x64.exe`,
  `${PREFIX}-Portable-${version}-win-x64.exe`,
  `${PREFIX}-${version}-win-x64.zip`,
 ];
}

function normalizedZipEntry(entry){
 if(typeof entry!=='string'||entry.length===0||entry.length>1024||/[\x00-\x1f\x7f]/.test(entry))
  throw new Error('Unsafe ZIP entry name or length');
 const name=entry.replace(/\\/g,'/').replace(/\/$/,'');
 // Reject Unicode compatibility spellings that Win32 tooling may normalize
 // into reserved devices or create colliding extraction destinations.
 if(name.normalize('NFKC')!==name)
  throw new Error('Unsafe Unicode-normalized Windows ZIP path');
 if(!name||name.startsWith('/')||/^[a-z]:/i.test(name)||
   name.split('/').some(segment=>!segment||segment==='.'||segment==='..'))
  throw new Error('Unsafe ZIP path traversal or absolute path');
 const segments=name.split('/');
 // Windows extraction can reinterpret ":" as an NTFS alternate data stream
 // or reserve device names even when nested and followed by an extension.
 // Trailing dots/spaces also alias distinct ZIP names on Win32.
 if(segments.some(segment=>/[<>:"|?*]/.test(segment)||/[. ]$/.test(segment)||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(segment)))
  throw new Error('Unsafe Windows ZIP path, device name or alternate stream');
 if(segments.some(s=>s.toLowerCase()==='data')||
    /\.user\.js$/i.test(name)||/(?:^|\/)\.env(?:\.|$)/i.test(name)||
    /(?:api[-_]?key|credential|secret|private[-_]?key)/i.test(name))
  throw new Error('Private Data, userscript or secret-like path forbidden in release ZIP');
 if(/(?:^|\/)(?:Userscript-Self-Healing-Manager-)?(?:Setup|Portable)-[^/]+\.exe$/i.test(name)||
    /portable-[^/]+\.exe$/i.test(name))
  throw new Error('Portable or installer EXE must not substitute for the unpacked ZIP');
 return name;
}

/**
 * Validates the REQUIRED three-format release names and a complete unpacked
 * app inventory. Does NOT certify executable launch, archive integrity,
 * signatures, platform compatibility, or V3/V4 behavior.
 */
export function validateWindowsReleaseLayout({version,artifactNames,zipEntries}){
 const required=expectedWindowsArtifacts(version);
 if(!Array.isArray(artifactNames)||artifactNames.length>1000||
    artifactNames.some(name=>typeof name!=='string'||name.length>255))
  throw new Error('Invalid Windows release artifact inventory');
 const selected=artifactNames.filter(n=>/\.(?:exe|zip)$/i.test(n));
 if(selected.length!==3||new Set(selected).size!==3||
    selected.some(n=>!required.includes(n))||
    required.some(n=>!selected.includes(n)))
  throw new Error('Windows Stable release requires exactly one Setup EXE, Portable EXE and full ZIP');
 if(!Array.isArray(zipEntries)||zipEntries.length===0||zipEntries.length>ENTRY_MAX)
  throw new Error('Empty or oversized release ZIP archive inventory');
 const items=zipEntries.map(normalizedZipEntry);
 const normalized=new Set(items.map(s=>s.toLowerCase()));
 if(normalized.size!==items.length)throw new Error('Unsafe duplicate ZIP paths');
 // A file and directory cannot share the same extraction destination.
 // Also reject an entry that would have to be both a file and ancestor folder.
 const directories=new Set(zipEntries.filter(e=>e.endsWith('/')||e.endsWith('\\')).map(normalizedZipEntry).map(s=>s.toLowerCase()));
 for(const entry of normalized){
  if(directories.has(entry)&&items.some((name,i)=>name.toLowerCase()===entry&&
       !zipEntries[i].endsWith('/')&&!zipEntries[i].endsWith('\\')))
   throw new Error('ZIP file collides with directory path');
  const parts=entry.split('/');
  for(let i=1;i<parts.length;i++){
   const parent=parts.slice(0,i).join('/');
   if(normalized.has(parent)&&!directories.has(parent))
    throw new Error('ZIP file collides with nested path');
  }
 }
 // electron-builder zip normally uses the win-unpacked root; allow one
 // optional enclosing directory, but require all core files under the same root.
 const executables=items.filter(n=>n.toLowerCase().endsWith('/'+PREFIX.toLowerCase()+'.exe')||
  n.toLowerCase()===PREFIX.toLowerCase()+'.exe');
 if(executables.length!==1)throw new Error('Full unpacked ZIP must contain exactly one app executable');
 const executable=executables[0];
 const root=executable.slice(0,executable.length-(PREFIX+'.exe').length);
 const has=(p)=>normalized.has((root+p).toLowerCase());
 if(!has('resources/app.asar')||
    !items.some(p=>p.startsWith(root+'locales/')&&/\.pak$/i.test(p))||
    !items.some(p=>p.startsWith(root)&&/\.dll$/i.test(p))||
    !items.some(p=>p.startsWith(root)&&/\.pak$/i.test(p)))
  throw new Error('ZIP missing required unpacked Electron resources, locales, DLL or pak assets');
 if(root&&items.some(p=>!p.startsWith(root)))
  throw new Error('ZIP contains files outside its unpacked application root');
 return Object.freeze({version,artifacts:Object.freeze([...required]),zipEntryCount:items.length});
}

async function digest(path){
 const hash=createHash('sha256');
 for await(const data of createReadStream(path))hash.update(data);
 return hash.digest('hex');
}
async function magic(path,expected){
 const handle=await open(path,'r');
 try{
  const buffer=Buffer.alloc(expected.length);
  const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
  return bytesRead===expected.length&&buffer.equals(expected);
 }finally{await handle.close();}
}

/** Fail-closed release-stage CLI, intentionally NOT wired to dev/test CI. */
async function runFinalArtifactInventory(){
 if(process.platform!=='win32')throw new Error('Windows release gate requires a real Windows build runner');
 const [version,location,...extra]=process.argv.slice(2);
 if(extra.length||!location)throw new Error('Usage: node scripts/windows-release-gate.mjs VERSION RELEASE_DIRECTORY');
 const names=expectedWindowsArtifacts(version);
 const folder=resolve(location);
 const found=await readdir(folder);
 const zip=join(folder,names[2]);
 const listed=spawnSync('tar.exe',['-tf',zip],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:30_000});
 if(listed.status!==0||listed.error)throw new Error('ZIP entry enumeration failed');
 const entries=listed.stdout.split(/\r?\n/).filter(Boolean);
 const verified=validateWindowsReleaseLayout({version,artifactNames:found,zipEntries:entries});
 const checksums=[];
 for(const [i,name] of names.entries()){
  const full=join(folder,name),info=await stat(full);
  if(!info.isFile()||info.size<64*1024)throw new Error('Missing, empty or invalid release artifact: '+name);
  if(!(await magic(full,i===2?Buffer.from([0x50,0x4b]):Buffer.from([0x4d,0x5a]))))
   throw new Error('Invalid EXE or ZIP signature: '+name);
  checksums.push(`${await digest(full)}  ${name}`);
 }
 // Never overwrite an existing signed or published manifest.
 await writeFile(join(folder,'SHA256SUMS.txt'),checksums.join('\n')+'\n',{flag:'wx'});
 process.stdout.write(`Release inventory passed: ${verified.version}, ${verified.zipEntryCount} ZIP entries; SHA256SUMS written.\n`);
 process.stdout.write('WARNING: This is inventory validation only; remaining RG gates still require independent evidence.\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runFinalArtifactInventory().catch(error=>{
  process.stderr.write('Release blocked: '+(error instanceof Error?error.message:'unknown failure')+'\n');
  process.exitCode=1;
 });
}
