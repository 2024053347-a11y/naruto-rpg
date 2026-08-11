import assert from 'node:assert/strict';

import { ToolApprovalBroker } from '../js/core/lingxi/approval-broker.js';
import { verifyActionProposal } from '../js/core/lingxi/action-proposal.js';
import {
  CloudSaveActionAdapter,
  LINGXI_CLOUD_SAVE_ACTION_TOOL,
  LINGXI_CLOUD_SAVE_IMPACT_KIND
} from '../js/core/lingxi/adapters/cloud-save-action-adapter.js';
import { createLingXiTools } from '../js/core/lingxi/lingxi-tools.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function makeCloudSave(initial = []) {
  const saves = clone(initial).map((save, index) => ({
    id: String(save.id || `save-${index + 1}`),
    slot_name: save.slot_name || '',
    size_bytes: save.size_bytes ?? 0,
    revision: save.revision ?? 1,
    created_at: save.created_at || '2026-01-01T00:00:00Z',
    updated_at: save.updated_at || '2026-01-01T00:00:00Z',
    preview_data: save.preview_data || {},
    save_data: save.save_data ?? null,
    ...(save.extra || {})
  }));
  let nextId = 100;
  const calls = [];
  return {
    saves,
    calls,
    async listSaves() {
      calls.push({ method: 'list' });
      return clone(saves);
    },
    async uploadSave(slotName, saveData, previewData) {
      calls.push({ method: 'upload', slotName, previewData });
      const entry = {
        id: `save-${nextId++}`,
        slot_name: slotName,
        size_bytes: 2048,
        revision: 1,
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
        preview_data: previewData || {}
      };
      saves.push(entry);
      return { id: entry.id, slot_name: slotName };
    },
    async updateSave(saveId, slotName, saveData, previewData) {
      calls.push({ method: 'update', saveId, slotName, previewData });
      const entry = saves.find(save => save.id === saveId);
      if (!entry) throw new Error('save not found');
      entry.slot_name = slotName;
      entry.revision += 1;
      entry.updated_at = '2026-08-10T00:00:01Z';
      entry.preview_data = previewData || {};
      return { id: entry.id, slot_name: slotName, revision: entry.revision };
    },
    async deleteSave(saveId) {
      calls.push({ method: 'delete', saveId });
      const index = saves.findIndex(save => save.id === saveId);
      if (index < 0) throw new Error('save not found');
      saves.splice(index, 1);
      return { id: saveId, deleted: true };
    },
    async downloadSave(saveId) {
      calls.push({ method: 'download', saveId });
      const entry = saves.find(save => save.id === saveId);
      if (!entry) throw new Error('save not found');
      const body = entry.save_data || { nodes: [], branch: 'main' };
      return new Blob([JSON.stringify(body)], { type: 'application/json' });
    }
  };
}

function makeTimelineSystem() {
  const imports = [];
  let exportData = { nodes: [{ id: 'node_1', title: '开局' }], branch: 'main' };
  return {
    imports,
    setExportData(data) { exportData = clone(data); },
    async getExportData({ includeArchive = false } = {}) {
      return { includeArchive, data: clone(exportData) };
    },
    async importTimeline(data, options) {
      imports.push({ data: clone(data), options: clone(options) });
      exportData = clone(data);
      return { imported: true, nodeCount: Array.isArray(data?.nodes) ? data.nodes.length : 0 };
    }
  };
}

const trustedEvent = Object.freeze({ source: 'trusted-test-ui' });
const fixedNow = 1_780_000_000_000;

function brokerFor(adapter) {
  return new ToolApprovalBroker({
    adapters: [adapter],
    now: () => fixedNow,
    isTrustedUserEvent: event => event === trustedEvent
  });
}

function errorCode(code) {
  return error => {
    assert.equal(error?.code, code);
    return true;
  };
}

function diffAt(proposal, path) {
  return proposal.diff.find(entry => entry.path === path);
}

const buildSaveSnapshot = async () => ({
  saveData: { nodes: [{ id: 'node_7' }], branch: 'main' },
  previewData: { name: '测试玩家', location: '木叶隐村', time: fixedNow }
});

const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

