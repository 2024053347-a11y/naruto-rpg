import { imageStudio as defaultImageStudio } from '../../image-studio/index.js';
import { normalizeImageProviderId } from '../../image-studio/settings.js';
import {
  LingXiActionError,
  createActionProposal,
  fingerprintValue,
  hashCanonical,
  verifyActionProposal
} from '../action-proposal.js';
import { consumeBrokerApprovedProposal } from '../approval-broker.js';

export const LINGXI_IMAGE_GENERATION_TOOL = 'generate_image';
export const LINGXI_IMAGE_LIBRARY_ACTION_TOOL = 'manage_image_library';
export const LINGXI_IMAGE_ACTION_IMPACT_KIND = 'image';
export const LINGXI_IMAGE_LIBRARY_IMPACT_KIND = 'image-library';

const ACTION_IMPACT_SCHEMA = 'naruto.lingxi-action-impact/v1';
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LOCAL_PROVIDER_TYPES = new Set(['comfyui', 'a1111', 'forge']);

function fail(code, message, details = null) {
  throw new LingXiActionError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(value, allowed, label) {
  if (!isRecord(value)) fail('LINGXI_IMAGE_INVALID', `${label}必须是对象`);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      fail('LINGXI_IMAGE_INVALID', `${label}包含不支持的字段: ${key}`);
    }
  }
}

function cleanText(value, label, max, { required = true } = {}) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return '';
    fail('LINGXI_IMAGE_INVALID', `${label}必须是文本`);
  }
  const result = String(value || '').replace(/\u0000/g, '').trim();
  if ((required && !result) || result.length > max) {
    fail('LINGXI_IMAGE_INVALID', `${label}必须是${required ? '非空' : ''}且不超过 ${max} 个字符的文本`);
  }
  return result;
}

function cloneSerializable(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function pointerSegment(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function endpointOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return `${url.protocol}//${url.host}`;
  } catch {
    return value ? '[自定义地址]' : '';
  }
}

function publicTarget(target) {
  assertOnlyKeys(target, new Set(['kind', 'nodeId', 'subjectId']), '图片目标');
  if (target?.kind === 'turn' && target.nodeId) {
    return { kind: 'turn', nodeId: cleanText(String(target.nodeId), '回合节点 ID', 240) };
  }
  if (target?.kind === 'portrait' && target.subjectId) {
    return { kind: 'portrait', subjectId: cleanText(String(target.subjectId), '人物 Subject ID', 240) };
  }
  fail('LINGXI_IMAGE_INVALID', '图片目标必须是 turn/nodeId 或 portrait/subjectId');
}

function targetKey(target) {
  return target.kind === 'turn'
    ? `turn:${target.nodeId}`
    : `portrait:${target.subjectId}`;
}

function providerSummary(id, provider = {}) {
  const type = normalizeImageProviderId(provider.type || id, id);
  const credentialConfigured = Boolean(String(provider.apiKey || '').trim());
  const endpoint = endpointOrigin(provider.apiUrl);
  const configured = Boolean(endpoint && (LOCAL_PROVIDER_TYPES.has(type) || credentialConfigured));
  return {
    id: String(id),
    type,
    configured,
    credentialConfigured,
    endpoint,
    model: String(provider.model || '').trim().slice(0, 160),
    ...(provider.size ? { size: String(provider.size).slice(0, 40) } : {}),
    ...(Number.isFinite(Number(provider.width)) ? { width: Number(provider.width) } : {}),
    ...(Number.isFinite(Number(provider.height)) ? { height: Number(provider.height) } : {})
  };
}

