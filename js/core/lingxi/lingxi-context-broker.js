import { AGENT_CONTEXT_SCHEMA } from '../agent-context-broker.js';

const PUBLIC_STATE_KEYS = Object.freeze([
  '玩家·姓名', '玩家·年龄', '玩家·性别', '玩家·忍阶', '玩家·正式忍阶',
  '玩家·所属村', '玩家·出身', '玩家·查克拉属性', '玩家·难度', '玩家·当前目标',
  '属性·查克拉', '属性·当前查克拉', '属性·精神力', '属性·当前精神力',
  '属性·生命力', '属性·当前生命力', '属性·体力', '属性·当前体力',
  '属性·速度', '属性·幸运', '进度·经验', '进度·下一级经验', '进度·金钱',
  '世界·地点', '世界·时间', '世界·年代', '世界·天气', '系统·回合数'
]);

function cleanText(value, max = 2000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function snapshotPublicState(state = {}) {
  const snapshot = {};
  for (const key of PUBLIC_STATE_KEYS) {
    if (state[key] !== undefined) snapshot[key] = state[key];
  }
  return snapshot;
}

/**
 * AgentToolRuntime requires a context broker, but the product assistant must not
 * inherit narrative history, NPC private intent, or hidden planner evidence.
 */
export class LingXiContextBroker {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.stats = { searches: 0, hits: 0, misses: 0 };
  }

  async preflight(options = {}) {
    const startedAt = this.now();
    const state = options.state && typeof options.state === 'object' ? options.state : {};
    const branchId = cleanText(state?._meta?.active_branch ?? state?.['系统·当前分支'], 160)
      || 'branch_main';
    const nodeId = cleanText(state?._meta?.current_node_id ?? state?.['系统·当前节点'], 160);
    const query = cleanText(options.query ?? options.userInput);
    const publicState = snapshotPublicState(state);
    const worldItem = Object.freeze({
      id: `assistant-state:${nodeId || 'unstarted'}`,
      domain: 'world',
      score: 1,
      summary: '用户当前存档的公开状态摘要。只用于解释，不代表任何修改已获批准。',
      data: publicState,
      source: Object.freeze({ kind: 'live-public-state', id: nodeId || 'unstarted' })
    });
    const emptyDomain = domain => Object.freeze({
      schema: AGENT_CONTEXT_SCHEMA,
      kind: 'search',
      domain,
      query,
      audience: 'assistant',
      branchId,
      nodeId,
      items: Object.freeze([]),
      sources: Object.freeze([]),
      cache: Object.freeze({ hit: false, key: '' })
    });
    const world = Object.freeze({
      ...emptyDomain('world'),
      items: Object.freeze([worldItem]),
      sources: Object.freeze([worldItem.source])
    });
    const character = emptyDomain('character');
    const dialogue = emptyDomain('dialogue');
    this.stats.searches += 3;
    this.stats.misses += 3;
    return Object.freeze({
      schema: AGENT_CONTEXT_SCHEMA,
      kind: 'preflight',
      query,
      audience: 'assistant',
      branchId,
      nodeId,
      domains: Object.freeze({ character, dialogue, world }),
      items: world.items,
      sources: world.sources,
      durationMs: Math.max(0, this.now() - startedAt),
      cache: Object.freeze(this.getCacheStats())
    });
  }

  getCacheStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total ? this.stats.hits / total : 0,
      size: 0
    };
  }
}

export const lingXiContextBroker = new LingXiContextBroker();

export default lingXiContextBroker;
