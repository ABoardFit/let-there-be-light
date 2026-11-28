import HavokPhysics from '@babylonjs/havok';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody.js';
import { PhysicsShapeConvexHull, PhysicsShapeBox } from '@babylonjs/core/Physics/v2/physicsShape.js';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import '@babylonjs/core/Physics/v2/physicsEngineComponent.js';

// The same fixed-step solver is used by the browser worker and independent Node checks.
export async function buildPhysicsTimeline(fragments, options = {}, havokOptions = {}) {
  const started = performance.now(), havok = await HavokPhysics(havokOptions);
  const engine = new NullEngine(), scene = new Scene(engine), plugin = new HavokPlugin(false, havok);
  const dt = 1 / 120, duration = 1.656, steps = Math.ceil(duration / dt);
  plugin.setVelocityLimits(12, 7);
  scene.enablePhysics(new Vector3(0, -5.8, 0), plugin);
  plugin.setTimeStep(dt);
  const bodies = [], records = [], shapes = [], contacts = [], activeContacts = new Set();
  let frame = 0;
  try {
    fragments.forEach((f, index) => {
      const origin = f.base.map((v,j)=>v+f.position[j]), min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity], positions=[];
      for(let i=0;i<f.positions.length;i+=3)for(let j=0;j<3;j++){const v=f.positions[i+j]*f.scaling[j]+origin[j];positions.push(v);min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);}
      const center=min.map((v,j)=>(v+max[j])/2), mesh=new Mesh(`solid-${f.part}`,scene);
      const chip=f.secondary&&f.sizeRatio<.5,scale=chip?.80:.86;
      mesh.setVerticesData('position',positions.map((v,i)=>(v-center[i%3])*scale));mesh.position=Vector3.FromArray(center);mesh.computeWorldMatrix(true);
      const shape=new PhysicsShapeConvexHull(mesh,scene);shape.material={friction:.4,staticFriction:.48,restitution:0};shapes.push(shape);
      const body=new PhysicsBody(mesh,PhysicsMotionType.DYNAMIC,false,scene);body.shape=shape;
      const mass=Math.max(.025,f.volume*3*scale**3);
      body.setMassProperties({mass});body.setLinearDamping(.10);body.setAngularDamping(.28);
      const radial=new Vector3(center[0],0,center[2]).normalize(), axis=new Vector3(radial.z,0,-radial.x).scale(options.family==='inward'?-1:1);
      body.setAngularVelocity(axis.scale(chip?2.6:1.25));body.setLinearVelocity(new Vector3(0,-.12,0));
      body.setCollisionCallbackEnabled(true);
      body.getCollisionObservable().add(event=>{activeContacts.add(index);if(contacts.length<2500)contacts.push({frame,part:f.part,other:records.find(r=>r.body===(event.collider===body?event.collidedAgainst:event.collider))?.f.part??-1,point:event.point?.asArray(),normal:event.normal?.asArray(),impulse:event.impulse,distance:event.distance});});
      records.push({f,body,mesh,center:Vector3.FromArray(center),base:Vector3.FromArray(f.base),min,max,mass,axis,chip,scale});bodies.push(body);
    });
    const minX=Math.min(...records.map(r=>r.min[0])),maxX=Math.max(...records.map(r=>r.max[0])),minZ=Math.min(...records.map(r=>r.min[2])),maxZ=Math.max(...records.map(r=>r.max[2]));
    const floor=options.clearanceFloor??Math.min(...records.map(r=>r.min[1])),top=3,height=top-floor;
    const walls=[[[minX-1,(top+floor)/2,(minZ+maxZ)/2],[2,height,maxZ-minZ+4]],[[maxX+1,(top+floor)/2,(minZ+maxZ)/2],[2,height,maxZ-minZ+4]],[[(minX+maxX)/2,(top+floor)/2,minZ-1],[maxX-minX, height,2]],[[(minX+maxX)/2,(top+floor)/2,maxZ+1],[maxX-minX,height,2]]];
    walls.forEach(([center,extents],i)=>{const node=new TransformNode(`neighbor-${i}`,scene);node.position=Vector3.FromArray(center);node.computeWorldMatrix(true);const body=new PhysicsBody(node,PhysicsMotionType.STATIC,false,scene),shape=new PhysicsShapeBox(Vector3.Zero(),Quaternion.Identity(),Vector3.FromArray(extents),scene);shape.material={friction:0,staticFriction:0,restitution:0};body.shape=shape;shapes.push(shape);bodies.push(body);});
    const values=new Float64Array((steps+1)*records.length*8);
    for(frame=0;frame<=steps;frame++){
      records.forEach((r,index)=>{const q=r.mesh.rotationQuaternion||Quaternion.Identity(),baseOffset=r.base.subtract(r.center).scale(r.scale).rotateByQuaternionToRef(q,new Vector3()),root=r.mesh.position.add(baseOffset),offset=root.subtract(r.base),at=(frame*records.length+index)*8;values.set([...offset.asArray(),...q.asArray(),activeContacts.has(index)?1:0],at);});
      activeContacts.clear();
      if(frame<steps){
        // A short release torque represents the yielding ground. Contact impulses
        // still determine the actual hinge and sliding; poses are never forced.
        const release=Math.max(0,1-frame*dt/.65);
        if(release)records.forEach(r=>r.body.applyAngularImpulse(r.axis.scale(r.mass*(r.chip?.018:.10)*dt*release)));
        plugin.executeStep(dt,bodies);
      }
    }
    return{engine:'Havok',dt,duration,steps,count:records.length,stride:8,values,contacts,bodies:records.map(r=>({part:r.f.part,parentPart:r.f.parentPart,mass:r.mass,scale:r.scale,center:r.center.asArray(),inertia:r.body.getMassProperties().inertia?.asArray(),secondary:!!r.f.secondary})),seed:options.seed,preparationMs:performance.now()-started};
  } finally {scene.dispose();shapes.forEach(s=>s.dispose());engine.dispose();}
}
