import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { fractureBlock } from './collapse.js';
import { restoreFractureMesh, snapshotFracture, fractureTransferables } from './fracture-data.js';

self.onmessage=({data:{source,variant}})=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
    const mesh=restoreFractureMesh(scene,source),result=fractureBlock(mesh,{variant,secondary:true}),data=snapshotFracture(result);
    self.postMessage({data},fractureTransferables(data));
  }catch(error){self.postMessage({error:error.message});}
  finally{scene.dispose();engine.dispose();}
};
