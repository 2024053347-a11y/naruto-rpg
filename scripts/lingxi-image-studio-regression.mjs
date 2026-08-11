import assert from 'node:assert/strict';

import { ToolApprovalBroker } from '../js/core/lingxi/approval-broker.js';
import {
  ImageStudioActionAdapter,
  LINGXI_IMAGE_GENERATION_TOOL
} from '../js/core/lingxi/adapters/image-studio-adapter.js';
import { createLingXiTools } from '../js/core/lingxi/lingxi-tools.js';

const SECRET = 'sk-image-provider-secret-1234567890';
const SIGNED_URL = 'https://cdn.example/image.png?token=cloud-secret-token';

function clone(value) {
  return structuredClone(value);
}

function studioHarness() {
  let settings = {
    enabled: true,
    turnMode: 'manual',
    promptMode: 'main-contract',
    providerId: 'openai-compatible',
    activeProviderId: 'openai-compatible',
    concurrency: 1,
    providers: {
      'openai-compatible': {
        type: 'openai-compatible',
        apiUrl: 'https://images.example/v1',
        apiKey: SECRET,
        apiKeyHeader: 'Authorization',
        model: 'image-model',
        size: '1024x1024'
      },
      comfyui: {
        type: 'comfyui',
        apiUrl: 'http://127.0.0.1:8188',
        workflow: { secretNode: SECRET }
      }
    },
    separatePromptModel: {
      apiUrl: 'https://prompt.example/v1',
      apiKey: SECRET,
      model: 'prompt-model'
    }
  };
  let targetState = {
    binding: { assetId: 'asset-selected', revision: 3, updatedAt: '2026-08-08T00:00:00.000Z' },
    assets: [{
      id: 'asset-1', target: { kind: 'turn', nodeId: 'node-7' }, providerId: 'openai-compatible',
      contentUrl: SIGNED_URL, metadata: { authorization: SECRET }, createdAt: '2026-08-08T00:00:00.000Z'
    }],
    jobs: []
  };
  const executeCalls = [];
  const readCalls = [];
  const studio = {
    async read(query) {
      readCalls.push(clone(query));
      if (query.type === 'settings') return clone(settings);
      if (query.type === 'target') return clone(targetState);
      if (query.type === 'gallery') {
        return {
          items: [{
            id: 'asset-1', target: { kind: 'turn', nodeId: 'node-7' },
            providerId: 'openai-compatible', contentUrl: SIGNED_URL,
            metadata: { authorization: SECRET }, protected: true,
            createdAt: '2026-08-08T00:00:00.000Z'
          }],
          total: 1,
          offset: query.offset,
          limit: query.limit
        };
      }
      throw new Error(`unexpected read: ${query.type}`);
    },
    async execute(command) {
      executeCalls.push(clone(command));
      return { jobId: 'job-approved', reused: false };
    }
  };
  return {
    studio,
    executeCalls,
    readCalls,
    mutateSettings(mutator) { settings = mutator(clone(settings)); },
    mutateTarget(mutator) { targetState = mutator(clone(targetState)); }
  };
}

const failures = [];
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

function errorCode(code) {
  return error => error?.code === code;
}

await test('image reads expose only allowlisted metadata and credential presence', async () => {
  const { studio } = studioHarness();
  const adapter = new ImageStudioActionAdapter({ imageStudio: studio });
  const settings = await adapter.inspectSettings();
  const gallery = await adapter.inspectGallery({
    filters: { turnNodeId: 'node-7' },
    offset: 0,
    limit: 10
  });
  const target = await adapter.inspectTarget({ kind: 'turn', nodeId: 'node-7' });
  const serialized = JSON.stringify({ settings, gallery, target });

  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes(SIGNED_URL), false);
  assert.equal(settings.providers.find(provider => provider.id === 'openai-compatible').credentialConfigured, true);
  assert.equal(settings.providers.find(provider => provider.id === 'comfyui').configured, true);
  assert.equal(gallery.items[0].id, 'asset-1');
  assert.equal(target.binding.revision, 3);
});

