import { ImageTransport, imageError } from './transport.js';

function nowSeed(value = '') {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function decodeBase64(value, fallbackType = 'image/png') {
  const source = String(value || '');
  const match = source.match(/^data:([^;,]+);base64,(.*)$/s);
  const mimeType = match?.[1] || fallbackType;
  const encoded = match?.[2] || source;
  let binary;
  try { binary = atob(encoded.replace(/\s/g, '')); }
  catch { throw imageError('PROVIDER_ERROR', '供应商返回了无效的 Base64 图片'); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

async function dimensionsOf(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20), mimeType: 'image/png' };
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    if (bytes[12] === 0x56 && bytes[15] === 0x58 && bytes.length >= 30) {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16), mimeType: 'image/webp'
      };
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          width: (bytes[offset + 7] << 8) + bytes[offset + 8],
          height: (bytes[offset + 5] << 8) + bytes[offset + 6], mimeType: 'image/jpeg'
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (globalThis.createImageBitmap) {
    const bitmap = await createImageBitmap(blob);
    const result = { width: bitmap.width, height: bitmap.height, mimeType: blob.type || 'image/png' };
    bitmap.close?.();
    return result;
  }
  return { width: 0, height: 0, mimeType: blob.type || 'image/png' };
}

async function generatedImage(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw imageError('PROVIDER_ERROR', '供应商没有返回图片数据');
  const dimensions = await dimensionsOf(blob);
  return { blob, mimeType: dimensions.mimeType, width: dimensions.width, height: dimensions.height };
}

function parseWorkflow(value) {
  let workflow = value;
  if (typeof workflow === 'string') {
    try { workflow = JSON.parse(workflow); }
    catch { throw imageError('WORKFLOW_INCOMPATIBLE', 'ComfyUI 工作流不是有效 JSON'); }
  }
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw imageError('WORKFLOW_INCOMPATIBLE', '请导入 ComfyUI API-format 工作流');
  }
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node || typeof node !== 'object' || !node.class_type || !node.inputs) {
      throw imageError('WORKFLOW_INCOMPATIBLE', `节点 ${nodeId} 不是 API-format 节点`);
    }
  }
  return structuredClone(workflow);
}

function parsePort(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.nodeId && value.input) return value;
  const match = String(value).trim().match(/^([^\.]+)(?:\.inputs)?\.([^\.]+)$/);
  return match ? { nodeId: match[1], input: match[2] } : null;
}

function patchWorkflow(workflow, mapping, values) {
  for (const [role, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    const port = parsePort(mapping?.[role]);
    if (!port) continue;
    if (!workflow[port.nodeId]?.inputs || !(port.input in workflow[port.nodeId].inputs)) {
      throw imageError('WORKFLOW_INCOMPATIBLE', `ComfyUI 端口不存在: ${port.nodeId}.${port.input}`);
    }
    workflow[port.nodeId].inputs[port.input] = value;
  }
  return workflow;
}

async function downloadUrl(transport, provider, url, signal) {
  if (String(url).startsWith('data:')) return decodeBase64(url);
  const parsed = new URL(url, provider.apiUrl);
  return transport.downloadUrl(parsed.href, { signal, provider });
}

const IMAGE_MODEL_NAME_PATTERN = /(?:gpt[-_. ]?image|dall[-_. ]?e|flux|sdxl|stable[-_. ]?diffusion|imagen|ideogram|recraft|qwen[-_. ]?image|seedream|nano[-_. ]?banana|cogview|kolors|hidream|playground[-_. ]?v|image[-_. ]?gen|text[-_. ]?to[-_. ]?image|txt2img|(?:^|[-_. ])image(?:$|[-_. ]))/i;
const IMAGE_MODEL_METADATA_PATTERN = /(?:^|[^a-z\d])(?:image|images|image[-_. ]?generation|text[-_. ]?to[-_. ]?image|txt2img)(?:$|[^a-z\d])/i;
const MAX_MODEL_ID_LENGTH = 512;
const MAX_MODEL_CATALOG_SIZE = 5000;

function modelName(item) {
  const name = typeof item === 'string'
    ? item.trim()
    : (!item || typeof item !== 'object' ? '' : String(item.id || item.name || '').trim());
  return name.length <= MAX_MODEL_ID_LENGTH ? name : '';
}

function imageModelHint(item, name) {
  if (IMAGE_MODEL_NAME_PATTERN.test(name)) return true;
  if (!item || typeof item !== 'object') return false;
  const hints = [
    item.type, item.task, item.mode, item.modality, item.modalities,
    item.capability, item.capabilities, item.endpoint, item.endpoints
  ].flat(Infinity).filter(value => typeof value === 'string');
  return IMAGE_MODEL_METADATA_PATTERN.test(hints.join(' '));
}

function normalizeModelCatalog(payload, currentModel = '') {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
  const catalog = new Map();
  for (const item of source) {
    const name = modelName(item);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const previous = catalog.get(key);
    catalog.set(key, {
      name: previous?.name || name,
      image: Boolean(previous?.image || imageModelHint(item, name))
    });
    if (catalog.size >= MAX_MODEL_CATALOG_SIZE) break;
  }
  const rawSelected = String(currentModel || '').trim();
  const selected = rawSelected.length <= MAX_MODEL_ID_LENGTH ? rawSelected : '';
  if (selected) {
    const key = selected.toLocaleLowerCase();
    const previous = catalog.get(key);
    catalog.set(key, {
      name: previous?.name || selected,
      image: Boolean(previous?.image || imageModelHint(null, selected))
    });
  }
  const entries = [...catalog.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, {
    sensitivity: 'base', numeric: true
  }));
  return {
    models: entries.map(item => item.name),
    imageModels: entries.filter(item => item.image).map(item => item.name)
  };
}

