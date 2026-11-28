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
function fractureSurface(plane,phase,vertical=false) {
  const [u,v]=planeBasis(plane);
  const height=(x,y)=>.032*Math.sin(x*15+phase)*Math.cos(y*12+phase*.73)+.014*Math.sin(x*24+y*8+phase*1.37);
  const sample=point=>vertical?[point[0],.245,point[2]]:point;
  const field=point=>{
    const x=point[0],y=vertical?.245:point[1],z=point[2];
    return x*plane[0]+y*plane[1]+z*plane[2]-plane[3]-height(x*u[0]+y*u[1]+z*u[2],x*v[0]+y*v[1]+z*v[2]);
  };
  const project=point=>{
    const offset=field(point);for(let i=0;i<3;i++)point[i]-=plane[i]*offset;
    return point;
  };
  const normal=point=>{
    const p=sample(point),x=dot(p,u),y=dot(p,v),du=.48*Math.cos(x*15+phase)*Math.cos(y*12+phase*.73)+.336*Math.cos(x*24+y*8+phase*1.37);
    const dv=vertical?0:-.384*Math.sin(x*15+phase)*Math.sin(y*12+phase*.73)+.112*Math.cos(x*24+y*8+phase*1.37);
    return unit(plane.slice(0,3).map((value,i)=>value-u[i]*du-v[i]*dv));
  };
  return {field,project,normal,definition:{plane,phase,vertical}};
}
export const fractureFieldFromDefinition=({plane,phase,vertical})=>fractureSurface(plane,phase,vertical).field;

function sourceSampler(faces) {
  const bounds=items=>{
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const face of items)for(const p of face.v)for(let j=0;j<3;j++){min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);}
    return {min,max};
  };
  const build=items=>{
    const node=bounds(items);node.materials=items.reduce((mask,face)=>mask|(1<<face.mat),0);if(items.length<=10){node.faces=items;return node;}
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
  // Millions of rejected triangle candidates need only scalar arithmetic.
  // Allocate barycentric attributes only when a candidate actually wins.
  const closest=(p,face,best)=>{
    const [a,b,c]=face.v;
    const abx=b[0]-a[0],aby=b[1]-a[1],abz=b[2]-a[2],acx=c[0]-a[0],acy=c[1]-a[1],acz=c[2]-a[2];
    const apx=p[0]-a[0],apy=p[1]-a[1],apz=p[2]-a[2];
    const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;let w0,w1,w2;
    if(d1<=0&&d2<=0){w0=1;w1=0;w2=0;}
    else {
      const bpx=p[0]-b[0],bpy=p[1]-b[1],bpz=p[2]-b[2],d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
      if(d3>=0&&d4<=d3){w0=0;w1=1;w2=0;}
      else {
        const vc=d1*d4-d3*d2;
        if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);w0=1-v;w1=v;w2=0;}
        else {
          const cpx=p[0]-c[0],cpy=p[1]-c[1],cpz=p[2]-c[2],d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
          if(d6>=0&&d5<=d6){w0=0;w1=0;w2=1;}
          else {
            const vb=d5*d2-d1*d6;
            if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);w0=1-w;w1=0;w2=w;}
            else {
              const va=d3*d6-d5*d4;
              if(va<=0&&d4-d3>=0&&d5-d6>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));w0=0;w1=1-w;w2=w;}
              else {const inv=1/(va+vb+vc),v=vb*inv,w=vc*inv;w0=1-v-w;w1=v;w2=w;}
            }
          }
        }
      }
    }
    const dx=a[0]*w0+b[0]*w1+c[0]*w2-p[0],dy=a[1]*w0+b[1]*w1+c[1]*w2-p[1],dz=a[2]*w0+b[2]*w1+c[2]*w2-p[2];
    const distanceSquared=dx*dx+dy*dy+dz*dz;
    if(distanceSquared<best.distanceSquared){best.distanceSquared=distanceSquared;best.face=face;best.weights=[w0,w1,w2];}
  };
  const boxDistance=(node,p)=>{
    const x=Math.max(node.min[0]-p[0],0,p[0]-node.max[0]),y=Math.max(node.min[1]-p[1],0,p[1]-node.max[1]),z=Math.max(node.min[2]-p[2],0,p[2]-node.max[2]);
    return x*x+y*y+z*z;
  };
  const nearest=(p,material=null)=>{
    const best={distanceSquared:Infinity};
    const visit=(node,distanceSquared)=>{
      if(distanceSquared>best.distanceSquared||(material!==null&&!(node.materials&(1<<material))))return;
      if(node.faces){for(const face of node.faces){if(material!==null&&face.mat!==material)continue;closest(p,face,best);}return;}
      const left=boxDistance(node.left,p),right=boxDistance(node.right,p);
      if(left<right){visit(node.left,left);visit(node.right,right);}else{visit(node.right,right);visit(node.left,left);}
    };visit(tree,boxDistance(tree,p));
    const [a,b,c]=best.face.v,w=best.weights;
    best.value=a.map((_,i)=>a[i]*w[0]+b[i]*w[1]+c[i]*w[2]);return best;
  };
  return {column,nearest,bounds:{min:tree.min,max:tree.max},clearColumns:()=>columns.clear()};
}

