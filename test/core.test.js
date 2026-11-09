import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest,resolveConfig,extractBase64Images,mimeFromBytes} from '../src/core.js';
const config={baseUrl:'https://example.test/v1/',defaultModel:'gpt-image-2'};
test('generation sends the exact selected model and image options',()=>{
 const r=buildRequest({model:'gpt-image-2.6-flare',prompt:'hello',count:2,size:'1024x1024',quality:'high',outputFormat:'webp',providerOptions:{openai:{outputCompression:80,complexity:'high',frameCount:8,frameDurationMs:100}}},config);
 assert.equal(r.url,'https://example.test/v1/images/generations');
 assert.deepEqual(r.params,{model:'gpt-image-2.6-flare',prompt:'hello',size:'1024x1024',n:2,quality:'high',output_format:'webp',output_compression:80,complexity:'high',frame_count:8,frame_duration_ms:100});
});
test('edit uses multipart and retains all images and model',async()=>{
 const r=buildRequest({model:'gpt-image-2',prompt:'change',inputImages:[{buffer:Buffer.from('abc'),mimeType:'image/png',fileName:'a.png'},{buffer:Buffer.from('def'),mimeType:'image/jpeg'}]},config);
 assert.equal(r.url,'https://example.test/v1/images/edits'); assert.equal(r.body.get('model'),'gpt-image-2'); assert.equal(r.body.getAll('image[]').length,2); assert.equal(await r.body.getAll('image[]')[0].text(),'abc');
});
test('config prioritizes explicit provider config and auth profile',()=>{
 assert.deepEqual(resolveConfig({cfg:{models:{providers:{new:{baseUrl:'https://configured/v1',apiKey:'config'}}}}},'auth',{GPT_IMAGE_BASE_URL:'https://env/v1',GPT_IMAGE_API_KEY:'env',GPT_IMAGE_MODEL_ID:'custom'}),{baseUrl:'https://configured/v1',apiKey:'auth',defaultModel:'custom'});
});
test('image bytes determine actual MIME and filename',()=>{
 const b=Buffer.from('GIF89a0000'); const images=extractBase64Images({data:[{b64_json:b.toString('base64')}]}); assert.equal(images[0].mimeType,'image/gif');assert.equal(images[0].fileName,'new-1.gif');assert.deepEqual(images[0].buffer,b);
 assert.equal(mimeFromBytes(Buffer.from('<svg xmlns="x"></svg>')),'image/svg+xml');
});
test('reject unsupported requests and malformed response',()=>{
 assert.throws(()=>buildRequest({model:'auto',prompt:'x'},config)); assert.throws(()=>buildRequest({model:'gpt-image-2',prompt:'x'},{baseUrl:'https://user:secret@example.test/v1'})); assert.throws(()=>buildRequest({model:'gpt-image-2',prompt:'x',count:5},config)); assert.throws(()=>extractBase64Images({data:[{url:'https://example.test/a'}]}),/URL responses/);
});
