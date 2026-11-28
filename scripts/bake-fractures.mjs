import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createNineSliceBlock } from '../src/terrain.js';
import { fractureBlock } from '../src/collapse.js';
import { snapshotFractureMesh,snapshotFracture } from '../src/fracture-data.js';
import { bakeFractureStages } from '../src/scene.js';
import { snapshotContactFragments } from '../src/contact-preparer.js';
import { buildPhysicsTimeline } from '../src/contact-physics.js';
import { encodeFractureBinary,decodeFractureBinary } from '../src/fracture-binary.js';
import { compactFractureTemplate } from './compact-fracture-template.mjs';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { fractureDecoderReady } from '../src/fracture-binary.js';

const destination=new URL('../public/fractures/',import.meta.url),started=performance.now();
await mkdir(destination,{recursive:true});
await Promise.all([MeshoptEncoder.ready,fractureDecoderReady]);
const wasmBinary=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
let clearanceFloor=Infinity;
{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{for(let id=0;id<16;id++){const source=createNineSliceBlock(scene,id);clearanceFloor=Math.min(clearanceFloor,...source.getVerticesData('position').filter((_,i)=>i%3===1));source.dispose();}}
  finally{scene.dispose();engine.dispose();}
}
const manifest={version:1,format:'LTBF-meshopt-q16-gzip',count:16,clearanceFloor,patterns:[]};
for(let id=0;id<16;id++){
  const begin=performance.now(),engine=new NullEngine(),scene=new Scene(engine),family=id%2?'outward':'inward';
  try{
    const source=createNineSliceBlock(scene,id);source.metadata.tileIndex=id;source.scaling.set(1.16,1,1.16);source.computeWorldMatrix(true);
    const original=snapshotFractureMesh(source),result=fractureBlock(source,{variant:0,secondary:true});
    const fracture=snapshotFracture(result),{falling,...stages}=bakeFractureStages(source,result,{family});
    const timeline=await buildPhysicsTimeline(snapshotContactFragments(falling),{family,variant:0,seed:13007+id*8191,clearanceFloor},{wasmBinary});
    const asset=compactFractureTemplate({version:1,id,sourceSeed:id,variant:0,family,source:original,fracture,stages,timeline},MeshoptEncoder);
    const bytes=encodeFractureBinary(asset,MeshoptEncoder),check=decodeFractureBinary(bytes);
    if(check.fracture.fragments.length!==result.fragments.length||check.timeline.values.length!==timeline.values.length)throw new Error(`Invalid encoded pattern ${id}.`);
    const compressed=gzipSync(bytes,{level:9}),file=`pattern-${String(id).padStart(2,'0')}.bin.gz`,sha256=createHash('sha256').update(compressed).digest('hex');
    await writeFile(new URL(file,destination),compressed);
    const entry={id,sourceSeed:id,family,file,sha256,compressedBytes:compressed.length,decodedBytes:bytes.length,expandedBytes:check.decodedBufferBytes,fragments:result.fragments.length,secondaryFragments:result.secondaryFragments.length};
    manifest.patterns.push(entry);console.log(JSON.stringify({...entry,bakeMs:Math.round(performance.now()-begin)}));
  }finally{scene.dispose();engine.dispose();}
}
manifest.compressedBytes=manifest.patterns.reduce((n,p)=>n+p.compressedBytes,0);manifest.decodedBytes=manifest.patterns.reduce((n,p)=>n+p.decodedBytes,0);manifest.expandedBytes=manifest.patterns.reduce((n,p)=>n+p.expandedBytes,0);
await writeFile(new URL('manifest.json',destination),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({complete:true,compressedBytes:manifest.compressedBytes,decodedBytes:manifest.decodedBytes,bakeMs:Math.round(performance.now()-started)}));
