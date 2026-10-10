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
import {open,readdir,readFile,lstat,writeFile} from 'node:fs/promises';
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
 if(typeof entry!=='string'||entry.length===0||entry.length>1024||/[\x00-\x1f\x7f\u0080-\u009f\u202a-\u202e\u2066-\u2069]/.test(entry))
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
 const directories=new Set();
 const files=new Set();
 for(let i=0;i<items.length;i++){
  const key=items[i].toLowerCase();
  if(zipEntries[i].endsWith('/')||zipEntries[i].endsWith('\\'))directories.add(key);
  else files.add(key);
 }
 for(const entry of normalized){
  if(directories.has(entry)&&files.has(entry))
   throw new Error('ZIP file collides with directory path');
  let parentEnd=entry.indexOf('/');
  while(parentEnd!==-1){
   if(files.has(entry.slice(0,parentEnd)))
    throw new Error('ZIP file collides with nested path');
   parentEnd=entry.indexOf('/',parentEnd+1);
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

/** Stable artifacts must match the built application's actual package version. */
export function assertStablePackageVersion(version,packageVersion){
 expectedWindowsArtifacts(version);
 if(typeof packageVersion!=='string'||packageVersion!==version)
  throw new Error('Stable artifact version differs from package.json or contains a prerelease identifier');
 return true;
}

/**
 * Development builds may already create SHA256SUMS. Verify every digest,
 * and never rewrite an existing checksum manifest.
 * This does not prove Authenticode signatures or executable provenance.
 */
export async function writeOrVerifyChecksumManifest(path,expectedLines){
 if(!Array.isArray(expectedLines)||expectedLines.length!==3)
  throw new Error('Invalid release checksum manifest expectations');
 const row=/^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]{0,254}\.(?:exe|zip))$/;
 const expected=new Map();
 for(const line of expectedLines){
  if(typeof line!=='string')throw new Error('Invalid release checksum line');
  const match=row.exec(line);
  if(!match||expected.has(match[2]))throw new Error('Invalid or duplicate expected checksum entry');
  expected.set(match[2],match[1]);
 }
 let info;
 try{info=await lstat(path);}
 catch(error){
  if(error?.code!=='ENOENT')throw error;
  // wx prevents overwriting a manifest created in an existence-check race.
  await writeFile(path,expectedLines.join('\n')+'\n',{flag:'wx'});
  return 'created';
 }
 if(info.isSymbolicLink()||!info.isFile()||info.size>8192||info.size<100)
  throw new Error('Unsafe existing checksum manifest path or file size');
 const current=await readFile(path,'utf8');
 const lines=(current.startsWith('\uFEFF')?current.slice(1):current).split(/\r?\n/);
 if(lines.at(-1)==='')lines.pop();
 if(lines.length!==expected.size)throw new Error('Release checksum manifest entry count mismatch');
 const observed=new Set();
 for(const line of lines){
  const match=row.exec(line);
  if(!match||observed.has(match[2])||expected.get(match[2])!==match[1])
   throw new Error('Invalid, duplicate or mismatched release checksum manifest entry');
  observed.add(match[2]);
 }
 return 'verified';
}

/**
 * Read ZIP central-directory attributes without extracting any archive data.
 * Filename-only tar listings do not expose Unix symlink file types or ZIP
 * encryption. This checks metadata safety, not full archive decompression.
 */
export async function inspectReleaseZipEntryTypes(path){
 const handle=await open(path,'r');
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.size<22)throw new Error('Invalid release ZIP archive');
  const tailSize=Math.min(stat.size,65557);
  const tail=Buffer.alloc(tailSize);
  if((await handle.read(tail,0,tailSize,stat.size-tailSize)).bytesRead!==tailSize)
   throw new Error('Incomplete ZIP end-of-directory read');
  let eocd=-1;
  for(let offset=tailSize-22;offset>=0;offset--){
   if(tail.readUInt32LE(offset)===0x06054b50&&
      offset+22+tail.readUInt16LE(offset+20)===tailSize){
    eocd=offset;break;
   }
  }
  if(eocd<0)throw new Error('Missing ZIP central-directory terminator');
  const disk=tail.readUInt16LE(eocd+4),cdDisk=tail.readUInt16LE(eocd+6);
  const countDisk=tail.readUInt16LE(eocd+8),count=tail.readUInt16LE(eocd+10);
  const size=tail.readUInt32LE(eocd+12),start=tail.readUInt32LE(eocd+16);
  // ZIP64/multi-volume archives are not part of the x64 desktop release.
  if(disk||cdDisk||countDisk!==count||count===0||count===0xffff||
     count>ENTRY_MAX||size===0xffffffff||start===0xffffffff||
     size===0||size>32*1024*1024)
   throw new Error('Unsupported ZIP64, split or oversized ZIP archive');
  const eocdPosition=stat.size-tailSize+eocd;
  if(start+size>eocdPosition)throw new Error('Invalid ZIP central-directory bounds');
  const central=Buffer.alloc(size);
  if((await handle.read(central,0,size,start)).bytesRead!==size)
   throw new Error('Incomplete ZIP central-directory read');
  let offset=0,totalUncompressedBytes=0;
  for(let index=0;index<count;index++){
   if(offset+46>size||central.readUInt32LE(offset)!==0x02014b50)
    throw new Error('Invalid ZIP central-directory entry');
   const flags=central.readUInt16LE(offset+8);
   const compression=central.readUInt16LE(offset+10);
   const compressedBytes=central.readUInt32LE(offset+20);
   const uncompressedBytes=central.readUInt32LE(offset+24);
   const nameLength=central.readUInt16LE(offset+28);
   const extraLength=central.readUInt16LE(offset+30);
   const commentLength=central.readUInt16LE(offset+32);
   const startingDisk=central.readUInt16LE(offset+34);
   const attrs=central.readUInt32LE(offset+38);
   if(flags&0x41)throw new Error('Encrypted ZIP entries are forbidden in Stable archives');
   if(startingDisk!==0||compressedBytes===0xffffffff||uncompressedBytes===0xffffffff)
    throw new Error('Unsupported multi-volume or ZIP64 entry in release archive');
   if(compression!==0&&compression!==8)throw new Error('Unsupported ZIP compression method');
   if(compression===0&&compressedBytes!==uncompressedBytes)
    throw new Error('Invalid stored ZIP entry size mismatch');
   // Budget is based on uncompressed bytes, not archive file size.
   // A high-ratio member is suspicious even when its overall ZIP is small.
   if(uncompressedBytes>2*1024**3||
      (uncompressedBytes>1024**2&&(compressedBytes===0||uncompressedBytes>compressedBytes*1000)))
    throw new Error('ZIP archive decompression budget or compression ratio exceeded');
   totalUncompressedBytes+=uncompressedBytes;
   if(totalUncompressedBytes>8*1024**3)
    throw new Error('ZIP archive total decompressed size budget exceeded');
   // Reject symlinks, FIFO, sockets and device nodes even if the creator OS
   // field lies; ordinary regular files and directories remain supported.
   const mode=(attrs>>>16)&0o170000;
   if((mode!==0&&mode!==0o100000&&mode!==0o040000)||(attrs&0x400)!==0)
    throw new Error('Unsafe special ZIP entry type or Windows reparse point');
   if(!nameLength||nameLength>1024||offset+46+nameLength+extraLength+commentLength>size)
    throw new Error('Invalid ZIP central-directory path budget');
   offset+=46+nameLength+extraLength+commentLength;
  }
  if(offset!==size)throw new Error('ZIP central-directory count or length mismatch');
  return Object.freeze({entryCount:count,totalUncompressedBytes});
 }finally{await handle.close();}
}

