/**
 * CI-only SBOM gate. Never log the full dependency manifest, file paths,
 * parsing errors, or private package names in the validation summary.
 */
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {verifyCycloneDxSbom} from './sbom-evidence.mjs';

const file=process.argv[2];
if(typeof file!=='string'||!isAbsolute(file))
 throw new Error('Invalid RG-02 SBOM evidence path');
let raw,packageJson;
try{
 raw=await readFile(file,'utf8');
 packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
}catch{
 throw new Error('Cannot read RG-02 dependency inventory');
}
if(raw.length===0||raw.length>8*1024*1024)
 throw new Error('Invalid RG-02 dependency inventory size');
let json;
try{json=JSON.parse(raw.replace(/^\uFEFF/,''));}
catch{throw new Error('Invalid RG-02 CycloneDX JSON');}
const result=verifyCycloneDxSbom(json,{name:packageJson.name,version:packageJson.version});
console.log('RG-02 CycloneDX dependency inventory validated: '+
 result.componentCount+' components, '+result.dependencyEdges+' dependency edges');
