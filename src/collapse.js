import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

// Triangle clipping retains the original turf, cap, stone UVs and custom shader
// attributes. Newly exposed fracture faces alone receive an interior stone crop.
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross3 = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => { const length=Math.hypot(...a); return a.map(v=>v/length); };
function planeBasis(plane) {
  const normal=plane.slice(0,3), reference=Math.abs(normal[1])<.85?[0,1,0]:[1,0,0];
  const u=unit(cross3(reference,normal));
  // Babylon's clockwise fronts: u × v points into the retained solid.
  return [u,cross3(u,normal)];
}
function randomSequence(seed) {
  let state=seed>>>0;
  return () => { state+=0x6d2b79f5; let value=state; value=Math.imul(value^(value>>>15),value|1); value^=value+Math.imul(value^(value>>>7),value|61); return ((value^(value>>>14))>>>0)/4294967296; };
}
function measure(faces) {
  let volume=0,topArea=0; const centroid=[0,0,0],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const {v,mat} of faces){
    const signed=dot(v[0],cross3(v[1],v[2]))/6; volume+=signed;
    for(let j=0;j<3;j++)centroid[j]+=signed*(v[0][j]+v[1][j]+v[2][j])/4;
    if(mat===0){const ab=v[1].slice(0,3).map((x,j)=>x-v[0][j]),ac=v[2].slice(0,3).map((x,j)=>x-v[0][j]);topArea+=Math.abs(cross3(ab,ac)[1])*.5;}
    for(const point of v)for(let j=0;j<3;j++){min[j]=Math.min(min[j],point[j]);max[j]=Math.max(max[j],point[j]);}
  }
  return {volume:Math.abs(volume),center:centroid.map(v=>v/volume),topArea,extent:max.map((v,j)=>v-min[j])};
}
function isClosedSolid(faces) {
  const edges=new Map();
  for(const {v} of faces){
    const ab=v[1].slice(0,3).map((x,j)=>x-v[0][j]),ac=v[2].slice(0,3).map((x,j)=>x-v[0][j]);
    if(Math.hypot(...cross3(ab,ac))<1e-12)return false;
    for(let i=0;i<3;i++){
      const a=key(v[i]),b=key(v[(i+1)%3]),id=[a,b].sort().join('|');
      const edge=edges.get(id)||{count:0,direction:0};edge.count++;edge.direction+=a<b?1:-1;edges.set(id,edge);
    }
  }
  return [...edges.values()].every(edge=>edge.count===2&&edge.direction===0);
}
const key = v => v.slice(0,3).map(x => x.toFixed(7)).join(',');
const mix = (a,b,t) => a.map((x,i) => x+(b[i]-x)*t);
const distance = (v,p) => dot(v,p)-p[3];
function weldPositions(vertices) {
  const buckets=new Map(), epsilon=2e-7;
  for(const v of vertices){
    const cell=v.slice(0,3).map(x=>Math.floor(x/epsilon));let found=null;
    for(let x=-1;x<=1&&!found;x++)for(let y=-1;y<=1&&!found;y++)for(let z=-1;z<=1&&!found;z++){
      const list=buckets.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','));
      found=list?.find(p=>Math.hypot(p[0]-v[0],p[1]-v[1],p[2]-v[2])<epsilon);
    }
    if(found){v[0]=found[0];v[1]=found[1];v[2]=found[2];}
    else{const k=cell.join(',');if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(v.slice(0,3));}
  }
}

