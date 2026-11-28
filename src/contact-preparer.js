import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
export function sampleContactTimeline(timeline,index,t){
  const at=Math.max(0,Math.min(1,t))*timeline.steps,lo=Math.floor(at),hi=Math.min(timeline.steps,lo+1),mix=at-lo,a=(lo*timeline.count+index)*8,b=(hi*timeline.count+index)*8,v=timeline.values;
  const offset=Vector3.Lerp(Vector3.FromArray(v,a),Vector3.FromArray(v,b),mix);
  const quaternion=Quaternion.Slerp(Quaternion.FromArray(v,a+3),Quaternion.FromArray(v,b+3),mix);
  return{offset,quaternion,scale:timeline.bodies[index].scale,rotation:quaternion.toEulerAngles(),contact:!!(v[a+7]||v[b+7])};
}
export function snapshotContactFragments(fragments){
  return fragments.map(f=>{
      const p=f.mesh.getVerticesData('position'),scale=f.mesh.scaling,origin=f.base.add(f.mesh.position),positions=[],seen=new Set(),extreme=Array(6).fill(0),values=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      for(let i=0;i<p.length;i+=3){const key=[(p[i]*scale.x+origin.x)/.045,(p[i+1]*scale.y+origin.y)/.045,(p[i+2]*scale.z+origin.z)/.045].map(Math.round).join(',');if(!seen.has(key)){seen.add(key);positions.push(p[i],p[i+1],p[i+2]);}for(let j=0;j<3;j++){if(p[i+j]<values[j]){values[j]=p[i+j];extreme[j]=i;}if(p[i+j]>values[j+3]){values[j+3]=p[i+j];extreme[j+3]=i;}}}
      extreme.forEach(i=>positions.push(p[i],p[i+1],p[i+2]));
      const constraint=c=>({cutId:c.cutId,side:c.side,definition:c.definition});
      return{base:f.base.asArray(),center:f.center.asArray(),position:f.mesh.position.asArray(),scaling:scale.asArray(),positions:new Float64Array(positions),volume:f.volume,topArea:f.topArea,part:f.part,bounds:f.bounds,supportGroup:f.supportGroup,supportLayer:f.supportLayer,secondary:f.secondary,parentPart:f.parentPart,sizeRatio:f.sizeRatio,solidConstraints:(f.solidConstraints||[]).map(constraint),columnConstraints:f.columnConstraints.map(constraint),secondaryCut:f.secondaryCut?constraint(f.secondaryCut):undefined};
    });
}
export function createContactPreparer(){
  let current=null, disposed=false;
  const cancel=()=>{if(!current)return;const entry=current;current=null;entry.worker.onmessage=entry.worker.onerror=entry.worker.onmessageerror=null;entry.worker.terminate();entry.reject(new DOMException('Contact plan cancelled.','AbortError'));};
  return{cancel,dispose(){disposed=true;cancel();},prepare(fragments,options){
    if(disposed)return Promise.reject(new DOMException('Contact preparer disposed.','AbortError'));
    cancel();
    const started=performance.now(), data=snapshotContactFragments(fragments), snapshotMs=performance.now()-started;
    return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./contact-worker.js',import.meta.url),{type:'module'}),entry={worker,reject};current=entry;const finish=()=>{worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();if(current===entry)current=null;};worker.onmessage=({data})=>{if(current!==entry)return;finish();if(data.error)reject(new Error(data.error));else resolve({...data,snapshotMs,totalPreparationMs:performance.now()-started});};worker.onerror=e=>{finish();reject(new Error(e.message||'Contact planning failed.'));};worker.onmessageerror=()=>{finish();reject(new Error('Unreadable contact plan.'));};try{worker.postMessage({fragments:data,options},data.map(f=>f.positions.buffer));}catch(error){finish();reject(error);}});
  }};
}
