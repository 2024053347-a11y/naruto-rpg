import { stateManager as defaultStateManager } from '../../state-manager.js';
import { eventBus as defaultEventBus } from '../../event-bus.js';
import { combatPlayerActionDefinition } from '../../../systems/combat-action.js';
import {
  LingXiActionError,
  canonicalStringify,
  createActionProposal,
  fingerprintValue,
  hashCanonical,
  verifyActionProposal
} from '../action-proposal.js';
import { consumeBrokerApprovedProposal } from '../approval-broker.js';

export const LINGXI_COMBAT_ACTION_TOOL = 'submit_combat_action';
export const LINGXI_COMBAT_ACTION_IMPACT_KIND = 'combat';

const ACTION_IMPACT_SCHEMA = 'naruto.lingxi-action-impact/v1';
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PLAYER_RESOURCE_KEYS = Object.freeze([
  '属性·当前查克拉', '属性·当前生命力', '属性·当前体力', '属性·当前精神力'
]);

function fail(code, message, details = null) {
  throw new LingXiActionError(code, message, details);
}

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanText(value, label, max) {
  if (typeof value !== 'string') fail('LINGXI_COMBAT_ACTION_INVALID', `${label}必须是文本`);
  const result = String(value || '').replace(/\u0000/g, '').trim();
  if (!result || result.length > max) {
    fail('LINGXI_COMBAT_ACTION_INVALID', `${label}必须是非空且不超过 ${max} 个字符的文本`);
  }
  return result;
}

function normalizeParams(params) {
  if (!isRecord(params)) fail('LINGXI_COMBAT_ACTION_INVALID', '战斗操作参数必须是对象');
  for (const key of Object.keys(params)) {
    if (FORBIDDEN_KEYS.has(key) || !['action', 'reason'].includes(key)) {
      fail('LINGXI_COMBAT_ACTION_INVALID', `战斗操作包含不支持的字段: ${key}`);
    }
  }
  const definition = combatPlayerActionDefinition(cleanText(params.action, '战斗操作', 40));
  if (!definition) fail('LINGXI_COMBAT_ACTION_INVALID', '战斗操作不在五种玩家动作白名单中');
  return {
    action: definition.action,
    reason: cleanText(params.reason, '操作原因', 500)
  };
}

function currentState(manager) {
  const state = typeof manager?.snapshot === 'function' ? manager.snapshot() : manager?.get?.();
  return isRecord(state) ? state : {};
}

function combatSnapshot(manager) {
  const state = currentState(manager);
  return {
    combat: clone(state._combat || null),
    resources: Object.fromEntries(
      PLAYER_RESOURCE_KEYS.filter(key => state[key] !== undefined).map(key => [key, clone(state[key])])
    ),
    nodeId: String(state?._meta?.current_node_id || state['系统·当前节点'] || ''),
    branchId: String(state?._meta?.active_branch || state['系统·当前分支'] || 'branch_main'),
    turn: Number(state['系统·回合数']) || 0
  };
}

function ensureAvailable(snapshot) {
  if (!snapshot.combat?.is_active) fail('LINGXI_COMBAT_NOT_ACTIVE', '当前没有进行中的战斗');
  if (!snapshot.nodeId) fail('LINGXI_COMBAT_ACTION_INVALID', '当前战斗缺少可绑定的时间线节点');
}

function actionDiff(params) {
  const definition = combatPlayerActionDefinition(params.action);
  return [{
    path: '/combat/playerAction',
    operation: 'add',
    after: { action: definition.action, label: definition.label }
  }];
}

export class CombatActionAdapter {
  #approvalPermit = null;

  constructor({
    stateManager = defaultStateManager,
    executeCombatAction = action => defaultEventBus.request('app:execute-combat-action', { action })
  } = {}) {
    if (typeof stateManager?.snapshot !== 'function' || typeof executeCombatAction !== 'function') {
      fail('LINGXI_ADAPTER_INVALID', '战斗适配器需要 snapshot() 和显式战斗动作执行器');
    }
    this.manager = stateManager;
    this.executeCombatAction = executeCombatAction;
    this.toolName = LINGXI_COMBAT_ACTION_TOOL;
  }

