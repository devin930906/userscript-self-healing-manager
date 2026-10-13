import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyCycloneDxSbom} from '../../scripts/sbom-evidence.mjs';

const name='userscript-self-healing-manager';
const version='0.1.0-alpha.5';
const rootRef='pkg:npm/userscript-self-healing-manager@0.1.0-alpha.5';
const direct='pkg:npm/react@19.2.0';
const nested='pkg:npm/typescript@5.8.3';
const sample=()=>({
 bomFormat:'CycloneDX',specVersion:'1.6',version:1,
 metadata:{component:{type:'application',name,version,'bom-ref':rootRef}},
 components:[
  {type:'library',name:'react',version:'19.2.0','bom-ref':direct},
  {type:'library',name:'typescript',version:'5.8.3','bom-ref':nested},
 ],
 dependencies:[
  {ref:rootRef,dependsOn:[direct]},
  {ref:direct,dependsOn:[nested]},
  {ref:nested,dependsOn:[]},
 ],
});

for(const bad of [
 {ref:rootRef,dependsOn:[direct,direct]},
 {ref:direct,dependsOn:[direct]},
 {ref:rootRef,dependsOn:[rootRef]},
]){
 test('RG-02 refuses duplicate or self-referential CycloneDX dependency edges: '+
  bad.ref+' '+bad.dependsOn.join(','),()=>{
  const inventory=sample();
  const idx=inventory.dependencies.findIndex(d=>d.ref===bad.ref);
  inventory.dependencies[idx]=bad;
  assert.throws(()=>verifyCycloneDxSbom(inventory,{name,version}),
   /Invalid or incomplete CycloneDX SBOM evidence/);
 });
}

test('RG-02 preserves distinct root and component edges',()=>{
 assert.equal(verifyCycloneDxSbom(sample(),{name,version}).dependencyEdges,2);
});
