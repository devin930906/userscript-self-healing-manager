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
 // Dependency references must describe actual, uniquely identified nodes.
 // npm's root application component can live in metadata rather than in
 // the components list; never assume arbitrary graph nodes are valid.
 const knownRefs=new Set();
 const rootRef=root['bom-ref'];
 if(rootRef!==undefined){
  if(typeof rootRef!=='string'||rootRef.length===0)fail();
  knownRefs.add(rootRef);
 }
 for(const component of components){
  if(!component||typeof component!=='object'||Array.isArray(component)||
     typeof component.type!=='string'||component.type.length===0||
     typeof component.name!=='string'||component.name.length===0||
     ('version' in component&&(typeof component.version!=='string'||component.version.length===0)))
   fail();
  const ref=component['bom-ref'];
  if(typeof ref!=='string'||ref.length===0||knownRefs.has(ref))fail();
  knownRefs.add(ref);
 }
 const dependencies=value.dependencies;
 if(!Array.isArray(dependencies))fail();
 let dependencyEdges=0;
 const seenNodes=new Set();
 for(const dependency of dependencies){
  if(!dependency||typeof dependency!=='object'||Array.isArray(dependency)||
     typeof dependency.ref!=='string'||!knownRefs.has(dependency.ref)||
     seenNodes.has(dependency.ref)||
     (dependency.dependsOn!==undefined&&(!Array.isArray(dependency.dependsOn)||
      !dependency.dependsOn.every(ref=>typeof ref==='string'&&knownRefs.has(ref)))))
   fail();
  seenNodes.add(dependency.ref);
  dependencyEdges+=dependency.dependsOn?.length??0;
  if(!Number.isSafeInteger(dependencyEdges))fail();
 }
 return Object.freeze({componentCount:components.length,dependencyEdges,
  rootName:name,rootVersion:version});
}
