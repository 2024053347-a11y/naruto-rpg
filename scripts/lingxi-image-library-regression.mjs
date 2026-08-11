import assert from 'node:assert/strict';

import { ToolApprovalBroker } from '../js/core/lingxi/approval-broker.js';
import {
  ImageLibraryActionAdapter,
  LINGXI_IMAGE_LIBRARY_ACTION_TOOL
} from '../js/core/lingxi/adapters/image-studio-adapter.js';

const SECRET = 'sk-image-library-secret-1234567890';
const SIGNED_URL = 'https://cdn.example/asset.png?signature=private-token';

function clone(value) {
  return structuredClone(value);
}

function studioHarness() {
  let assets = [
    {
      id: 'asset-selected', kind: 'asset', target: { kind: 'turn', nodeId: 'node-7' },
      targetKey: 'turn:node-7', selected: true, protected: false,
      contentUrl: SIGNED_URL, metadata: { authorization: SECRET }
    },
    {
      id: 'asset-1', kind: 'asset', target: { kind: 'turn', nodeId: 'node-7' },
      targetKey: 'turn:node-7', selected: false, protected: false,
      providerId: 'openai-compatible', contentUrl: SIGNED_URL,
      metadata: { authorization: SECRET }
    },
    {
      id: 'asset-protected', kind: 'asset', target: { kind: 'portrait', subjectId: 'npc-1' },
      targetKey: 'portrait:npc-1', selected: false, protected: true
    }
  ];
  const bindings = new Map([
    ['turn:node-7', { assetId: 'asset-selected', revision: 3, updatedAt: '2026-08-08T00:00:00.000Z' }],
    ['portrait:npc-1', { assetId: null, revision: 1, updatedAt: '2026-08-08T00:00:00.000Z' }]
  ]);
  const jobs = new Map([
    ['job-failed', { id: 'job-failed', state: 'failed', providerId: 'openai-compatible', prompt: SECRET }],
    ['job-active', { id: 'job-active', state: 'generating', providerId: 'openai-compatible' }]
  ]);
  const executeCalls = [];

  const targetKey = target => target.kind === 'turn' ? `turn:${target.nodeId}` : `portrait:${target.subjectId}`;
  const studio = {
    async read(query) {
      if (query.type === 'target') {
        const key = targetKey(query.target);
        return {
          binding: clone(bindings.get(key) || null),
          assets: clone(assets.filter(asset => asset.targetKey === key)),
          jobs: clone([...jobs.values()].filter(job => job.targetKey === key))
        };
      }
      if (query.type === 'gallery') {
        return {
          items: clone(assets.slice(query.offset, query.offset + query.limit)),
          total: assets.length,
          offset: query.offset,
          limit: query.limit
        };
      }
      if (query.type === 'job') return clone(jobs.get(query.jobId) || null);
      throw new Error(`unexpected read: ${query.type}`);
    },
    async execute(command) {
      executeCalls.push(clone(command));
      if (command.type === 'select') {
        const key = targetKey(command.target);
        const binding = bindings.get(key) || { assetId: null, revision: 0 };
        if (binding.revision !== command.expectedRevision) return { status: 'stale', binding: clone(binding) };
        for (const asset of assets) if (asset.targetKey === key) asset.selected = asset.id === command.assetId;
        const next = { assetId: command.assetId, revision: binding.revision + 1, updatedAt: '2026-08-09T00:00:00.000Z' };
        bindings.set(key, next);
        return { status: 'updated', binding: clone(next) };
      }
      if (command.type === 'detach') {
        const key = targetKey(command.target);
        const binding = bindings.get(key);
        if (binding.revision !== command.expectedRevision) return { status: 'stale', binding: clone(binding) };
        for (const asset of assets) if (asset.targetKey === key) asset.selected = false;
        const next = { assetId: null, revision: binding.revision + 1, updatedAt: '2026-08-09T00:00:00.000Z' };
        bindings.set(key, next);
        return { status: 'detached', binding: clone(next) };
      }
      if (command.type === 'protect') {
        const asset = assets.find(item => item.id === command.assetId);
        asset.protected = command.protected;
        return clone(asset);
      }
      if (command.type === 'delete') {
        assets = assets.filter(item => item.id !== command.assetId);
        return { id: command.assetId };
      }
      if (command.type === 'retry') {
        jobs.set('job-retry', { id: 'job-retry', state: 'queued', providerId: 'openai-compatible' });
        return { jobId: 'job-retry', reused: false };
      }
      if (command.type === 'cancel') {
        jobs.set(command.jobId, { ...jobs.get(command.jobId), state: 'cancelled' });
        return clone(jobs.get(command.jobId));
      }
      throw new Error(`unexpected execute: ${command.type}`);
    }
  };

  return {
    studio,
    executeCalls,
    mutateBinding(target, mutator) {
      const key = targetKey(target);
      bindings.set(key, mutator(clone(bindings.get(key))));
    }
  };
}

const trustedEvent = Object.freeze({ source: 'trusted-image-test' });