export class OpenAIImageAdapter {
  constructor(transport) { this.transport = transport; this.type = 'openai'; }

  async probe(provider, { signal } = {}) {
    const data = await this.transport.json(provider, '/models', { signal });
    const { models, imageModels } = normalizeModelCatalog(data, provider.model);
    return {
      status: 'ready', adapter: this.type, model: String(provider.model || '').trim(), models, imageModels,
      recommendedModel: imageModels[0] || '',
      capabilities: { textToImage: true, referenceImage: false, deterministicSeed: false, resumable: false }
    };
  }

  async generate({ provider, prompt, negativePrompt, parameters = {}, signal }) {
    const body = {
      model: provider.model || 'gpt-image-1',
      prompt: [prompt, negativePrompt ? `Avoid: ${negativePrompt}` : ''].filter(Boolean).join('\n'),
      n: 1,
      size: parameters.size || provider.size || '1024x1024',
      quality: parameters.quality || provider.quality || 'auto',
      response_format: 'b64_json'
    };
    let data;
    try {
      data = await this.transport.json(provider, '/images/generations', { method: 'POST', body, signal });
    } catch (error) {
      if (error.status !== 400) throw error;
      delete body.response_format;
      data = await this.transport.json(provider, '/images/generations', { method: 'POST', body, signal });
    }
    const item = data?.data?.[0];
    if (!item) throw imageError('PROVIDER_ERROR', 'Images API 未返回图片');
    const blob = item.b64_json ? decodeBase64(item.b64_json) : await downloadUrl(this.transport, provider, item.url, signal);
    return { images: [await generatedImage(blob)], metadata: { revisedPrompt: item.revised_prompt || '' } };
  }
}

export class A1111ImageAdapter {
  constructor(transport) { this.transport = transport; this.type = 'a1111'; }

  async probe(provider, { signal } = {}) {
    const [models, samplers] = await Promise.all([
      this.transport.json(provider, '/sdapi/v1/sd-models', { signal }),
      this.transport.json(provider, '/sdapi/v1/samplers', { signal })
    ]);
    return {
      status: 'ready', adapter: this.type,
      models: Array.isArray(models) ? models.map(item => item.title || item.model_name).filter(Boolean) : [],
      samplers: Array.isArray(samplers) ? samplers.map(item => item.name).filter(Boolean) : [],
      capabilities: { textToImage: true, referenceImage: false, deterministicSeed: true, resumable: false, cancel: 'global-disabled' }
    };
  }

  async generate({ provider, prompt, negativePrompt, parameters = {}, signal }) {
    const seed = Number.isInteger(parameters.seed) ? parameters.seed : -1;
    const body = {
      prompt,
      negative_prompt: negativePrompt || '', seed,
      sampler_name: parameters.sampler || provider.sampler || 'Euler a',
      steps: Number(parameters.steps || provider.steps) || 24,
      cfg_scale: Number(parameters.cfgScale || provider.cfgScale) || 7,
      width: Number(parameters.width || provider.width) || 768,
      height: Number(parameters.height || provider.height) || 1024,
      batch_size: 1,
      override_settings_restore_afterwards: true
    };
    if (provider.model) body.override_settings = { sd_model_checkpoint: provider.model };
    const data = await this.transport.json(provider, '/sdapi/v1/txt2img', { method: 'POST', body, signal });
    const image = data?.images?.[0];
    if (!image) throw imageError('PROVIDER_ERROR', 'A1111 / Forge 未返回图片');
    return { images: [await generatedImage(decodeBase64(image))], metadata: { info: data.info || '', seed } };
  }
}

export class ComfyUIImageAdapter {
  constructor(transport) { this.transport = transport; this.type = 'comfyui'; }