function earClip(loop, plane) {
  const [u,v]=planeBasis(plane);
  const coords = loop.map(point => [dot(point,u),dot(point,v)]);
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  let area=0; for(let i=0;i<coords.length;i++){const a=coords[i],b=coords[(i+1)%coords.length];area+=a[0]*b[1]-b[0]*a[1];}
  const ids=loop.map((_,i)=>i); if(area<0)ids.reverse();
  const result=[];
  while(ids.length>3){
    let found=false;
    const order=ids.map((_,i)=>i).sort((i,j)=>cross(coords[ids[(j+ids.length-1)%ids.length]],coords[ids[j]],coords[ids[(j+1)%ids.length]])-cross(coords[ids[(i+ids.length-1)%ids.length]],coords[ids[i]],coords[ids[(i+1)%ids.length]]));
    for(const i of order){
      const a=ids[(i+ids.length-1)%ids.length],b=ids[i],c=ids[(i+1)%ids.length];
      if(cross(coords[a],coords[b],coords[c])<=1e-12)continue;
      if(ids.some(j=>j!==a&&j!==b&&j!==c&&cross(coords[a],coords[b],coords[j])>=-1e-12&&cross(coords[b],coords[c],coords[j])>=-1e-12&&cross(coords[c],coords[a],coords[j])>=-1e-12))continue;
      result.push([loop[a],loop[b],loop[c]]);ids.splice(i,1);found=true;break;
    }
    if(!found)break;
  }
  if(ids.length===3)result.push(ids.map(i=>loop[i]));
  return result;
}
function cut(triangles, plane, interiorOffset) {
  let kept=[];const segments=[];
  for(const face of triangles){
    // Welding this candidate must not alter an already accepted adjacent shard.
    const poly=[];const verts=face.v.map(v=>[...v]);
    for(let i=0;i<3;i++){
      const a=verts[i],b=verts[(i+1)%3],da=distance(a,plane),db=distance(b,plane);
      if(da<=1e-9)poly.push(a);
      if((da < -1e-9&&db > 1e-9)||(da > 1e-9&&db < -1e-9))poly.push(mix(a,b,da/(da-db)));
    }
    if(poly.length<3)continue;
    for(let i=1;i<poly.length-1;i++)kept.push({v:[poly[0],poly[i],poly[i+1]],mat:face.mat,cut:face.cut});
  }
  weldPositions(kept.flatMap(face=>face.v));
  kept=kept.filter(({v})=>{
    const a=v[0],b=v[1],c=v[2],x=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],y=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    return Math.hypot(x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0])>1e-13;
  });
  const boundary=new Map();
  for(const {v} of kept)for(let i=0;i<3;i++){
    const a=v[i],b=v[(i+1)%3],ka=key(a),kb=key(b);if(ka===kb)continue;
    const k=[ka,kb].sort().join('|');if(boundary.has(k))boundary.get(k).count++;else boundary.set(k,{a,b,count:1});
  }
  segments.length=0;
  for(const {a,b,count} of boundary.values())if(count===1&&Math.abs(distance(a,plane))<1e-6&&Math.abs(distance(b,plane))<1e-6)segments.push([a,b]);
  const edges=new Map(), vertices=new Map(), neighbors=new Map();
  for(const [a,b] of segments){
    const ka=key(a),kb=key(b),e=[ka,kb].sort().join('|');
    if(edges.has(e))continue;edges.set(e,[ka,kb]);vertices.set(ka,a);vertices.set(kb,b);
    if(!neighbors.has(ka))neighbors.set(ka,[]);if(!neighbors.has(kb))neighbors.set(kb,[]);
    neighbors.get(ka).push(kb);neighbors.get(kb).push(ka);
  }
  const used=new Set();
  for(const [start] of neighbors){
    if(used.has(start))continue;
    const keys=[];let current=start,previous=null;
    while(!used.has(current)){
      used.add(current);keys.push(current);const next=neighbors.get(current)?.find(k=>k!==previous);
      if(!next)break;previous=current;current=next;
    }
    if(current!==start||keys.length<3)continue;
    const [uAxis,vAxis]=planeBasis(plane),points=keys.map(k=>vertices.get(k));
    const projected=points.map(v=>[dot(v,uAxis),dot(v,vAxis)]);
    const loop=points.map((point,i)=>{
      const v=[...point];
      v[3]=plane[0];v[4]=plane[1];v[5]=plane[2];
      // A square painted soil texture uses equal scale in both plane directions.
      // Keep these UVs independent of the exterior's narrow grass/stone atlas.
      v[6]=projected[i][0]*.85+interiorOffset[0];
      v[7]=projected[i][1]*.85+interiorOffset[1];
      v[8]=v[9]=v[10]=v[11]=1;v[12]=.342;v[13]=.43;v[14]=0;
      return v;
    });
    // Babylon uses clockwise front faces: tangent × up is the inward geometric
    // cross product, so this winding exposes the outward fracture normal.
    for(const tri of earClip(loop,plane))kept.push({v:tri,mat:2,cut:true});
  }
  return kept;
}