function brokerFor(adapter) {
  return new ToolApprovalBroker({
    adapters: [adapter],
    now: () => 1_780_000_000_000,
    isTrustedUserEvent: event => event === trustedEvent
  });
}

function errorCode(code) {
  return error => {
    assert.equal(error?.code, code);
    return true;
  };
}

const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

await test('selection is staged without writes and binds the exact target revision', async () => {
  const { studio, executeCalls } = studioHarness();
  const adapter = new ImageLibraryActionAdapter({ imageStudio: studio });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_IMAGE_LIBRARY_ACTION_TOOL, {
    action: 'select', target: { kind: 'turn', nodeId: 'node-7' },
    assetId: 'asset-1', reason: '切换到第二版插图'
  });
  assert.equal(executeCalls.length, 0);
  assert.equal(proposal.params.expectedRevision, 3);
  assert.equal(proposal.context.actionImpact.kind, 'image-library');
  assert.equal(JSON.stringify(proposal).includes(SECRET), false);
  assert.equal(JSON.stringify(proposal).includes(SIGNED_URL), false);
  await assert.rejects(() => adapter.apply(proposal), errorCode('LINGXI_APPROVAL_REQUIRED'));

  await broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' });
  assert.deepEqual(executeCalls, [{
    type: 'select', target: { kind: 'turn', nodeId: 'node-7' },
    assetId: 'asset-1', expectedRevision: 3
  }]);
});

await test('binding drift invalidates selection before ImageStudio execute', async () => {
  const { studio, executeCalls, mutateBinding } = studioHarness();
  const adapter = new ImageLibraryActionAdapter({ imageStudio: studio });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_IMAGE_LIBRARY_ACTION_TOOL, {
    action: 'detach', target: { kind: 'turn', nodeId: 'node-7' }, reason: '解绑插图'
  });
  mutateBinding({ kind: 'turn', nodeId: 'node-7' }, binding => ({ ...binding, revision: 4 }));
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_STALE')
  );
  assert.equal(executeCalls.length, 0);
});

await test('delete refuses selected or protected assets and deletes an eligible asset once', async () => {
  const { studio, executeCalls } = studioHarness();
  const selectedBroker = brokerFor(new ImageLibraryActionAdapter({ imageStudio: studio }));
  await assert.rejects(
    () => selectedBroker.stageAction(LINGXI_IMAGE_LIBRARY_ACTION_TOOL, {
      action: 'delete', assetId: 'asset-selected', reason: '不应直接删除当前图片'
    }),
    errorCode('LINGXI_IMAGE_ASSET_SELECTED')
  );
  const protectedBroker = brokerFor(new ImageLibraryActionAdapter({ imageStudio: studio }));
  await assert.rejects(
    () => protectedBroker.stageAction(LINGXI_IMAGE_LIBRARY_ACTION_TOOL, {
      action: 'delete', assetId: 'asset-protected', reason: '不应绕过保护'
    }),
    errorCode('LINGXI_IMAGE_ASSET_PROTECTED')
  );
  const broker = brokerFor(new ImageLibraryActionAdapter({ imageStudio: studio }));
  const proposal = await broker.stageAction(LINGXI_IMAGE_LIBRARY_ACTION_TOOL, {
    action: 'delete', assetId: 'asset-1', reason: '删除未采用的版本'
  });
  assert.equal(JSON.stringify(proposal.diff).includes(SIGNED_URL), false);
  await broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' });
  assert.deepEqual(executeCalls, [{ type: 'delete', assetId: 'asset-1' }]);
});

await test('retry and cancel use fixed job ids and explicit cost impact', async () => {
  const { studio, executeCalls } = studioHarness();
  const retryBroker = brokerFor(new ImageLibraryActionAdapter({ imageStudio: studio }));
  const retry = await retryBroker.stageAction(LINGXI_IMAGE_LIBRARY_ACTION_TOOL, {
    action: 'retry', jobId: 'job-failed', reason: '重试失败的生成'
  });
  assert.match(retry.context.actionImpact.details.join(' '), /再次产生 API 费用/);
  const retryReceipt = await retryBroker.approveFromUserEvent(trustedEvent, {
    proposalId: retry.id, confirmation: 'yes'
  });
  assert.equal(retryReceipt.jobId, 'job-retry');

  const cancelBroker = brokerFor(new ImageLibraryActionAdapter({ imageStudio: studio }));
  const cancel = await cancelBroker.stageAction(LINGXI_IMAGE_LIBRARY_ACTION_TOOL, {
    action: 'cancel', jobId: 'job-active', reason: '停止当前生成'
  });
  await cancelBroker.approveFromUserEvent(trustedEvent, { proposalId: cancel.id, confirmation: 'yes' });
  assert.deepEqual(executeCalls, [
    { type: 'retry', jobId: 'job-failed' },
    { type: 'cancel', jobId: 'job-active' }
  ]);
});

if (failures.length) {
  console.error(`\n${failures.length} Ling Xi image-library regression test(s) failed; ${passed} passed.`);
  process.exitCode = 1;
} else {
  console.log(`\nLing Xi image-library regression passed (${passed} tests).`);
}