export function summarizeImageSettings(settings = {}) {
  const providers = Object.entries(isRecord(settings.providers) ? settings.providers : {})
    .map(([id, provider]) => providerSummary(id, isRecord(provider) ? provider : {}));
  const activeProviderId = normalizeImageProviderId(
    settings.activeProviderId || settings.providerId || 'openai-compatible'
  );
  return {
    enabled: settings.enabled === true,
    turnMode: settings.turnMode === 'automatic' || settings.turnMode === 'auto' ? 'automatic' : 'manual',
    promptMode: settings.promptMode === 'separate-model' ? 'separate-model' : 'main-contract',
    activeProviderId,
    concurrency: Math.max(1, Math.min(4, Math.trunc(Number(settings.concurrency) || 1))),
    providers,
    separatePromptModel: settings.separatePromptModel
      ? providerSummary('separate-prompt-model', settings.separatePromptModel)
      : null,
    notice: 'API 密钥仅以“已配置/未配置”表示，不会进入灵希上下文。'
  };
}

function galleryAssetSummary(asset = {}) {
  const target = asset.target?.kind === 'turn' && asset.target.nodeId
    ? { kind: 'turn', nodeId: String(asset.target.nodeId).slice(0, 240) }
    : (asset.target?.kind === 'portrait' && asset.target.subjectId
        ? { kind: 'portrait', subjectId: String(asset.target.subjectId).slice(0, 240) }
        : null);
  return {
    id: String(asset.id || asset.assetId || '').slice(0, 240),
    target,
    purpose: String(asset.purpose || asset.metadata?.purpose || '').slice(0, 80),
    subjectName: String(asset.subjectName || asset.metadata?.subject_name || '').slice(0, 160),
    campaignId: String(asset.campaignId || asset.metadata?.campaign_id || '').slice(0, 240),
    providerId: String(asset.providerId || '').slice(0, 100),
    createdAt: String(asset.createdAt || '').slice(0, 80),
    state: String(asset.state || asset.cloudState || '').slice(0, 60),
    selected: asset.selected === true,
    protected: asset.protected === true || asset.isProtected === true,
    sizeBytes: Number.isFinite(Number(asset.sizeBytes)) ? Math.max(0, Number(asset.sizeBytes)) : null,
    width: Number.isFinite(Number(asset.width)) ? Math.max(0, Number(asset.width)) : null,
    height: Number.isFinite(Number(asset.height)) ? Math.max(0, Number(asset.height)) : null
  };
}

function normalizeGalleryFilters(filters = {}) {
  assertOnlyKeys(filters, new Set(['campaignId', 'turnNodeId', 'subjectId', 'purpose']), '图库筛选');
  const result = {};
  for (const key of ['campaignId', 'turnNodeId', 'subjectId', 'purpose']) {
    const value = cleanText(filters[key], key, 240, { required: false });
    if (value) result[key] = value;
  }
  return result;
}

function jobSummary(job = {}) {
  return {
    id: String(job.id || '').slice(0, 240),
    state: String(job.state || '').slice(0, 60),
    providerId: String(job.providerId || '').slice(0, 100),
    mode: String(job.mode || '').slice(0, 40),
    createdAt: String(job.createdAt || '').slice(0, 80),
    updatedAt: String(job.updatedAt || '').slice(0, 80),
    errorCode: String(job.error?.code || '').slice(0, 100)
  };
}

export class ImageStudioActionAdapter {
  #approvalPermit = null;

  constructor({ imageStudio = defaultImageStudio } = {}) {
    if (typeof imageStudio?.read !== 'function' || typeof imageStudio?.execute !== 'function') {
      fail('LINGXI_ADAPTER_INVALID', '图片适配器需要 ImageStudio read() 和 execute()');
    }
    this.imageStudio = imageStudio;
    this.toolName = LINGXI_IMAGE_GENERATION_TOOL;
  }

  bindApprovalPermit(permit) {
    if (!permit || typeof permit !== 'object') fail('LINGXI_ADAPTER_INVALID', '审批许可必须是不透明对象');
    if (this.#approvalPermit && this.#approvalPermit !== permit) {
      fail('LINGXI_ADAPTER_INVALID', '图片适配器已绑定到另一个审批 Broker');
    }
    this.#approvalPermit = permit;
  }

