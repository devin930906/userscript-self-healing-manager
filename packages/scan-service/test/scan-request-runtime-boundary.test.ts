import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openDatabase,migrateDatabase,createScriptRepository} from '../../persistence/src/index.ts';
import {runStaticScan,type ScanRequest} from '../src/index.ts';

/**
 * The exported scan service must validate runtime payloads before entering
 * importPaths, filesystem traversal, or SQLite mutation.
 */
test('RG-01 scan request rejects malformed path lists and recursive flags before any import',async()=>{
 const db=openDatabase(':memory:');
 migrateDatabase(db);
 const repository=createScriptRepository(db);
 const privateMarker='PRIVATE_SCAN_PAYLOAD_MUST_NOT_LEAK';
 const examples:[string,unknown][]=[
  ['null request',null],
  ['missing request',undefined],
  ['missing paths',{recursive:false,maxFiles:2}],
  ['null paths',{paths:null,recursive:false,maxFiles:2}],
  ['string paths',{paths:'./unexpected.user.js',recursive:false,maxFiles:2}],
  ['number entry',{paths:[42],recursive:false,maxFiles:2}],
  ['null entry',{paths:[null],recursive:false,maxFiles:2}],
  ['empty path',{paths:[''],recursive:false,maxFiles:2}],
  ['whitespace path',{paths:['   '],recursive:false,maxFiles:2}],
  ['truthy string recursive',{paths:['./synthetic.user.js'],recursive:'true',maxFiles:2}],
  ['false string recursive',{paths:['./synthetic.user.js'],recursive:'false',maxFiles:2}],
  ['missing recursive',{paths:['./synthetic.user.js'],maxFiles:2}],
  ['object path with private data',{paths:[{privateMarker}],recursive:false,maxFiles:2}],
 ];
 try{
  for(const [description,input] of examples){
   await assert.rejects(
    runStaticScan(input as ScanRequest,{repository}),
    error=>{
     assert.ok(error instanceof Error,description);
     assert.equal(error.message,'Invalid static scan request',description);
     assert.equal(error.message.includes(privateMarker),false);
     return true;
    },
    description,
   );
   assert.equal(repository.list().length,0,description+' must not touch the registry');
  }
 }finally{db.close();}
});

test('RG-01 valid empty scan keeps an empty inventory without touching filesystem',async()=>{
 const db=openDatabase(':memory:');
 migrateDatabase(db);
 try{
  const repository=createScriptRepository(db);
  const result=await runStaticScan({paths:[],recursive:false,maxFiles:2},{repository});
  assert.equal(result.scanMode,'static-only');
  assert.equal(result.requestedCount,0);
  assert.equal(result.processedCount,0);
  assert.deepEqual(result.items,[]);
  assert.equal(repository.list().length,0);
 }finally{db.close();}
});
