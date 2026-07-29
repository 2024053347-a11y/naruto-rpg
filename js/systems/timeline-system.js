import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import {
  assertTimelineSave,
  findForbiddenTimelineMedia,
  sanitizeTimelinePersistenceValue,
  sanitizeTimelineSnapshot
} from '../core/timeline-save-schema.js';
import {
  diffContinuityLedgers,
  prepareContinuityCommit,
  remapContinuityDelta,
  remapContinuityLedger
} from '../core/continuity-ledger.js';
import { encodeTimelineSave } from '../core/timeline-file-codec.js';
import { formatGameTime, generateId, generateNodeId, truncate, getNextBranchColor, deepClone } from '../utils/format.js';

const ARCHIVE_THRESHOLD = 100;
const ARCHIVE_ANCESTOR_KEEP = 20;
const IMAGE_STATE_SNAPSHOT_SLICES = new Set(['_relationships', '_image_worldbook_overlay']);

function buildIllustrationMedia(nodeId, imageContract = null) {
  return {
    illustration: {
      contract_id: imageContract ? `turn:${nodeId}:visual-contract:v1` : null,
      contract: imageContract
        ? sanitizeTimelinePersistenceValue(imageContract, `timeline_node.${nodeId}.media.illustration.contract`)
        : null,
      selected_asset_id: null,
      version_group_id: `turn:${nodeId}:illustration`,
      binding_revision: 0,
      updated_at: Date.now()
    }
  };
}

class TimelineSystem {
  constructor() {
    this._initialized = false;
    this._nodeCache = new Map();
    this._pendingBranchFrom = null;
    this._archiveRunning = false;
  }

  async init() {
    if (this._initialized) return;
    await stateManager.initDB();
    await this._sanitizeStoredTimelineNodes();
    const meta = await stateManager.dbGet('timeline_meta', 'root');
    if (meta) {
      const metaState = stateManager.getSub('_meta') || {};
      metaState.current_node_id = meta.value?.current_id || null;
      metaState.active_branch = meta.value?.active_branch || 'branch_main';
      stateManager.setSub('_meta', metaState);
    }
    this._initialized = true;
  }

  async createRootNode({ summary, stateSnapshot, chatHistory = [], continuityDelta = [] }) {
    const nodeId = generateNodeId(1);
    const createdAt = Date.now();
    const baseSnapshot = this._buildNodeSnapshot(stateSnapshot, nodeId, 'branch_main');
    const { snapshot, delta: committedContinuityDelta } = this._prepareContinuitySnapshot(baseSnapshot, {
      nodeId,
      branchId: 'branch_main',
      turnNumber: 1,
      gameTime: stateSnapshot?.['世界·时间'] || '',
      recordedAt: createdAt,
      continuityDelta
    });
    const node = {
      id: nodeId,
      parent_id: null,
      children_ids: [],
      branch_id: 'branch_main',
      turn_number: 1,
      depth: 0,
      real_timestamp: createdAt,
      game_time: stateSnapshot?.['世界·时间']
        ? formatGameTime(stateSnapshot['世界·时间'])
        : '游戏开始',
      player_input: '(游戏开始 - 角色创建完成)',
      ai_response_summary: summary || '冒险开始',
      state_snapshot: snapshot,
      continuity_delta: committedContinuityDelta,
      continuity_revision: snapshot._continuity.revision,
      chat_history_delta: deepClone(chatHistory).slice(-40),
      chat_history: null,
      summary: summary || '冒险开始',
      tags: [],
      is_checkpoint: false,
      created_at: createdAt,
      accessed_count: 0,
      archived: false,
      archived_at: null
    };

    const branch = {
      id: 'branch_main',
      name: '主线',
      color: '#eb613f',
      description: '默认时间线',
      created_at: Date.now(),
      diverged_from: null,
      diverged_at_turn: null,
      head_node_id: nodeId,
      node_count: 1,
      is_active: true
    };
    const metaEntry = {
      key: 'root',
      value: { root_id: nodeId, current_id: nodeId, active_branch: 'branch_main', total_nodes: 1 }
    };
    await this._commitInitialTimeline(node, branch, metaEntry);

    const metaState = stateManager.getSub('_meta') || {};
    metaState.current_node_id = nodeId;
    metaState.active_branch = 'branch_main';
    stateManager.setSub('_meta', metaState);
    this._commitLiveContinuity(node);

    this._cacheTreeSummary();
    eventBus.emit('timeline:node-created', node);
    eventBus.emit('timeline:branch-created', branch);

    return node;
  }

