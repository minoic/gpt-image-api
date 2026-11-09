export const PROVIDER_ID = 'new';
const string = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const OPTION_MAP = { quality:'quality', outputFormat:'output_format', background:'background', moderation:'moderation', outputCompression:'output_compression', user:'user', inputFidelity:'input_fidelity', complexity:'complexity', frameCount:'frame_count', frameDurationMs:'frame_duration_ms', responseFormat:'response_format', partialImages:'partial_images' };

export function resolveConfig(req, authKey, env = process.env) {
  const provider = record(req.cfg?.models?.providers?.[PROVIDER_ID]);
  return {
    baseUrl: string(provider.baseUrl) ?? string(env.GPT_IMAGE_BASE_URL),
    apiKey: string(authKey) ?? string(provider.apiKey) ?? string(env.GPT_IMAGE_API_KEY),
    defaultModel: string(env.GPT_IMAGE_MODEL_ID) ?? 'gpt-image-2',
  };
}
export function buildRequest(req, config) {
  const base = string(config.baseUrl);
  if (!base) throw new Error('Missing base URL: configure models.providers.new.baseUrl or GPT_IMAGE_BASE_URL.');
  const parsed = new URL(base);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Base URL must be HTTP(S), without credentials, query or fragment.');
  const model = string(req.model) ?? string(config.defaultModel);
  if (!model || model === 'auto' || model.startsWith('gemini')) throw new Error('Select an explicit OpenAI-compatible image model ID.');
  if (!string(req.prompt)) throw new Error('Prompt is required.');
  const inputs = req.inputImages ?? [];
  if (inputs.length > 5) throw new Error('At most five input images are supported.');
  const options = record(record(req.providerOptions).openai);
  const params = { model, prompt:req.prompt };
  if (req.size) params.size = req.size;
  if (req.count !== undefined) {
    if (!Number.isInteger(req.count) || req.count < 1 || req.count > 4) throw new Error('count must be an integer from 1 to 4.');
    params.n = req.count;
  }
  for (const [key, wire] of Object.entries(OPTION_MAP)) {
    const value = options[key] ?? req[key];
    if (value !== undefined && value !== null) params[wire] = value;
  }
  const url = `${base.replace(/\/+$/, '')}/images/${inputs.length ? 'edits' : 'generations'}`;
  if (!inputs.length) return {url, params, edit:false};
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, String(value));
  inputs.forEach((image, i) => {
    if (!(image.buffer instanceof Uint8Array)) throw new Error('Invalid image buffer.');
    form.append('image[]', new Blob([image.buffer], {type:image.mimeType || 'image/png'}), image.fileName || `input-${i+1}.png`);
  });
  return {url, params, body:form, edit:true};
}
export function mimeFromBytes(buffer, fallback = 'image/png') {
  if (buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return 'image/png';
  if (buffer.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))) return 'image/jpeg';
  if (buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  if (['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString())) return 'image/gif';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buffer.subarray(0,1024).toString('utf8'))) return 'image/svg+xml';
  return fallback;
}
export function extractBase64Images(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('Image response must contain a data array.');
  return payload.data.map((entry, index) => {
    if (typeof entry.b64_json !== 'string' || !entry.b64_json) throw new Error('Image response has no b64_json; URL responses are not supported.');
    const buffer = Buffer.from(entry.b64_json, 'base64');
    if (!buffer.length) throw new Error('Image response is empty.');
    const mimeType = mimeFromBytes(buffer, entry.mime_type || 'image/png');
    const ext = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'}[mimeType] ?? 'bin';
    return {buffer, mimeType, fileName:`new-${index+1}.${ext}`, ...(entry.revised_prompt ? {revisedPrompt:entry.revised_prompt}: {})};
  });
}
