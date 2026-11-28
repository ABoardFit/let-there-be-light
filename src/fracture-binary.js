import { MeshoptDecoder } from 'meshoptimizer/decoder';
const MAGIC=0x4642544c;
export const fractureDecoderReady=MeshoptDecoder.ready;

// Aligned sections share identical render buffers. Bounded quantization and
// meshoptimizer encoding reduce transfer size without changing tessellation;
// exceptionally thin triangles retain their original float32 vertices.
export function encodeFractureBinary(value,encoder){
  const sections=[],buffers=new Map();let length=0;
  const visit=(value,key='',path='')=>{
    if(ArrayBuffer.isView(value)){
      const array=value instanceof Uint32Array?value:new Float32Array(value);
      const words=new Uint32Array(array.buffer,array.byteOffset,array.length);let hash=2166136261;
      for(const word of words)hash=Math.imul(hash^word,16777619);
      const bufferType=array instanceof Uint32Array?'u32':'f32',id=`${bufferType}:${array.length}:${hash}`,matches=buffers.get(id)||[];
      for(const prior of matches)if(words.every((v,i)=>v===prior.words[i]))return prior.descriptor;
      const stride=key==='values'?8:/position|normal/i.test(key)?3:/color/i.test(key)?4:/uv/i.test(key)?2:1;
      const quantize=bufferType==='f32';
      const bits=/color/i.test(key)?12:key==='values'?20:16;
      const minimum=Array(stride).fill(Infinity),maximum=Array(stride).fill(-Infinity),scale=[];
      let stored=words;
      if(quantize){
        for(let i=0;i<array.length;i++){minimum[i%stride]=Math.min(minimum[i%stride],array[i]);maximum[i%stride]=Math.max(maximum[i%stride],array[i]);}
        for(let j=0;j<stride;j++)scale[j]=(maximum[j]-minimum[j])/((1<<bits)-1);
        stored=new Uint32Array(words.length);for(let i=0;i<array.length;i++)stored[i]=scale[i%stride]?Math.round((array[i]-minimum[i%stride])/scale[i%stride]):0;
      }
      let encoded,codec='xor-byteplane',normalOct=false;
      if(encoder&&/normal/i.test(key)){
        const count=array.length/3,padded=new Float32Array(count*4);
        for(let i=0;i<count;i++)padded.set(array.subarray(i*3,i*3+3),i*4);
        const oct=encoder.encodeFilterOct(padded,count,8,16);
        encoded=encoder.encodeVertexBufferLevel(oct,count,8,3);codec='meshopt-normal';normalOct=true;
      }else if(encoder){
        const source=new Uint8Array(stored.buffer,stored.byteOffset,stored.byteLength);
        codec=bufferType==='u32'?'meshopt-index':'meshopt-vertex';
        encoded=bufferType==='u32'?encoder.encodeIndexBuffer(source,stored.length,4):encoder.encodeVertexBufferLevel(source,stored.length/stride,stride*4,3);
      }else{
        encoded=new Uint8Array(array.byteLength);
        for(let i=0;i<stored.length;i++){const delta=stored[i]^(i>=stride?stored[i-stride]:0);for(let byte=0;byte<4;byte++)encoded[byte*stored.length+i]=(delta>>>(byte*8))&255;}
      }
      const result={bufferType,byteOffset:length,byteLength:encoded.byteLength,length:array.length,codec,stride,...(quantize&&!normalOct?{quantized:{bits,minimum,scale}}:{}),...(value.fractureExact?.length?{exact:value.fractureExact}:{})};
      const padded=new Uint8Array(Math.ceil(encoded.length/4)*4);padded.set(encoded);
      sections.push(padded);length+=padded.byteLength;matches.push({words,descriptor:result});buffers.set(id,matches);return result;
    }
    if(Array.isArray(value))return value.map((item,i)=>visit(item,key,path+'.'+i));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,visit(v,k==='data'?(value.kind||k):k,path+'.'+k)]));
    return value;
  };
  const header=new TextEncoder().encode(JSON.stringify(visit(value))),offset=12+Math.ceil(header.length/4)*4;
  const bytes=new Uint8Array(offset+length),view=new DataView(bytes.buffer);
  view.setUint32(0,MAGIC,true);view.setUint32(4,header.length,true);view.setUint32(8,offset,true);bytes.set(header,12);
  let at=offset;for(const section of sections){bytes.set(section,at);at+=section.length;}return bytes;
}