await test('cloud save inspection returns only whitelisted metadata', async () => {
  const cloud = makeCloudSave([{
    id: 'save-1',
    slot_name: '主线存档',
    revision: 3,
    preview_data: { name: '测试玩家', location: '木叶隐村', time: 123 },
    extra: {
      user_id: 'secret-user',
      content_sha256: 'abc123',
      blob_name: 'private-blob',
      file_path: '/saves/save-1'
    }
  }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const result = await adapter.inspectSaves({ limit: 5 });
  const serialized = JSON.stringify(result);
  assert.equal(result.saves.length, 1);
  assert.equal(result.saves[0].id, 'save-1');
  assert.equal(result.saves[0].slotName, '主线存档');
  assert.equal(result.saves[0].revision, 3);
  assert.equal(result.saves[0].preview.name, '测试玩家');
  for (const secret of ['user_id', 'content_sha256', 'blob_name', 'file_path']) {
    assert.equal(serialized.includes(secret), false, `inspect leak: ${secret}`);
  }
  assert.match(result.notice, /不包含存档正文、用户标识、校验值或下载地址/);
});

await test('upload stages an add diff and applies only through the broker approval', async () => {
  const cloud = makeCloudSave();
  const timeline = makeTimelineSystem();
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: timeline,
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
    action: 'upload',
    slotName: '新存档',
    reason: '备份当前进度'
  });
  assert.equal(adapter.toolName, LINGXI_CLOUD_SAVE_ACTION_TOOL);
  assert.deepEqual(proposal.diff, [{
    path: '/cloudSaves/新存档',
    operation: 'add',
    before: null,
    after: { slotName: '新存档', action: 'upload' }
  }]);
  assert.equal(proposal.context.actionImpact.kind, LINGXI_CLOUD_SAVE_IMPACT_KIND);
  assert.match(proposal.context.actionImpact.summary, /上传新云存档/);
  assert.equal(cloud.calls.some(call => call.method !== 'list'), false);
  assert.equal(timeline.imports.length, 0);

  const receipt = await broker.approveFromUserEvent(trustedEvent, {
    proposalId: proposal.id,
    confirmation: 'yes'
  });
  assert.equal(receipt.result.action, 'upload');
  assert.equal(receipt.result.slotName, '新存档');
  assert.ok(receipt.result.saveId);
  assert.notEqual(receipt.afterFingerprint, receipt.beforeFingerprint);
  assert.equal(cloud.saves.some(save => save.slot_name === '新存档'), true);
  assert.equal(cloud.calls.some(call => call.method === 'upload'), true);
  assert.equal(timeline.imports.length, 0);
});

await test('upload rejects an occupied slot and rejects saveId-shaped params', async () => {
  const cloud = makeCloudSave([{ id: 'save-1', slot_name: '主线存档', revision: 2 }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  await assert.rejects(
    () => broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
      action: 'upload', slotName: '主线存档', reason: '重复备份'
    }),
    errorCode('LINGXI_CLOUD_SAVE_SLOT_EXISTS')
  );
  await assert.rejects(
    () => broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
      action: 'upload', slotName: '新存档', saveId: 'save-9', reason: '参数冲突'
    }),
    errorCode('LINGXI_CLOUD_SAVE_INVALID')
  );
  await assert.rejects(
    () => broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
      action: 'upload', slotName: '新存档', reason: 'x', unexpected: 1
    }),
    errorCode('LINGXI_CLOUD_SAVE_INVALID')
  );
});

await test('overwrite binds the real revision and is irreversible', async () => {
  const cloud = makeCloudSave([{
    id: 'save-1',
    slot_name: '主线存档',
    revision: 3,
    updated_at: '2026-08-01T12:00:00Z'
  }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
    action: 'overwrite',
    saveId: 'save-1',
    reason: '覆盖旧版'
  });
  assert.deepEqual(diffAt(proposal, '/cloudSaves/save-1'), {
    path: '/cloudSaves/save-1',
    operation: 'replace',
    before: {
      slotName: '主线存档',
      revision: 3,
      updatedAt: '2026-08-01T12:00:00Z'
    },
    after: { slotName: '主线存档', action: 'overwrite' }
  });
  const details = proposal.context.actionImpact.details.join('\n');
  assert.match(details, /覆盖前版本: 第 3 版/);
  assert.match(details, /旧版本将被覆盖/);

  const receipt = await broker.approveFromUserEvent(trustedEvent, {
    proposalId: proposal.id,
    confirmation: 'yes'
  });
  assert.equal(receipt.result.saveId, 'save-1');
  assert.equal(cloud.saves.find(save => save.id === 'save-1').revision, 4);
  assert.ok(cloud.calls.some(call => call.method === 'update' && call.saveId === 'save-1'));
});

