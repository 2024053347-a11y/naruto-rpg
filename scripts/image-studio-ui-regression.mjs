import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as imageStudioController from '../js/ui/image-studio-controller.js';

const uiSource = readFileSync(new URL('../js/ui/image-studio.js', import.meta.url), 'utf8');

const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error.message}`, { cause: error }));
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

await test('OpenAI-compatible settings keep manual model entry and expose explicit model discovery', () => {
  assert.match(uiSource, /name="openai\.model"/);
  assert.match(uiSource, /data-action="fetch-image-models"/);
});

await test('mixed model catalogs keep the manual value without auto-selecting a language model', () => {
  assert.equal(typeof imageStudioController.normalizeImageModelCatalog, 'function');
  const catalog = imageStudioController.normalizeImageModelCatalog({
    models: ['gpt-4.1', 'flux-pro', 'gpt-image-1', 'flux-pro'],
    imageModels: ['flux-pro', 'gpt-image-1']
  }, 'my-private-image-model');

  assert.equal(catalog.models.filter(model => model === 'flux-pro').length, 1);
  assert.ok(catalog.models.includes('gpt-4.1'));
  assert.ok(catalog.models.includes('my-private-image-model'));
  assert.deepEqual(catalog.imageModels, ['flux-pro', 'gpt-image-1']);
  assert.equal(Object.hasOwn(catalog, 'selectedModel'), false);
});

await test('model catalogs bound pathological entry counts and identifiers', () => {
  const catalog = imageStudioController.normalizeImageModelCatalog({
    models: [
      ...Array.from({ length: 5200 }, (_, index) => `model-${String(index).padStart(4, '0')}`),
      'x'.repeat(513)
    ]
  });
  assert.equal(catalog.models.length, 5000);
  assert.equal(catalog.models.some(model => model.length > 512), false);
});

await test('main API reuse exposes only connection fields and derives an allowed key header', async () => {
  const reused = imageStudioController.reusableMainApiConfig({
    apiUrl: 'https://relay.example/v1', apiKey: 'secret', model: 'language-model', backend: 'claude'
  });
  assert.deepEqual(reused, {
    apiUrl: 'https://relay.example/v1', apiKey: 'secret', apiKeyHeader: 'x-api-key'
  });
  assert.equal(Object.hasOwn(reused, 'model'), false);

  const controller = new imageStudioController.ImageStudioUIController(null, {
    readMainApiConfig: () => ({
      apiUrl: 'https://relay.example/v1', apiKey: 'secret', model: 'do-not-copy', backend: 'custom',
      apiKeyHeader: 'api-key'
    })
  });
  assert.deepEqual(await controller.mainApiConfig(), {
    apiUrl: 'https://relay.example/v1', apiKey: 'secret', apiKeyHeader: 'api-key'
  });
});

await test('main API reuse can read the application state manager without a UI-only adapter', async () => {
  const controller = imageStudioController.createImageStudioUIController(null, {
    stateManager: {
      getAPIConfig() {
        return {
          apiUrl: 'https://relay.example/v1/chat/completions',
          apiKey: 'fixture-secret',
          backend: 'claude',
          model: 'language-only-model'
        };
      }
    }
  });
  assert.deepEqual(await controller.mainApiConfig(), {
    apiUrl: 'https://relay.example/v1/chat/completions',
    apiKey: 'fixture-secret',
    apiKeyHeader: 'x-api-key'
  });
});

await test('OpenAI-compatible UI exposes the three proxy-supported API key headers', () => {
  assert.match(uiSource, /name="openai\.apiKeyHeader"/);
  for (const header of ['Authorization', 'x-api-key', 'api-key']) {
    assert.match(uiSource, new RegExp(`['"]${header}['"]`));
  }
  assert.match(uiSource, /data-action="use-main-api"/);
});

if (failures.length) {
  throw new AggregateError(failures, `${failures.length} image studio UI regression test(s) failed`);
}

console.log(`\n${passed} image studio UI regression tests passed.`);