  async createNode({ turnNumber, playerInput, aiResponse, cleanResponse, stateSnapshot, chatHistory = [], memorySummary = null, imageContract = null, shinobiDaily = null, continuityDelta = [] }) {
    const meta = stateManager.getSub('_meta') || {};
    const currentId = meta.current_node_id;
    const activeBranch = meta.active_branch;
    const turnCount = turnNumber !== undefined ? turnNumber : Math.max(1, (stateManager.get('系统·回合数') || 0) - 1);

    if (!currentId) {
      const nodeId = generateNodeId(turnCount);
      const createdAt = Date.now();
      const baseSnapshot = this._buildNodeSnapshot(stateSnapshot, nodeId, 'branch_main');
      const { snapshot, delta: committedContinuityDelta } = this._prepareContinuitySnapshot(baseSnapshot, {
        nodeId,
        branchId: 'branch_main',
        turnNumber: turnCount,
        gameTime: stateSnapshot?.['世界·时间'] || '',
        recordedAt: createdAt,
        continuityDelta
      });
      const cleanAiResponse = (aiResponse || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, '').trim();
      const cleanPlayerInput = (playerInput || '').replace(/<[^>]*>/g, '').trim();
      const summary = truncate(memorySummary || cleanAiResponse || cleanPlayerInput, 200);
      const delta = this._extractChatDelta(chatHistory);
      const node = {
        id: nodeId, parent_id: null, children_ids: [], branch_id: 'branch_main',
        turn_number: turnCount, depth: 0, real_timestamp: createdAt,
        game_time: stateSnapshot?.['世界·时间'] ? formatGameTime(stateSnapshot['世界·时间']) : '游戏开始',
        player_input: truncate(cleanPlayerInput, 200),
        ai_response_summary: truncate(cleanAiResponse, 200),
        clean_response: cleanResponse || aiResponse || '',
        shinobi_daily: shinobiDaily
          ? sanitizeTimelinePersistenceValue(shinobiDaily, `timeline_node.${nodeId}.shinobi_daily`)
          : null,
        media: buildIllustrationMedia(nodeId, imageContract),
        state_snapshot: snapshot,
        continuity_delta: committedContinuityDelta,
        continuity_revision: snapshot._continuity.revision,
        chat_history_delta: delta,
        chat_history: null,
        summary: summary, tags: [], is_checkpoint: true, created_at: createdAt, accessed_count: 0,
        archived: false, archived_at: null
      };
      const branch = { id: 'branch_main', name: '主线', color: '#eb613f', description: '默认时间线', created_at: Date.now(), diverged_from: null, diverged_at_turn: null, head_node_id: nodeId, node_count: 1, is_active: true };
      const metaEntry = { key: 'root', value: { root_id: nodeId, current_id: nodeId, active_branch: 'branch_main', total_nodes: 1 } };
      await this._commitInitialTimeline(node, branch, metaEntry);
      const metaState = stateManager.getSub('_meta') || {};
      metaState.current_node_id = nodeId;
      metaState.active_branch = 'branch_main';
      stateManager.setSub('_meta', metaState);
      this._commitLiveContinuity(node);
      this._cacheTreeSummary();
      eventBus.emit('timeline:node-created', node);
      eventBus.emit('timeline:branch-created', branch);
      return node;
    }

    const nodeId = generateNodeId(turnCount);
    const cleanAiResponse = (aiResponse || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, '').trim();
    const cleanPlayerInput = (playerInput || '').replace(/<[^>]*>/g, '').trim();
    const summary = truncate(memorySummary || cleanPlayerInput || cleanAiResponse, 200);
    const delta = this._extractChatDelta(chatHistory);
    const shouldCreateBranch = this._pendingBranchFrom === currentId;
    const newBranchId = shouldCreateBranch ? generateId('branch') : null;
    const expectedBranchId = activeBranch || 'branch_main';
    const createdAt = Date.now();
    const transactionResult = await stateManager.dbMutateTimeline(({ nodes, branches, meta: storedMetaEntry }) => {
      if (!storedMetaEntry?.value) throw new Error('时间线元数据不存在，无法追加节点');
      const parentNode = nodes.find(candidate => candidate.id === currentId);
      if (!parentNode) throw new Error(`当前父节点不存在: ${currentId}`);
      if (storedMetaEntry.value.current_id !== currentId) {
        throw new Error('当前时间线节点已变化，本次追加请求已过期');
      }
      if (!Array.isArray(parentNode.children_ids)) throw new Error(`当前父节点 children_ids 无效: ${currentId}`);
      if (nodes.some(candidate => candidate.id === nodeId)) throw new Error(`时间线节点 ID 已存在: ${nodeId}`);

      const storedActiveBranch = storedMetaEntry.value.active_branch;
      if (storedActiveBranch !== expectedBranchId) {
        throw new Error('当前活动分支已变化，本次追加请求已过期');
      }
      const currentBranch = branches.find(candidate => candidate.id === storedActiveBranch);
      if (!currentBranch) throw new Error(`活动分支不存在: ${storedActiveBranch}`);

      const createBranch = shouldCreateBranch && parentNode.children_ids.length > 0;
      const branchId = createBranch ? newBranchId : storedActiveBranch;
      const baseSnapshot = this._buildNodeSnapshot(stateSnapshot, nodeId, branchId);
      const { snapshot, delta: committedContinuityDelta } = this._prepareContinuitySnapshot(baseSnapshot, {
        parentNode,
        nodeId,
        branchId,
        turnNumber: turnCount,
        gameTime: stateSnapshot?.['世界·时间'] || '',
        recordedAt: createdAt,
        continuityDelta
      });
      const node = {
        id: nodeId,
        parent_id: currentId,
        children_ids: [],
        branch_id: branchId,
        turn_number: turnCount,
        depth: (parentNode.depth || 0) + 1,
        real_timestamp: createdAt,
        game_time: stateSnapshot?.['世界·时间']
          ? formatGameTime(stateSnapshot['世界·时间'])
          : '',
        player_input: truncate(cleanPlayerInput, 200),
        ai_response_summary: truncate(cleanAiResponse, 200),
        clean_response: cleanResponse || aiResponse || '',
        shinobi_daily: shinobiDaily
          ? sanitizeTimelinePersistenceValue(shinobiDaily, `timeline_node.${nodeId}.shinobi_daily`)
          : null,
        media: buildIllustrationMedia(nodeId, imageContract),
        state_snapshot: snapshot,
        continuity_delta: committedContinuityDelta,
        continuity_revision: snapshot._continuity.revision,
        chat_history_delta: delta,
        chat_history: null,
        summary,
        tags: [],
        is_checkpoint: false,
        created_at: createdAt,
        accessed_count: 0,
        archived: false,
        archived_at: null
      };
      const updatedParent = {
        ...parentNode,
        children_ids: [...parentNode.children_ids, nodeId]
      };

      let createdBranch = null;
      let branchesToCommit;
      if (createBranch) {
        if (branches.some(branch => branch.id === newBranchId)) {
          throw new Error(`时间线分支 ID 已存在: ${newBranchId}`);
        }
        createdBranch = {
          id: newBranchId,
          name: `IF线·${parentNode.summary || '新选择'}`,
          color: getNextBranchColor(),
          description: `从"${parentNode.summary || ''}"分歧`,
          created_at: Date.now(),
          diverged_from: parentNode.id,
          diverged_at_turn: parentNode.turn_number,
          head_node_id: nodeId,
          node_count: 1,
          is_active: true
        };
        branchesToCommit = [
          ...branches.filter(branch => branch.is_active === true).map(branch => ({ ...branch, is_active: false })),
          createdBranch
        ];
      } else {
        if (!Number.isInteger(currentBranch.node_count) || currentBranch.node_count < 0) {
          throw new Error(`活动分支 node_count 无效: ${branchId}`);
        }
        branchesToCommit = [{
          ...currentBranch,
          head_node_id: nodeId,
          node_count: currentBranch.node_count + 1,
          is_active: true
        }];
      }

      if (!Number.isInteger(storedMetaEntry.value.total_nodes) || storedMetaEntry.value.total_nodes < 0) {
        throw new Error('时间线元数据 total_nodes 无效');
      }
      const metaEntry = {
        ...storedMetaEntry,
        value: {
          ...storedMetaEntry.value,
          current_id: nodeId,
          active_branch: branchId,
          total_nodes: storedMetaEntry.value.total_nodes + 1
        }
      };
      return {
        nodes: [node, updatedParent],
        branches: branchesToCommit,
        meta: metaEntry,
        result: { node, createdBranch, branchId }
      };
    }, {
      nodeKeys: [currentId, nodeId],
      branchKeys: shouldCreateBranch ? null : [expectedBranchId]
    });
    const { node, createdBranch, branchId } = transactionResult;
    if (createdBranch) {
      this._pendingBranchFrom = null;
      eventBus.emit('timeline:branch-created', createdBranch);
    }

    const metaState = stateManager.getSub('_meta') || {};
    metaState.current_node_id = nodeId;
    metaState.active_branch = branchId;
    stateManager.setSub('_meta', metaState);
    this._commitLiveContinuity(node);

    this._cacheTreeSummary();
    eventBus.emit('timeline:node-created', node);

    this._maybeArchive().catch(err => console.warn('[Timeline] archive failed:', err.message));
    return node;
  }

  async setIllustrationContract(nodeId, imageContract) {
    const updatedNode = await stateManager.dbMutateTimeline(({ nodes }) => {
      const node = nodes.find(candidate => candidate?.id === nodeId);
      if (!node) {
        const error = new Error(`时间线节点不存在: ${nodeId}`);
        error.code = 'TARGET_GONE';
        throw error;
      }
      const current = node.media?.illustration || buildIllustrationMedia(nodeId).illustration;
      const updated = {
        ...node,
        media: {
          ...(node.media || {}),
          illustration: {
            ...current,
            contract_id: imageContract ? `turn:${nodeId}:visual-contract:v1` : null,
            contract: imageContract
              ? sanitizeTimelinePersistenceValue(imageContract, `timeline_node.${nodeId}.media.illustration.contract`)
              : null,
            updated_at: Date.now()
          }
        }
      };
      return { nodes: [updated], result: updated };
    }, { nodeKeys: [nodeId], branchKeys: [] });
    this._nodeCache.set(nodeId, updatedNode);
    eventBus.emit('timeline:media-changed', { nodeId, media: updatedNode.media });
    return updatedNode.media.illustration;
  }

