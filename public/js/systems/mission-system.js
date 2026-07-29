import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { normalizeMissionStatus } from '../data/instruction-contract.js';

class MissionSystem {
  processInstruction(missionData) {
    if (!missionData || typeof missionData !== 'object') {
      console.warn('[MissionSystem] Invalid mission instruction:', typeof missionData);
      return;
    }
    missionData = this._normalizeInstruction(missionData);

    if (missionData.status === 'completed') {
      this._completeMission(missionData);
    } else if (missionData.status === 'active') {
      this._addMission(missionData);
    } else if (missionData.status === 'progress') {
      this._updateMissionProgress(missionData);
    } else if (missionData.status === 'failed') {
      this._failMission(missionData);
    } else if (missionData.status === 'abandoned') {
      this._abandonMission(missionData);
    }

    eventBus.emit('mission:updated', missionData);
  }

  _completeMission(data) {
    const missions = stateManager.getSub('_missions') || {};
    const active = missions.active || {};
    let mission = active[data.id] || data;

    delete active[data.id];
    missions.active = active;

    const missionId = data.id || mission.id;
    if (!missionId) {
      console.warn('[MissionSystem] _completeMission called without valid mission id');
      return null;
    }
    mission = { ...mission, ...data, status: 'completed', completed_at: Date.now() };
    const completed = missions.completed || {};
    completed[missionId] = mission;
    missions.completed = completed;

    const stats = missions.stats || { total_done: 0, d_rank: 0, c_rank: 0, b_rank: 0, a_rank: 0, s_rank: 0 };
    stats.total_done = (stats.total_done || 0) + 1;
    const rankKey = this._rankKey(mission.rank);
    if (rankKey) stats[rankKey] = (stats[rankKey] || 0) + 1;
    missions.stats = stats;
    stateManager.setSub('_missions', missions);

    stateManager.update([{ key: '进度·已完成任务', op: '+', value: 1 }]);

    const expReward = data.exp_reward ?? data.reward?.exp ?? mission.reward_exp ?? 0;
    const ryoReward = data.ryo_reward ?? data.reward?.ryo ?? mission.reward_ryo ?? 0;
    if (expReward) {
      stateManager.update([{ key: '进度·经验', op: '+', value: expReward }]);
    }
    if (ryoReward) {
      stateManager.update([{ key: '进度·金钱', op: '+', value: ryoReward }]);
    }

    eventBus.emit('mission:completed', mission);
    return mission;
  }

  _addMission(data) {
    const missions = stateManager.getSub('_missions') || {};
    const active = missions.active || {};

    const existing = data.id ? active[data.id] : null;
    if (existing) {
      const patch = { ...data };
      for (const alias of ['name', 'mission_name', 'missionName', 'task_name', '任务名', '任务名称']) {
        delete patch[alias];
      }
      if (!this._usableMissionTitle(patch.title)) delete patch.title;
      for (const key of ['rank', 'location', 'client']) {
        if (!this._missionText(patch[key])) delete patch[key];
      }

      delete patch.reward;
      delete patch.requester;
      delete patch.ryo_reward;
      delete patch.exp_reward;
      delete patch.reward_ryo;
      delete patch.reward_exp;

      const rewardRyo = data.reward?.ryo ?? data.ryo_reward ?? data.reward_ryo;
      const rewardExp = data.reward?.exp ?? data.exp_reward ?? data.reward_exp;
      if (rewardRyo !== undefined && rewardRyo !== null && rewardRyo !== '') patch.reward_ryo = rewardRyo;
      if (rewardExp !== undefined && rewardExp !== null && rewardExp !== '') patch.reward_exp = rewardExp;

      if (data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress)) {
        patch.progress = { ...(existing.progress || {}), ...data.progress };
      } else {
        delete patch.progress;
      }
      if (Array.isArray(data.steps)) {
        patch.progress = {
          ...(existing.progress || {}),
          ...(patch.progress || {}),
          steps: data.steps,
          total_steps: patch.progress?.total_steps ?? data.steps.length
        };
      }
      if (Array.isArray(data.clues)) {
        patch.clues = this._mergeClues(existing.clues || [], data.clues);
      } else {
        delete patch.clues;
      }

      const updated = {
        ...existing,
        ...patch,
        id: existing.id,
        status: 'active',
        created_at: existing.created_at,
        updated_at: Date.now()
      };
      active[existing.id] = updated;
      missions.active = active;
      stateManager.setSub('_missions', missions);
      eventBus.emit('mission:updated-active', updated);
      return updated;
    }

