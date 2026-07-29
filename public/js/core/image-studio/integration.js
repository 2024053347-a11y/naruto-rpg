import { AIClient } from '../ai-client.js';
import { eventBus } from '../event-bus.js';
import { stateManager } from '../state-manager.js';
import { relationshipSystem } from '../../systems/relationship-system.js';
import { timelineSystem } from '../../systems/timeline-system.js';
import { extractImageContract, validateImageContract } from './contracts.js';
import { imageStudio } from './index.js';

const PLANNER_SYSTEM = `你是画面契约规划器。只根据用户提供的已公开叙事与视觉档案，选择一个最值得定格的瞬间。
禁止加入推理过程、NPC心声、未知秘密或未公开身份。
最终只输出：<image_contract version="1">严格 JSON</image_contract>。
JSON 必须满足 schema="naruto.visual-contract/v1"、purpose="turn_illustration"，并包含 scene.summary、shot、subjects、style、continuity。`;

function fallbackContract(node) {
  const summary = String(node?.clean_response || node?.ai_response_summary || '本回合场景').slice(0, 1200);
  return {
    schema: 'naruto.visual-contract/v1', purpose: 'turn_illustration',
    scene: { summary, location: '', action: summary.slice(0, 400), mood: '' },
    shot: { framing: 'cinematic medium-wide shot', viewpoint: 'eye level', composition: '', lighting: '' },
    subjects: [],
    style: { positive: ['high quality anime illustration', 'coherent Naruto-inspired ninja world'], negative: [] },
    continuity: { keep: [], avoid: ['spoilers', 'unknown identities', 'text', 'watermark'] }
  };
}

async function planWithSeparateModel(node, settings) {
  const main = stateManager.getAPIConfig?.() || {};
  const configured = settings.separatePromptModel || {};
  const config = {
    ...main, ...configured,
    backend: configured.backend && configured.backend !== 'inherit' ? configured.backend : main.backend,
    apiUrl: configured.apiUrl || main.apiUrl,
    apiKey: configured.apiKey || main.apiKey,
    model: configured.model || main.model,
    useProxy: main.useProxy !== false
  };
  if (!config.model || (!config.apiUrl && config.backend !== 'tavern')) return fallbackContract(node);
  const client = new AIClient();
  client.configure(config);
  const safeContext = {
    playerAction: node.player_input || '', narrative: node.clean_response || '',
    location: node.state_snapshot?.['世界·地点'] || node.state_snapshot?.world_state?.current_location || '',
    time: node.game_time || '',
    publicCharacters: Object.entries(node.state_snapshot?._relationships || {}).map(([name, value]) => ({
      name, role: value?.role || '', visual: value?.visual_profile?.canonical_description || ''
    }))
  };
  let previous = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = [
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user', content: `${JSON.stringify(safeContext)}${attempt ? `\n\n上次输出无效，请修复：${previous.slice(0, 2000)}` : ''}` }
    ];
    previous = await client.chat(messages, {
      temperature: Number(config.temperature) || 0.25,
      max_tokens: Math.max(800, Number(config.maxTokens) || 1800)
    });
    const extracted = extractImageContract(previous);
    if (extracted.contract && validateImageContract(extracted.contract).valid) return extracted.contract;
  }
  return fallbackContract(node);
}

