import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyCycloneDxSbom} from '../../scripts/sbom-evidence.mjs';

const rootName='userscript-self-healing-manager';
const rootVersion='0.1.0-alpha.5';
const sample=()=>({
 bomFormat:'CycloneDX',specVersion:'1.6',version:1,
 metadata:{component:{type:'application',name:rootName,version:rootVersion}},
 components:[
  {type:'library',name:'react',version:'19.2.0','bom-ref':'pkg:npm/react@19.2.0'},
  {type:'library',name:'typescript',version:'5.8.3','bom-ref':'pkg:npm/typescript@5.8.3'},
 ],
 dependencies:[{ref:'pkg:npm/react@19.2.0',dependsOn:[]}],
});

test('RG-02 accepts a pinned CycloneDX dependency inventory and returns count-only evidence',()=>{
 assert.deepEqual(verifyCycloneDxSbom(sample(),{name:rootName,version:rootVersion}),
  {componentCount:2,dependencyEdges:0,rootName,rootVersion});
});

test('RG-02 rejects empty, wrong-project and malformed dependency inventories',()=>{
 const variations:unknown[]=[
  {...sample(),bomFormat:'SPDX'},
  {...sample(),specVersion:'0.1'},
  {...sample(),version:0},
  {...sample(),metadata:{component:{type:'application',name:'other',version:rootVersion}}},
  {...sample(),metadata:{component:{type:'application',name:rootName,version:'0.0.0'}}},
  {...sample(),components:[]},
  {...sample(),components:[{type:'library',name:''}]},
  {...sample(),components:[null]},
  {...sample(),dependencies:'forged'},
 ];
 for(const item of variations){
  assert.throws(()=>verifyCycloneDxSbom(item,{name:rootName,version:rootVersion}),
   /Invalid|incomplete|mismatch|CycloneDX|SBOM|component/i);
 }
});

test('RG-02 SBOM validation errors never reflect dependency names, file paths or private tokens',()=>{
 const canary='PRIVATE_ACCOUNT_TOKEN_SHOULD_NOT_ESCAPE';
 const unsafe={...sample(),metadata:{component:{name:canary,version:rootVersion}}};
 assert.throws(()=>verifyCycloneDxSbom(unsafe,{name:rootName,version:rootVersion}),err=>{
  assert.ok(err instanceof Error);
  assert.doesNotMatch(err.message,/PRIVATE_ACCOUNT_TOKEN_SHOULD_NOT_ESCAPE/);
  return true;
 });
});