  async inspectSettings() {
    return summarizeImageSettings(await this.imageStudio.read({ type: 'settings' }));
  }

  async inspectGallery({ filters = {}, offset = 0, limit = 20 } = {}) {
    const normalizedFilters = normalizeGalleryFilters(filters);
    const normalizedOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    const normalizedLimit = Math.max(1, Math.min(40, Math.trunc(Number(limit) || 20)));
    const result = await this.imageStudio.read({
      type: 'gallery',
      filters: normalizedFilters,
      offset: normalizedOffset,
      limit: normalizedLimit
    });
    return {
      filters: normalizedFilters,
      items: (Array.isArray(result?.items) ? result.items : []).map(galleryAssetSummary),
      total: Math.max(0, Number(result?.total) || 0),
      offset: normalizedOffset,
      limit: normalizedLimit,
      notice: '只返回图片元数据，不返回临时下载地址、云端授权参数或 API 密钥。'
    };
  }

  async inspectTarget(target) {
    const normalizedTarget = publicTarget(target);
    const result = await this.imageStudio.read({ type: 'target', target: normalizedTarget });
    const binding = result?.binding;
    return {
      target: normalizedTarget,
      binding: binding ? {
        assetId: String(binding.assetId || binding.activeAssetId || '').slice(0, 240),
        revision: Math.max(0, Number(binding.revision) || 0),
        updatedAt: String(binding.updatedAt || '').slice(0, 80)
      } : null,
      assets: (Array.isArray(result?.assets) ? result.assets : []).map(galleryAssetSummary),
      jobs: (Array.isArray(result?.jobs) ? result.jobs : []).map(jobSummary)
    };
  }

  _normalizeGenerationParams(params) {
    assertOnlyKeys(
      params,
      new Set(['target', 'prompt', 'negativePrompt', 'providerId', 'reroll', 'reason']),
      '图片生成参数'
    );
    return {
      target: publicTarget(params.target),
      prompt: cleanText(params.prompt, '正向提示词', 6000),
      negativePrompt: cleanText(params.negativePrompt, '负向提示词', 3000, { required: false }),
      providerId: cleanText(params.providerId, '绘图后端 ID', 100, { required: false }),
      reroll: params.reroll === true,
      reason: cleanText(params.reason, '生成原因', 500)
    };
  }

  async _snapshot(target) {
    const [settings, targetState] = await Promise.all([
      this.imageStudio.read({ type: 'settings' }),
      this.imageStudio.read({ type: 'target', target })
    ]);
    const serializableSettings = cloneSerializable(settings);
    const serializableTargetState = cloneSerializable(targetState);
    return {
      settings: serializableSettings,
      targetState: serializableTargetState,
      fingerprint: await fingerprintValue({
        settings: serializableSettings,
        targetState: serializableTargetState
      })
    };
  }

  _resolveProvider(params, settings) {
    if (settings?.enabled !== true) {
      fail('LINGXI_IMAGE_DISABLED', '文生图尚未启用，请先在图片工作台设置中启用');
    }
    const requested = params.providerId
      ? normalizeImageProviderId(params.providerId)
      : normalizeImageProviderId(settings.activeProviderId || settings.providerId);
    const provider = settings?.providers?.[requested];
    if (!provider) fail('LINGXI_IMAGE_PROVIDER_UNAVAILABLE', `绘图后端不存在: ${requested}`);
    if (!String(provider.apiUrl || '').trim()) {
      fail('LINGXI_IMAGE_PROVIDER_UNAVAILABLE', `绘图后端尚未配置地址: ${requested}`);
    }
    return requested;
  }

  _diff(params) {
    const key = pointerSegment(targetKey(params.target));
    return [{
      path: `/imageStudio/generationRequests/${key}`,
      operation: 'add',
      after: {
        target: params.target,
        providerId: params.providerId,
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        reroll: params.reroll
      }
    }];
  }