export function decodeFractureBinary(input,{lazy=false}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.byteLength<12||view.getUint32(0,true)!==MAGIC)throw new Error('Invalid fracture asset header.');
  const headerLength=view.getUint32(4,true),offset=view.getUint32(8,true);
  if(offset%4||offset<12+headerLength||offset>bytes.length)throw new Error('Invalid fracture asset offsets.');
  const data=JSON.parse(new TextDecoder().decode(bytes.subarray(12,12+headerLength)));
  const buffers=new Map();
  const visit=value=>{
    if(value&&typeof value==='object'&&!Array.isArray(value)&&value.bufferType){
      const {byteOffset,length,bufferType}=value;
      if(!['f32','u32'].includes(bufferType)||!Number.isInteger(byteOffset)||byteOffset<0||byteOffset%4||!Number.isInteger(length)||length<0||offset+byteOffset+(value.byteLength??length*4)>bytes.length)throw new Error('Invalid fracture asset buffer.');
      const Type=bufferType==='u32'?Uint32Array:Float32Array,at=bytes.byteOffset+offset+byteOffset,id=`${bufferType}:${byteOffset}:${length}`;
      if(buffers.has(id))return buffers.get(id);
      if(value.codec==='xor-byteplane'||value.codec?.startsWith('meshopt-')){
        const words=new Uint32Array(length),stride=value.stride;
        if(!Number.isInteger(stride)||stride<1||stride>8)throw new Error('Invalid fracture buffer predictor.');
        if(value.codec==='meshopt-normal'){
          const target=new Uint8Array(length/3*8);MeshoptDecoder.decodeVertexBuffer(target,length/3,8,bytes.subarray(offset+byteOffset,offset+byteOffset+value.byteLength),'OCTAHEDRAL');
          const shorts=new Int16Array(target.buffer),result=new Float32Array(length);for(let i=0;i<length;i++)result[i]=shorts[Math.floor(i/3)*4+i%3]/32767;
          buffers.set(id,result);return result;
        }
        if(value.codec==='meshopt-index')MeshoptDecoder.decodeIndexBuffer(new Uint8Array(words.buffer),length,4,bytes.subarray(offset+byteOffset,offset+byteOffset+value.byteLength));
        else if(value.codec==='meshopt-vertex')MeshoptDecoder.decodeVertexBuffer(new Uint8Array(words.buffer),length/stride,stride*4,bytes.subarray(offset+byteOffset,offset+byteOffset+value.byteLength));
        else for(let i=0;i<length;i++){let delta=0;for(let byte=0;byte<4;byte++)delta|=bytes[offset+byteOffset+byte*length+i]<<(byte*8);words[i]=delta^(i>=stride?words[i-stride]:0);}
        let result=bufferType==='u32'?words:new Float32Array(words.buffer);
        if(value.quantized){const {minimum,scale}=value.quantized;result=new Float32Array(length);for(let i=0;i<length;i++)result[i]=minimum[i%stride]+words[i]*scale[i%stride];}
        if(value.exact)for(let i=0;i<value.exact.length;i+=4)result.set(value.exact.slice(i+1,i+4),value.exact[i]);
        buffers.set(id,result);return result;
      }
      return at%4===0?new Type(bytes.buffer,at,length):new Type(bytes.slice(offset+byteOffset,offset+byteOffset+length*4).buffer);
    }
    if(Array.isArray(value))return value.map(visit);
    if(value&&typeof value==='object'){
      const result={};for(const [k,v] of Object.entries(value)){
        if(lazy&&v?.bufferType)Object.defineProperty(result,k,{enumerable:true,get:()=>visit(v)});
        else result[k]=visit(v);
      }return result;
    }
    return value;
  };
  const result=visit(data);
  Object.defineProperties(result,{clearDecodedBuffers:{value:()=>buffers.clear()},decodedBufferBytes:{get:()=>[...buffers.values()].reduce((n,a)=>n+a.byteLength,0)},encodedBytes:{value:bytes.byteLength}});
  return result;
}
