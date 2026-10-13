/**
 * Validate an npm CycloneDX SBOM as an RG-02 build-evidence input.
 * Do not echo dependency names, filesystem paths, user data, or raw parse errors.
 * An SBOM is not proof that dependencies are free of vulnerabilities.
 */
export function verifyCycloneDxSbom(value,{name,version}={}){
 const fail=()=>{throw new Error('Invalid or incomplete CycloneDX SBOM evidence');};
 if(typeof name!=='string'||name.length===0||typeof version!=='string'||version.length===0)
  fail();
 if(!value||typeof value!=='object'||Array.isArray(value)||
    value.bomFormat!=='CycloneDX'||!['1.4','1.5','1.6'].includes(value.specVersion)||
    !Number.isSafeInteger(value.version)||value.version<1)
  fail();
 const root=value.metadata?.component;
 if(!root||typeof root!=='object'||root.name!==name||root.version!==version)
  fail();
 const components=value.components;
 if(!Array.isArray(components)||components.length===0)
  fail();
 for(const component of components){
  if(!component||typeof component!=='object'||Array.isArray(component)||
     typeof component.type!=='string'||component.type.length===0||
     typeof component.name!=='string'||component.name.length===0||
     ('version' in component&&(typeof component.version!=='string'||component.version.length===0)))
   fail();
 }
 const dependencies=value.dependencies;
 if(!Array.isArray(dependencies))fail();
 let dependencyEdges=0;
 for(const dependency of dependencies){
  if(!dependency||typeof dependency!=='object'||Array.isArray(dependency)||
     typeof dependency.ref!=='string'||dependency.ref.length===0||
     (dependency.dependsOn!==undefined&&(!Array.isArray(dependency.dependsOn)||
      !dependency.dependsOn.every(ref=>typeof ref==='string'&&ref.length>0))))
   fail();
  dependencyEdges+=dependency.dependsOn?.length??0;
  if(!Number.isSafeInteger(dependencyEdges))fail();
 }
 return Object.freeze({componentCount:components.length,dependencyEdges,
  rootName:name,rootVersion:version});
}
