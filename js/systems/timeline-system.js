import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { instructionParser } from '../core/instruction-parser.js';
import { formatGameTime, generateId, generateNodeId, truncate, getNextBranchColor, deepClone } from '../utils/format.js';

const ARCHIVE_THRESHOLD = 100;
const ARCHIVE_ANCESTOR_KEEP = 20;

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
    const meta = await stateManager.dbGet('timeline_meta', 'root');
    if (meta) {
      const metaState = stateManager.getSub('_meta') || {};
      metaState.current_node_id = meta.value?.current_id || null;
      metaState.active_branch = meta.value?.active_branch || 'branch_main';
      stateManager.setSub('_meta', metaState);
    }
    this._initialized = true;
  }

  async createRootNode({ summary, stateSnapshot, chatHistory = [] }) {
    const nodeId = generateNodeId(1);
    const snapshot = this._buildNodeSnapshot(stateSnapshot, nodeId, 'branch_main');
    const node = {
      id: nodeId,
      parent_id: null,
      children_ids: [],
      branch_id: 'branch_main',
      turn_number: 1,
      depth: 0,
      real_timestamp: Date.now(),
      game_time: stateSnapshot?.['世界·时间']
        ? formatGameTime(stateSnapshot['世界·时间'])
        : '游戏开始',
      player_input: '(游戏开始 - 角色创建完成)',
      ai_response_summary: summary || '冒险开始',
      state_snapshot: snapshot,
      chat_history_delta: deepClone(chatHistory).slice(-40),
      chat_history: null,
      summary: summary || '冒险开始',
      tags: [],
      is_checkpoint: false,
      created_at: Date.now(),
      accessed_count: 0,
      archived: false,
      archived_at: null
    };

    await stateManager.dbPut('timeline_nodes', node);

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
    await stateManager.dbPut('timeline_branches', branch);

    await stateManager.dbPut('timeline_meta', {
      key: 'root',
      value: { root_id: nodeId, current_id: nodeId, active_branch: 'branch_main', total_nodes: 1 }
    });

    const metaState = stateManager.getSub('_meta') || {};
    metaState.current_node_id = nodeId;
    metaState.active_branch = 'branch_main';
    stateManager.setSub('_meta', metaState);

    this._cacheTreeSummary();
    eventBus.emit('timeline:node-created', node);
    eventBus.emit('timeline:branch-created', branch);

    return node;
  }

  async createNode({ turnNumber, playerInput, aiResponse, cleanResponse, stateSnapshot, chatHistory = [] }) {
    const meta = stateManager.getSub('_meta') || {};
    const currentId = meta.current_node_id;
    const activeBranch = meta.active_branch;
    const turnCount = turnNumber !== undefined ? turnNumber : Math.max(1, (stateManager.get('系统·回合数') || 0) - 1);

    if (!currentId) {
      const nodeId = generateNodeId(turnCount);
      const snapshot = this._buildNodeSnapshot(stateSnapshot, nodeId, 'branch_main');
      const cleanAiResponse = (aiResponse || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, '').trim();
      const cleanPlayerInput = (playerInput || '').replace(/<[^>]*>/g, '').trim();
      const summary = truncate(cleanAiResponse || cleanPlayerInput, 200);
      const delta = this._extractChatDelta(chatHistory);
      const node = {
        id: nodeId, parent_id: null, children_ids: [], branch_id: 'branch_main',
        turn_number: turnCount, depth: 0, real_timestamp: Date.now(),
        game_time: stateSnapshot?.['世界·时间'] ? formatGameTime(stateSnapshot['世界·时间']) : '游戏开始',
        player_input: truncate(cleanPlayerInput, 200),
        ai_response_summary: truncate(cleanAiResponse, 200),
        clean_response: cleanResponse || aiResponse || '',
        state_snapshot: snapshot,
        chat_history_delta: delta,
        chat_history: null,
        summary: summary, tags: [], is_checkpoint: true, created_at: Date.now(), accessed_count: 0,
        archived: false, archived_at: null
      };
      await stateManager.dbPut('timeline_nodes', node);
      const branch = { id: 'branch_main', name: '主线', color: '#eb613f', description: '默认时间线', created_at: Date.now(), diverged_from: null, diverged_at_turn: null, head_node_id: nodeId, node_count: 1, is_active: true };
      await stateManager.dbPut('timeline_branches', branch);
      await stateManager.dbPut('timeline_meta', { key: 'root', value: { root_id: nodeId, current_id: nodeId, active_branch: 'branch_main', total_nodes: 1 } });
      const metaState = stateManager.getSub('_meta') || {};
      metaState.current_node_id = nodeId;
      metaState.active_branch = 'branch_main';
      stateManager.setSub('_meta', metaState);
      this._cacheTreeSummary();
      eventBus.emit('timeline:node-created', node);
      eventBus.emit('timeline:branch-created', branch);
      return node;
    }

    const parentNode = await stateManager.dbGet('timeline_nodes', currentId);
    if (!parentNode) return null;

    let branchId = activeBranch;
    if (this._pendingBranchFrom === currentId && parentNode.children_ids.length > 0) {
      const branch = await this._createBranchFromNode(parentNode);
      branchId = branch.id;
      this._pendingBranchFrom = null;
    }

    const nodeId = generateNodeId(turnCount);
    const snapshot = this._buildNodeSnapshot(stateSnapshot, nodeId, branchId);
    const cleanAiResponse = (aiResponse || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, '').trim();
    const cleanPlayerInput = (playerInput || '').replace(/<[^>]*>/g, '').trim();
    const summary = truncate(cleanPlayerInput || cleanAiResponse, 60);
    const delta = this._extractChatDelta(chatHistory);

    const node = {
      id: nodeId,
      parent_id: currentId,
      children_ids: [],
      branch_id: branchId,
      turn_number: turnCount,
      depth: (parentNode.depth || 0) + 1,
      real_timestamp: Date.now(),
      game_time: stateSnapshot?.['世界·时间']
        ? formatGameTime(stateSnapshot['世界·时间'])
        : '',
      player_input: truncate(cleanPlayerInput, 200),
      ai_response_summary: truncate(cleanAiResponse, 200),
      clean_response: cleanResponse || aiResponse || '',
      state_snapshot: snapshot,
      chat_history_delta: delta,
      chat_history: null,
      summary,
      tags: [],
      is_checkpoint: false,
      created_at: Date.now(),
      accessed_count: 0,
      archived: false,
      archived_at: null
    };

    if (!parentNode.children_ids.includes(nodeId)) {
      parentNode.children_ids.push(nodeId);
    }

    await stateManager.dbPut('timeline_nodes', node);
    await stateManager.dbPut('timeline_nodes', parentNode);

    const branch = await stateManager.dbGet('timeline_branches', branchId);
    if (branch) {
      branch.head_node_id = nodeId;
      branch.node_count = (branch.node_count || 0) + 1;
      await stateManager.dbPut('timeline_branches', branch);
    }

    const metaEntry = await stateManager.dbGet('timeline_meta', 'root');
    if (metaEntry) {
      metaEntry.value.current_id = nodeId;
      metaEntry.value.active_branch = branchId;
      metaEntry.value.total_nodes = (metaEntry.value.total_nodes || 0) + 1;
      await stateManager.dbPut('timeline_meta', metaEntry);
    }

    const metaState = stateManager.getSub('_meta') || {};
    metaState.current_node_id = nodeId;
    metaState.active_branch = branchId;
    stateManager.setSub('_meta', metaState);

    this._cacheTreeSummary();
    eventBus.emit('timeline:node-created', node);

    this._maybeArchive().catch(err => console.warn('[Timeline] archive failed:', err.message));
    return node;
  }

  async pruneForward(targetNodeId) {
    const targetNode = await stateManager.dbGet('timeline_nodes', targetNodeId);
    if (!targetNode) throw new Error('目标节点不存在');

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
      return { pruned: 0, restored: true };
    }

    const prunedCount = descendantIds.size;
    for (const id of descendantIds) {
      await stateManager.dbDelete('timeline_nodes', id);
      this._nodeCache.delete(id);
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

    if (targetNode.state_snapshot) {
      stateManager.restore(deepClone(targetNode.state_snapshot));
    } else {
      await this._replayStateFromAncestor(targetNode);
    }

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

    if (targetNode.state_snapshot) {
      stateManager.restore(deepClone(targetNode.state_snapshot));
    } else {
      await this._replayStateFromAncestor(targetNode);
    }

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

    const oldBranch = await stateManager.dbGet('timeline_branches', oldBranchId);
    if (oldBranch) {
      oldBranch.is_active = false;
      await stateManager.dbPut('timeline_branches', oldBranch);
    }

    branch.is_active = true;
    await stateManager.dbPut('timeline_branches', branch);

    if (branch.head_node_id) {
      const headNode = await stateManager.dbGet('timeline_nodes', branch.head_node_id);
      if (headNode?.state_snapshot) {
        stateManager.restore(deepClone(headNode.state_snapshot));
      } else if (headNode) {
        await this._replayStateFromAncestor(headNode);
      }
    }

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
    const chain = [];
    let cursor = targetNode;
    let safety = 0;
    while (cursor && safety < 200) {
      chain.unshift(cursor);
      if (!cursor.parent_id) break;
      cursor = await stateManager.dbGet('timeline_nodes', cursor.parent_id);
      safety++;
    }

    let startIdx = -1;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i].state_snapshot && !chain[i].archived) {
        startIdx = i;
        break;
      }
    }
    if (startIdx === -1) {
      for (let i = chain.length - 1; i >= 0; i--) {
        if (chain[i].state_snapshot) {
          startIdx = i;
          break;
        }
      }
    }
    if (startIdx === -1) {
      throw new Error('无法找到祖先快照,无法精确恢复此回合');
    }

    stateManager.restore(deepClone(chain[startIdx].state_snapshot));

    for (let i = startIdx + 1; i < chain.length; i++) {
      const node = chain[i];
      if (node.state_snapshot && !node.archived) {
        stateManager.restore(deepClone(node.state_snapshot));
      } else {
        const raw = node.clean_response || node.ai_response_summary || '';
        if (raw) {
          const instructions = instructionParser.parse(raw);
          const variables = instructions.variables || [];
          if (variables.length > 0) {
            const applied = variables.filter(v => v && ((typeof v.key === 'string' && v.key.trim() && ['=', '+', '-'].includes(v.op)) || (typeof v.path === 'string' && v.path.trim() && ['set', 'add', 'sub', 'assign', 'push', 'remove'].includes(v.op))));
            if (applied.length) stateManager.batchUpdate(applied);
          }
        }
      }
    }
    return chain.length - startIdx - 1;
  }

  _buildNodeSnapshot(stateSnapshot, nodeId, branchId) {
    const snapshot = deepClone(stateSnapshot || {});
    if (!snapshot._meta) snapshot._meta = {};
    snapshot._meta.current_node_id = nodeId;
    snapshot._meta.active_branch = branchId;
    return snapshot;
  }

  async _createBranchFromNode(parentNode) {
    const meta = stateManager.getSub('_meta') || {};
    const oldBranchId = meta.active_branch;
    const oldBranch = await stateManager.dbGet('timeline_branches', oldBranchId);
    if (oldBranch) {
      oldBranch.is_active = false;
      await stateManager.dbPut('timeline_branches', oldBranch);
    }

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
    await stateManager.dbPut('timeline_branches', newBranch);
    eventBus.emit('timeline:branch-created', newBranch);
    return newBranch;
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
    const allNodes = await this.getAllNodes();
    const branches = await this.getAllBranches();
    const metaEntry = await stateManager.dbGet('timeline_meta', 'root');

    const nodes = includeArchive
      ? allNodes.map(n => { const { memory_snapshot, ...rest } = n; return rest; })
      : allNodes.map(n => {
          const { memory_snapshot, chat_history, chat_history_delta, ...rest } = n;
          if (n.archived) {
            return { ...rest, archived: true, state_snapshot: null };
          }
          return { ...rest, chat_history: null };
        });

    return {
      export_version: '2.0',
      exported_at: new Date().toISOString(),
      include_archive: includeArchive,
      meta: metaEntry,
      branches,
      nodes
    };
  }

  async exportTimeline({ includeArchive = false } = {}) {
    const data = await this.getExportData({ includeArchive });

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `naruto-timeline-${Date.now()}${includeArchive ? '-full' : ''}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
    return migrated;
  }

  async importTimeline(data, { mode = 'overwrite' } = {}) {
    if (!data || typeof data !== 'object') throw new Error('存档格式无效');
    const incomingNodes = Array.isArray(data.nodes) ? data.nodes : [];
    const incomingBranches = Array.isArray(data.branches) ? data.branches : [];
    if (!incomingNodes.length || !incomingBranches.length) throw new Error('存档缺少时间线节点或分支数据');

    await stateManager.initDB();

    if (mode === 'merge') {
      return await this._importMerge(incomingNodes, incomingBranches, data);
    }

    const migratedNodes = incomingNodes.map(n => this._migrateNodeV1ToV2(n));
    if (!migratedNodes.some(n => n?.id)) throw new Error('存档节点数据无效');

    await stateManager.dbClear('timeline_nodes');
    await stateManager.dbClear('timeline_branches');
    await stateManager.dbClear('timeline_meta');

    for (const node of migratedNodes) {
      if (node?.id) await stateManager.dbPut('timeline_nodes', node);
    }

    const latestNode = [...migratedNodes].sort((a, b) => (b.turn_number || 0) - (a.turn_number || 0))[0];
    const importedMeta = data.meta?.value || data.timeline?.meta || {};
    const currentId = importedMeta.current_id && migratedNodes.some(n => n.id === importedMeta.current_id)
      ? importedMeta.current_id
      : latestNode.id;
    const currentNode = migratedNodes.find(n => n.id === currentId) || latestNode;
    const activeBranch = currentNode.branch_id || importedMeta.active_branch || 'branch_main';

    for (const branch of incomingBranches) {
      if (branch?.id) await stateManager.dbPut('timeline_branches', { ...branch, is_active: branch.id === activeBranch });
    }

    const metaEntry = {
      key: 'root',
      value: {
        root_id: importedMeta.root_id || migratedNodes.find(n => !n.parent_id)?.id || migratedNodes[0].id,
        current_id: currentId,
        active_branch: activeBranch,
        total_nodes: migratedNodes.length
      }
    };
    await stateManager.dbPut('timeline_meta', metaEntry);

    await this._restoreImportedState(currentNode, migratedNodes);

    const metaState = stateManager.getSub('_meta') || {};
    metaState.current_node_id = currentId;
    metaState.active_branch = activeBranch;
    stateManager.setSub('_meta', metaState);

    this._pendingBranchFrom = null;
    this._initialized = true;
    this._cacheTreeSummary();
    eventBus.emit('timeline:imported', { node: currentNode, nodes: migratedNodes, branches: incomingBranches, mode: 'overwrite' });
    this._maybeArchive().catch(() => {});
    return currentNode;
  }

  async _importMerge(incomingNodes, incomingBranches, data) {
    const existingNodes = await stateManager.dbGetAll('timeline_nodes') || [];
    const existingBranches = await stateManager.dbGetAll('timeline_branches') || [];
    const existingNodeIds = new Set(existingNodes.map(n => n.id));
    const existingBranchIds = new Set(existingBranches.map(b => b.id));

    const branchIdMap = new Map();
    for (const branch of incomingBranches) {
      if (!branch?.id) continue;
      let newId = branch.id;
      let suffix = 0;
      while (existingBranchIds.has(newId) || branchIdMap.has(newId)) {
        suffix++;
        newId = `${branch.id}_imp${suffix}`;
      }
      branchIdMap.set(branch.id, newId);
      existingBranchIds.add(newId);
    }

    const nodeIdMap = new Map();
    for (const node of incomingNodes) {
      if (!node?.id) continue;
      let newId = node.id;
      let suffix = 0;
      while (existingNodeIds.has(newId) || nodeIdMap.has(newId)) {
        suffix++;
        const parts = node.id.split('_');
        if (parts.length >= 2) {
          newId = `${parts[0]}_${parts[1]}_imp${suffix}`;
        } else {
          newId = `${node.id}_imp${suffix}`;
        }
      }
      nodeIdMap.set(node.id, newId);
      existingNodeIds.add(newId);
    }

    for (const branch of incomingBranches) {
      if (!branch?.id) continue;
      const newBranchId = branchIdMap.get(branch.id);
      const renamed = {
        ...branch,
        id: newBranchId,
        name: `${branch.name || '导入分支'} (导入)`,
        is_active: false,
        head_node_id: branch.head_node_id ? nodeIdMap.get(branch.head_node_id) || null : null,
        diverged_from: branch.diverged_from ? nodeIdMap.get(branch.diverged_from) || null : null
      };
      await stateManager.dbPut('timeline_branches', renamed);
    }

    const migratedIncoming = incomingNodes.map(n => {
      const migrated = this._migrateNodeV1ToV2(n);
      return {
        ...migrated,
        id: nodeIdMap.get(n.id) || n.id,
        parent_id: n.parent_id ? nodeIdMap.get(n.parent_id) || null : null,
        children_ids: (n.children_ids || []).map(cid => nodeIdMap.get(cid)).filter(Boolean),
        branch_id: n.branch_id ? branchIdMap.get(n.branch_id) || n.branch_id : n.branch_id
      };
    });
    for (const node of migratedIncoming) {
      await stateManager.dbPut('timeline_nodes', node);
    }

    const existingMeta = await stateManager.dbGet('timeline_meta', 'root');
    if (existingMeta) {
      existingMeta.value.total_nodes = (existingMeta.value.total_nodes || 0) + migratedIncoming.length;
      await stateManager.dbPut('timeline_meta', existingMeta);
    }

    this._cacheTreeSummary();
    eventBus.emit('timeline:imported', { nodes: migratedIncoming, branches: incomingBranches, mode: 'merge' });
    this._maybeArchive().catch(() => {});
    return null;
  }

  async _restoreImportedState(currentNode, allNodes) {
    if (currentNode.state_snapshot) {
      stateManager.restore(deepClone(currentNode.state_snapshot));
      return;
    }
    let snapshotToRestore = null;
    let cursor = allNodes.find(n => n.id === currentNode.id);
    while (cursor && !snapshotToRestore) {
      cursor = allNodes.find(n => n.id === cursor.parent_id);
      if (cursor && cursor.state_snapshot) snapshotToRestore = cursor.state_snapshot;
    }
    if (snapshotToRestore) {
      stateManager.restore(deepClone(snapshotToRestore));
    } else {
      console.warn('[Timeline] 导入的存档缺少有效状态快照');
    }
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

    this._cacheTreeSummary();
    eventBus.emit('timeline:branch-promoted', { oldBranchId: branchId, newMainBranchId: 'branch_main' });
  }

  async deleteBranch(branchId) {
    if (branchId === 'branch_main') throw new Error('Cannot delete main branch');
    const nodes = await stateManager.dbGetAll('timeline_nodes');
    const nodesToDelete = nodes.filter(n => n.branch_id === branchId);

    for (const node of nodesToDelete) {
      await stateManager.dbDelete('timeline_nodes', node.id);
      this._nodeCache.delete(node.id);
    }
    await stateManager.dbDelete('timeline_branches', branchId);

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