    const missionId = data.id || `mission_${Date.now()}`;

    const mission = {
      id: missionId,
      rank: data.rank || 'D',
      title: this._usableMissionTitle(data.title) || this._deriveMissionTitle(data),
      description: data.description || '',
      type: data.type || '杂务',
      client: data.client || data.requester || '',
      location: data.location || '',
      objective: data.objective || data.description || '',
      risk: data.risk || '低',
      deadline: data.deadline || '',
      reward_ryo: data.reward?.ryo ?? data.ryo_reward ?? data.reward_ryo ?? 0,
      reward_exp: data.reward?.exp ?? data.exp_reward ?? data.reward_exp ?? 0,
      clues: data.clues || [],
      progress: data.progress || { current_step: 0, total_steps: data.steps?.length || 0, steps: data.steps || [] },
      status: 'active',
      created_at: Date.now()
    };

    active[mission.id] = mission;
    missions.active = active;
    stateManager.setSub('_missions', missions);

    eventBus.emit('mission:added', mission);
    return mission;
  }

  _updateMissionProgress(data) {
    const missions = stateManager.getSub('_missions') || {};
    const active = missions.active || {};
    const mission = active[data.id];
    if (!mission) return null;

    const updated = {
      ...mission,
      ...data,
      status: 'active',
      updated_at: Date.now()
    };
    if (data.progress && typeof data.progress === 'object') {
      updated.progress = { ...(mission.progress || {}), ...data.progress };
    }
    if (Array.isArray(data.clues)) {
      const existing = Array.isArray(mission.clues) ? mission.clues : [];
      updated.clues = this._mergeClues(existing, data.clues).slice(-20);
    }
    active[data.id] = updated;
    missions.active = active;
    stateManager.setSub('_missions', missions);
    eventBus.emit('mission:progress', updated);
    return updated;
  }

  _failMission(data) {
    const missions = stateManager.getSub('_missions') || {};
    const active = missions.active || {};
    let mission = active[data.id];
    delete active[data.id];
    if (!mission) mission = data;
    mission = { ...mission, ...data, status: 'failed', failed_at: Date.now() };

    missions.active = active;
    const failed = missions.failed || {};
    failed[mission.id] = mission;
    missions.failed = failed;

    const stats = missions.stats || { total_done: 0, total_failed: 0, d_rank: 0, c_rank: 0, b_rank: 0, a_rank: 0, s_rank: 0 };
    stats.total_failed = (stats.total_failed || 0) + 1;
    missions.stats = stats;
    stateManager.setSub('_missions', missions);

    eventBus.emit('mission:failed', mission);
    return mission;
  }

  _abandonMission(data) {
    const missions = stateManager.getSub('_missions') || {};
    const active = missions.active || {};
    const mission = active[data.id];
    if (!mission) return null;
    delete active[data.id];
    missions.active = active;

    const abandoned = { ...mission, ...data, status: 'abandoned', abandoned_at: Date.now() };
    const failed = missions.failed || {};
    failed[abandoned.id] = abandoned;
    missions.failed = failed;

    const stats = missions.stats || { total_done: 0, total_failed: 0, total_abandoned: 0, d_rank: 0, c_rank: 0, b_rank: 0, a_rank: 0, s_rank: 0 };
    stats.total_abandoned = (stats.total_abandoned || 0) + 1;
    missions.stats = stats;
    stateManager.setSub('_missions', missions);

    eventBus.emit('mission:abandoned', abandoned);
    return abandoned;
  }

  getActiveMissions() {
    const missions = stateManager.getSub('_missions') || {};
    const active = missions.active || {};
    return Object.values(active);
  }

  getCompletedMissions() {
    const missions = stateManager.getSub('_missions') || {};
    const completed = missions.completed || {};
    return Object.values(completed);
  }

  getAvailableMissions() {
    const missions = stateManager.getSub('_missions') || {};
    const available = missions.available || {};
    return Object.values(available);
  }

  getMissionStats() {
    const missions = stateManager.getSub('_missions') || {};
    return missions.stats || { total_done: 0, d_rank: 0, c_rank: 0, b_rank: 0, a_rank: 0, s_rank: 0 };
  }

  _rankKey(rank) {
    const key = `${String(rank || 'D').trim().toLowerCase()}_rank`;
    return ['d_rank', 'c_rank', 'b_rank', 'a_rank', 's_rank'].includes(key) ? key : null;
  }

  _normalizeInstruction(data) {
    const next = { ...data };
    for (const key of ['title', 'name', 'mission_name', 'missionName', 'task_name', '任务名', '任务名称']) {
      const title = this._usableMissionTitle(next[key]);
      if (title) {
        next.title = title;
        break;
      }
    }
    const rawStatus = String(next.status || '').trim().toLowerCase();
    const isNewMissionStatus = rawStatus === 'accepted' || rawStatus === 'in_progress';
    if (rawStatus) next.status = normalizeMissionStatus(rawStatus);
    if (next.progress_update && !next.progress) {
      next.progress = {
        current_step: next.progress_update.step,
        note: next.progress_update.note
      };
      if (!isNewMissionStatus) next.status = 'progress';
    }
    return next;
  }

  _deriveMissionTitle(data) {
    for (const value of [data.objective, data.description]) {
      const text = this._missionText(value);
      if (!text) continue;
      const firstSentence = text.split(/[\r\n。！？!?；;]/, 1)[0].trim() || text;
      return firstSentence.length > 32 ? `${firstSentence.slice(0, 31)}…` : firstSentence;
    }

    const rawId = this._missionText(data.id);
    if (rawId) {
      const readableId = rawId
        .replace(/^mission[_:\-\s]*/i, '')
        .replace(/[_-]+/g, ' ')
        .trim();
      return readableId ? `任务·${readableId}` : `任务·${rawId}`;
    }
    return '新任务';
  }

  _usableMissionTitle(value) {
    const title = this._missionText(value);
    if (!title || /^(?:未知任务|未命名任务|未知|unknown(?:\s+(?:mission|task))?)$/i.test(title)) return '';
    return title;
  }

  _missionText(value) {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).replace(/\s+/g, ' ').trim();
    }
    if (Array.isArray(value)) {
      return value.map(item => this._missionText(item)).filter(Boolean).join('、');
    }
    if (!value || typeof value !== 'object') return '';
    for (const key of ['title', 'name', 'summary', 'description', 'objective', 'target', 'text']) {
      const text = this._missionText(value[key]);
      if (text) return text;
    }
    return '';
  }

  _mergeClues(existing, incoming) {
    const result = [...existing];
    for (const clue of incoming) {
      const key = this._clueKey(clue);
      if (!key || result.some(item => this._clueKey(item) === key)) continue;
      result.push(clue);
    }
    return result;
  }

  _clueKey(clue) {
    if (typeof clue === 'string') return clue.trim();
    if (!clue || typeof clue !== 'object') return '';
    return `${clue.title || ''}|${clue.detail || clue.description || ''}`.trim();
  }
}

export const missionSystem = new MissionSystem();
export default missionSystem;