  async stage(params, { now = Date.now(), ttlMs } = {}) {
    const normalized = this._normalizeGenerationParams(params);
    const snapshot = await this._snapshot(normalized.target);
    normalized.providerId = this._resolveProvider(normalized, snapshot.settings);
    const diff = this._diff(normalized);
    const proposal = await createActionProposal({
      tool: this.toolName,
      params: normalized,
      stateFingerprint: snapshot.fingerprint,
      context: {
        actionImpact: {
          schema: ACTION_IMPACT_SCHEMA,
          kind: LINGXI_IMAGE_ACTION_IMPACT_KIND,
          summary: '调用已配置的外部绘图后端创建 1 个图片生成任务',
          details: [
            `目标: ${targetKey(normalized.target)}`,
            `后端: ${normalized.providerId}`,
            '批准后可能产生 API 费用、算力消耗并持久化图片资源。'
          ]
        }
      },
      diff,
      ttlMs,
      now
    });
    const current = await this._snapshot(normalized.target);
    if (current.fingerprint !== snapshot.fingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '图片设置或目标在提案生成期间发生了变化');
    }
    return proposal;
  }

  async apply(proposal, approvalPermit) {
    const brokerApproved = consumeBrokerApprovedProposal(proposal);
    const directlyBound = this.#approvalPermit && approvalPermit === this.#approvalPermit;
    if (!brokerApproved || (this.#approvalPermit && !directlyBound)) {
      fail('LINGXI_APPROVAL_REQUIRED', '图片生成只能由绑定的审批 Broker 执行');
    }
    await verifyActionProposal(proposal);
    if (proposal.tool !== this.toolName) {
      fail('LINGXI_PROPOSAL_INVALID', `图片适配器不能执行 ${proposal.tool}`);
    }
    const normalized = this._normalizeGenerationParams(proposal.params);
    const snapshot = await this._snapshot(normalized.target);
    normalized.providerId = this._resolveProvider(normalized, snapshot.settings);
    if (snapshot.fingerprint !== proposal.stateFingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '图片设置或目标已变化，请重新生成并审批提案');
    }
    const diff = this._diff(normalized);
    if (await hashCanonical(diff) !== proposal.diffHash) {
      fail('LINGXI_PROPOSAL_TAMPERED', '图片生成的重新计算差异与已批准提案不一致');
    }
    const bindingRevision = Math.max(0, Number(snapshot.targetState?.binding?.revision) || 0);
    const result = await this.imageStudio.execute({
      type: 'generate',
      target: normalized.target,
      mode: 'manual',
      prompt: normalized.prompt,
      negativePrompt: normalized.negativePrompt,
      providerId: normalized.providerId,
      reroll: normalized.reroll,
      bindingRevision
    });
    return {
      schema: 'naruto.lingxi-action-receipt/v1',
      proposalId: proposal.id,
      tool: proposal.tool,
      appliedAt: Date.now(),
      beforeFingerprint: proposal.stateFingerprint,
      afterFingerprint: await fingerprintValue({
        jobId: String(result?.jobId || ''),
        reused: result?.reused === true
      }),
      diff,
      jobId: String(result?.jobId || ''),
      reused: result?.reused === true,
      status: result?.reused === true ? 'reused' : 'queued'
    };
  }
}

const RETRYABLE_JOB_STATES = new Set(['failed', 'interrupted', 'blocked']);
const CANCELLABLE_JOB_STATES = new Set(['queued', 'planning', 'generating', 'staging', 'uploading', 'binding']);

function libraryImpact(summary, details) {
  return {
    schema: ACTION_IMPACT_SCHEMA,
    kind: LINGXI_IMAGE_LIBRARY_IMPACT_KIND,
    summary: cleanText(summary, '影响摘要', 240),
    details: details.map(item => cleanText(item, '影响明细', 500)).slice(0, 20)
  };
}