await test('staging does not call the provider and broker approval enqueues the exact request once', async () => {
  const { studio, executeCalls } = studioHarness();
  const adapter = new ImageStudioActionAdapter({ imageStudio: studio });
  const trustedEvent = {};
  const broker = new ToolApprovalBroker({
    adapters: [adapter],
    isTrustedUserEvent: event => event === trustedEvent
  });
  const proposal = await broker.stageAction(LINGXI_IMAGE_GENERATION_TOOL, {
    target: { kind: 'turn', nodeId: 'node-7' },
    prompt: '夕阳下的木叶村，忍者站在火影岩前',
    negativePrompt: '模糊，多余手指',
    providerId: '',
    reroll: false,
    reason: '为当前回合生成插图'
  });

  assert.equal(executeCalls.length, 0);
  assert.equal(proposal.context.actionImpact.kind, 'image');
  assert.equal(JSON.stringify(proposal).includes(SECRET), false);
  await assert.rejects(() => adapter.apply(proposal), errorCode('LINGXI_APPROVAL_REQUIRED'));
  assert.equal(executeCalls.length, 0);

  const receipt = await broker.approveFromUserEvent(trustedEvent, {
    proposalId: proposal.id,
    confirmation: 'yes'
  });
  assert.equal(receipt.status, 'queued');
  assert.equal(receipt.jobId, 'job-approved');
  assert.equal(executeCalls.length, 1);
  assert.deepEqual(executeCalls[0], {
    type: 'generate',
    target: { kind: 'turn', nodeId: 'node-7' },
    mode: 'manual',
    prompt: '夕阳下的木叶村，忍者站在火影岩前',
    negativePrompt: '模糊，多余手指',
    providerId: 'openai-compatible',
    reroll: false,
    bindingRevision: 3
  });
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_REPLAYED')
  );
  assert.equal(executeCalls.length, 1);
});

await test('settings or target drift invalidates approval before any generation call', async () => {
  const { studio, executeCalls, mutateSettings } = studioHarness();
  const adapter = new ImageStudioActionAdapter({ imageStudio: studio });
  const trustedEvent = {};
  const broker = new ToolApprovalBroker({
    adapters: [adapter],
    isTrustedUserEvent: event => event === trustedEvent
  });
  const proposal = await broker.stageAction(LINGXI_IMAGE_GENERATION_TOOL, {
    target: { kind: 'portrait', subjectId: 'npc-kakashi' },
    prompt: '旗木卡卡西人物肖像',
    reason: '生成人物肖像'
  });
  mutateSettings(current => {
    current.providers['openai-compatible'].model = 'changed-model';
    return current;
  });

  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_STALE')
  );
  assert.equal(executeCalls.length, 0);
});

await test('Ling Xi tools provide image reads and stage only a pending proposal', async () => {
  const { studio } = studioHarness();
  const adapter = new ImageStudioActionAdapter({ imageStudio: studio });
  const staged = [];
  const tools = createLingXiTools({
    stateManager: { get: () => ({}), getSub: () => ({}) },
    stageVariableChange: async value => value,
    imageStudioAdapter: adapter,
    async stageImageGeneration(params) {
      staged.push(clone(params));
      return {
        id: 'image-proposal',
        params,
        diff: [{ path: '/imageStudio/generationRequests/turn:node-7', after: params }]
      };
    }
  });

  const settings = await tools.inspect_image_settings.execute({});
  const gallery = await tools.inspect_image_gallery.execute({ turnNodeId: 'node-7', limit: 5 });
  const result = await tools.stage_image_generation.execute({
    target: { kind: 'turn', nodeId: 'node-7' },
    prompt: '木叶村夜景',
    reason: '回合插图'
  });

  assert.equal(JSON.stringify({ settings, gallery, result }).includes(SECRET), false);
  assert.equal(staged.length, 1);
  assert.equal(result.status, 'pending-human-approval');
  assert.match(result.notice, /尚未调用绘图 API/);
  assert.equal(staged[0].prompt, '木叶村夜景');
});

if (failures.length) {
  console.error(`\n${failures.length} Ling Xi image regression test(s) failed; ${passed} passed.`);
  process.exitCode = 1;
} else {
  console.log(`\nLing Xi image regression passed (${passed} tests).`);
}
