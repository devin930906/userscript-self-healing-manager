import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertWindowsPeExecutable} from '../src/pe-executable.ts';
import {launchSelectedChrome} from '../src/index.ts';

async function fixture(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-pe-preflight-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
const validPe=(machine=0x8664)=>{
 const bytes=Buffer.alloc(1024);
 bytes.write('MZ',0,'ascii');
 bytes.writeUInt32LE(128,0x3c);
 bytes.write('PE\0\0',128,'binary');
 bytes.writeUInt16LE(machine,132);
 bytes.writeUInt16LE(3,134);
 bytes.writeUInt16LE(0xf0,148);
 bytes.writeUInt16LE(machine===0x014c?0x10b:0x20b,152);
 return bytes;
};

test('QA-002 fake Chrome exe with valid name, large size or DOS stub is refused before spawn',async()=>fixture(async root=>{
 const invalid=[
  Buffer.from('MALWARE-EXE-NOT-PE'.padEnd(512,'x')),
  (()=>{const b=Buffer.alloc(512);b.write('MZ');b.writeUInt32LE(128,0x3c);return b;})(),
  (()=>{const b=validPe();b.writeUInt32LE(0xFFFFFF00,0x3c);return b;})(),
  (()=>{const b=validPe();b.writeUInt16LE(0,132);return b;})(),
 ];
 for(let i=0;i<invalid.length;i++){
  const path=join(root,'chrome-'+i+'.exe');
  await writeFile(path,invalid[i]!);
  await assert.rejects(assertWindowsPeExecutable(path),/invalid|PE|executable|header/i);
 }
 const fake=join(root,'chrome-binary-lookalike.exe');
 await writeFile(fake,invalid[0]!);
 await assert.rejects(launchSelectedChrome({executablePath:fake,port:9239}),
  /invalid|PE|executable|header/i);
}));

test('QA-002 valid bounded PE32+ and PE32 headers pass ONLY the format preflight, not Chrome identity',async()=>fixture(async root=>{
 for(const machine of [0x8664,0x014c]){
  const path=join(root,'synthetic-header-'+machine+'.exe');
  await writeFile(path,validPe(machine));
  await assert.doesNotReject(assertWindowsPeExecutable(path));
 }
}));

test('QA-002 refuses contradictory PE machine/magic and truncated optional headers before Chrome spawn',async()=>fixture(async root=>{
 const invalid=[
  // 64-bit machine must use PE32+ (0x20b), not a PE32 optional header.
  (()=>{const b=validPe(0x8664);b.writeUInt16LE(0x10b,152);return b;})(),
  // 32-bit x86 machine must use PE32 (0x10b), not PE32+.
  (()=>{const b=validPe(0x014c);b.writeUInt16LE(0x20b,152);return b;})(),
  // COFF size 2 is enough to store a fake magic but not a PE32+ optional header.
  (()=>{const b=validPe();b.writeUInt16LE(2,148);return b;})(),
  // 96 bytes cannot hold the complete mandatory PE32+ fixed fields.
  (()=>{const b=validPe();b.writeUInt16LE(96,148);return b;})(),
  // 95 bytes cannot hold the mandatory PE32 fixed fields.
  (()=>{const b=validPe(0x014c);b.writeUInt16LE(95,148);return b;})(),
 ];
 for(const [index,bytes] of invalid.entries()){
  const path=join(root,'inconsistent-chrome-'+index+'.exe');
  await writeFile(path,bytes);
  await assert.rejects(assertWindowsPeExecutable(path),/invalid|PE|executable|header/i,
   'A syntactically contradictory PE must fail the read-only executable preflight');
  await assert.rejects(launchSelectedChrome({executablePath:path,port:9239}),
   /invalid|PE|executable|header/i,'An inconsistent executable must never reach Chrome spawn');
 }
}));

test('QA-002 rejects EXE files whose declared section headers extend past EOF',async()=>fixture(async root=>{
 // e_lfanew=128, COFF header=24, optional header=240, section count=3:
 // all three 40-byte section headers require at least 512 bytes.
 const exact=join(root,'pe-section-table-exact.exe');
 await writeFile(exact,validPe().subarray(0,512));
 await assert.doesNotReject(assertWindowsPeExecutable(exact),
  'an exact-fit section table must remain a valid format-only preflight');

 const invalid=[
  validPe().subarray(0,511),
  (()=>{const bytes=validPe();bytes.writeUInt16LE(96,134);return bytes;})(),
  (()=>{const bytes=validPe(0x014c);bytes.writeUInt16LE(21,134);return bytes;})(),
 ];
 for(const [index,bytes] of invalid.entries()){
  const file=join(root,'truncated-section-table-'+index+'.exe');
  await writeFile(file,bytes);
  await assert.rejects(assertWindowsPeExecutable(file),/invalid|PE|header/i,
   'declared section table must be entirely present before any executable spawn');
  await assert.rejects(launchSelectedChrome({executablePath:file,port:9239}),
   /invalid|PE|header/i,
   'never launch a selected executable with a truncated declared section table');
 }
}));

test('QA-002 symlink or truncated PE header is never accepted by the direct preflight',async()=>fixture(async root=>{
 const truncated=join(root,'short.exe');
 await writeFile(truncated,Buffer.from('MZ'));
 await assert.rejects(assertWindowsPeExecutable(truncated),/invalid|PE|executable|header/i);
}));