function libraryReceipt(proposal, afterFingerprint, diff, result = {}) {
  return {
    schema: 'naruto.lingxi-action-receipt/v1',
    proposalId: proposal.id,
    tool: proposal.tool,
    appliedAt: Date.now(),
    beforeFingerprint: proposal.stateFingerprint,
    afterFingerprint,
    diff: cloneSerializable(diff),
    summary: String(result.summary || '图片库操作已完成').slice(0, 300),
    ...(result.jobId ? { jobId: String(result.jobId).slice(0, 240) } : {})
  };
}

function normalizeLibraryParams(params, { stored = false } = {}) {
  const allowed = new Set(['action', 'target', 'assetId', 'jobId', 'reason']);
  if (stored) allowed.add('expectedRevision');
  assertOnlyKeys(params, allowed, '图片库操作参数');
  const action = cleanText(params.action, '图片库操作', 40);
  if (!['select', 'detach', 'protect', 'unprotect', 'delete', 'retry', 'cancel'].includes(action)) {
    fail('LINGXI_IMAGE_INVALID', `不支持的图片库操作: ${action}`);
  }
  const reason = cleanText(params.reason, '操作原因', 500);
  if (action === 'select' || action === 'detach') {
    if (params.jobId !== undefined) fail('LINGXI_IMAGE_INVALID', `${action} 操作不接受 jobId`);
    const target = publicTarget(params.target);
    const assetId = action === 'select' ? cleanText(params.assetId, '图片资源 ID', 240) : '';
    if (action === 'detach' && params.assetId !== undefined) {
      fail('LINGXI_IMAGE_INVALID', '解绑操作不接受 assetId');
    }
    const expectedRevision = stored ? Number(params.expectedRevision) : null;
    if (stored && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
      fail('LINGXI_PROPOSAL_TAMPERED', '图片绑定版本无效');
    }
    return {
      action,
      target,
      ...(assetId ? { assetId } : {}),
      ...(stored ? { expectedRevision } : {}),
      reason
    };
  }
  if (action === 'protect' || action === 'unprotect' || action === 'delete') {
    if (params.target !== undefined || params.jobId !== undefined || params.expectedRevision !== undefined) {
      fail('LINGXI_IMAGE_INVALID', `${action} 操作只接受 assetId 和 reason`);
    }
    return { action, assetId: cleanText(params.assetId, '图片资源 ID', 240), reason };
  }
  if (params.target !== undefined || params.assetId !== undefined || params.expectedRevision !== undefined) {
    fail('LINGXI_IMAGE_INVALID', `${action} 操作只接受 jobId 和 reason`);
  }
  return { action, jobId: cleanText(params.jobId, '图片任务 ID', 240), reason };
}

function publicTargetState(result = {}) {
  const binding = result?.binding;
  return {
    binding: binding ? {
      assetId: String(binding.assetId || binding.activeAssetId || '').slice(0, 240),
      revision: Math.max(0, Number(binding.revision) || 0),
      updatedAt: String(binding.updatedAt || '').slice(0, 80)
    } : null,
    assets: (Array.isArray(result?.assets) ? result.assets : []).map(galleryAssetSummary),
    jobs: (Array.isArray(result?.jobs) ? result.jobs : []).map(jobSummary)
  };
}

export class ImageLibraryActionAdapter {
  #approvalPermit = null;

  constructor({ imageStudio = defaultImageStudio } = {}) {
    if (typeof imageStudio?.read !== 'function' || typeof imageStudio?.execute !== 'function') {
      fail('LINGXI_ADAPTER_INVALID', '图片库适配器需要 ImageStudio read() 和 execute()');
    }
    this.imageStudio = imageStudio;
    this.toolName = LINGXI_IMAGE_LIBRARY_ACTION_TOOL;
  }

  bindApprovalPermit(permit) {
    if (!permit || typeof permit !== 'object') fail('LINGXI_ADAPTER_INVALID', '审批许可必须是不透明对象');
    if (this.#approvalPermit && this.#approvalPermit !== permit) {
      fail('LINGXI_ADAPTER_INVALID', '图片库适配器已绑定到另一个审批 Broker');
    }
    this.#approvalPermit = permit;
  }

