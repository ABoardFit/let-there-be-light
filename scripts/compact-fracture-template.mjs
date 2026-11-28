// The intact block remains an exact source snapshot. Fracture meshes are never
// rendered before their resting/final buffers are installed, so store those
// buffers directly and share them with the animation target records.
export function compactFractureTemplate(asset){
  for(const [fragments,stages] of [[asset.fracture.fragments,asset.stages.resting],[asset.fracture.secondaryFragments,asset.stages.children]]){
    for(const fragment of fragments){
      const target=stages.find(stage=>stage.part===fragment.part);
      for(const [kind,key,stride] of [['position','positions',3],['normal','normals',3],['color','colors',4],['terrainAuthoredHeight','authoredHeight',1]]){
        if(!target[key]?.length)continue;
        const existing=fragment.mesh.attributes.find(a=>a.kind===kind);
        if(existing)existing.data=target[key];else fragment.mesh.attributes.push({kind,stride,data:target[key]});
      }
    }
  }
  const protect=(positions,indices)=>{
    if(positions.fractureExact)return;
    const original=new Float32Array(positions),quantized=new Float32Array(original.length),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<original.length;i++){low[i%3]=Math.min(low[i%3],original[i]);high[i%3]=Math.max(high[i%3],original[i]);}
    const scale=low.map((v,j)=>(high[j]-v)/65535);
    for(let i=0;i<original.length;i++)quantized[i]=scale[i%3]?low[i%3]+Math.round((original[i]-low[i%3])/scale[i%3])*scale[i%3]:original[i];
    const cross=(p,a,b,c)=>{const x=p[b]-p[a],y=p[b+1]-p[a+1],z=p[b+2]-p[a+2],u=p[c]-p[a],v=p[c+1]-p[a+1],w=p[c+2]-p[a+2];return[y*w-z*v,z*u-x*w,x*v-y*u];};
    const exact=new Set(),key=i=>`${original[i]},${original[i+1]},${original[i+2]}`;
    for(let pass=0;pass<4;pass++){
      const before=exact.size;
      for(let i=0;i<indices.length;i+=3){
        const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,n=cross(original,a,b,c),q=cross(quantized,a,b,c),area=n[0]**2+n[1]**2+n[2]**2;
        if(area>1e-24&&(n[0]*q[0]+n[1]*q[1]+n[2]*q[2]<=area*.25||q[0]**2+q[1]**2+q[2]**2<1e-24)){exact.add(key(a));exact.add(key(b));exact.add(key(c));}
      }
      if(exact.size===before)break;
      for(let i=0;i<original.length;i+=3)if(exact.has(key(i)))quantized.set(original.subarray(i,i+3),i);
    }
    const fixes=[];for(let i=0;i<original.length;i+=3)if(exact.has(key(i)))fixes.push(i,original[i],original[i+1],original[i+2]);
    positions.fractureExact=fixes;
  };
  const position=mesh=>mesh.attributes.find(a=>a.kind==='position').data;
  protect(position(asset.source),asset.source.indices);protect(asset.stages.cracked.positions,asset.source.indices);
  protect(position(asset.fracture.crack),asset.fracture.crack.indices);protect(asset.stages.crackedLine,asset.fracture.crack.indices);
  for(const fragment of [...asset.fracture.fragments,...asset.fracture.secondaryFragments]){
    protect(position(fragment.mesh),fragment.mesh.indices);
    const supported=asset.stages.supported.find(s=>s.part===fragment.part);if(supported)protect(supported.positions,fragment.mesh.indices);
  }
  asset.fractureResting=true;asset.geometryPose='resting';return asset;
}