await test('delete binds the real target, is permanent, and removes the cloud save', async () => {
  const cloud = makeCloudSave([{
    id: 'save-1',
    slot_name: '临时存档',
    revision: 1,
    updated_at: '2026-08-02T00:00:00Z'
  }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
    action: 'delete',
    saveId: 'save-1',
    reason: '清理旧备份'
  });
  assert.deepEqual(diffAt(proposal, '/cloudSaves/save-1'), {
    path: '/cloudSaves/save-1',
    operation: 'remove',
    before: {
      slotName: '临时存档',
      revision: 1,
      updatedAt: '2026-08-02T00:00:00Z'
    },
    after: null
  });
  assert.match(proposal.context.actionImpact.summary, /永久删除云存档/);
  assert.match(proposal.context.actionImpact.details.join('\n'), /永久移除，无法撤销/);

  const receipt = await broker.approveFromUserEvent(trustedEvent, {
    proposalId: proposal.id,
    confirmation: 'yes'
  });
  assert.equal(cloud.saves.length, 0);
  assert.ok(cloud.calls.some(call => call.method === 'delete' && call.saveId === 'save-1'));
  assert.notEqual(receipt.afterFingerprint, receipt.beforeFingerprint);
});

await test('restore downloads the save and overwrites the local timeline without touching the list', async () => {
  const cloud = makeCloudSave([{
    id: 'save-1',
    slot_name: '主线存档',
    revision: 5,
    updated_at: '2026-08-03T00:00:00Z',
    save_data: { nodes: [{ id: 'node_cloud' }, { id: 'node_cloud_2' }], branch: 'main' }
  }]);
  const timeline = makeTimelineSystem();
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: timeline,
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
    action: 'restore',
    saveId: 'save-1',
    reason: '回档'
  });
  assert.deepEqual(proposal.diff, [{
    path: '/cloudSaves/save-1',
    operation: 'restore',
    before: { slotName: '主线存档', revision: 5 },
    after: { restoredIntoLocalTimeline: true }
  }]);
  const details = proposal.context.actionImpact.details.join('\n');
  assert.match(details, /下载该云存档并以覆盖模式导入本地时间线/);
  assert.match(details, /当前未保存的本地进度会丢失/);

  const receipt = await broker.approveFromUserEvent(trustedEvent, {
    proposalId: proposal.id,
    confirmation: 'yes'
  });
  assert.equal(receipt.afterFingerprint, proposal.stateFingerprint);
  assert.equal(receipt.result.saveId, 'save-1');
  assert.ok(cloud.calls.some(call => call.method === 'download' && call.saveId === 'save-1'));
  assert.equal(timeline.imports.length, 1);
  assert.deepEqual(timeline.imports[0].options, { mode: 'overwrite' });
  assert.deepEqual(timeline.imports[0].data.nodes, [{ id: 'node_cloud' }, { id: 'node_cloud_2' }]);
});

await test('approval requires exact broker consent from a trusted confirmation event', async () => {
  const cloud = makeCloudSave([{ id: 'save-1', slot_name: '主线存档', revision: 1 }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
    action: 'delete',
    saveId: 'save-1',
    reason: '审批边界测试'
  });
  await assert.rejects(
    () => adapter.apply(proposal, {}),
    errorCode('LINGXI_APPROVAL_REQUIRED')
  );
  await assert.rejects(
    () => broker.approveFromUserEvent({ source: 'synthetic' }, {
      proposalId: proposal.id
    }),
    errorCode('LINGXI_TRUSTED_UI_REQUIRED')
  );
  const receipt = await broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id });
  assert.equal(receipt.result.action, 'delete');
});

await test('a mutated client copy fails proposal binding verification', async () => {
  const cloud = makeCloudSave([{ id: 'save-1', slot_name: '主线存档', revision: 1 }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
    action: 'overwrite',
    saveId: 'save-1',
    reason: '正常覆盖'
  });
  const tampered = clone(proposal);
  tampered.params.reason = '被篡改的原因';
  await assert.rejects(
    () => verifyActionProposal(tampered),
    errorCode('LINGXI_PROPOSAL_TAMPERED')
  );
  await broker.approveFromUserEvent(trustedEvent, {
    proposalId: proposal.id,
    confirmation: 'yes'
  });
  assert.equal(cloud.saves.find(save => save.id === 'save-1').revision, 2);
});