function roundedFragment(piece,sampler,interiorOffset,radiusLimit=.05,roundingCells=4.2) {
  const radius=Math.min(radiusLimit,Math.min(...piece.extent)*.18),spacing=radius/roundingCells,padding=radius+spacing*2;
  const columnCuts=piece.constraints.filter(c=>c.cutId<3),volumeCuts=piece.constraints.filter(c=>c.cutId>=3);
  const start=piece.min.map(v=>Math.floor((v-padding)/spacing)),end=piece.max.map(v=>Math.ceil((v+padding)/spacing));
  let nx,ny,nz,origin,occupancy;
  // Partition samples estimate bounds; a curved cut can include source voxels
  // beyond that estimate. Grow only affected grids before opening the solid.
  for(let expansion=0;;expansion++){
    [nx,ny,nz]=end.map((v,j)=>v-start[j]+1);origin=start.map(v=>v*spacing);occupancy=new Uint8Array(nx*ny*nz);
    const touches=[false,false,false,false,false,false];
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const px=origin[0]+x*spacing,pz=origin[2]+z*spacing;
      if(columnCuts.some(c=>c.surface.field([px,0,pz])*c.side>0))continue;
      const hits=sampler.column(px,pz);if(hits.length<2)continue;
      for(let y=0;y<ny;y++){
        const py=origin[1]+y*spacing;let inside=false;
        for(let j=0;j+1<hits.length;j+=2)if(py>=hits[j]&&py<=hits[j+1]){inside=true;break;}
        if(!inside)continue;
        const point=[px,py,pz];if(volumeCuts.every(c=>c.surface.field(point)*c.side<=0)){
          occupancy[x+nx*(y+ny*z)]=1;
          if(x===0)touches[0]=true;if(x===nx-1)touches[1]=true;
          if(y===0)touches[2]=true;if(y===ny-1)touches[3]=true;
          if(z===0)touches[4]=true;if(z===nz-1)touches[5]=true;
        }
      }
    }
    if(!touches.some(Boolean))break;
    if(expansion===4)throw new Error('Fracture occupancy exceeded the padded source bounds.');
    const growth=Math.ceil(padding/spacing);
    for(let axis=0;axis<3;axis++){
      if(expansion===3){start[axis]=Math.floor((sampler.bounds.min[axis]-padding)/spacing);end[axis]=Math.ceil((sampler.bounds.max[axis]+padding)/spacing);}
      else {if(touches[axis*2])start[axis]-=growth;if(touches[axis*2+1])end[axis]+=growth;}
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
    const votes=[0,0,0];for(const node of polygon)votes[node.hit.face.mat]++;
    const mat=exterior?votes.indexOf(Math.max(...votes)):2;
    const cut=piece.constraints.reduce((best,c)=>Math.abs(c.surface.field(center))<Math.abs(best.surface.field(center))?c:best),[uAxis,vAxis]=planeBasis(cut.plane);
    const cutId=exterior?(mat===2?sampler.nearest(center,2).face.cutId:undefined):cut.cutId;
    const vertices=polygon.map(node=>{
      const cacheKey=node.id+':'+mat+(mat===2?':'+cutId:'');if(records.has(cacheKey))return records.get(cacheKey);
      let value;
      if(exterior){
        const attributes=node.hit.face.mat===mat?node.hit.value:sampler.nearest(node.p,mat).value;
        value=[...node.p,...node.n,...attributes.slice(6)];
      }
      else value=[...node.p,...node.n,dot(node.p,uAxis)*.55+interiorOffset[0],dot(node.p,vAxis)*.55+interiorOffset[1],1,1,1,1,.342,.43,0];
      records.set(cacheKey,value);return value;
    });
    for(let i=1;i<vertices.length-1;i++)faces.push({v:[vertices[0],vertices[i],vertices[i+1]],mat,cut:mat===2,cutId});
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
export function fractureBlock(source, options = {}) {
  const scene=source.getScene(),meshes=new Set(scene.meshes),roots=new Set(scene.transformNodes);
  try { return buildFracture(source,options); }
  catch(error) {
    // A later fragment may fail after earlier meshes were allocated. None of
    // those partial results has an owner yet, so roll back the whole call.
    scene.meshes.filter(mesh=>!meshes.has(mesh)).forEach(mesh=>{
      try { mesh.dispose(false,false); }
      // Babylon registers a mesh before its constructor initializes disposal
      // data. An allocation failure there still needs scene deregistration.
      catch { scene.removeMesh(mesh); }
    });
    scene.transformNodes.filter(root=>!roots.has(root)).forEach(root=>{
      try { root.dispose(); } catch { scene.removeTransformNode(root); }
    });
    throw error;
  }
}
export const createFractureCrack=(source,options={})=>fractureBlock(source,{...options,crackOnly:true});
function buildFracture(source, {variant=0,crackOnly=false,secondary=false} = {}) {
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
        random(); // Retain the seeded sequence when removing the old Y tilt.
        components=[Math.cos(heading),0,Math.sin(heading)];
      }else{
        const slope=()=> (random()-.5)*(split<7?.46:1.0);
        components=[slope(),slope(),slope()];components[axis]=1;
      }
      const normal=unit(components);
      // Curved column walls are vertical extrusions: different columns can
      // fall straight down without interlocking. Height cuts remain fully 3D.
      plane=[...normal,0];surface=fractureSurface(plane,(seed%1024)*.013+split*2.39,split<3);
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

  const emitFragment=(piece,rounded,part,parent=null)=>{
    const faces=rounded.faces;
    const {center:centroid,volume,topArea,min,max}=measure(faces), center=new Vector3(...centroid);
    const supportGroup=parent?.supportGroup??piece.constraints.filter(c=>c.cutId<3).map(c=>`${c.cutId}:${c.side}`).join('|');
    const columnConstraints=parent?.columnConstraints??piece.constraints.filter(c=>c.cutId<3).map(c=>({cutId:c.cutId,side:c.side,field:c.surface.field,definition:c.surface.definition}));
    const heightCut=piece.constraints.find(c=>c.cutId>=3&&c.cutId<7);
    const supportLayer=parent?.supportLayer??(heightCut.side===1?0:1);
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
    const root=new TransformNode(`${source.name}-fracture-root-${part}`,scene);root.setEnabled(false);root.parent=source.parent;
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
    const ancestry=parent?{parentPart:parent.part,secondary:true,sizeRatio:volume/parent.volume}:{};
    const c0=parent?piece.constraints[0]:null;
    const secondaryCut=c0?{cutId:c0.cutId,side:c0.side,definition:c0.surface.definition,field:c0.surface.field}:undefined;
    const solidConstraints=[...(parent?.solidConstraints||[]),...piece.constraints.map(c=>({cutId:c.cutId,side:c.side,definition:c.surface.definition,field:c.surface.field}))];
    mesh.metadata={tileIndex:source.metadata.tileIndex,destructionFragment:true,fragmentIndex:part,fractureVariant:variant,cutSurfaces,roundedSolid:rounded.stats,...ancestry};
    return {root,mesh,base:root.position.clone(),part,center,volume,topArea,supportGroup,supportLayer,columnConstraints,solidConstraints,bounds:{min,max},seed:(seed+Math.imul(part+1,0x27d4eb2d))>>>0,...ancestry,...(secondaryCut?{secondaryCut}:{})};
  };
  const roundedParents=[];
  for(let part=0;!crackOnly&&part<pieces.length;part++){
    const rounded=roundedFragment(pieces[part],sampler,interiorOffset);
    fragments.push(emitFragment(pieces[part],rounded,part));
    if(secondary)roundedParents.push(rounded);
  }
  const secondaryFragments=[];
  if(secondary&&!crackOnly){
    // Extra damage breaks real existing clods, rather than spawning unrelated
    // particles. Their own closed exterior bounds the new pieces, and all of
    // its grass/stone/previous cut attributes remain available for projection.
    const splitRandom=randomSequence(seed^0x51ed270b);
    const ranked=fragments.map((f,i)=>({f,i,weight:f.volume*(.8+splitRandom()*.4)})).sort((a,b)=>b.weight-a.weight);
    const selected=[...ranked.filter(({f})=>f.topArea>.005).slice(0,2),...ranked.filter(({f})=>f.topArea<=.005).slice(0,1)];
    for(const {f:parent,i:parentIndex} of selected){
      const parentSampler=sourceSampler(roundedParents[parentIndex].faces),parentPoints=pieces[parentIndex].points;
      const extent=parent.bounds.max.map((v,j)=>v-parent.bounds.min[j]),axis=extent.indexOf(Math.max(...extent));
      let childPieces;
      for(let attempt=0;attempt<24;attempt++){
        const normal=[0,1,2].map(j=>j===axis?1:(splitRandom()-.5)*.5),plane=[...unit(normal),0];
        const surface=fractureSurface(plane,splitRandom()*Math.PI*2),values=parentPoints.map(p=>surface.field(p)).sort((a,b)=>a-b);
        const ratio=.27+splitRandom()*.08,at=Math.max(1,Math.min(values.length-1,Math.floor(values.length*ratio)));
        plane[3]=(values[at-1]+values[at])*.5;
        const halves=[[],[]];for(const p of parentPoints)halves[surface.field(p)>0?1:0].push(p);
        const shaped=halves.map(moments);
        if(shaped.some(piece=>Math.min(...piece.extent)<.10||piece.volume<.002))continue;
        const cut={plane,surface,cutId:100+parent.part};
        childPieces=shaped.map((piece,j)=>({...piece,constraints:[{...cut,side:j?-1:1}]}));break;
      }
      if(!childPieces)continue;
      for(const piece of childPieces){
        const rounded=roundedFragment(piece,parentSampler,interiorOffset,.024,3.2);
        secondaryFragments.push(emitFragment(piece,rounded,fragments.length+secondaryFragments.length,parent));
      }
    }
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
  return {fragments,secondaryFragments,crack,variant,dispose(){crack.dispose(false,false);[...fragments,...secondaryFragments].forEach(f=>{f.mesh.dispose(false,false);f.root.dispose();});}};
}
