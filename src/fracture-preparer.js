import { snapshotFractureMesh, restoreFracture, fractureTransferables } from './fracture-data.js';

// One requested tile and one transferred result at a time. Reset/hover changes
// terminate obsolete CPU work rather than retaining a board-sized mesh cache.
export function createFracturePreparer() {
  let current=null,workerInstance=null,disposed=false;
  const abort=()=>new DOMException('Fracture preparation cancelled.','AbortError');
  const cancel=()=>{
    workerInstance?.terminate();workerInstance=null;
    current?.reject?.(abort());current=null;
  };
  const prepare=(source,{variant=0}={})=>{
    if(disposed)return Promise.reject(abort());
    if(current?.source===source&&current.variant===variant)return current.promise;
    if(current?.worker)cancel();else current=null;
    const entry={source,variant,worker:null,promise:null,reject:null};current=entry;
    entry.promise=new Promise((resolve,reject)=>{
      entry.reject=reject;
      try{
        const worker=workerInstance??new Worker(new URL('./fracture-worker.js',import.meta.url),{type:'module'});workerInstance=worker;entry.worker=worker;
        const finish=()=>{
          entry.worker=null;entry.reject=null;
          worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;
        };
        worker.onmessage=({data})=>{
          finish();if(current!==entry||disposed||source.isDisposed()){reject(abort());return;}
          if(data.error){current=null;reject(new Error(data.error));}else resolve(data.data);
        };
        const failed=message=>{finish();worker.terminate();if(workerInstance===worker)workerInstance=null;if(current===entry)current=null;reject(new Error(message));};
        worker.onerror=event=>failed(event.message||'Fracture worker failed.');
        worker.onmessageerror=()=>failed('Fracture worker returned an unreadable result.');
        const snapshot=snapshotFractureMesh(source);worker.postMessage({source:snapshot,variant},fractureTransferables(snapshot));
      }catch(error){entry.worker?.terminate();workerInstance=null;if(current===entry)current=null;reject(error);}
    });
    return entry.promise;
  };
  const fracture=async(source,options)=>{
    const pending=prepare(source,options),entry=current,data=await pending;
    if(disposed||source.isDisposed()||current!==entry)throw abort();
    const result=restoreFracture(source,data);current=null;return result;
  };
  return {prepare,fracture,cancel,dispose(){cancel();disposed=true;}};
}