  async _authorize(proposal, approvalPermit) {
    const brokerApproved = consumeBrokerApprovedProposal(proposal);
    const directlyBound = this.#approvalPermit && approvalPermit === this.#approvalPermit;
    if (!brokerApproved || (this.#approvalPermit && !directlyBound)) {
      fail('LINGXI_APPROVAL_REQUIRED', '图片库操作只能由绑定的审批 Broker 执行');
    }
    await verifyActionProposal(proposal);
    if (proposal.tool !== this.toolName) {
      fail('LINGXI_PROPOSAL_INVALID', `图片库适配器不能执行 ${proposal.tool}`);
    }
  }

  async _targetSnapshot(target) {
    const raw = cloneSerializable(await this.imageStudio.read({ type: 'target', target }));
    return {
      raw,
      public: { target, ...publicTargetState(raw) },
      fingerprint: await fingerprintValue(raw)
    };
  }

  async _findAsset(assetId) {
    const limit = 40;
    for (let offset = 0; offset < 500; offset += limit) {
      const page = await this.imageStudio.read({ type: 'gallery', filters: {}, offset, limit });
      const items = Array.isArray(page?.items) ? page.items : [];
      const asset = items.find(item => String(item?.id || item?.assetId || '') === assetId);
      if (asset) return cloneSerializable(asset);
      const total = Math.max(0, Number(page?.total) || 0);
      if (items.length < limit || offset + items.length >= total) break;
    }
    return null;
  }

  async _assetSnapshot(assetId) {
    const rawAsset = await this._findAsset(assetId);
    if (!rawAsset) fail('LINGXI_IMAGE_ASSET_UNAVAILABLE', '图片资源不存在或不在可见图库范围内');
    const asset = galleryAssetSummary(rawAsset);
    let targetState = null;
    if (asset.target) targetState = await this._targetSnapshot(asset.target);
    const selected = Boolean(targetState?.public?.binding?.assetId === asset.id || asset.selected);
    const publicAsset = { ...asset, selected };
    const raw = { asset: rawAsset, targetState: targetState?.raw || null };
    return { raw, public: publicAsset, targetState, fingerprint: await fingerprintValue(raw) };
  }

  async _jobSnapshot(jobId) {
    const raw = cloneSerializable(await this.imageStudio.read({ type: 'job', jobId }));
    if (!raw || !raw.id) fail('LINGXI_IMAGE_JOB_UNAVAILABLE', '图片任务不存在');
    return { raw, public: jobSummary(raw), fingerprint: await fingerprintValue(raw) };
  }

  async _snapshot(params) {
    if (params.action === 'select' || params.action === 'detach') return this._targetSnapshot(params.target);
    if (params.action === 'protect' || params.action === 'unprotect' || params.action === 'delete') {
      return this._assetSnapshot(params.assetId);
    }
    return this._jobSnapshot(params.jobId);
  }

  _prepare(params, snapshot, { stored = false } = {}) {
    if (params.action === 'select') {
      const asset = snapshot.public.assets.find(item => item.id === params.assetId);
      if (!asset?.target || targetKey(asset.target) !== targetKey(params.target)) {
        fail('LINGXI_IMAGE_ASSET_UNAVAILABLE', '所选图片不属于该目标');
      }
      if (snapshot.public.binding?.assetId === params.assetId) fail('LINGXI_NO_CHANGES', '该图片已经是当前版本');
      const revision = snapshot.public.binding?.revision || 0;
      if (stored && params.expectedRevision !== revision) fail('LINGXI_PROPOSAL_STALE', '图片绑定版本已经变化');
      return { ...params, expectedRevision: revision };
    }
    if (params.action === 'detach') {
      if (!snapshot.public.binding?.assetId) fail('LINGXI_NO_CHANGES', '该图片目标当前没有绑定版本');
      const revision = snapshot.public.binding.revision || 0;
      if (stored && params.expectedRevision !== revision) fail('LINGXI_PROPOSAL_STALE', '图片绑定版本已经变化');
      return { ...params, expectedRevision: revision };
    }
    if (params.action === 'protect' && snapshot.public.protected) fail('LINGXI_NO_CHANGES', '该图片已经受保护');
    if (params.action === 'unprotect' && !snapshot.public.protected) fail('LINGXI_NO_CHANGES', '该图片当前未受保护');
    if (params.action === 'delete') {
      if (snapshot.public.protected) fail('LINGXI_IMAGE_ASSET_PROTECTED', '请先单独取消图片保护');
      if (snapshot.public.selected) fail('LINGXI_IMAGE_ASSET_SELECTED', '请先单独解绑或选择其他图片版本');
    }
    if (params.action === 'retry' && !RETRYABLE_JOB_STATES.has(snapshot.public.state)) {
      fail('LINGXI_IMAGE_JOB_UNAVAILABLE', '只有失败、中断或阻塞的图片任务可以重试');
    }
    if (params.action === 'cancel' && !CANCELLABLE_JOB_STATES.has(snapshot.public.state)) {
      fail('LINGXI_IMAGE_JOB_UNAVAILABLE', '该图片任务当前不能取消');
    }
    return params;
  }

  _diff(params, snapshot) {
    if (params.action === 'select' || params.action === 'detach') {
      return [{
        path: `/imageStudio/bindings/${pointerSegment(targetKey(params.target))}/assetId`,
        operation: snapshot.public.binding?.assetId ? 'replace' : 'add',
        before: snapshot.public.binding?.assetId || null,
        after: params.action === 'select' ? params.assetId : null
      }];
    }
    if (params.action === 'protect' || params.action === 'unprotect') {
      return [{
        path: `/imageStudio/assets/${pointerSegment(params.assetId)}/protected`,
        operation: 'replace',
        before: snapshot.public.protected,
        after: params.action === 'protect'
      }];
    }
    if (params.action === 'delete') {
      return [{
        path: `/imageStudio/assets/${pointerSegment(params.assetId)}`,
        operation: 'remove',
        before: snapshot.public,
        after: null
      }];
    }
    return [{
      path: `/imageStudio/jobs/${pointerSegment(params.jobId)}/${params.action}`,
      operation: 'add',
      before: { state: snapshot.public.state },
      after: { requested: true }
    }];
  }

  _impact(params, snapshot) {
    if (params.action === 'select') {
      return libraryImpact('选择一个已有图片版本作为当前画面', [
        `目标: ${targetKey(params.target)}`,
        `图片资源: ${params.assetId}`,
        '批准后会更新本地绑定，并在已登录时同步云端选择。'
      ]);
    }
    if (params.action === 'detach') {
      return libraryImpact('解绑当前图片版本', [
        `目标: ${targetKey(params.target)}`,
        `当前图片资源: ${snapshot.public.binding.assetId}`,
        '图片资源本身会保留在图库中。'
      ]);
    }
    if (params.action === 'protect' || params.action === 'unprotect') {
      return libraryImpact(params.action === 'protect' ? '保护图片资源' : '取消图片资源保护', [
        `图片资源: ${params.assetId}`,
        '保护状态可能同步到云端图库。'
      ]);
    }
    if (params.action === 'delete') {
      return libraryImpact('永久删除一个未绑定、未保护的图片资源', [
        `图片资源: ${params.assetId}`,
        '批准后会删除云端资源、本地元数据和本地图片 Blob；此操作不可撤销。'
      ]);
    }
    if (params.action === 'retry') {
      return libraryImpact('重试失败的图片生成任务', [
        `原任务: ${params.jobId}`,
        `原状态: ${snapshot.public.state}`,
        `后端: ${snapshot.public.providerId || '按原任务配置'}`,
        '批准后会复用原任务的提示词与后端创建新任务，可能再次产生 API 费用和算力消耗。'
      ]);
    }
    return libraryImpact('取消正在执行的图片生成任务', [
      `任务: ${params.jobId}`,
      `当前状态: ${snapshot.public.state}`,
      '已发出的外部请求可能无法即时撤回，最终状态以画面工坊回执为准。'
    ]);
  }

  async stage(params, { now = Date.now(), ttlMs } = {}) {
    const normalizedInput = normalizeLibraryParams(params);
    const snapshot = await this._snapshot(normalizedInput);
    const normalized = this._prepare(normalizedInput, snapshot);
    const diff = this._diff(normalized, snapshot);
    const proposal = await createActionProposal({
      tool: this.toolName,
      params: normalized,
      stateFingerprint: snapshot.fingerprint,
      context: { actionImpact: this._impact(normalized, snapshot) },
      diff,
      ttlMs,
      now
    });
    const current = await this._snapshot(normalized);
    if (current.fingerprint !== snapshot.fingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '图片库状态在提案生成期间发生了变化');
    }
    return proposal;
  }

