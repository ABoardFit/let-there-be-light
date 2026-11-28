import { decodeFractureBinary,fractureDecoderReady } from './fracture-binary.js';

let loading=null,catalog=null;const recent=[];
export function getFractureTemplate(id){
  if(!catalog)throw new Error('Fracture templates are not loaded.');
  const template=catalog.patterns[id];if(!template)throw new RangeError('Unknown fracture pattern.');
  const at=recent.indexOf(id);if(at>=0)recent.splice(at,1);recent.push(id);
  while(recent.length>3)catalog.patterns[recent.shift()].clearDecodedBuffers();return template;
}

export function loadFractureCatalog({onProgress=()=>{},baseUrl,fetch:fetchAsset=globalThis.fetch}={}){
  if(catalog)return Promise.resolve(catalog);
  if(loading)return loading;
  const root=baseUrl||new URL('fractures/',new URL(import.meta.env?.BASE_URL||'./',globalThis.location?.href||'http://localhost/'));
  loading=(async()=>{
    await fractureDecoderReady;
    const started=performance.now(),response=await fetchAsset(new URL('manifest.json',root));
    if(!response.ok)throw new Error(`Unable to load fracture catalog (${response.status}).`);
    const manifest=await response.json();
    if(manifest.version!==1||manifest.patterns?.length!==16||manifest.patterns.some((p,i)=>p.id!==i))throw new Error('Invalid fracture catalog.');
    const patterns=new Array(16);let cursor=0,complete=0;onProgress(0,16);
    // Four concurrent downloads keep startup responsive without inflating all
    // compressed and decompressed buffers simultaneously on mobile devices.
    await Promise.all(Array.from({length:4},async()=>{
      while(cursor<16){
        const index=cursor++,entry=manifest.patterns[index],url=new URL(entry.file,root);url.searchParams.set('v',entry.sha256);
        const reply=await fetchAsset(url);
        if(!reply.ok)throw new Error(`Unable to load fracture pattern ${index} (${reply.status}).`);
        const compressed=await reply.arrayBuffer(),signature=new Uint8Array(compressed);
        const stream=signature[0]===0x1f&&signature[1]===0x8b?new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')):null;
        const decoded=decodeFractureBinary(stream?await new Response(stream).arrayBuffer():compressed,{lazy:true});
        if(decoded.version!==1||decoded.id!==index)throw new Error(`Invalid fracture pattern ${index}.`);
        patterns[index]=decoded;onProgress(++complete,16);
      }
    }));
    catalog={manifest,patterns,loadMs:performance.now()-started};return catalog;
  })().catch(error=>{loading=null;throw error;});
  return loading;
}
