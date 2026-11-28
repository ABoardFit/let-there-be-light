import { buildPhysicsTimeline } from './contact-physics.js';
import wasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
self.onmessage=async({data:{fragments,options}})=>{
  try {const result=await buildPhysicsTimeline(fragments,options,{locateFile:()=>wasmUrl});self.postMessage(result,[result.values.buffer]);}
  catch(error){self.postMessage({error:error.stack||error.message});}
};
