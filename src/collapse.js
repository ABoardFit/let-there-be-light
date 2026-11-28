import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { roundVoxelSolid } from './rounded-solid.js';

// Rounded closed solids remove thin tips before mesh extraction. Original turf
// and stone attributes are projected onto the outside; cuts use the soil material.
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross3 = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => { const length=Math.hypot(...a); return a.map(v=>v/length); };
const sourceSamplers=new WeakMap();
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
  return {volume:Math.abs(volume),center:centroid.map(v=>v/volume),topArea,min,max,extent:max.map((v,j)=>v-min[j])};
}
const key = v => v.slice(0,3).map(x => x.toFixed(7)).join(',');
const mix = (a,b,t) => a.map((x,i) => x+(b[i]-x)*t);
const distance = (v,p) => dot(v,p)-p[3];
function fractureSurface(plane,phase) {
  const [u,v]=planeBasis(plane);
  const height=(x,y)=>.032*Math.sin(x*15+phase)*Math.cos(y*12+phase*.73)+.014*Math.sin(x*24+y*8+phase*1.37);
  const field=point=>distance(point,plane)-height(dot(point,u),dot(point,v));
  const project=point=>{
    const offset=field(point);for(let i=0;i<3;i++)point[i]-=plane[i]*offset;
    return point;
  };
  const normal=point=>{
    const x=dot(point,u),y=dot(point,v),du=.48*Math.cos(x*15+phase)*Math.cos(y*12+phase*.73)+.336*Math.cos(x*24+y*8+phase*1.37);
    const dv=-.384*Math.sin(x*15+phase)*Math.sin(y*12+phase*.73)+.112*Math.cos(x*24+y*8+phase*1.37);
    return unit(plane.slice(0,3).map((value,i)=>value-u[i]*du-v[i]*dv));
  };
  return {field,project,normal};
}

function sourceSampler(faces) {
  const bounds=items=>{
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const face of items)for(const p of face.v)for(let j=0;j<3;j++){min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);}
    return {min,max};
  };
  const build=items=>{
    const node=bounds(items);if(items.length<=10){node.faces=items;return node;}
    const extent=node.max.map((v,j)=>v-node.min[j]),axis=extent.indexOf(Math.max(...extent));
    items.sort((a,b)=>a.v.reduce((s,v)=>s+v[axis],0)-b.v.reduce((s,v)=>s+v[axis],0));
    const half=Math.floor(items.length/2);node.left=build(items.slice(0,half));node.right=build(items.slice(half));return node;
  };
  const tree=build([...faces]),columns=new Map();
  const column=(x,z)=>{
    const id=x.toFixed(9)+','+z.toFixed(9);if(columns.has(id))return columns.get(id);
    const hits=[],visit=node=>{
      if(x<node.min[0]-1e-9||x>node.max[0]+1e-9||z<node.min[2]-1e-9||z>node.max[2]+1e-9)return;
      if(!node.faces){visit(node.left);visit(node.right);return;}
      for(const {v:[a,b,c]} of node.faces){
        const den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(den)<1e-13)continue;
        const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den,w=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;
        if(u>=-1e-9&&w>=-1e-9&&u+w<=1+1e-9)hits.push(a[1]*u+b[1]*w+c[1]*(1-u-w));
      }
    };visit(tree);hits.sort((a,b)=>a-b);
    const result=hits.filter((v,i)=>!i||v-hits[i-1]>1e-7);columns.set(id,result);return result;
  };
  const subtract=(a,b)=>a.slice(0,3).map((v,j)=>v-b[j]);
  const closest=(p,face)=>{
    const [a,b,c]=face.v,ab=subtract(b,a),ac=subtract(c,a),ap=subtract(p,a),d1=dot(ab,ap),d2=dot(ac,ap);let weights;
    if(d1<=0&&d2<=0)weights=[1,0,0];
    else {
      const bp=subtract(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
      if(d3>=0&&d4<=d3)weights=[0,1,0];
      else {
        const vc=d1*d4-d3*d2;
        if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);weights=[1-v,v,0];}
        else {
          const cp=subtract(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
          if(d6>=0&&d5<=d6)weights=[0,0,1];
          else {
            const vb=d5*d2-d1*d6;
            if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);weights=[1-w,0,w];}
            else {
              const va=d3*d6-d5*d4;
              if(va<=0&&d4-d3>=0&&d5-d6>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));weights=[0,1-w,w];}
              else {const inv=1/(va+vb+vc),v=vb*inv,w=vc*inv;weights=[1-v-w,v,w];}
            }
          }
        }
      }
    }
    const point=[0,1,2].map(i=>a[i]*weights[0]+b[i]*weights[1]+c[i]*weights[2]);
    return {weights,face,distanceSquared:subtract(point,p).reduce((sum,v)=>sum+v*v,0)};
  };
  const boxDistance=(node,p)=>p.slice(0,3).reduce((sum,v,j)=>sum+Math.max(node.min[j]-v,0,v-node.max[j])**2,0);
  const nearest=(p,material=null)=>{
    let best={distanceSquared:Infinity};
    const visit=node=>{
      if(boxDistance(node,p)>best.distanceSquared)return;
      if(node.faces){for(const face of node.faces){if(material!==null&&face.mat!==material)continue;const hit=closest(p,face);if(hit.distanceSquared<best.distanceSquared)best=hit;}return;}
      const first=boxDistance(node.left,p)<boxDistance(node.right,p)?node.left:node.right;
      visit(first);visit(first===node.left?node.right:node.left);
    };visit(tree);
    const [a,b,c]=best.face.v,w=best.weights;
    best.value=a.map((_,i)=>a[i]*w[0]+b[i]*w[1]+c[i]*w[2]);return best;
  };
  return {column,nearest,clearColumns:()=>columns.clear()};
}