  async bindIllustration(nodeId, {
    assetId = null,
    expectedRevision = null,
    authoritativeRevision = null,
    versionGroupId = null,
    jobId = null
  } = {}) {
    const mutation = await stateManager.dbMutateTimeline(({ nodes }) => {
      const node = nodes.find(candidate => candidate?.id === nodeId);
      if (!node) return { result: { status: 'missing', nodeId } };
      const current = node.media?.illustration || buildIllustrationMedia(nodeId).illustration;
      const revision = Number(current.binding_revision) || 0;
      const hasAuthoritativeRevision = authoritativeRevision !== null
        && Number.isSafeInteger(Number(authoritativeRevision))
        && Number(authoritativeRevision) >= 0;
      const remoteRevision = hasAuthoritativeRevision ? Number(authoritativeRevision) : null;
      if (hasAuthoritativeRevision && remoteRevision < revision) {
        return { result: { status: 'stale', nodeId, revision, selectedAssetId: current.selected_asset_id || null } };
      }
      if (!hasAuthoritativeRevision && expectedRevision !== null && Number(expectedRevision) !== revision) {
        return { result: { status: 'stale', nodeId, revision, selectedAssetId: current.selected_asset_id || null } };
      }
      if (hasAuthoritativeRevision
        && remoteRevision === revision
        && (current.selected_asset_id || null) === (assetId || null)) {
        return { result: { status: 'unchanged', nodeId, ...current } };
      }
      const illustration = {
        ...current,
        selected_asset_id: assetId || null,
        version_group_id: versionGroupId || current.version_group_id || `turn:${nodeId}:illustration`,
        binding_revision: hasAuthoritativeRevision ? remoteRevision : revision + 1,
        last_job_id: jobId || current.last_job_id || null,
        updated_at: Date.now()
      };
      const updated = { ...node, media: { ...(node.media || {}), illustration } };
      return { nodes: [updated], result: { status: 'updated', node: updated, illustration } };
    }, { nodeKeys: [nodeId], branchKeys: [] });
    if (mutation.status !== 'updated') return mutation;
    this._nodeCache.set(nodeId, mutation.node);
    eventBus.emit('timeline:media-changed', { nodeId, media: mutation.node.media });
    return { status: 'updated', ...mutation.illustration };
  }

  async syncCurrentImageStateSlices(sliceKeys = []) {
    if (!Array.isArray(sliceKeys)) throw new TypeError('图片状态切片必须是数组');
    const requested = [...new Set(sliceKeys.map(String))];
    const unsupported = requested.filter(key => !IMAGE_STATE_SNAPSHOT_SLICES.has(key));
    if (unsupported.length) throw new TypeError(`不允许同步到时间线的图片状态切片: ${unsupported.join(', ')}`);
    if (!requested.length) return { status: 'noop', slices: [] };

    const liveMeta = stateManager.getSub('_meta') || {};
    const nodeId = liveMeta.current_node_id;
    if (!nodeId) return { status: 'missing-current', slices: requested };

    // Capture and validate before opening the IndexedDB transaction. The
    // transaction mutator must stay synchronous, and image bytes belong in the
    // dedicated image store rather than a timeline/save snapshot.
    const captured = Object.fromEntries(requested.map(key => [
      key,
      sanitizeTimelinePersistenceValue(stateManager.getSub(key), `state_snapshot.${key}`)
    ]));

    const mutation = await stateManager.dbMutateTimeline(({ nodes, meta }) => {
      if (meta?.value?.current_id !== nodeId) {
        return {
          result: {
            status: 'stale',
            nodeId,
            currentNodeId: meta?.value?.current_id || null,
            slices: requested
          }
        };
      }
      const node = nodes.find(candidate => candidate?.id === nodeId);
      if (!node) return { result: { status: 'missing', nodeId, slices: requested } };
      if (!node.state_snapshot || typeof node.state_snapshot !== 'object'
        || Array.isArray(node.state_snapshot)) {
        return { result: { status: 'invalid-snapshot', nodeId, slices: requested } };
      }
      const stateSnapshot = deepClone(node.state_snapshot);
      for (const key of requested) stateSnapshot[key] = captured[key];
      const updatedNode = { ...node, state_snapshot: stateSnapshot };
      return {
        nodes: [updatedNode],
        result: { status: 'updated', nodeId, slices: requested, node: updatedNode }
      };
    }, { nodeKeys: [nodeId], branchKeys: [] });

    if (mutation.status !== 'updated') return mutation;
    this._nodeCache.set(nodeId, mutation.node);
    eventBus.emit('timeline:image-state-synced', { nodeId, slices: requested });
    return { status: 'updated', nodeId, slices: requested };
  }

  async _commitInitialTimeline(node, branch, metaEntry) {
    return await stateManager.dbMutateTimeline(({ nodes, branches, meta }) => {
      if (meta || nodes.length > 0 || branches.length > 0) {
        throw new Error('时间线已经初始化，本次根节点创建请求已过期');
      }
      return {
        nodes: [node],
        branches: [branch],
        meta: metaEntry,
        result: node
      };
    });
  }

  async _sanitizeStoredTimelineNodes() {
    const updatedNodes = await stateManager.dbMutateTimeline(({ nodes }) => {
      const updates = nodes
        .filter(node => findForbiddenTimelineMedia(node, `timeline_node.${node?.id || 'unknown'}`))
        .map(node => sanitizeTimelinePersistenceValue(node, `timeline_node.${node?.id || 'unknown'}`));
      return { nodes: updates, result: updates };
    }, { branchKeys: [] });
    for (const node of updatedNodes) this._nodeCache.set(node.id, node);
    return updatedNodes.length;
  }

