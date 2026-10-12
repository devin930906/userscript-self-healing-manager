import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';

/**
 * Bounded Windows PE format preflight for an explicitly selected Chrome EXE.
 * Neither an .exe extension nor a length >64 establishes executable identity.
 * This is NOT a digital-signature, publisher, or Chrome-brand certification:
 * a correctly formed malicious PE still requires the user's own trust decision.
 * The launcher independently verifies the real Chrome CDP Browser.getVersion.
 */
export async function assertWindowsPeExecutable(path:string):Promise<void>{
 const invalid=()=>new Error('Invalid selected Chrome executable PE header');
 if(typeof path!=='string'||!/\.exe$/i.test(path))throw invalid();
 const before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||before.size<128)throw invalid();
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const opened=await handle.stat();
  if(!opened.isFile()||opened.size!==before.size||
     opened.dev!==before.dev||opened.ino!==before.ino)throw invalid();
  const dos=Buffer.alloc(64);
  if((await handle.read(dos,0,dos.length,0)).bytesRead!==dos.length||
     dos.toString('ascii',0,2)!=='MZ')throw invalid();
  const offset=dos.readUInt32LE(0x3c);
  // Portable Chrome typically uses a small DOS stub. Do not accept massive
  // offsets that could drive unbounded reads during an otherwise safe preflight.
  if(offset<64||offset>4096||offset+26>opened.size)throw invalid();
  const pe=Buffer.alloc(26);
  if((await handle.read(pe,0,pe.length,offset)).bytesRead!==pe.length||
     pe.toString('binary',0,4)!=='PE\0\0')throw invalid();
  const machine=pe.readUInt16LE(4);
  const sections=pe.readUInt16LE(6);
  const optionalBytes=pe.readUInt16LE(20);
  const magic=pe.readUInt16LE(24);
  // PE32 uses x86; x64 and ARM64 use PE32+. The fixed optional header
  // must fit in SizeOfOptionalHeader before Windows is asked to launch it.
  const expectedMagic=machine===0x014c?0x10b:
   machine===0x8664||machine===0xaa64?0x20b:null;
  const minOptionalBytes=expectedMagic===0x10b?96:112;
  if(expectedMagic===null||magic!==expectedMagic||sections<1||sections>96||
     optionalBytes<minOptionalBytes||offset+24+optionalBytes>opened.size)
   throw invalid();
  const after=await handle.stat();
  const atPath=await lstat(path);
  if(!after.isFile()||after.size!==opened.size||
     after.ino!==opened.ino||after.dev!==opened.dev||
     atPath.isSymbolicLink()||!atPath.isFile()||
     atPath.size!==opened.size||atPath.ino!==opened.ino||atPath.dev!==opened.dev)
   throw invalid();
 }finally{await handle.close();}
}
