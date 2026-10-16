import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectReleaseZipEntryTypes} from '../../scripts/windows-release-gate.mjs';

type Member=Readonly<{name:string;localOffset:number;payloadBytes:number}>;

function localStoredMember(name:string,payload:Buffer):Buffer{
 const nameBytes=Buffer.from(name,'utf8');
 const header=Buffer.alloc(30+nameBytes.length);
 header.writeUInt32LE(0x04034b50,0);
 header.writeUInt16LE(20,4);
 header.writeUInt32LE(payload.length,18);
 header.writeUInt32LE(payload.length,22);
 header.writeUInt16LE(nameBytes.length,26);
 nameBytes.copy(header,30);
 return Buffer.concat([header,payload]);
}

function finishZip(local:Buffer,members:readonly Member[]):Buffer{
 const records=members.map(({name,localOffset,payloadBytes})=>{
  const bytes=Buffer.from(name,'utf8');
  const central=Buffer.alloc(46+bytes.length);
  central.writeUInt32LE(0x02014b50,0);
  central.writeUInt16LE(20,4);
  central.writeUInt16LE(20,6);
  central.writeUInt32LE(payloadBytes,20);
  central.writeUInt32LE(payloadBytes,24);
  central.writeUInt16LE(bytes.length,28);
  central.writeUInt32LE(0x20,38);
  central.writeUInt32LE(localOffset,42);
  bytes.copy(central,46);
  return central;
 });
 const directory=Buffer.concat(records);
 const end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(members.length,8);
 end.writeUInt16LE(members.length,10);
 end.writeUInt32LE(directory.length,12);
 end.writeUInt32LE(local.length,16);
 return Buffer.concat([local,directory,end]);
}

test('RG-09 accepts distinct non-overlapping local ZIP member regions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-zip-disjoint-'));
 try{
  const name1='resources/app.asar',name2='locales/en-US.pak';
  const first=localStoredMember(name1,Buffer.from('app'));
  const second=localStoredMember(name2,Buffer.from('locale'));
  const file=join(dir,'valid.zip');
  await writeFile(file,finishZip(Buffer.concat([first,second]),[
   {name:name1,localOffset:0,payloadBytes:3},
   {name:name2,localOffset:first.length,payloadBytes:6},
  ]));
  assert.equal((await inspectReleaseZipEntryTypes(file,{verifyLocalHeaders:true})).entryCount,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('RG-09 rejects a nested ZIP local member hidden inside another member payload',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-zip-overlap-'));
 try{
  const name1='resources/app.asar',name2='resources/nested.bin';
  const nested=localStoredMember(name2,Buffer.alloc(0));
  const outer=localStoredMember(name1,nested);
  const file=join(dir,'overlap.zip');
  await writeFile(file,finishZip(outer,[
   {name:name1,localOffset:0,payloadBytes:nested.length},
   {name:name2,localOffset:30+Buffer.byteLength(name1),payloadBytes:0},
  ]));
  await assert.rejects(inspectReleaseZipEntryTypes(file,{verifyLocalHeaders:true}),
   /overlap|intersect|collid|ZIP member region/i,
   'A second central-directory entry must not alias bytes already owned by another local member');
 }finally{await rm(dir,{recursive:true,force:true});}
});


// General-purpose ZIP writers may store the CRC and sizes after file data
// when bit 3 is set. The release parser must check this local descriptor,
// not just the central-directory values: a missing descriptor creates
// extractor-dependent archive interpretations.
test('RG-09 accepts signed and unsigned valid ZIP data descriptors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-zip-descriptor-valid-'));
 try{
  const name='resources/app.asar',payload=Buffer.from('xyz');
  const crc32=0xeb8eba67; // CRC-32 of the fixed synthetic 'xyz' payload
  for(const signed of [true,false]){
   const local=localStoredMember(name,payload);
   local.writeUInt16LE(8,6);
   // With bit 3 set the local CRC and sizes may be zero until descriptor.
   local.writeUInt32LE(0,18);local.writeUInt32LE(0,22);
   const descriptor=Buffer.alloc(signed?16:12);
   const at=signed?4:0;
   if(signed)descriptor.writeUInt32LE(0x08074b50,0);
   descriptor.writeUInt32LE(crc32,at);
   descriptor.writeUInt32LE(payload.length,at+4);
   descriptor.writeUInt32LE(payload.length,at+8);
   const file=join(dir,signed?'signed.zip':'unsigned.zip');
   const data=finishZip(Buffer.concat([local,descriptor]),[
    {name,localOffset:0,payloadBytes:payload.length},
   ]);
   const centralOffset=local.length+descriptor.length;
   data.writeUInt16LE(8,centralOffset+8);
   data.writeUInt32LE(crc32,centralOffset+16);
   await writeFile(file,data);
   assert.equal((await inspectReleaseZipEntryTypes(file,{verifyLocalHeaders:true})).entryCount,1);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('RG-09 rejects a bit-3 ZIP member with missing or forged local data descriptor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'usshm-zip-descriptor-forged-'));
 try{
  const name='resources/app.asar',payload=Buffer.from('xyz');
  const crc32=0xeb8eba67;
  const local=localStoredMember(name,payload);
  local.writeUInt16LE(8,6);
  local.writeUInt32LE(0,18);local.writeUInt32LE(0,22);
  // A central-only CRC/size is not a valid local data descriptor. Real ZIP
  // extractors can disagree about whether this member was complete.
  const absent=finishZip(local,[{name,localOffset:0,payloadBytes:payload.length}]);
  absent.writeUInt16LE(8,local.length+8);
  absent.writeUInt32LE(crc32,local.length+16);
  const absentFile=join(dir,'missing.zip');
  await writeFile(absentFile,absent);
  await assert.rejects(inspectReleaseZipEntryTypes(absentFile,{verifyLocalHeaders:true}),
   /descriptor|invalid|missing|bounds/i);
  // Now include a 16-byte descriptor, but lie about compressed byte count.
  const malformed=Buffer.alloc(16);
  malformed.writeUInt32LE(0x08074b50,0);
  malformed.writeUInt32LE(crc32,4);
  malformed.writeUInt32LE(payload.length+1,8);
  malformed.writeUInt32LE(payload.length,12);
  const bad=finishZip(Buffer.concat([local,malformed]),[
   {name,localOffset:0,payloadBytes:payload.length},
  ]);
  bad.writeUInt16LE(8,local.length+malformed.length+8);
  bad.writeUInt32LE(crc32,local.length+malformed.length+16);
  const badFile=join(dir,'forged.zip');
  await writeFile(badFile,bad);
  await assert.rejects(inspectReleaseZipEntryTypes(badFile,{verifyLocalHeaders:true}),
   /descriptor|invalid|mismatch|bounds/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});