  async pruneForward(targetNodeId) {
    const targetNode = await stateManager.dbGet('timeline_nodes', targetNodeId);
    if (!targetNode) throw new Error('目标节点不存在');
    const preparedRestore = this._prepareNodeRestore(targetNode);

    const meta = stateManager.getSub('_meta') || {};
    const currentId = meta.current_node_id;

    const allNodes = await stateManager.dbGetAll('timeline_nodes');
    const descendantIds = new Set();
    const collectDescendants = (nodeId) => {
      const node = allNodes.find(n => n.id === nodeId);
      if (!node || !Array.isArray(node.children_ids)) return;
      for (const childId of node.children_ids) {
        if (!descendantIds.has(childId)) {
          descendantIds.add(childId);
          collectDescendants(childId);
        }
      }
    };
    if (Array.isArray(targetNode.children_ids)) {
      for (const childId of targetNode.children_ids) {
        descendantIds.add(childId);
        collectDescendants(childId);
      }
    }

    if (descendantIds.size === 0 && targetNodeId === currentId) {
      stateManager.commitPreparedRestore(preparedRestore);
      return { pruned: 0, restored: true };
    }

    const prunedCount = descendantIds.size;
    for (const id of descendantIds) {
      await stateManager.dbDelete('timeline_nodes', id);
      this._nodeCache.delete(id);
    }
    if (descendantIds.size) {
      eventBus.emit('timeline:nodes-deleted', { nodeIds: [...descendantIds], reason: 'prune' });
    }

    targetNode.children_ids = [];
    await stateManager.dbPut('timeline_nodes', targetNode);

    const branch = await stateManager.dbGet('timeline_branches', targetNode.branch_id || 'branch_main');
    if (branch) {
      branch.head_node_id = targetNodeId;
      branch.node_count = Math.max(0, (branch.node_count || 0) - prunedCount);
      await stateManager.dbPut('timeline_branches', branch);
    }

    const metaEntry = await stateManager.dbGet('timeline_meta', 'root');
    if (metaEntry) {
      metaEntry.value.current_id = targetNodeId;
      metaEntry.value.total_nodes = Math.max(0, (metaEntry.value.total_nodes || 0) - prunedCount);
      await stateManager.dbPut('timeline_meta', metaEntry);
    }

    stateManager.commitPreparedRestore(preparedRestore);

    const metaState = stateManager.getSub('_meta') || {};
    metaState.current_node_id = targetNodeId;
    metaState.active_branch = targetNode.branch_id || 'branch_main';
    stateManager.setSub('_meta', metaState);
    this._pendingBranchFrom = null;

    targetNode.accessed_count = (targetNode.accessed_count || 0) + 1;
    await stateManager.dbPut('timeline_nodes', targetNode);

    this._cacheTreeSummary();
    eventBus.emit('timeline:jumped', {
      fromNodeId: currentId,
      toNodeId: targetNodeId,
      branchId: targetNode.branch_id || 'branch_main',
      pruned: prunedCount
    });

    return { pruned: prunedCount, node: targetNode };
  }

  async jumpToNode(targetNodeId) {
    const meta = stateManager.getSub('_meta') || {};
    const currentId = meta.current_node_id;
    if (currentId === targetNodeId) {
      this._pendingBranchFrom = null;
      return;
    }

    const targetNode = await stateManager.dbGet('timeline_nodes', targetNodeId);
    if (!targetNode) throw new Error('目标节点不存在');
    const preparedRestore = this._prepareNodeRestore(targetNode);
    stateManager.commitPreparedRestore(preparedRestore);

    const metaState = stateManager.getSub('_meta') || {};
    metaState.current_node_id = targetNodeId;
    metaState.active_branch = targetNode.branch_id || 'branch_main';
    stateManager.setSub('_meta', metaState);
    this._pendingBranchFrom = targetNode.children_ids?.length ? targetNodeId : null;

    targetNode.accessed_count = (targetNode.accessed_count || 0) + 1;
    await stateManager.dbPut('timeline_nodes', targetNode);

    const metaEntry = await stateManager.dbGet('timeline_meta', 'root');
    if (metaEntry) {
      metaEntry.value.current_id = targetNodeId;
      metaEntry.value.active_branch = targetNode.branch_id || 'branch_main';
      await stateManager.dbPut('timeline_meta', metaEntry);
    }
    await this._setActiveBranchFlags(targetNode.branch_id || 'branch_main');

    this._cacheTreeSummary();
    eventBus.emit('timeline:jumped', {
      fromNodeId: currentId,
      toNodeId: targetNodeId,
      branchId: targetNode.branch_id || 'branch_main',
      willBranchOnNextInput: Boolean(this._pendingBranchFrom)
    });

    return targetNode;
  }

  async getAllNodes() {
    return await stateManager.dbGetAll('timeline_nodes');
  }

  async getAllBranches() {
    return await stateManager.dbGetAll('timeline_branches');
  }

  async getCurrentNode() {
    const meta = stateManager.getSub('_meta') || {};
    const currentId = meta.current_node_id;
    if (!currentId) return null;
    return await stateManager.dbGet('timeline_nodes', currentId);
  }

  async getActiveBranch() {
    const meta = stateManager.getSub('_meta') || {};
    const branchId = meta.active_branch;
    return await stateManager.dbGet('timeline_branches', branchId);
  }

  async switchBranch(branchId) {
    const branch = await stateManager.dbGet('timeline_branches', branchId);
    if (!branch) throw new Error('分支不存在');

    const meta = stateManager.getSub('_meta') || {};
    const oldBranchId = meta.active_branch;
    if (oldBranchId === branchId) return;
    this._pendingBranchFrom = null;

    let headNode = null;
    let preparedRestore = null;
    if (branch.head_node_id) {
      headNode = await stateManager.dbGet('timeline_nodes', branch.head_node_id);
      if (!headNode) throw new Error('分支头节点不存在');
      preparedRestore = this._prepareNodeRestore(headNode);
    }

    await this._setActiveBranchFlags(branchId);

    if (preparedRestore) stateManager.commitPreparedRestore(preparedRestore);

    meta.active_branch = branchId;
    meta.current_node_id = branch.head_node_id || meta.current_node_id;
    stateManager.setSub('_meta', meta);

    const metaEntry = await stateManager.dbGet('timeline_meta', 'root');
    if (metaEntry) {
      metaEntry.value.current_id = meta.current_node_id;
      metaEntry.value.active_branch = branchId;
      await stateManager.dbPut('timeline_meta', metaEntry);
    }

    this._cacheTreeSummary();
    eventBus.emit('timeline:branch-switched', { from: oldBranchId, to: branchId });
  }

  async _setActiveBranchFlags(branchId) {
    const branches = await stateManager.dbGetAll('timeline_branches');
    for (const branch of branches) {
      const shouldBeActive = branch.id === branchId;
      if (branch.is_active === shouldBeActive) continue;
      await stateManager.dbPut('timeline_branches', { ...branch, is_active: shouldBeActive });
    }
  }

  _extractChatDelta(chatHistory) {
    if (!Array.isArray(chatHistory) || chatHistory.length === 0) return [];
    const last2 = chatHistory.slice(-2);
    return deepClone(last2);
  }

  async _reconstructChatHistory(targetNode) {
    if (!targetNode) return [];
    if (Array.isArray(targetNode.chat_history) && targetNode.chat_history.length > 0) {
      return deepClone(targetNode.chat_history);
    }
    const chain = [];
    let cursor = targetNode;
    let safety = 0;
    while (cursor && safety < 200) {
      if (Array.isArray(cursor.chat_history_delta) && cursor.chat_history_delta.length > 0) {
        chain.unshift(...deepClone(cursor.chat_history_delta));
      }
      if (!cursor.parent_id) break;
      cursor = await stateManager.dbGet('timeline_nodes', cursor.parent_id);
      safety++;
    }
    return chain.slice(-80);
  }

  async _getBranchNodes(branchId) {
    const all = await stateManager.dbGetAll('timeline_nodes');
    return all.filter(n => n.branch_id === branchId);
  }

