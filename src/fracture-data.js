import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { fractureFieldFromDefinition } from './collapse.js';

export function snapshotFractureMesh(mesh) {
  return {
    name:mesh.name, position:mesh.position.asArray(), scaling:mesh.scaling.asArray(), metadata:mesh.metadata,
    attributes:mesh.getVerticesDataKinds().map(kind=>({kind,stride:mesh.getVertexBuffer(kind).getSize(),data:new Float64Array(mesh.getVerticesData(kind))})),
    indices:new Uint32Array(mesh.getIndices()),
    subMeshes:mesh.subMeshes.map(s=>[s.materialIndex,s.verticesStart,s.verticesCount,s.indexStart,s.indexCount]),
  };
}

export function restoreFractureMesh(scene,data) {
  const mesh=new Mesh(data.name,scene);
  for(const {kind,stride,data:values} of data.attributes)mesh.setVerticesData(kind,values instanceof Float32Array?values.slice():Array.from(values),false,stride);
  mesh.setIndices(data.indices.slice());mesh.releaseSubMeshes();
  for(const sub of data.subMeshes)new SubMesh(...sub,mesh);
  mesh.position.copyFromFloats(...data.position);mesh.scaling.copyFromFloats(...data.scaling);mesh.metadata=structuredClone(data.metadata);
  return mesh;
}

export function snapshotFracture(result) {
  const snapshotFragment=f=>({
    mesh:snapshotFractureMesh(f.mesh),rootName:f.root.name,base:f.base.asArray(),center:f.center.asArray(),
    part:f.part,volume:f.volume,topArea:f.topArea,supportGroup:f.supportGroup,supportLayer:f.supportLayer,bounds:f.bounds,seed:f.seed,
    columnConstraints:f.columnConstraints.map(({cutId,side,definition})=>({cutId,side,definition})),
    solidConstraints:(f.solidConstraints||[]).map(({cutId,side,definition})=>({cutId,side,definition})),
    ...(f.secondary?{parentPart:f.parentPart,secondary:true,sizeRatio:f.sizeRatio,secondaryCut:{cutId:f.secondaryCut.cutId,side:f.secondaryCut.side,definition:f.secondaryCut.definition}}:{}),
  });
  return {variant:result.variant,crack:snapshotFractureMesh(result.crack),fragments:result.fragments.map(snapshotFragment),secondaryFragments:(result.secondaryFragments||[]).map(snapshotFragment)};
}

export function fractureTransferables(data) {
  const meshes=data.fragments?[data.crack,...data.fragments.map(f=>f.mesh),...(data.secondaryFragments||[]).map(f=>f.mesh)]:[data];
  return meshes.flatMap(mesh=>[mesh.indices.buffer,...mesh.attributes.map(a=>a.data.buffer)]);
}

export function restoreFracture(source,data) {
  const scene=source.getScene(),beforeMeshes=new Set(scene.meshes),beforeRoots=new Set(scene.transformNodes);
  try {
    const restoreFragment=f=>{
      const root=new TransformNode(f.rootName,scene);root.setEnabled(false);root.parent=source.parent;root.position.copyFromFloats(...f.base);
      const mesh=restoreFractureMesh(scene,f.mesh);mesh.parent=root;mesh.material=source.material;mesh.receiveShadows=true;
      return {...f,root,mesh,base:Vector3.FromArray(f.base),center:Vector3.FromArray(f.center),columnConstraints:f.columnConstraints.map(c=>({...c,field:fractureFieldFromDefinition(c.definition)})),solidConstraints:(f.solidConstraints||[]).map(c=>({...c,field:fractureFieldFromDefinition(c.definition)})),...(f.secondaryCut?{secondaryCut:{...f.secondaryCut,field:fractureFieldFromDefinition(f.secondaryCut.definition)}}:{})};
    };
    const fragments=data.fragments.map(restoreFragment),secondaryFragments=(data.secondaryFragments||[]).map(restoreFragment);
    const crack=restoreFractureMesh(scene,data.crack);crack.parent=source.parent;crack.isPickable=false;
    return {fragments,secondaryFragments,crack,variant:data.variant,dispose(){crack.dispose(false,false);for(const f of [...fragments,...secondaryFragments]){f.mesh.dispose(false,false);f.root.dispose();}}};
  }catch(error){
    for(const mesh of scene.meshes.filter(m=>!beforeMeshes.has(m))){try{mesh.dispose(false,false);}catch{scene.removeMesh(mesh);}}
    for(const root of scene.transformNodes.filter(n=>!beforeRoots.has(n))){try{root.dispose();}catch{scene.removeTransformNode(root);}}
    throw error;
  }
}