await test('stale cloud save lists block approval before any write', async () => {
  const cloud = makeCloudSave([{ id: 'save-1', slot_name: '主线存档', revision: 1 }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
    action: 'delete',
    saveId: 'save-1',
    reason: '删除旧档'
  });
  cloud.saves.push({ id: 'save-2', slot_name: '新增档位', revision: 1 });
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, {
      proposalId: proposal.id,
      confirmation: 'yes'
    }),
    errorCode('LINGXI_PROPOSAL_STALE')
  );
  assert.equal(cloud.saves.some(save => save.id === 'save-1'), true);
  assert.equal(cloud.calls.some(call => call.method === 'delete'), false);
});

await test('a settled proposal cannot replay its cloud write', async () => {
  const cloud = makeCloudSave([{ id: 'save-1', slot_name: '主线存档', revision: 1 }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
    action: 'overwrite',
    saveId: 'save-1',
    reason: '只覆盖一次'
  });
  await broker.approveFromUserEvent(trustedEvent, {
    proposalId: proposal.id,
    confirmation: 'yes'
  });
  const revisions = cloud.saves.find(save => save.id === 'save-1').revision;
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, {
      proposalId: proposal.id,
      confirmation: 'yes'
    }),
    errorCode('LINGXI_PROPOSAL_REPLAYED')
  );
  assert.equal(cloud.saves.find(save => save.id === 'save-1').revision, revisions);
  assert.equal(cloud.calls.filter(call => call.method === 'update').length, 1);
});

await test('missing targets and wrong action params fail cleanly', async () => {
  const cloud = makeCloudSave([{ id: 'save-1', slot_name: '主线存档', revision: 1 }]);
  const adapter = new CloudSaveActionAdapter({
    cloudSave: cloud,
    timelineSystem: makeTimelineSystem(),
    buildSaveSnapshot
  });
  const broker = brokerFor(adapter);
  await assert.rejects(
    () => broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
      action: 'delete', saveId: 'save-missing', reason: 'x'
    }),
    errorCode('LINGXI_CLOUD_SAVE_TARGET_UNAVAILABLE')
  );
  await assert.rejects(
    () => broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
      action: 'overwrite', saveId: 'save-1', slotName: '主线存档', reason: 'x'
    }),
    errorCode('LINGXI_CLOUD_SAVE_INVALID')
  );
  await assert.rejects(
    () => broker.stageAction(LINGXI_CLOUD_SAVE_ACTION_TOOL, {
      action: 'wipe', saveId: 'save-1', reason: 'x'
    }),
    errorCode('LINGXI_CLOUD_SAVE_INVALID')
  );
});

await test('Ling Xi tools wire inspection and staging without undefined params', async () => {
  const calls = [];
  const tools = createLingXiTools({
    stateManager: { get: () => ({}) },
    stageVariableChange: async value => value,
    async inspectCloudSaves(params) {
      calls.push({ name: 'inspect', params: clone(params) });
      return {
        saves: [{ id: 'save-1', slotName: '主线存档' }],
        count: 1,
        notice: '仅返回云存档元数据。'
      };
    },
    async stageCloudSaveAction(params) {
      calls.push({ name: 'stage', params: clone(params) });
      return {
        id: 'proposal-cloud',
        tool: LINGXI_CLOUD_SAVE_ACTION_TOOL,
        diff: [{ path: '/cloudSaves/新存档', operation: 'add' }]
      };
    }
  });
  const inspected = await tools.inspect_cloud_saves.execute({ limit: 5 });
  assert.deepEqual(inspected.saves, [{ id: 'save-1', slotName: '主线存档' }]);
  const staged = await tools.stage_cloud_save_action.execute({
    action: 'upload',
    slotName: '新存档',
    reason: '备份'
  });
  assert.equal(staged.status, 'pending-human-approval');
  assert.deepEqual(calls[0], { name: 'inspect', params: { limit: 5 } });
  assert.deepEqual(calls[1], {
    name: 'stage',
    params: { action: 'upload', slotName: '新存档', reason: '备份' }
  });
  const missingId = await tools.stage_cloud_save_action.execute({
    action: 'restore',
    saveId: 'save-1',
    reason: '回档'
  });
  assert.deepEqual(calls[2].params, {
    action: 'restore',
    saveId: 'save-1',
    reason: '回档'
  });
  assert.equal(Object.keys(missingId.proposal.diff).length > 0, true);
});

if (failures.length) {
  console.error(`\nLing Xi cloud save action regression failed: ${failures.length}/${passed + failures.length}`);
  process.exitCode = 1;
} else {
  console.log(`\nLing Xi cloud save action regression passed (${passed} tests).`);
}
