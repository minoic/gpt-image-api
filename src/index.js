import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createProviderApiKeyAuthMethod, isProviderApiKeyConfigured } from 'openclaw/plugin-sdk/provider-auth';
import { resolveApiKeyForProvider } from 'openclaw/plugin-sdk/provider-auth-runtime';
import { assertOkOrThrowHttpError, postJsonRequest, postMultipartRequest, resolveProviderHttpRequestConfig } from 'openclaw/plugin-sdk/provider-http';
import { PROVIDER_ID, resolveConfig, buildRequest, extractBase64Images } from './core.js';

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
        const images = extractBase64Images(await result.response.json());
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
  },
});