  bindApprovalPermit(permit) {
    if (!permit || typeof permit !== 'object') fail('LINGXI_ADAPTER_INVALID', '审批许可必须是不透明对象');
    if (this.#approvalPermit && this.#approvalPermit !== permit) {
      fail('LINGXI_ADAPTER_INVALID', '战斗适配器已绑定到另一个审批 Broker');
    }
    this.#approvalPermit = permit;
  }

  async _authorize(proposal, approvalPermit) {
    const brokerApproved = consumeBrokerApprovedProposal(proposal);
    const directlyBound = this.#approvalPermit && approvalPermit === this.#approvalPermit;
    if (!brokerApproved || (this.#approvalPermit && !directlyBound)) {
      fail('LINGXI_APPROVAL_REQUIRED', '战斗动作只能由绑定的审批 Broker 执行');
    }
    await verifyActionProposal(proposal);
    if (proposal.tool !== this.toolName) {
      fail('LINGXI_PROPOSAL_INVALID', `战斗适配器不能执行 ${proposal.tool}`);
    }
  }

  async stage(params, { now = Date.now(), ttlMs } = {}) {
    const normalized = normalizeParams(params);
    const snapshot = combatSnapshot(this.manager);
    ensureAvailable(snapshot);
    const definition = combatPlayerActionDefinition(normalized.action);
    const diff = actionDiff(normalized);
    const proposal = await createActionProposal({
      tool: this.toolName,
      params: normalized,
      stateFingerprint: await fingerprintValue(snapshot),
      context: {
        actionImpact: {
          schema: ACTION_IMPACT_SCHEMA,
          kind: LINGXI_COMBAT_ACTION_IMPACT_KIND,
          summary: `提交战斗动作: ${definition.label}`,
          details: [
            `对手: ${String(snapshot.combat.enemy_name || '未知对手').slice(0, 160)}`,
            `当前战斗回合: ${Number(snapshot.combat.turn) || 1}`,
            '批准后会把固定玩家动作送入主生成管线，调用模型并可能产生 API 费用。',
            '模型回执会推进剧情，结算资源与战斗状态，并创建新的时间线回合。'
          ]
        }
      },
      diff,
      ttlMs,
      now
    });
    if (canonicalStringify(combatSnapshot(this.manager)) !== canonicalStringify(snapshot)) {
      fail('LINGXI_PROPOSAL_STALE', '战斗状态在提案生成期间发生了变化');
    }
    return proposal;
  }

  async apply(proposal, approvalPermit) {
    await this._authorize(proposal, approvalPermit);
    const normalized = normalizeParams(proposal.params);
    const before = combatSnapshot(this.manager);
    ensureAvailable(before);
    if (await fingerprintValue(before) !== proposal.stateFingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '战斗、资源或时间线状态已经变化，请重新生成提案');
    }
    const diff = actionDiff(normalized);
    if (await hashCanonical(diff) !== proposal.diffHash) {
      fail('LINGXI_PROPOSAL_TAMPERED', '战斗动作的重新计算差异与已批准提案不一致');
    }
    const result = await this.executeCombatAction(normalized.action);
    if (!result || result.accepted !== true) {
      fail('LINGXI_COMBAT_ACTION_REJECTED', '主战斗管线没有接受已批准的玩家动作', {
        reason: String(result?.code || 'UNKNOWN').slice(0, 100)
      });
    }
    const after = combatSnapshot(this.manager);
    if (!after.nodeId || after.nodeId === before.nodeId) {
      fail('LINGXI_COMBAT_ACTION_FAILED', '战斗动作没有生成新的时间线回合，请检查主模型回执');
    }
    return {
      schema: 'naruto.lingxi-action-receipt/v1',
      proposalId: proposal.id,
      tool: proposal.tool,
      appliedAt: Date.now(),
      beforeFingerprint: proposal.stateFingerprint,
      afterFingerprint: await fingerprintValue(after),
      diff: clone(diff),
      summary: `战斗动作「${combatPlayerActionDefinition(normalized.action).label}」已由主生成管线完成`,
      timeline: { beforeNodeId: before.nodeId, nodeId: after.nodeId }
    };
  }
}

export function createCombatActionAdapter(options = {}) {
  return new CombatActionAdapter(options);
}

export default CombatActionAdapter;