async function digest(path){
 const hash=createHash('sha256');
 for await(const data of createReadStream(path))hash.update(data);
 return hash.digest('hex');
}
/** Validate the PE/COFF header and AMD64 machine type, not just DOS MZ bytes. */
export function isWindowsX64Pe(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<0x40||buffer.readUInt16LE(0)!==0x5a4d)return false;
 const offset=buffer.readUInt32LE(0x3c);
 if(offset<0x40||offset+26>buffer.length)return false;
 return buffer.readUInt32LE(offset)===0x00004550&&
  buffer.readUInt16LE(offset+4)===0x8664&&
  buffer.readUInt16LE(offset+20)>=2&&
  buffer.readUInt16LE(offset+24)===0x20b;
}

async function validateX64Pe(path){
 const handle=await open(path,'r');
 try{
  const dos=Buffer.alloc(0x40);
  if((await handle.read(dos,0,dos.length,0)).bytesRead!==dos.length)return false;
  if(dos.readUInt16LE(0)!==0x5a4d)return false;
  const offset=dos.readUInt32LE(0x3c);
  if(offset<0x40||offset>1024*1024)return false;
  const coff=Buffer.alloc(26);
  if((await handle.read(coff,0,coff.length,offset)).bytesRead!==coff.length)return false;
  return coff.readUInt32LE(0)===0x00004550&&coff.readUInt16LE(4)===0x8664&&
   coff.readUInt16LE(20)>=2&&coff.readUInt16LE(24)===0x20b;
 }finally{await handle.close();}
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
 const packageJson=JSON.parse(await readFile(fileURLToPath(new URL('../package.json',import.meta.url)),'utf8'));
 assertStablePackageVersion(version,packageJson.version);
 const folder=resolve(location);
 const found=await readdir(folder);
 const zip=join(folder,names[2]);
 const listed=spawnSync('tar.exe',['-tf',zip],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:30_000});
 if(listed.status!==0||listed.error)throw new Error('ZIP entry enumeration failed');
 const entries=listed.stdout.split(/\r?\n/).filter(Boolean);
 const verified=validateWindowsReleaseLayout({version,artifactNames:found,zipEntries:entries});
 const inspected=await inspectReleaseZipEntryTypes(zip);
 if(inspected.entryCount!==verified.zipEntryCount)
  throw new Error('ZIP central-directory entry count differs from archive filename inventory');
 const checksums=[];
 for(const [i,name] of names.entries()){
  const full=join(folder,name),info=await lstat(full);
  if(info.isSymbolicLink()||!info.isFile()||info.size<64*1024)throw new Error('Missing, linked or invalid release artifact: '+name);
  if(i===2?!(await magic(full,Buffer.from([0x50,0x4b,0x03,0x04]))):!(await validateX64Pe(full)))
   throw new Error('Invalid Windows x64 PE executable or ZIP signature: '+name);
  checksums.push(`${await digest(full)}  ${name}`);
 }
 // Verify a pre-existing build manifest or create one without overwriting.
 const manifestState=await writeOrVerifyChecksumManifest(join(folder,'SHA256SUMS.txt'),checksums);
 process.stdout.write(`Release inventory passed: ${verified.version}, ${verified.zipEntryCount} ZIP entries; SHA256SUMS ${manifestState}.\n`);
 process.stdout.write('WARNING: This is inventory validation only; remaining RG gates still require independent evidence.\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runFinalArtifactInventory().catch(error=>{
  process.stderr.write('Release blocked: '+(error instanceof Error?error.message:'unknown failure')+'\n');
  process.exitCode=1;
 });
}