export function fractureBlock(source) {
  const scene=source.getScene(),position=source.getVerticesData('position'),normal=source.getVerticesData('normal'),uv=source.getVerticesData('uv'),color=source.getVerticesData('color'),stone=source.getVerticesData('terrainStoneUV'),bottom=source.getVerticesData('terrainBottomLight');
  const vertices=Array.from({length:position.length/3},(_,i)=>[...position.slice(i*3,i*3+3),...normal.slice(i*3,i*3+3),...uv.slice(i*2,i*2+2),...color.slice(i*4,i*4+4),...stone.slice(i*2,i*2+2),bottom[i]]);
  weldPositions(vertices);
  const index=source.getIndices(),topCount=source.subMeshes[0].indexCount,original=[];
  for(let i=0;i<index.length;i+=3)original.push({v:[vertices[index[i]],vertices[index[i+1]],vertices[index[i+2]]],mat:i<topCount?0:1});
  const tileIndex=source.metadata?.tileIndex??0, seed=(Math.imul(tileIndex+1,0x45d9f3b)^0x9e3779b9)>>>0;
  const interiorOffset=[(seed&255)/255,((seed>>>8)&255)/255];
  const random=randomSequence(seed), targetCount=8+Math.floor(random()*5);
  const pieces=[{faces:original,...measure(original),heightSplit:false}];
  // Split each solid in two. Cut topology belongs to the tile, never the camera.
  // Height cuts leave buried stone chunks alongside the upper turf pieces.
  for(let split=0;pieces.length<targetCount;split++){
    const candidates=pieces.map((piece,i)=>({piece,i})).filter(({piece})=>split<3||split>=7||!piece.heightSplit);
    const largest=candidates.reduce((best,item)=>item.piece.volume>best.piece.volume?item:best).i, piece=pieces[largest];
    // Four broad columns first; then break each through its height. Subsequent
    // cuts follow its longest dimension so shards remain rock chunks, not blades.
    const axis=split===0?0:split<3?2:split<7?1:piece.extent.indexOf(Math.max(...piece.extent));
    let a,b,measureA,measureB;
    for(let attempt=0;attempt<48;attempt++){
      const slope=()=> (random()<.5?-1:1)*(.11+random()*.04);
      const components=[slope(),slope(),slope()];components[axis]=1;
      const normal=unit(components);
      let offset=dot(piece.center,normal)+(random()-.5)*piece.extent[axis]*.14;
      // Keep cuts clear of existing vertices and reject numerical sliver cuts.
      const projections=piece.faces.flatMap(face=>face.v.map(v=>dot(v,normal)));
      for(let nudge=0;nudge<100&&projections.some(v=>Math.abs(v-offset)<3e-6);nudge++)offset+=.000071;
      const plane=[...normal,offset];
      a=cut(piece.faces,plane,interiorOffset);b=cut(piece.faces,plane.map(v=>-v),interiorOffset);
      measureA=measure(a);measureB=measure(b);
      const chunky=m=>m.volume/piece.volume>.28&&m.volume/piece.volume<.72&&Math.max(...m.extent)/Math.min(...m.extent)<3.5&&m.volume/m.extent.reduce((a,b)=>a*b,1)>.28;
      if(chunky(measureA)&&chunky(measureB)&&isClosedSolid(a)&&isClosedSolid(b))break;
      if(attempt===47)throw new Error('Unable to form closed tile fracture');
    }
    const heightSplit=piece.heightSplit||axis===1;
    pieces.splice(largest,1,{faces:a,...measureA,heightSplit},{faces:b,...measureB,heightSplit});
  }
  const fragments=[],crackSegments=new Map();
  for(let part=0;part<pieces.length;part++){
    const {faces,center:centroid,volume,topArea}=pieces[part], center=new Vector3(...centroid);
    const p=[],n=[],u=[],c=[],s=[],light=[],indices=[];
    const append=face=>{for(const v of face.v){indices.push(p.length/3);p.push(v[0],v[1],v[2]);n.push(v[3],v[4],v[5]);u.push(v[6],v[7]);c.push(...v.slice(8,12));s.push(v[12],v[13]);light.push(v[14]);}};
    faces.filter(f=>f.mat===0).forEach(append);const grassIndices=indices.length;
    faces.filter(f=>f.mat===1).forEach(append);const exteriorIndices=indices.length;
    faces.filter(f=>f.mat===2).forEach(append);
    for(const face of faces.filter(f=>f.cut))for(let k=0;k<3;k++){
      const a=face.v[k],b=face.v[(k+1)%3];
      if(Math.abs(a[1]-.245)<1e-5&&Math.abs(b[1]-.245)<1e-5){const id=[key(a),key(b)].sort().join('|');crackSegments.set(id,[a,b]);}
    }
    const root=new TransformNode(`${source.name}-fracture-root-${part}`,scene);root.parent=source.parent;
    const scaledCenter=center.multiply(source.scaling);
    root.position.copyFrom(source.position.add(scaledCenter));
    const mesh=new Mesh(`${source.name}-fragment-${part}`,scene),data=new VertexData();
    Object.assign(data,{positions:p,normals:n,uvs:u,colors:c,indices});data.applyToMesh(mesh);
    mesh.setVerticesData('terrainStoneUV',s,false,2);mesh.setVerticesData('terrainBottomLight',light,false,1);
    mesh.releaseSubMeshes();
    new SubMesh(0,0,grassIndices,0,grassIndices,mesh);
    new SubMesh(1,grassIndices,exteriorIndices-grassIndices,grassIndices,exteriorIndices-grassIndices,mesh);
    new SubMesh(2,exteriorIndices,p.length/3-exteriorIndices,exteriorIndices,indices.length-exteriorIndices,mesh);
    mesh.parent=root;mesh.position.copyFrom(scaledCenter.negate());mesh.scaling.copyFrom(source.scaling);mesh.material=source.material;mesh.receiveShadows=true;
    mesh.metadata={tileIndex:source.metadata.tileIndex,destructionFragment:true,fragmentIndex:part};
    fragments.push({root,mesh,base:root.position.clone(),part,center,volume,topArea,seed:(seed+Math.imul(part+1,0x27d4eb2d))>>>0});
  }
  const positions=[],indices=[], paths=new Map();
  // Join tessellated cut edges before drawing. A narrow, varying fracture with
  // short branches reads as broken turf rather than a uniform polygon symbol.
  for(const [a,b] of crackSegments.values()){
    let dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<1e-6)continue;
    dx/=length;dz/=length;if(dx<-.0001||(Math.abs(dx)<.0001&&dz<0)){dx=-dx;dz=-dz;}
    const offset=-dz*a[0]+dx*a[2],id=[dx,dz,offset].map(v=>v.toFixed(4)).join(',');
    const lo=Math.min(dx*a[0]+dz*a[2],dx*b[0]+dz*b[2]),hi=Math.max(dx*a[0]+dz*a[2],dx*b[0]+dz*b[2]);
    const path=paths.get(id);if(path){path.lo=Math.min(lo,path.lo);path.hi=Math.max(hi,path.hi);}else paths.set(id,{dx,dz,offset,lo,hi});
  }
  const ribbon=(points,widths)=>{
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<1e-6)continue;
      const nx=-dz/length,nz=dx/length,start=positions.length/3,wa=widths[i],wb=widths[i+1];
      positions.push(a[0]+nx*wa,.249,a[1]+nz*wa,a[0]-nx*wa,.249,a[1]-nz*wa,b[0]-nx*wb,.249,b[1]-nz*wb,b[0]+nx*wb,.249,b[1]+nz*wb);
      indices.push(start,start+2,start+1,start,start+3,start+2);
    }
  };
  let pathIndex=0;
  for(const {dx,dz,offset,lo,hi} of paths.values()){
    const count=Math.max(4,Math.ceil((hi-lo)/.028)),points=[],widths=[],phase=++pathIndex*1.71+(seed%1000)*.01;
    for(let i=0;i<=count;i++){
      const t=i/count,d=lo+(hi-lo)*t;
      const jitter=(Math.sin(i*2.41+phase)+Math.sin(i*.81+phase)*.45)*.006*Math.sin(Math.PI*t);
      points.push([dx*d-dz*(offset+jitter),dz*d+dx*(offset+jitter)]);
      widths.push(.0014+.0019*(.5+.5*Math.sin(i*1.93+phase)));
    }
    ribbon(points,widths);
    for(const fraction of [.30,.68]){
      const i=Math.floor(count*fraction),origin=points[i],side=fraction<.5?1:-1;
      const branch=[],width=[],length=.055+.035*(.5+.5*Math.sin(phase));
      for(let j=0;j<=4;j++){
        const t=j/4;
        branch.push([origin[0]+(-dz*side+dx*.35)*length*t+Math.sin(j*2.1+phase)*.003*t,origin[1]+(dx*side+dz*.35)*length*t]);
        width.push(.0016*(1-t));
      }
      ribbon(branch,width);
    }
  }
  const crack=new Mesh(`${source.name}-cracks`,scene),data=new VertexData(),normals=[];
  VertexData.ComputeNormals(positions,indices,normals);Object.assign(data,{positions,indices,normals});data.applyToMesh(crack);
  crack.parent=source.parent;crack.scaling.copyFrom(source.scaling);crack.isPickable=false;crack.metadata={destructionCrack:true,tileIndex:source.metadata.tileIndex};
  fragments.forEach(f=>f.root.setEnabled(false));
  return {fragments,crack,dispose(){crack.dispose(false,false);fragments.forEach(f=>{f.mesh.dispose(false,false);f.root.dispose();});}};
}