  async _maybeArchive() {
    if (this._archiveRunning) return;
    const ui = stateManager.getSub('_ui') || {};
    const settings = ui.settings || {};
    if (settings?.autoArchive === false) return;
    this._archiveRunning = true;
    try {
      const branches = await this.getAllBranches();
      for (const branch of branches) {
        const nodes = await this._getBranchNodes(branch.id);
        if (nodes.length <= ARCHIVE_THRESHOLD) continue;

        const headId = branch.head_node_id;
        const retainIds = new Set();
        let cursor = await stateManager.dbGet('timeline_nodes', headId);
        for (let i = 0; i < ARCHIVE_ANCESTOR_KEEP && cursor; i++) {
          retainIds.add(cursor.id);
          cursor = cursor.parent_id ? await stateManager.dbGet('timeline_nodes', cursor.parent_id) : null;
        }
        for (const n of nodes) if (n.is_checkpoint) retainIds.add(n.id);

        let archivedCount = 0;
        for (const n of nodes) {
          if (retainIds.has(n.id) || n.archived) continue;
          n.chat_history_delta = null;
          n.chat_history = null;
          n.archived = true;
          n.archived_at = Date.now();
          await stateManager.dbPut('timeline_nodes', n);
          this._nodeCache.delete(n.id);
          archivedCount++;
        }
        if (archivedCount > 0) {
          eventBus.emit('timeline:archived', { branchId: branch.id, count: archivedCount });
        }
      }
    } catch (err) {
      console.warn('[Timeline] archive failed:', err.message);
    } finally {
      this._archiveRunning = false;
    }
  }

  async manualArchive() {
    if (this._archiveRunning) return { running: true };
    this._archiveRunning = true;
    let total = 0;
    try {
      const branches = await this.getAllBranches();
      for (const branch of branches) {
        const nodes = await this._getBranchNodes(branch.id);
        const headId = branch.head_node_id;
        const retainIds = new Set();
        let cursor = await stateManager.dbGet('timeline_nodes', headId);
        for (let i = 0; i < ARCHIVE_ANCESTOR_KEEP && cursor; i++) {
          retainIds.add(cursor.id);
          cursor = cursor.parent_id ? await stateManager.dbGet('timeline_nodes', cursor.parent_id) : null;
        }
        for (const n of nodes) if (n.is_checkpoint) retainIds.add(n.id);
        for (const n of nodes) {
          if (retainIds.has(n.id) || n.archived) continue;
          n.chat_history_delta = null;
          n.chat_history = null;
          n.archived = true;
          n.archived_at = Date.now();
          await stateManager.dbPut('timeline_nodes', n);
          this._nodeCache.delete(n.id);
          total++;
        }
      }
      eventBus.emit('timeline:archived', { manual: true, count: total });
    } finally {
      this._archiveRunning = false;
    }
    return { archived: total };
  }

  async getStorageStats() {
    const nodes = await this.getAllNodes();
    let totalBytes = 0;
    let archivedCount = 0;
    let activeCount = 0;
    for (const n of nodes) {
      try {
        totalBytes += JSON.stringify(n).length;
      } catch { /* ignore circular */ }
      if (n.archived) archivedCount++; else activeCount++;
    }
    return { totalNodes: nodes.length, archivedCount, activeCount, estimatedBytes: totalBytes };
  }

  async _replayStateFromAncestor(targetNode) {
    stateManager.commitPreparedRestore(this._prepareNodeRestore(targetNode));
    return 0;
  }

