import assert from 'node:assert/strict';

import { createSettingsConfigGateway } from '../js/ui/settings-config-gateway.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createManager(initialConfig) {
  return {
    apiConfig: clone(initialConfig),
    saves: [],
    getAPIConfig() {
      return this.apiConfig;
    },
    async saveAPIConfig(config) {
      this.apiConfig = clone(config);
      this.saves.push(clone(config));
    }
  };
}

async function main() {
  const latestAuxiliaryConfig = {
    variableUpdater: { enabled: true, model: 'variables-latest', transport: { streaming: true } },
    narrativeReview: { enabled: true, model: 'review-latest' },
    aiCallPolicy: { strictSingleCall: false, limits: { review: 2 } },
    futurePlanner: { enabled: false, model: 'planner-latest' }
  };
  const manager = createManager({
    apiUrl: 'https://old.example/v1',
    apiKey: 'old-key',
    model: 'old-model',
    backend: 'openai',
    disableStreaming: false,
    promptPreset: { id: 'current-preset' },
    ...latestAuxiliaryConfig
  });
  const gateway = createSettingsConfigGateway(manager);

  const saved = await gateway.saveMainAIConnection({
    apiUrl: 'https://new.example/v1',
    apiKey: 'new-key',
    model: 'new-model',
    backend: 'custom',
    disableStreaming: true,
    variableUpdater: { enabled: false, model: 'variables-stale' },
    narrativeReview: { enabled: false, model: 'review-stale' },
    aiCallPolicy: { strictSingleCall: true },
    futurePlanner: { enabled: true, model: 'planner-stale' }
  });

  assert.equal(manager.saves.length, 1);
  assert.equal(saved.apiUrl, 'https://new.example/v1');
  assert.equal(saved.model, 'new-model');
  assert.equal(saved.disableStreaming, true);
  assert.deepEqual(saved.promptPreset, { id: 'current-preset' });
  for (const [key, value] of Object.entries(latestAuxiliaryConfig)) {
    assert.deepEqual(saved[key], value, `main connection save must preserve latest ${key}`);
  }

  const auxiliaryManager = createManager({
    apiUrl: 'https://current.example/v1',
    model: 'main-current',
    variableUpdater: {
      enabled: true,
      model: 'variables-old',
      transport: { streaming: true, timeoutMs: 30_000 }
    },
    narrativeReview: { enabled: true, model: 'review-current' },
    aiCallPolicy: { strictSingleCall: false },
    futurePlanner: { enabled: false }
  });
  const auxiliaryGateway = createSettingsConfigGateway(auxiliaryManager);
  const auxiliarySaved = await auxiliaryGateway.saveAuxiliaryConfig('variableUpdater', {
    model: 'variables-new',
    transport: { timeoutMs: 60_000 }
  });

  assert.deepEqual(auxiliarySaved.variableUpdater, {
    enabled: true,
    model: 'variables-new',
    transport: { streaming: true, timeoutMs: 60_000 }
  });
  assert.deepEqual(auxiliarySaved.narrativeReview, { enabled: true, model: 'review-current' });
  assert.deepEqual(auxiliarySaved.aiCallPolicy, { strictSingleCall: false });
  assert.deepEqual(auxiliarySaved.futurePlanner, { enabled: false });

  let releaseFirstSave;
  let markFirstSaveStarted;
  const firstSaveStarted = new Promise(resolve => { markFirstSaveStarted = resolve; });
  const firstSaveRelease = new Promise(resolve => { releaseFirstSave = resolve; });
  const concurrentManager = {
    apiConfig: {
      apiUrl: 'https://concurrent.example/v1',
      variableUpdater: { enabled: true, model: 'variables-old' },
      narrativeReview: { enabled: true, model: 'review-old' }
    },
    saveCalls: 0,
    getAPIConfig() {
      return this.apiConfig;
    },
    async saveAPIConfig(config) {
      this.saveCalls += 1;
      if (this.saveCalls === 1) {
        markFirstSaveStarted();
        await firstSaveRelease;
      }
      this.apiConfig = clone(config);
    }
  };
  const concurrentGateway = createSettingsConfigGateway(concurrentManager);
  const firstCommit = concurrentGateway.saveAuxiliaryConfig('variableUpdater', { model: 'variables-new' });
  await firstSaveStarted;
  const secondCommit = concurrentGateway.saveAuxiliaryConfig('narrativeReview', { model: 'review-new' });
  releaseFirstSave();
  await Promise.all([firstCommit, secondCommit]);

  assert.equal(concurrentManager.apiConfig.variableUpdater.model, 'variables-new');
  assert.equal(concurrentManager.apiConfig.narrativeReview.model, 'review-new');

  const uiManager = createManager({ apiUrl: 'https://ui.example/v1' });
  uiManager.ui = {
    settings: {
      themePreset: 'anbu',
      reading: { fontSize: 16, lineHeight: 1.7 },
      gameplay: { tacticalCombat: true }
    },
    panel_tab: 'missions'
  };
  uiManager.uiSaves = 0;
  uiManager.getSub = function getSub(key) {
    return key === '_ui' ? this.ui : undefined;
  };
  uiManager.update = function update(entries) {
    assert.deepEqual(entries.map(entry => [entry.key, entry.op]), [['_ui.settings', '=']]);
    this.ui.settings = clone(entries[0].value);
  };
  uiManager.saveUIPrefs = async function saveUIPrefs() {
    this.uiSaves += 1;
  };
  const uiGateway = createSettingsConfigGateway(uiManager);
  const uiSaved = await uiGateway.saveUISettings({
    reading: { fontSize: 18 },
    gameplay: { responseMode: 'detailed' }
  });

  assert.deepEqual(uiSaved, {
    themePreset: 'anbu',
    reading: { fontSize: 18, lineHeight: 1.7 },
    gameplay: { tacticalCombat: true, responseMode: 'detailed' }
  });
  assert.equal(uiManager.ui.panel_tab, 'missions');
  assert.equal(uiManager.uiSaves, 1);

  console.log('settings config gateway regression passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