  async probe(provider, { signal } = {}) {
    const workflow = parseWorkflow(provider.workflow);
    const objectInfo = await this.transport.json(provider, '/object_info', { signal });
    const missing = [...new Set(Object.values(workflow).map(node => node.class_type))]
      .filter(classType => !objectInfo?.[classType]);
    if (missing.length) throw imageError('WORKFLOW_INCOMPATIBLE', `ComfyUI 缺少节点: ${missing.join(', ')}`);
    const referenceImage = Boolean(parsePort(provider.mapping?.reference));
    return {
      status: 'ready', adapter: this.type, workflowNodes: Object.keys(workflow).length,
      capabilities: { textToImage: true, referenceImage, deterministicSeed: Boolean(parsePort(provider.mapping?.seed)), resumable: true, cancel: 'job' }
    };
  }

  async generate({ provider, prompt, negativePrompt, parameters = {}, referenceBlob = null, signal, resumeToken, onCheckpoint, onProgress }) {
    let promptId = resumeToken?.promptId || null;
    if (!promptId) {
      let referenceName = null;
      if (referenceBlob && parsePort(provider.mapping?.reference)) {
        const form = new FormData();
        form.append('image', referenceBlob, `naruto-reference-${nowSeed(Date.now())}.png`);
        form.append('overwrite', 'false');
        const uploaded = await this.transport.json(provider, '/upload/image', { method: 'POST', body: form, signal });
        referenceName = uploaded?.name || uploaded?.filename;
        if (!referenceName) throw imageError('PROVIDER_ERROR', 'ComfyUI 参考图上传失败');
      }
      const workflow = patchWorkflow(parseWorkflow(provider.workflow), provider.mapping || {}, {
        positive: prompt, negative: negativePrompt || '', seed: parameters.seed,
        width: parameters.width, height: parameters.height, reference: referenceName
      });
      const submitted = await this.transport.json(provider, '/prompt', {
        method: 'POST', body: { prompt: workflow, client_id: `naruto-rpg-${nowSeed(Date.now())}` }, signal
      });
      promptId = submitted?.prompt_id;
      if (!promptId) throw imageError('PROVIDER_ERROR', 'ComfyUI 未返回 prompt_id');
      await onCheckpoint?.({ promptId });
    }
    const startedAt = Date.now();
    const timeoutMs = Math.max(10000, Number(provider.timeoutMs) || 300000);
    const interval = Math.max(250, Number(provider.pollIntervalMs) || 1000);
    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const history = await this.transport.json(provider, `/history/${encodeURIComponent(promptId)}`, { signal });
      const record = history?.[promptId] || (history?.outputs ? history : null);
      if (record?.status?.status_str === 'error' || record?.status?.completed === false && record?.status?.messages?.some?.(item => item?.[0] === 'execution_error')) {
        throw imageError('PROVIDER_ERROR', 'ComfyUI 工作流执行失败', record.status);
      }
      if (record?.outputs) {
        const outputNode = String(provider.mapping?.output || '');
        const nodes = outputNode && record.outputs[outputNode]
          ? [record.outputs[outputNode]] : Object.values(record.outputs);
        const descriptors = nodes.flatMap(output => output?.images || []);
        if (!descriptors.length) throw imageError('WORKFLOW_INCOMPATIBLE', 'ComfyUI 输出节点没有图片');
        const descriptor = descriptors[0];
        const query = new URLSearchParams({ filename: descriptor.filename, subfolder: descriptor.subfolder || '', type: descriptor.type || 'output' });
        const blob = await this.transport.blob(provider, `/view?${query}`, { signal });
        return { images: [await generatedImage(blob)], resumeToken: { promptId }, metadata: { promptId } };
      }
      onProgress?.({ label: '等待 ComfyUI 完成', promptId });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, interval);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
    }
    throw imageError('PROVIDER_ERROR', 'ComfyUI 生成超时');
  }

  async cancel(provider, resumeToken, { signal } = {}) {
    if (!resumeToken?.promptId) return false;
    await this.transport.json(provider, '/queue', { method: 'POST', body: { delete: [resumeToken.promptId] }, signal });
    return true;
  }
}

export class ImageAdapterRegistry {
  constructor({ transport = new ImageTransport() } = {}) {
    this.transport = transport;
    this.adapters = new Map();
    this.register('openai', new OpenAIImageAdapter(transport));
    this.register('openai-compatible', this.adapters.get('openai'));
    this.register('comfyui', new ComfyUIImageAdapter(transport));
    const a1111 = new A1111ImageAdapter(transport);
    this.register('a1111', a1111);
    this.register('forge', a1111);
  }

  register(type, adapter) { this.adapters.set(type, adapter); return this; }

  get(type) {
    const adapter = this.adapters.get(String(type || '').toLowerCase());
    if (!adapter) throw imageError('PROFILE_INVALID', `不支持的绘图后端: ${type}`);
    return adapter;
  }
}

export { decodeBase64, dimensionsOf, generatedImage, nowSeed };
