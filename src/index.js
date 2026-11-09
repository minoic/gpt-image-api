import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createProviderApiKeyAuthMethod, isProviderApiKeyConfigured } from 'openclaw/plugin-sdk/provider-auth';
import { resolveApiKeyForProvider } from 'openclaw/plugin-sdk/provider-auth-runtime';
import { assertOkOrThrowHttpError, postJsonRequest, postMultipartRequest, resolveProviderHttpRequestConfig, fetchWithTimeoutGuarded } from 'openclaw/plugin-sdk/provider-http';
import { saveMediaBuffer } from 'openclaw/plugin-sdk/media-store';
import { PROVIDER_ID, resolveConfig, buildRequest, extractImages } from './core.js';

export function buildImageProvider() {
  return {
    id: PROVIDER_ID, label: 'GPT Image API', defaultModel: process.env.GPT_IMAGE_MODEL_ID || 'gpt-image-2',
    defaultTimeoutMs:180000,
    models:[process.env.GPT_IMAGE_MODEL_ID || 'gpt-image-2'],
    isConfigured: ({agentDir, cfg}) => Boolean(process.env.GPT_IMAGE_API_KEY || cfg?.models?.providers?.new?.apiKey) || isProviderApiKeyConfigured({provider:PROVIDER_ID, agentDir}),
    capabilities:{
      generate:{maxCount:4,supportsSize:true},
      edit:{enabled:true,maxCount:4,maxInputImages:5,supportsSize:true},
      output:{formats:['png','jpeg','webp'],backgrounds:['transparent','opaque','auto'],qualities:['low','medium','high','xhigh','max','auto']},
    },
    async generateImage(req) {
      let apiKey;
      try { apiKey = (await resolveApiKeyForProvider({provider:PROVIDER_ID,cfg:req.cfg,agentDir:req.agentDir,store:req.authStore})).apiKey; } catch {}
      const config = resolveConfig(req,apiKey);
      if (!config.apiKey) throw new Error('Missing API key: set GPT_IMAGE_API_KEY or configure provider new.');
      const request = buildRequest(req,config);
      const http = resolveProviderHttpRequestConfig({baseUrl:config.baseUrl,defaultBaseUrl:config.baseUrl,allowPrivateNetwork:undefined,defaultHeaders:{Authorization:`Bearer ${config.apiKey}`},provider:PROVIDER_ID,capability:'image',transport:'http'});
      const common = {url:request.url,headers:http.headers,timeoutMs:req.timeoutMs ?? 180000,fetchFn:fetch,allowPrivateNetwork:http.allowPrivateNetwork,ssrfPolicy:req.ssrfPolicy,dispatcherPolicy:http.dispatcherPolicy};
      const jsonHeaders = new Headers(http.headers);
      jsonHeaders.set('Content-Type', 'application/json');
      const result = request.edit ? await postMultipartRequest({...common,body:request.body}) : await postJsonRequest({...common,headers:jsonHeaders,body:request.params});
      try {
        await assertOkOrThrowHttpError(result.response,`GPT Image ${request.edit ? 'edit' : 'generation'} failed`);
        const images = await extractImages(await result.response.json(), async url => {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Image URL must be HTTP(S) without credentials.');
          const download = await fetchWithTimeoutGuarded(url, {method:'GET'}, Math.min(req.timeoutMs ?? 60000, 60000), fetch, {auditContext:'new image download'});
          try {
            await assertOkOrThrowHttpError(download.response, 'Image download failed');
            const limit = 25 * 1024 * 1024;
            const declared = Number(download.response.headers.get('content-length'));
            if (declared > limit) throw new Error('Image exceeds 25 MiB limit.');
            const chunks = []; let size = 0;
            if (!download.response.body) throw new Error('Image download response is empty.');
            for await (const chunk of download.response.body) {
              size += chunk.length;
              if (size > limit) throw new Error('Image exceeds 25 MiB limit.');
              chunks.push(Buffer.from(chunk));
            }
            return {buffer:Buffer.concat(chunks), mimeType:download.response.headers.get('content-type')?.split(';')[0]};
          } finally { await download.release(); }
        });
        if (!images.length) throw new Error('Image response contains no images.');
        return {images,model:request.params.model};
      } finally { await result.release(); }
    },
  };
}
export default definePluginEntry({
  id:PROVIDER_ID,name:'GPT Image API',description:'OpenAI-compatible image generation and edits',
  register(api) {
    api.registerProvider({
      id:PROVIDER_ID,label:'GPT Image API',envVars:['GPT_IMAGE_API_KEY'],
      auth:[createProviderApiKeyAuthMethod({providerId:PROVIDER_ID,methodId:'api-key',label:'GPT Image API key',hint:'API key for your image endpoint',optionKey:'gptImageApiKey',flagName:'--gpt-image-api-key',envVar:'GPT_IMAGE_API_KEY',promptMessage:'Enter image API key',defaultModel:`new/${process.env.GPT_IMAGE_MODEL_ID || 'gpt-image-2'}`})],
      catalog:{order:'simple',run:ctx=>{
        const apiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey || process.env.GPT_IMAGE_API_KEY;
        const baseUrl = process.env.GPT_IMAGE_BASE_URL;
        return apiKey && baseUrl ? {provider:{baseUrl,apiKey,models:[]}} : null;
      }},
    });
    api.registerImageGenerationProvider(buildImageProvider());
    api.registerTool((context) => ({
      name:'gpt_image_26', label:'GPT Image 2.6',
      description:'Generate an image, animated GIF or SVG with the configured GPT image endpoint. GIF accepts frame_count 2–16 and frame_duration_ms 20–2000; SVG requires n=1.',
      parameters:{type:'object',additionalProperties:false,required:['prompt'],properties:{
        prompt:{type:'string',description:'Image or animation description'},
        model:{type:'string',description:'Model ID, optionally prefixed new/'},
        size:{type:'string'},quality:{type:'string',enum:['low','medium','high','xhigh','max','auto']},
        output_format:{type:'string',enum:['png','jpeg','webp','gif','svg']},
        complexity:{type:'string',enum:['low','medium','high']},
        frame_count:{type:'integer',minimum:2,maximum:16},
        frame_duration_ms:{type:'integer',minimum:20,maximum:2000},
        n:{type:'integer',minimum:1,maximum:4},
        background:{type:'string',enum:['transparent','opaque','auto']},
        moderation:{type:'string',enum:['low','auto']},
        output_compression:{type:'integer',minimum:0,maximum:100}
      }},
      async execute(_id, p) {
        if ((p.frame_count !== undefined || p.frame_duration_ms !== undefined) && p.output_format !== 'gif') throw new Error('frame_count and frame_duration_ms require GIF output.');
        if ((p.output_format === 'gif' || p.output_format === 'svg') && p.output_compression !== undefined) throw new Error('GIF/SVG do not support output_compression.');
        if (p.output_format === 'svg' && (p.n ?? 1) !== 1) throw new Error('SVG output requires n=1.');
        const provider = buildImageProvider();
        const model = (p.model || process.env.GPT_IMAGE_MODEL_ID || 'gpt-image-2').replace(/^new\//, '');
        const response = await provider.generateImage({provider:PROVIDER_ID,model,prompt:p.prompt,cfg:context.getRuntimeConfig?.() ?? context.runtimeConfig ?? context.config ?? api.config,agentDir:context.agentDir,count:p.n,size:p.size,quality:p.quality,providerOptions:{openai:{outputFormat:p.output_format,complexity:p.complexity,frameCount:p.frame_count,frameDurationMs:p.frame_duration_ms,background:p.background,moderation:p.moderation,outputCompression:p.output_compression}}});
        const files = [];
        for (const asset of response.images) {
          const saved = await saveMediaBuffer(asset.buffer,asset.mimeType,'outbound',25*1024*1024,asset.fileName);
          files.push({path:saved.path,mimeType:asset.mimeType});
        }
        return {content:[{type:'text',text:`Generated ${files.length} file(s) with ${model}. Send the following media:\n${files.map(f=>`MEDIA:${f.path}`).join('\n')}`}],details:{model,files}};
      },
    }), {name:'gpt_image_26'});
  },
});