export class ImageFeatureIntegration {
  constructor({ studio = imageStudio } = {}) {
    this.studio = studio;
    this.disposers = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return this;
    await this.studio.ready();
    this.initialized = true;
    this.disposers.push(this.studio.subscribe(event => this._onStudioEvent(event)));
    this.disposers.push(eventBus.on('turn:committed', event => {
      void this._onTurnCommitted(event).catch(error => {
        console.warn('[ImageIntegration] Turn image planning failed:', error.message);
        eventBus.emit('image:job-error', { target: { kind: 'turn', nodeId: event.nodeId }, error: error.message });
      });
    }));
    this.disposers.push(eventBus.on('timeline:nodes-deleted', ({ nodeIds = [] }) => {
      for (const nodeId of nodeIds) void this.studio.execute({ type: 'detach', target: { kind: 'turn', nodeId } }).catch(() => {});
    }));
    this.disposers.push(eventBus.on('relationship:visual-changed', () => (
      this._syncLiveState(['_relationships'])
    )));
    this.disposers.push(eventBus.on('relationship:visual-deleted', ({ subjectId }) => {
      void this._syncLiveState(['_relationships']);
      void this.studio.execute({ type: 'detach', target: { kind: 'portrait', subjectId } }).catch(() => {});
    }));
    return this;
  }

  async _onTurnCommitted({ nodeId, allowAuxiliaryAI = true }) {
    // 严格单调用回合不允许在提交后偷偷规划或生成图片；用户仍可在图片工作室手动生成。
    if (!allowAuxiliaryAI) return;
    const settings = await this.studio.read({ type: 'settings' });
    if (!settings.enabled) return;
    const node = await stateManager.dbGet('timeline_nodes', nodeId);
    if (!node) return;
    let contract = node.media?.illustration?.contract || null;
    if (settings.promptMode === 'separate-model') {
      contract = await planWithSeparateModel(node, settings);
      await timelineSystem.setIllustrationContract(nodeId, contract);
      eventBus.emit('image:contract-ready', { nodeId });
    }
    if (settings.turnMode !== 'automatic' && settings.turnMode !== 'auto') return;
    await this.studio.execute({
      type: 'generate', target: { kind: 'turn', nodeId }, mode: 'auto', contract,
      prompt: contract ? '' : node.clean_response || node.ai_response_summary || '',
      bindingRevision: Number(node.media?.illustration?.binding_revision) || 0
    });
  }

  async _onStudioEvent(event) {
    if (event?.type === 'worldbook.changed') {
      await this._syncLiveState(['_image_worldbook_overlay']);
      return;
    }
    if (event?.type !== 'binding.changed' && event?.type !== 'binding.detached') return;
    const target = event.target || event.binding?.target;
    const assetId = event.binding?.assetId || null;
    const revision = Number(event.binding?.revision) || 0;
    const authoritativeRevision = event.authoritative === true ? revision : null;
    const expectedRevision = authoritativeRevision === null ? Math.max(0, revision - 1) : null;
    let result;
    if (target?.kind === 'turn') {
      result = await timelineSystem.bindIllustration(target.nodeId, {
        assetId, expectedRevision, authoritativeRevision,
        versionGroupId: event.binding?.versionGroupId, jobId: event.job?.id
      });
    } else if (target?.kind === 'portrait') {
      result = relationshipSystem.bindPortrait(target.subjectId, {
        assetId, expectedRevision, authoritativeRevision,
        versionGroupId: event.binding?.versionGroupId, jobId: event.job?.id
      });
      // relationship:visual-changed also queues this write. Awaiting one here
      // makes image:binding-changed (and its cloud-save follow-up) a reliable
      // persistence boundary rather than relying on event timing.
      if (result?.status === 'updated') await this._syncLiveState(['_relationships']);
    }
    eventBus.emit('image:binding-changed', { target, asset: event.asset || null, binding: event.binding || null, result });
  }

  async _syncLiveState(sliceKeys) {
    try {
      return await timelineSystem.syncCurrentImageStateSlices(sliceKeys);
    } catch (error) {
      console.warn('[ImageIntegration] Live image state persistence failed:', error.message);
      eventBus.emit('image:snapshot-sync-error', { slices: sliceKeys, error: error.message });
      return { status: 'failed', error: error.message };
    }
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) dispose?.();
    this.initialized = false;
  }
}

export const imageFeatureIntegration = new ImageFeatureIntegration();
export { fallbackContract, planWithSeparateModel };
