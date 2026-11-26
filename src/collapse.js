import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

// Triangle clipping retains the original turf, cap, stone UVs and custom shader
// attributes. Newly exposed fracture faces alone receive an interior stone crop.
const sites = [[-.31,-.28],[.29,-.30],[-.29,.29],[.31,.28],[.015,.015]];
const key = v => v.slice(0,3).map(x => x.toFixed(7)).join(',');
const mix = (a,b,t) => a.map((x,i) => x+(b[i]-x)*t);
const distance = (v,p) => v[0]*p[0]+v[2]*p[1]-p[2];
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
  const coords = loop.map(v => [-plane[1]*v[0]+plane[0]*v[2],v[1]]);
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  let area=0; for(let i=0;i<coords.length;i++){const a=coords[i],b=coords[(i+1)%coords.length];area+=a[0]*b[1]-b[0]*a[1];}
  const ids=loop.map((_,i)=>i); if(area<0)ids.reverse();
  const result=[];
  while(ids.length>3){
    let found=false;
    for(let i=0;i<ids.length;i++){
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
function cut(triangles, plane, artHeight) {
  let kept=[];const segments=[];
  for(const face of triangles){
    const poly=[];const verts=face.v;
    for(let i=0;i<3;i++){
      const a=verts[i],b=verts[(i+1)%3],da=distance(a,plane),db=distance(b,plane);
      if(da<=1e-9)poly.push(a);
      if((da < -1e-9&&db > 1e-9)||(da > 1e-9&&db < -1e-9))poly.push(mix(a,b,da/(da-db)));
    }
    if(poly.length<3)continue;
    for(let i=1;i<poly.length-1;i++)kept.push({v:[poly[0],poly[i],poly[i+1]],mat:face.mat});
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length];
      if(Math.abs(distance(a,plane))<1e-7&&Math.abs(distance(b,plane))<1e-7&&key(a)!==key(b))segments.push([a,b]);
    }
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
    const loop=keys.map(k=>{
      const v=[...vertices.get(k)], tangent=-plane[1]*v[0]+plane[0]*v[2];
      v[3]=plane[0];v[4]=0;v[5]=plane[1];
      v[6]=.30+(tangent+.6)*.17;v[7]=.53+(v[1]+.045)*.21/artHeight;
      v[8]=v[9]=v[10]=v[11]=1;v[12]=v[6];v[13]=v[7];v[14]=0;
      return v;
    });
    // Babylon uses clockwise front faces: tangent × up is the inward geometric
    // cross product, so this winding exposes the outward fracture normal.
    for(const tri of earClip(loop,plane))kept.push({v:tri,mat:1});
  }
  return kept;
}

export function fractureBlock(source) {
  const scene=source.getScene(),position=source.getVerticesData('position'),normal=source.getVerticesData('normal'),uv=source.getVerticesData('uv'),color=source.getVerticesData('color'),stone=source.getVerticesData('terrainStoneUV'),bottom=source.getVerticesData('terrainBottomLight');
  const vertices=Array.from({length:position.length/3},(_,i)=>[...position.slice(i*3,i*3+3),...normal.slice(i*3,i*3+3),...uv.slice(i*2,i*2+2),...color.slice(i*4,i*4+4),...stone.slice(i*2,i*2+2),bottom[i]]);
  weldPositions(vertices);
  const index=source.getIndices(),topCount=source.subMeshes[0].indexCount,original=[];
  for(let i=0;i<index.length;i+=3)original.push({v:[vertices[index[i]],vertices[index[i+1]],vertices[index[i+2]]],mat:i<topCount?0:1});
  const fragments=[],crackSegments=new Map();
  for(let part=0;part<sites.length;part++){
    const site=sites[part];let faces=original;
    for(let j=0;j<sites.length;j++){
      if(j===part)continue;const other=sites[j],dx=other[0]-site[0],dz=other[1]-site[1],length=Math.hypot(dx,dz);
      faces=cut(faces,[dx/length,dz/length,((other[0]**2+other[1]**2)-(site[0]**2+site[1]**2))/(2*length)],source.metadata.nineSlice.artHeight);
    }
    const p=[],n=[],u=[],c=[],s=[],light=[],indices=[];
    const append=face=>{for(const v of face.v){indices.push(p.length/3);p.push(v[0]-site[0],v[1],v[2]-site[1]);n.push(v[3],v[4],v[5]);u.push(v[6],v[7]);c.push(...v.slice(8,12));s.push(v[12],v[13]);light.push(v[14]);}};
    faces.filter(f=>f.mat===0).forEach(append);const grassIndices=indices.length;
    faces.filter(f=>f.mat===1).forEach(append);
    for(const face of faces.filter(f=>f.mat===1))for(let k=0;k<3;k++){
      const a=face.v[k],b=face.v[(k+1)%3];
      if(a[1]>.24&&b[1]>.24&&Math.abs(a[4])<.01&&Math.abs(b[4])<.01){const id=[key(a),key(b)].sort().join('|');crackSegments.set(id,[a,b]);}
    }
    const root=new TransformNode(`${source.name}-fracture-root-${part}`,scene);root.parent=source.parent;
    root.position.set(site[0]*source.scaling.x,0,site[1]*source.scaling.z);
    const mesh=new Mesh(`${source.name}-fragment-${part}`,scene),data=new VertexData();
    Object.assign(data,{positions:p,normals:n,uvs:u,colors:c,indices});data.applyToMesh(mesh);
    mesh.setVerticesData('terrainStoneUV',s,false,2);mesh.setVerticesData('terrainBottomLight',light,false,1);
    mesh.releaseSubMeshes();new SubMesh(0,0,grassIndices,0,grassIndices,mesh);new SubMesh(1,grassIndices,p.length/3-grassIndices,grassIndices,indices.length-grassIndices,mesh);
    mesh.parent=root;mesh.scaling.copyFrom(source.scaling);mesh.material=source.material;mesh.receiveShadows=true;
    mesh.metadata={tileIndex:source.metadata.tileIndex,destructionFragment:true,fragmentIndex:part};
    fragments.push({root,mesh,base:root.position.clone(),part});
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
    const count=Math.max(4,Math.ceil((hi-lo)/.028)),points=[],widths=[],phase=++pathIndex*1.71;
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