function roundedFragment(piece,sampler,interiorOffset) {
  const radius=Math.min(.05,Math.min(...piece.extent)*.18),spacing=radius/4.2,padding=radius+spacing*2;
  const start=piece.min.map(v=>Math.floor((v-padding)/spacing)),end=piece.max.map(v=>Math.ceil((v+padding)/spacing));
  const [nx,ny,nz]=end.map((v,j)=>v-start[j]+1),origin=start.map(v=>v*spacing),occupancy=new Uint8Array(nx*ny*nz);
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const px=origin[0]+x*spacing,pz=origin[2]+z*spacing,hits=sampler.column(px,pz);if(hits.length<2)continue;
    for(let y=0;y<ny;y++){
      const py=origin[1]+y*spacing;let inside=false;
      for(let j=0;j+1<hits.length;j+=2)if(py>=hits[j]&&py<=hits[j+1]){inside=true;break;}
      if(!inside)continue;
      const point=[px,py,pz];if(piece.constraints.every(c=>c.surface.field(point)*c.side<=0))occupancy[x+nx*(y+ny*z)]=1;
    }
  }
  const solid=roundVoxelSolid({occupancy,nx,ny,nz,origin,spacing,radius}),faces=[],nodes=new Map(),records=new Map(),crossings=new Map();
  const vertex=id=>{
    if(nodes.has(id))return nodes.get(id);
    const p=solid.positions.slice(id*3,id*3+3),n=solid.normals.slice(id*3,id*3+3),hit=sampler.nearest(p);
    const signal=Math.min(radius*.85-Math.sqrt(hit.distanceSquared),radius*(dot(n,hit.value.slice(3,6))-.15));
    const node={id,p,n,hit,signal};nodes.set(id,node);return node;
  };
  const crossing=(a,b)=>{
    const from=a.id<b.id?a:b,to=a.id<b.id?b:a,id='edge-'+from.id+':'+to.id;
    if(crossings.has(id))return crossings.get(id);
    const t=from.signal/(from.signal-to.signal),p=mix(from.p,to.p,t),n=unit(mix(from.n,to.n,t));
    const node={id,p,n,hit:sampler.nearest(p),signal:0};crossings.set(id,node);return node;
  };
  const clipped=(triangle,exterior)=>{
    const poly=[];
    for(let j=0;j<3;j++){
      const a=triangle[j],b=triangle[(j+1)%3],inside=exterior?a.signal>=0:a.signal<=0;
      if(inside)poly.push(a);
      if((a.signal<0&&b.signal>0)||(a.signal>0&&b.signal<0))poly.push(crossing(a,b));
    }
    return poly.filter((node,i)=>node.id!==poly[(i+poly.length-1)%poly.length].id);
  };
  const append=(polygon,exterior)=>{
    if(polygon.length<3)return;
    const center=[0,1,2].map(j=>polygon.reduce((sum,node)=>sum+node.p[j],0)/polygon.length);
    const votes=[0,0];for(const node of polygon)votes[node.hit.face.mat]++;
    const mat=exterior?(votes[0]>=votes[1]?0:1):2;
    const cut=piece.constraints.reduce((best,c)=>Math.abs(c.surface.field(center))<Math.abs(best.surface.field(center))?c:best),[uAxis,vAxis]=planeBasis(cut.plane);
    const vertices=polygon.map(node=>{
      const cacheKey=node.id+':'+mat+(exterior?'':':'+cut.cutId);if(records.has(cacheKey))return records.get(cacheKey);
      let value;
      if(exterior){
        const attributes=node.hit.face.mat===mat?node.hit.value:sampler.nearest(node.p,mat).value;
        value=[...node.p,...node.n,...attributes.slice(6)];
      }
      else value=[...node.p,...node.n,dot(node.p,uAxis)*.55+interiorOffset[0],dot(node.p,vAxis)*.55+interiorOffset[1],1,1,1,1,.342,.43,0];
      records.set(cacheKey,value);return value;
    });
    for(let i=1;i<vertices.length-1;i++)faces.push({v:[vertices[0],vertices[i],vertices[i+1]],mat,cut:!exterior,cutId:exterior?undefined:cut.cutId});
  };
  // Snap the shared scalar contour, not individual triangle intersections, so
  // float32 upload cannot collapse tiny slivers or create mismatched seam edges.
  const snap=new Set();
  for(let i=0;i<solid.indices.length;i+=3)for(let j=0;j<3;j++){
    const a=vertex(solid.indices[i+j]),b=vertex(solid.indices[i+(j+1)%3]);
    if(a.signal*b.signal>=0)continue;
    const t=a.signal/(a.signal-b.signal),length=Math.hypot(...a.p.map((v,k)=>v-b.p[k]));
    if(t*length<1e-5)snap.add(a.id);
    if((1-t)*length<1e-5)snap.add(b.id);
  }
  for(const id of snap)nodes.get(id).signal=0;
  for(let i=0;i<solid.indices.length;i+=3){
    const triangle=solid.indices.slice(i,i+3).map(vertex);
    if(triangle.every(v=>v.signal>=0))append(triangle,true);
    else if(triangle.every(v=>v.signal<=0))append(triangle,false);
    else {append(clipped(triangle,true),true);append(clipped(triangle,false),false);}
  }
  return {faces,stats:{...solid.stats,cellSize:spacing,radius}};
}
export function fractureBlock(source, {variant=0} = {}) {
  if(!Number.isInteger(variant)||variant<0||variant>0xffffffff)throw new RangeError('Fracture variant must be an unsigned 32-bit integer.');
  const scene=source.getScene(),position=source.getVerticesData('position'),normal=source.getVerticesData('normal'),uv=source.getVerticesData('uv'),color=source.getVerticesData('color'),stone=source.getVerticesData('terrainStoneUV'),bottom=source.getVerticesData('terrainBottomLight');
  const vertices=Array.from({length:position.length/3},(_,i)=>[...position.slice(i*3,i*3+3),...normal.slice(i*3,i*3+3),...uv.slice(i*2,i*2+2),...color.slice(i*4,i*4+4),...stone.slice(i*2,i*2+2),bottom[i]]);
  const index=source.getIndices(),topCount=source.subMeshes[0].indexCount;let original=[];
  for(let i=0;i<index.length;i+=3)original.push({v:[vertices[index[i]],vertices[index[i+1]],vertices[index[i+2]]],mat:i<topCount?0:1});
  if(!sourceSamplers.has(source))sourceSamplers.set(source,sourceSampler(original));
  const sampler=sourceSamplers.get(source);
  // Keep the BVH for the source lifetime, but do not retain ray columns from
  // every different grid produced by repeated reset/variant cycles.
  sampler.clearColumns();
  let variantSeed=Math.imul(variant,0x85ebca6b);variantSeed^=variantSeed>>>16;
  const tileIndex=source.metadata?.tileIndex??0, seed=(Math.imul(tileIndex+1,0x45d9f3b)^variantSeed^0x9e3779b9)>>>0;
  const interiorOffset=[(seed&255)/255,((seed>>>8)&255)/255];
  const random=randomSequence(seed), targetCount=8+Math.floor(random()*5);
  const sampleStep=.05,sourceBounds=measure(original),points=[];
  for(let z=sourceBounds.min[2]+sampleStep/2;z<sourceBounds.max[2];z+=sampleStep)for(let x=sourceBounds.min[0]+sampleStep/2;x<sourceBounds.max[0];x+=sampleStep){
    const hits=sampler.column(x,z);
    for(let y=sourceBounds.min[1]+sampleStep/2;y<sourceBounds.max[1];y+=sampleStep){
      for(let j=0;j+1<hits.length;j+=2)if(y>=hits[j]&&y<=hits[j+1]){points.push([x,y,z]);break;}
    }
  }
  const moments=points=>{
    const center=[0,0,0],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const p of points)for(let j=0;j<3;j++){center[j]+=p[j];min[j]=Math.min(min[j],p[j]-sampleStep/2);max[j]=Math.max(max[j],p[j]+sampleStep/2);}
    return {points,center:center.map(v=>v/points.length),min,max,extent:max.map((v,j)=>v-min[j]),volume:points.length*sampleStep**3};
  };
  const pieces=[{...moments(points),heightSplit:false,constraints:[]}],crackCuts=[];
  const columnHeading=random()*Math.PI;
  // Coarse samples choose balanced cuts; they are never rendered. The final
  // closed surface comes solely from the finer rounded-solid reconstruction.
  for(let split=0;pieces.length<targetCount;split++){
    const candidates=pieces.map((piece,i)=>({piece,i})).filter(({piece})=>split===2?piece.constraints.length===1:split<3||split>=7||!piece.heightSplit);
    const largestVolume=Math.max(...candidates.map(({piece})=>piece.volume));
    const substantial=candidates.filter(({piece})=>piece.volume>=largestVolume*.70);
    let ticket=random()*substantial.reduce((sum,{piece})=>sum+piece.volume*piece.volume,0),selected=substantial.at(-1);
    for(const candidate of substantial){ticket-=candidate.piece.volume**2;if(ticket<=0){selected=candidate;break;}}
    const largest=selected.i,piece=selected.piece,axis=split<3?null:split<7?1:piece.extent.indexOf(Math.max(...piece.extent));
    let a,b,plane,surface;
    for(let attempt=0;attempt<48;attempt++){
      let components;
      if(split<3){
        // Four load-bearing columns remain, but their independent cut headings
        // and unequal areas no longer form the same axis-aligned quarter grid.
        const heading=columnHeading+(split?Math.PI/2+(random()-.5)*1.05:0);
        components=[Math.cos(heading),(random()-.5)*.24,Math.sin(heading)];
      }else{
        const slope=()=> (random()-.5)*(split<7?.46:1.0);
        components=[slope(),slope(),slope()];components[axis]=1;
      }
      const normal=unit(components);
      plane=[...normal,0];surface=fractureSurface(plane,(seed%1024)*.013+split*2.39);
      // Quantiles of the actual curved cut field vary fragment sizes while
      // ensuring both children retain substantial source material.
      const projections=piece.points.map(point=>surface.field(point)).sort((a,b)=>a-b);
      const quantile=.34+random()*.32,at=Math.max(1,Math.min(projections.length-1,Math.floor(quantile*projections.length)));
      plane[3]=(projections[at-1]+projections[at])*.5;
      const left=[],right=[];for(const point of piece.points)(surface.field(point)<=0?left:right).push(point);
      a=moments(left);b=moments(right);
      const chunky=m=>m.volume/piece.volume>.28&&m.volume/piece.volume<.72&&Math.max(...m.extent)/Math.min(...m.extent)<3.5&&m.volume/m.extent.reduce((a,b)=>a*b,1)>.28;
      if(chunky(a)&&chunky(b))break;
      if(attempt===47)throw new Error('Unable to form substantial tile fragments');
    }
    crackCuts.push({surface,constraints:piece.constraints});
    const constraint={plane,surface,cutId:split},heightSplit=piece.heightSplit||(split>=3&&split<7);
    pieces.splice(largest,1,
      {...a,heightSplit,constraints:[...piece.constraints,{...constraint,side:1}]},
      {...b,heightSplit,constraints:[...piece.constraints,{...constraint,side:-1}]});
  }
  const fragments=[],crackSegments=new Map();
  // March the same physical cut fields across the intact flat turf for stage one.
  // No large intermediate clipped meshes are built just to obtain these lines.
  const crackStep=.025,edge=.44;
  for(const cut of crackCuts)for(let z=-edge;z<edge;z+=crackStep)for(let x=-edge;x<edge;x+=crackStep){
    const corners=[[x,.245,z],[Math.min(edge,x+crackStep),.245,z],[Math.min(edge,x+crackStep),.245,Math.min(edge,z+crackStep)],[x,.245,Math.min(edge,z+crackStep)]],intersections=[];
    for(let i=0;i<4;i++){
      const a=corners[i],b=corners[(i+1)%4],da=cut.surface.field(a),db=cut.surface.field(b);if((da>0)===(db>0))continue;
      let lo=0,hi=1;for(let j=0;j<24;j++){const t=(lo+hi)/2;if((cut.surface.field(mix(a,b,t))>0)===(da>0))lo=t;else hi=t;}
      intersections.push(mix(a,b,(lo+hi)/2));
    }
    for(let i=0;i+1<intersections.length;i+=2){
      const a=intersections[i],b=intersections[i+1],middle=mix(a,b,.5);
      if(cut.constraints.every(c=>c.surface.field(middle)*c.side<=0))crackSegments.set([key(a),key(b)].sort().join('|'),[a,b]);
    }
  }

  for(let part=0;part<pieces.length;part++){
    const rounded=roundedFragment(pieces[part],sampler,interiorOffset),faces=rounded.faces;
    const {center:centroid,volume,topArea,min,max}=measure(faces), center=new Vector3(...centroid);
    const supportGroup=pieces[part].constraints.filter(c=>c.cutId<3).map(c=>`${c.cutId}:${c.side}`).join('|');
    const heightCut=pieces[part].constraints.find(c=>c.cutId>=3&&c.cutId<7);
    const supportLayer=heightCut.side===1?0:1;
    const p=[],n=[],u=[],c=[],s=[],light=[],indices=[],vertexIds=new Map();
    const append=face=>{for(const v of face.v){
      const id=v;
      if(!vertexIds.has(id)){
        vertexIds.set(id,p.length/3);p.push(v[0],v[1],v[2]);n.push(v[3],v[4],v[5]);u.push(v[6],v[7]);c.push(...v.slice(8,12));s.push(v[12],v[13]);light.push(v[14]);
      }
      indices.push(vertexIds.get(id));
    }};
    faces.filter(f=>f.mat===0).forEach(append);const grassIndices=indices.length,grassVertices=p.length/3;
    faces.filter(f=>f.mat===1).forEach(append);const exteriorIndices=indices.length,exteriorVertices=p.length/3;
    const cutSurfaces=[];
    for(const id of [...new Set(faces.filter(f=>f.mat===2).map(f=>f.cutId))].sort((a,b)=>a-b)){
      const indexStart=indices.length;faces.filter(f=>f.mat===2&&f.cutId===id).forEach(append);
      cutSurfaces.push({id,indexStart,indexCount:indices.length-indexStart});
    }
    const root=new TransformNode(`${source.name}-fracture-root-${part}`,scene);root.parent=source.parent;
    const scaledCenter=center.multiply(source.scaling);
    root.position.copyFrom(source.position.add(scaledCenter));
    const mesh=new Mesh(`${source.name}-fragment-${part}`,scene),data=new VertexData();
    Object.assign(data,{positions:p,normals:n,uvs:u,colors:c,indices});data.applyToMesh(mesh);
    mesh.setVerticesData('terrainStoneUV',s,false,2);mesh.setVerticesData('terrainBottomLight',light,false,1);
    mesh.releaseSubMeshes();
    new SubMesh(0,0,grassVertices,0,grassIndices,mesh);
    new SubMesh(1,grassVertices,exteriorVertices-grassVertices,grassIndices,exteriorIndices-grassIndices,mesh);
    new SubMesh(2,exteriorVertices,p.length/3-exteriorVertices,exteriorIndices,indices.length-exteriorIndices,mesh);
    mesh.parent=root;mesh.position.copyFrom(scaledCenter.negate());mesh.scaling.copyFrom(source.scaling);mesh.material=source.material;mesh.receiveShadows=true;
    mesh.metadata={tileIndex:source.metadata.tileIndex,destructionFragment:true,fragmentIndex:part,fractureVariant:variant,cutSurfaces,roundedSolid:rounded.stats};
    fragments.push({root,mesh,base:root.position.clone(),part,center,volume,topArea,supportGroup,supportLayer,bounds:{min,max},seed:(seed+Math.imul(part+1,0x27d4eb2d))>>>0});
  }
  const positions=[],indices=[],neighbors=new Map(),edgePoints=new Map();
  // Follow the actual curved turf intersection as connected polylines. Branches
  // arise where physical fractures meet, not once per tessellated edge.
  for(const [a,b] of crackSegments.values()){
    const ka=key(a),kb=key(b);edgePoints.set(ka,a);edgePoints.set(kb,b);
    if(!neighbors.has(ka))neighbors.set(ka,[]);if(!neighbors.has(kb))neighbors.set(kb,[]);
    neighbors.get(ka).push(kb);neighbors.get(kb).push(ka);
  }
  const usedEdges=new Set();
  const starts=[...neighbors.keys()].sort((a,b)=>(neighbors.get(a).length===2)-(neighbors.get(b).length===2));
  for(const start of starts)for(const neighbor of neighbors.get(start)){
    if(usedEdges.has([start,neighbor].sort().join('|')))continue;
    const path=[edgePoints.get(start)];let previous=start,current=neighbor;
    while(current){
      usedEdges.add([previous,current].sort().join('|'));path.push(edgePoints.get(current));
      if(neighbors.get(current).length!==2||current===start)break;
      const next=neighbors.get(current).find(k=>k!==previous&&!usedEdges.has([current,k].sort().join('|')));
      previous=current;current=next;
    }
    for(let i=0;i<path.length-1;i++){
      const a=path[i],b=path[i+1],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<1e-7)continue;
      const width=.0018+.00065*Math.sin(a[0]*27+a[2]*19+seed%31),nx=-dz/length*width,nz=dx/length*width,at=positions.length/3;
      positions.push(a[0]+nx,.249,a[2]+nz,a[0]-nx,.249,a[2]-nz,b[0]-nx,.249,b[2]-nz,b[0]+nx,.249,b[2]+nz);
      indices.push(at,at+2,at+1,at,at+3,at+2);
    }
  }
  const crack=new Mesh(`${source.name}-cracks`,scene),data=new VertexData(),normals=[];
  VertexData.ComputeNormals(positions,indices,normals);Object.assign(data,{positions,indices,normals});data.applyToMesh(crack);
  crack.parent=source.parent;crack.scaling.copyFrom(source.scaling);crack.isPickable=false;crack.metadata={destructionCrack:true,tileIndex:source.metadata.tileIndex};
  fragments.forEach(f=>f.root.setEnabled(false));
  return {fragments,crack,variant,dispose(){crack.dispose(false,false);fragments.forEach(f=>{f.mesh.dispose(false,false);f.root.dispose();});}};
}