  _prepareNodeRestore(node) {
    const snapshot = node?.state_snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error(`节点 ${node?.id || 'unknown'} 缺少完整状态快照，无法精确恢复`);
    }
    return stateManager.prepareRestore(snapshot);
  }

  _buildNodeSnapshot(stateSnapshot, nodeId, branchId) {
    const source = stateSnapshot && typeof stateSnapshot === 'object' && !Array.isArray(stateSnapshot)
      ? stateSnapshot
      : stateManager.snapshot();
    const snapshot = sanitizeTimelineSnapshot(source);
    if (!snapshot._meta) snapshot._meta = {};
    snapshot._meta.current_node_id = nodeId;
    snapshot._meta.active_branch = branchId;
    return snapshot;
  }

  _prepareContinuitySnapshot(snapshot, {
    parentNode = null,
    nodeId,
    branchId,
    turnNumber = 0,
    gameTime = '',
    recordedAt = Date.now(),
    continuityDelta = []
  } = {}) {
    const prepared = prepareContinuityCommit({
      ledger: snapshot?._continuity,
      legacyMemory: snapshot?._memory,
      events: continuityDelta,
      context: {
        nodeId,
        branchId,
        turn: Number.isInteger(turnNumber) ? Math.max(0, turnNumber) : 0,
        gameTime,
        recordedAt,
        source: 'turn_commit'
      }
    });
    snapshot._continuity = prepared.ledger;
    const parentLedger = parentNode?.state_snapshot?._continuity;
    return {
      snapshot,
      delta: diffContinuityLedgers(parentLedger, prepared.ledger)
    };
  }

  _commitLiveContinuity(node) {
    const ledger = node?.state_snapshot?._continuity;
    if (ledger) stateManager.setSub('_continuity', deepClone(ledger));
  }

  async _createBranchFromNode(parentNode) {
    const meta = stateManager.getSub('_meta') || {};
    const oldBranchId = meta.active_branch;
    const oldBranch = await stateManager.dbGet('timeline_branches', oldBranchId);
    const previousBranch = oldBranch ? { ...oldBranch, is_active: false } : null;

    const newBranch = {
      id: generateId('branch'),
      name: `IF线·${parentNode.summary || '新选择'}`,
      color: getNextBranchColor(),
      description: `从"${parentNode.summary}"分歧`,
      created_at: Date.now(),
      diverged_from: parentNode.id,
      diverged_at_turn: parentNode.turn_number,
      head_node_id: null,
      node_count: 0,
      is_active: true
    };
    return { branch: newBranch, previousBranch };
  }

  _cacheTreeSummary() {
    try {
      const meta = stateManager.getSub('_meta') || {};
      localStorage.setItem('naruto_timeline_summary', JSON.stringify({
        current_id: meta.current_node_id,
        active_branch: meta.active_branch,
        cached_at: Date.now()
      }));
    } catch { console.warn('[Timeline] Failed to cache tree summary'); }
  }

  async getExportData({ includeArchive = false } = {}) {
    // Export/cloud-save is an explicit consistency boundary. Flush both small
    // live image slices first so an export started immediately after a profile
    // edit cannot race the event-driven persistence listener.
    await this.syncCurrentImageStateSlices([
      '_relationships',
      '_image_worldbook_overlay'
    ]);
    const allNodes = await this.getAllNodes();
    const branches = await this.getAllBranches();
    const metaEntry = await stateManager.dbGet('timeline_meta', 'root');

    const nodes = includeArchive
      ? allNodes.map(n => { const { memory_snapshot, ...rest } = n; return rest; })
      : allNodes.map(n => {
          const { memory_snapshot, chat_history, ...rest } = n;
          if (n.archived) {
            return { ...rest, archived: true };
          }
          return { ...rest, chat_history: null };
        });

    return sanitizeTimelinePersistenceValue({
      export_version: '2.0',
      exported_at: new Date().toISOString(),
      include_archive: includeArchive,
      meta: metaEntry,
      branches,
      nodes
    }, 'timeline_export');
  }

  async exportTimeline({ includeArchive = false, compression = 'auto' } = {}) {
    const data = await this.getExportData({ includeArchive });
    const encoded = await encodeTimelineSave(data, { compression });
    const fileName = `naruto-timeline-${Date.now()}${includeArchive ? '-full' : ''}${encoded.extension}`;
    const url = URL.createObjectURL(encoded.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.hidden = true;
    document.body?.appendChild(a);
    a.click();
    a.remove?.();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    const result = { ...encoded, fileName, includeArchive };
    eventBus.emit('timeline:exported', {
      fileName,
      format: encoded.format,
      fallbackReason: encoded.fallbackReason,
      includeArchive
    });
    return result;
  }

  _migrateNodeV1ToV2(node) {
    if (!node || typeof node !== 'object') return node;
    const migrated = { ...node };
    delete migrated.memory_snapshot;
    if (Array.isArray(migrated.chat_history) && migrated.chat_history.length > 0 && !migrated.chat_history_delta) {
      migrated.chat_history_delta = deepClone(migrated.chat_history.slice(-2));
    }
    if (migrated.archived === undefined) migrated.archived = false;
    if (migrated.archived_at === undefined) migrated.archived_at = null;
    if (migrated.continuity_delta === undefined) migrated.continuity_delta = [];
    if (migrated.continuity_revision === undefined
        && Number.isInteger(migrated.state_snapshot?._continuity?.revision)) {
      migrated.continuity_revision = migrated.state_snapshot._continuity.revision;
    }
    return sanitizeTimelinePersistenceValue(migrated, `timeline_node.${migrated.id || 'unknown'}`);
  }

  _normalizeImportedTimeline(nodes, branches, data) {
    const wrappedMeta = data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)
      && Object.prototype.hasOwnProperty.call(data.meta, 'value');
    const rawMeta = wrappedMeta ? data.meta.value : (data.timeline?.meta ?? data.meta);
    if (rawMeta != null && (typeof rawMeta !== 'object' || Array.isArray(rawMeta))) {
      throw new Error('存档格式无效: 时间线元数据必须是 JSON 对象');
    }
    const importedMeta = rawMeta || {};
    const migratedNodes = nodes.map((node, index) => {
      const migrated = this._migrateNodeV1ToV2(node);
      if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) return migrated;
      return {
        ...migrated,
        parent_id: migrated.parent_id ?? null,
        turn_number: Number.isInteger(migrated.turn_number) ? migrated.turn_number : index,
        children_ids: Array.isArray(migrated.children_ids)
          ? [...migrated.children_ids]
          : (migrated.children_ids == null ? [] : migrated.children_ids)
      };
    });

    const validNodes = migratedNodes.filter(node => node && typeof node === 'object' && !Array.isArray(node));
    const validBranches = branches.filter(branch => branch && typeof branch === 'object' && !Array.isArray(branch));
    const soleBranchId = validBranches.length === 1 ? validBranches[0].id : null;
    for (let index = 0; index < validNodes.length; index++) {
      const node = validNodes[index];
      if (node.branch_id == null && soleBranchId) node.branch_id = soleBranchId;
    }

    const nodeById = new Map(validNodes.filter(node => node.id).map(node => [node.id, node]));
    const nodesMissingChildren = new Set(
      nodes
        .filter(node => node && typeof node === 'object' && !Array.isArray(node) && node.children_ids == null)
        .map(node => node.id)
        .filter(Boolean)
    );
    for (const node of validNodes) {
      if (!node.parent_id || !nodeById.has(node.parent_id) || !nodesMissingChildren.has(node.parent_id)) continue;
      const parent = nodeById.get(node.parent_id);
      if (!parent.children_ids.includes(node.id)) parent.children_ids.push(node.id);
    }

    for (const node of validNodes) {
      const visited = new Set();
      let cursor = node;
      let depth = 0;
      let complete = true;
      while (cursor.parent_id != null) {
        if (visited.has(cursor.id)) {
          complete = false;
          break;
        }
        visited.add(cursor.id);
        cursor = nodeById.get(cursor.parent_id);
        if (!cursor) {
          complete = false;
          break;
        }
        depth++;
      }
      if (complete) node.depth = depth;
    }

    const newestNode = candidates => candidates.reduce((latest, candidate) => {
      if (!latest) return candidate;
      const turnDelta = (candidate.turn_number || 0) - (latest.turn_number || 0);
      if (turnDelta !== 0) return turnDelta > 0 ? candidate : latest;
      const timeDelta = (candidate.created_at || candidate.real_timestamp || 0)
        - (latest.created_at || latest.real_timestamp || 0);
      return timeDelta >= 0 ? candidate : latest;
    }, null);
    const roots = validNodes.filter(node => node.parent_id == null);
    const derivedRootId = roots.length === 1 ? roots[0].id : undefined;
    const requestedActiveBranch = importedMeta.active_branch;
    const requestedBranch = validBranches.find(branch => branch.id === requestedActiveBranch);
    const requestedHead = requestedBranch ? nodeById.get(requestedBranch.head_node_id) : null;
    const derivedCurrentNode = importedMeta.current_id == null && requestedBranch
      ? ((requestedHead?.branch_id === requestedBranch.id ? requestedHead : null)
        || newestNode(validNodes.filter(node => node.branch_id === requestedBranch.id)))
      : newestNode(validNodes);
    const rootId = importedMeta.root_id ?? derivedRootId;
    const currentId = importedMeta.current_id ?? derivedCurrentNode?.id;
    const currentNode = nodeById.get(currentId);
    const activeBranch = importedMeta.active_branch ?? currentNode?.branch_id ?? soleBranchId;

    const normalizedBranches = branches.map(branch => {
      if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return branch;
      const branchNodes = validNodes.filter(node => node.branch_id === branch.id);
      const derivedHead = newestNode(branchNodes);
      return {
        ...branch,
        color: branch.color || '#eb613f',
        head_node_id: branch.head_node_id ?? derivedHead?.id,
        node_count: branchNodes.length,
        is_active: branch.id === activeBranch
      };
    });
    const metaEntry = {
      key: 'root',
      value: {
        ...importedMeta,
        root_id: rootId,
        current_id: currentId,
        active_branch: activeBranch,
        total_nodes: migratedNodes.length
      }
    };
    const normalized = { nodes: migratedNodes, branches: normalizedBranches, meta: metaEntry };
    assertTimelineSave(normalized);
    return normalized;
  }

  async importTimeline(data, { mode = 'overwrite' } = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('存档格式无效: 存档根节点必须是 JSON 对象');
    }
    const incomingNodes = Array.isArray(data.nodes) ? data.nodes : [];
    const incomingBranches = Array.isArray(data.branches) ? data.branches : [];
    if (!incomingNodes.length || !incomingBranches.length) throw new Error('存档缺少时间线节点或分支数据');

    const normalized = this._normalizeImportedTimeline(incomingNodes, incomingBranches, data);

    await stateManager.initDB();

    if (mode === 'merge') {
      return await this._importMerge(normalized.nodes, normalized.branches, normalized.meta);
    }

    const { nodes: migratedNodes, branches: normalizedBranches, meta: metaEntry } = normalized;
    const currentId = metaEntry.value.current_id;
    const activeBranch = metaEntry.value.active_branch;
    const currentNode = migratedNodes.find(node => node.id === currentId);
    const preparedRestore = this._prepareImportedState(currentNode, migratedNodes);
    const preparedMeta = preparedRestore.state._meta && typeof preparedRestore.state._meta === 'object'
      && !Array.isArray(preparedRestore.state._meta)
      ? preparedRestore.state._meta
      : {};
    preparedRestore.state._meta = {
      ...preparedMeta,
      current_node_id: currentId,
      active_branch: activeBranch
    };

    await stateManager.dbReplaceTimeline({
      nodes: migratedNodes,
      branches: normalizedBranches,
      meta: metaEntry
    });
    stateManager.commitPreparedRestore(preparedRestore);

    this._pendingBranchFrom = null;
    this._initialized = true;
    this._cacheTreeSummary();
    eventBus.emit('timeline:imported', { node: currentNode, nodes: migratedNodes, branches: incomingBranches, mode: 'overwrite' });
    this._maybeArchive().catch(() => {});
    return currentNode;
  }

  async _importMerge(incomingNodes, incomingBranches, incomingMeta) {
    const imported = await stateManager.dbMutateTimeline(({ nodes: existingNodes, branches: existingBranches, meta: existingMeta }) => {
      if (!existingMeta?.value) throw new Error('当前时间线元数据不存在，无法合并导入');
      const attachmentNode = existingNodes.find(node => node.id === existingMeta.value.current_id);
      if (!attachmentNode) throw new Error('当前时间线节点不存在，无法合并导入');
      if (!Array.isArray(attachmentNode.children_ids)) throw new Error('当前时间线节点 children_ids 无效');

      const existingNodeIds = new Set(existingNodes.map(node => node.id));
      const existingBranchIds = new Set(existingBranches.map(branch => branch.id));
      const branchIdMap = new Map();
      for (const branch of incomingBranches) {
        let newId = branch.id;
        let suffix = 0;
        while (existingBranchIds.has(newId)) newId = `${branch.id}_imp${++suffix}`;
        branchIdMap.set(branch.id, newId);
        existingBranchIds.add(newId);
      }

      const nodeIdMap = new Map();
      for (const node of incomingNodes) {
        let newId = node.id;
        let suffix = 0;
        while (existingNodeIds.has(newId)) newId = `${node.id}_imp${++suffix}`;
        nodeIdMap.set(node.id, newId);
        existingNodeIds.add(newId);
      }

      // An imported timeline is attached below an existing node. Memory event
      // IDs and their provenance therefore need the same collision-safe remap
      // as node/branch IDs; cumulative ledgers repeat the same immutable IDs.
      const incomingContinuityIds = new Set();
      for (const node of incomingNodes) {
        for (const event of node.continuity_delta || []) {
          if (event?.event_id) incomingContinuityIds.add(event.event_id);
        }
        for (const event of node.state_snapshot?._continuity?.events || []) {
          if (event?.event_id) incomingContinuityIds.add(event.event_id);
        }
      }
      const eventIdMap = new Map();
      const importEventPrefix = generateId('memory_import');
      let importEventIndex = 0;
      for (const eventId of incomingContinuityIds) {
        eventIdMap.set(eventId, `${importEventPrefix}_${++importEventIndex}`);
      }

      const importedRootOriginal = incomingNodes.find(node => node.id === incomingMeta.value.root_id);
      if (!importedRootOriginal) throw new Error('导入时间线根节点不存在');
      const importedRootId = nodeIdMap.get(importedRootOriginal.id);
      const importedRootBranchId = branchIdMap.get(importedRootOriginal.branch_id);
      const attachmentDepth = Number.isInteger(attachmentNode.depth) ? attachmentNode.depth : 0;
      const attachmentTurn = Number.isInteger(attachmentNode.turn_number) ? attachmentNode.turn_number : 0;
      const importedRootTurn = Number.isInteger(importedRootOriginal.turn_number) ? importedRootOriginal.turn_number : 0;
      const turnOffset = attachmentTurn + 1 - importedRootTurn;
      const incomingNodeById = new Map(incomingNodes.map(node => [node.id, node]));
      const relativeDepth = node => {
        let depth = 0;
        let cursor = node;
        while (cursor.id !== importedRootOriginal.id) {
          cursor = incomingNodeById.get(cursor.parent_id);
          if (!cursor) throw new Error(`导入节点 ${node.id} 无法追溯到根节点`);
          depth++;
        }
        return depth;
      };

      const migratedIncoming = incomingNodes.map(node => {
        const id = nodeIdMap.get(node.id);
        const branchId = branchIdMap.get(node.branch_id);
        const turnNumber = node.turn_number + turnOffset;
        const snapshot = node.state_snapshot && typeof node.state_snapshot === 'object'
          ? deepClone(node.state_snapshot)
          : node.state_snapshot;
        if (snapshot) {
          if (!snapshot._meta) snapshot._meta = {};
          snapshot._meta.current_node_id = id;
          snapshot._meta.active_branch = branchId;
          if (snapshot._version !== '4.0' && snapshot._version !== '5.0') {
            snapshot._meta.turn_count = turnNumber + 1;
          } else {
            snapshot['系统·回合数'] = turnNumber + 1;
          }
          if (snapshot._continuity) {
            snapshot._continuity = remapContinuityLedger(snapshot._continuity, {
              nodeIds: nodeIdMap,
              branchIds: branchIdMap,
              eventIds: eventIdMap
            });
          }
        }
        return {
          ...node,
          id,
          parent_id: node.id === importedRootOriginal.id
            ? attachmentNode.id
            : nodeIdMap.get(node.parent_id),
          children_ids: node.children_ids.map(childId => nodeIdMap.get(childId)),
          branch_id: branchId,
          turn_number: turnNumber,
          depth: attachmentDepth + 1 + relativeDepth(node),
          state_snapshot: snapshot,
          continuity_delta: remapContinuityDelta(node.continuity_delta || [], {
            nodeIds: nodeIdMap,
            branchIds: branchIdMap,
            eventIds: eventIdMap
          })
        };
      });
      const migratedNodeById = new Map(migratedIncoming.map(node => [node.id, node]));
      const updatedAttachment = {
        ...attachmentNode,
        children_ids: [...attachmentNode.children_ids, importedRootId]
      };

      const remappedBranches = incomingBranches.map(branch => {
        const id = branchIdMap.get(branch.id);
        const divergedFrom = id === importedRootBranchId
          ? attachmentNode.id
          : (branch.diverged_from == null ? null : nodeIdMap.get(branch.diverged_from));
        return {
          ...branch,
          id,
          name: `${branch.name || '导入分支'} (导入)`,
          is_active: false,
          head_node_id: nodeIdMap.get(branch.head_node_id),
          diverged_from: divergedFrom,
          diverged_at_turn: id === importedRootBranchId
            ? attachmentTurn
            : (migratedNodeById.get(divergedFrom)?.turn_number ?? branch.diverged_at_turn),
          node_count: migratedIncoming.filter(node => node.branch_id === id).length
        };
      });
      const normalizedExistingBranches = existingBranches.map(branch => ({
        ...branch,
        is_active: branch.id === existingMeta.value.active_branch,
        node_count: existingNodes.filter(node => node.branch_id === branch.id).length
      }));
      const mergedNodes = existingNodes.map(node => node.id === attachmentNode.id ? updatedAttachment : node)
        .concat(migratedIncoming)
        .map(node => sanitizeTimelinePersistenceValue(node, `timeline_node.${node.id || 'unknown'}`));
      const mergedBranches = normalizedExistingBranches.concat(remappedBranches);
      const mergedMeta = {
        ...existingMeta,
        value: {
          ...existingMeta.value,
          total_nodes: mergedNodes.length
        }
      };
      assertTimelineSave({ nodes: mergedNodes, branches: mergedBranches, meta: mergedMeta });
      return {
        replace: true,
        nodes: mergedNodes,
        branches: mergedBranches,
        meta: mergedMeta,
        result: { root: migratedIncoming.find(node => node.id === importedRootId), nodes: migratedIncoming, branches: remappedBranches }
      };
    });
    this._cacheTreeSummary();
    eventBus.emit('timeline:imported', { nodes: imported.nodes, branches: imported.branches, mode: 'merge' });
    this._maybeArchive().catch(() => {});
    return imported.root;
  }

  _getImportedRestorePlan(currentNode, allNodes) {
    if (!currentNode?.id) throw new Error('导入的当前节点不存在');
    const nodeById = new Map((allNodes || []).filter(node => node?.id).map(node => [node.id, node]));
    const visited = new Set();
    const chain = [];
    let cursor = nodeById.get(currentNode?.id);
    while (cursor) {
      if (visited.has(cursor.id)) {
        throw new Error('导入状态恢复失败: 父节点关系包含环');
      }
      visited.add(cursor.id);
      chain.unshift(cursor);
      if (!cursor.parent_id) break;
      cursor = nodeById.get(cursor.parent_id);
      if (!cursor) throw new Error('导入状态恢复失败: 父节点不存在');
    }
    const snapshot = chain.at(-1)?.state_snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error(`导入状态恢复失败: 当前节点 ${currentNode.id} 缺少有效状态快照，无法精确恢复`);
    }
    return { snapshot };
  }

  _prepareImportedState(currentNode, allNodes) {
    const plan = this._getImportedRestorePlan(currentNode, allNodes);
    return stateManager.prepareRestore(plan.snapshot);
  }

  async _restoreImportedState(currentNode, allNodes) {
    stateManager.commitPreparedRestore(this._prepareImportedState(currentNode, allNodes));
  }

  async promoteBranchToMain(branchId) {
    if (branchId === 'branch_main') return;

    const branches = await stateManager.dbGetAll('timeline_branches');
    const targetBranch = branches.find(b => b.id === branchId);
    if (!targetBranch) throw new Error('Branch not found');

    const nodes = await stateManager.dbGetAll('timeline_nodes');

    const targetNodes = nodes.filter(n => n.branch_id === branchId);
    if (targetNodes.length === 0) return;

    targetNodes.sort((a, b) => a.turn_number - b.turn_number);
    const firstIFNode = targetNodes[0];

    const mainNodesToDemote = nodes.filter(n => n.branch_id === 'branch_main' && n.turn_number >= firstIFNode.turn_number);

    const newIFBranchId = 'branch_alt_' + Date.now();
    const newIFBranch = {
      id: newIFBranchId,
      name: '原主线 (自第 ' + firstIFNode.turn_number + ' 回)',
      color: '#A9A9A9',
      description: `原主线分支，自第 ${firstIFNode.turn_number} 回起降格为IF线`,
      created_at: Date.now(),
      diverged_from: firstIFNode.parent_id,
      diverged_at_turn: firstIFNode.turn_number - 1,
      head_node_id: mainNodesToDemote.length ? mainNodesToDemote[mainNodesToDemote.length - 1].id : firstIFNode.parent_id,
      node_count: mainNodesToDemote.length,
      is_active: false
    };

    await stateManager.dbPut('timeline_branches', newIFBranch);

    for (const node of mainNodesToDemote) {
      node.branch_id = newIFBranchId;
      await stateManager.dbPut('timeline_nodes', node);
      this._nodeCache.set(node.id, node);
    }

    for (const node of targetNodes) {
      node.branch_id = 'branch_main';
      await stateManager.dbPut('timeline_nodes', node);
      this._nodeCache.set(node.id, node);
    }

    await stateManager.dbDelete('timeline_branches', branchId);

    const mainBranch = await stateManager.dbGet('timeline_branches', 'branch_main');
    if (mainBranch) {
      const allMainNodes = (await stateManager.dbGetAll('timeline_nodes')).filter(n => n.branch_id === 'branch_main');
      allMainNodes.sort((a, b) => a.turn_number - b.turn_number);
      mainBranch.head_node_id = allMainNodes.length ? allMainNodes[allMainNodes.length - 1].id : mainBranch.head_node_id;
      mainBranch.node_count = allMainNodes.length;
      await stateManager.dbPut('timeline_branches', mainBranch);
    }

    const metaEntry = await stateManager.dbGet('timeline_meta', 'root');
    if (metaEntry?.value?.active_branch === branchId) {
       await stateManager.dbPut('timeline_meta', { key: 'root', value: { ...(metaEntry?.value || {}), active_branch: 'branch_main' } });
       const metaState = stateManager.getSub('_meta') || {};
       metaState.active_branch = 'branch_main';
       stateManager.setSub('_meta', metaState);
    }
    const activeBranch = metaEntry?.value?.active_branch === branchId
      ? 'branch_main'
      : (metaEntry?.value?.active_branch || 'branch_main');
    await this._setActiveBranchFlags(activeBranch);

    this._cacheTreeSummary();
    eventBus.emit('timeline:branch-promoted', { oldBranchId: branchId, newMainBranchId: 'branch_main' });
  }

  async deleteBranch(branchId) {
    if (branchId === 'branch_main') throw new Error('Cannot delete main branch');
    const nodes = await stateManager.dbGetAll('timeline_nodes');
    const nodesToDelete = nodes.filter(n => n.branch_id === branchId);
    const deletedIds = new Set(nodesToDelete.map(node => node.id));

    for (const node of nodes) {
      if (deletedIds.has(node.id) || !Array.isArray(node.children_ids)) continue;
      const children = node.children_ids.filter(id => !deletedIds.has(id));
      if (children.length === node.children_ids.length) continue;
      node.children_ids = children;
      await stateManager.dbPut('timeline_nodes', node);
      this._nodeCache.set(node.id, node);
    }

    for (const node of nodesToDelete) {
      await stateManager.dbDelete('timeline_nodes', node.id);
      this._nodeCache.delete(node.id);
    }
    if (nodesToDelete.length) {
      eventBus.emit('timeline:nodes-deleted', {
        nodeIds: nodesToDelete.map(node => node.id),
        reason: 'branch-delete'
      });
    }
    await stateManager.dbDelete('timeline_branches', branchId);

    const metaEntry = await stateManager.dbGet('timeline_meta', 'root');
    if (metaEntry) {
      metaEntry.value.total_nodes = Math.max(0, nodes.length - nodesToDelete.length);
      await stateManager.dbPut('timeline_meta', metaEntry);
    }

    const meta = stateManager.getSub('_meta') || {};
    const currentId = meta.current_node_id;
    if (nodesToDelete.some(n => n.id === currentId)) {
      const firstNode = nodesToDelete.sort((a, b) => a.turn_number - b.turn_number)[0];
      if (firstNode && firstNode.parent_id) {
        try {
          await this.jumpToNode(firstNode.parent_id);
        } catch (err) {
          console.warn('[Timeline] jumpToNode failed during branch deletion:', err.message);
          await this.emergencyReset();
          throw new Error('分支删除后无法跳转到父节点，已执行紧急重置');
        }
      } else {
        await this.emergencyReset();
      }
    } else {
      this._cacheTreeSummary();
      eventBus.emit('timeline:branch-deleted', { branchId });
    }
  }

  async emergencyReset() {
    await stateManager.dbClear('timeline_nodes');
    await stateManager.dbClear('timeline_branches');
    await stateManager.dbClear('timeline_meta');
    stateManager.reset();
    localStorage.removeItem('naruto_timeline_summary');
    this._nodeCache.clear();
    this._initialized = false;
  }
}

export const timelineSystem = new TimelineSystem();
export default timelineSystem;