  async apply(proposal, approvalPermit) {
    await this._authorize(proposal, approvalPermit);
    const normalizedInput = normalizeLibraryParams(proposal.params, { stored: true });
    const snapshot = await this._snapshot(normalizedInput);
    if (snapshot.fingerprint !== proposal.stateFingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '图片资源、绑定或任务状态已经变化，请重新生成提案');
    }
    const normalized = this._prepare(normalizedInput, snapshot, { stored: true });
    const diff = this._diff(normalized, snapshot);
    if (await hashCanonical(diff) !== proposal.diffHash) {
      fail('LINGXI_PROPOSAL_TAMPERED', '图片库操作的重新计算差异与已批准提案不一致');
    }

    let result;
    if (normalized.action === 'select') {
      result = await this.imageStudio.execute({
        type: 'select', target: normalized.target, assetId: normalized.assetId,
        expectedRevision: normalized.expectedRevision
      });
      if (result?.status === 'stale') fail('LINGXI_PROPOSAL_STALE', '图片绑定在执行时发生了并发变化');
    } else if (normalized.action === 'detach') {
      result = await this.imageStudio.execute({
        type: 'detach', target: normalized.target, expectedRevision: normalized.expectedRevision
      });
      if (result?.status === 'stale') fail('LINGXI_PROPOSAL_STALE', '图片绑定在执行时发生了并发变化');
    } else if (normalized.action === 'protect' || normalized.action === 'unprotect') {
      result = await this.imageStudio.execute({
        type: 'protect', assetId: normalized.assetId, protected: normalized.action === 'protect'
      });
    } else if (normalized.action === 'delete') {
      result = await this.imageStudio.execute({ type: 'delete', assetId: normalized.assetId });
    } else if (normalized.action === 'retry') {
      result = await this.imageStudio.execute({ type: 'retry', jobId: normalized.jobId });
    } else {
      result = await this.imageStudio.execute({ type: 'cancel', jobId: normalized.jobId });
    }

    let afterFingerprint;
    if (normalized.action === 'delete') {
      afterFingerprint = await fingerprintValue({ deletedAssetId: normalized.assetId });
    } else if (normalized.action === 'retry') {
      afterFingerprint = await fingerprintValue({ newJobId: String(result?.jobId || result?.id || '') });
    } else {
      const after = await this._snapshot(normalized);
      afterFingerprint = after.fingerprint;
    }
    return libraryReceipt(proposal, afterFingerprint, diff, {
      summary: normalized.action === 'retry' ? '图片生成重试任务已创建' : `图片库操作已完成: ${normalized.action}`,
      jobId: normalized.action === 'retry' ? (result?.jobId || result?.id) : ''
    });
  }
}

export function createImageStudioActionAdapter(options = {}) {
  return new ImageStudioActionAdapter(options);
}

export function createImageLibraryActionAdapter(options = {}) {
  return new ImageLibraryActionAdapter(options);
}

export default ImageStudioActionAdapter;
