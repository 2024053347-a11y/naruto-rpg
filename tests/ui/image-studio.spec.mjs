import { test, expect } from '@playwright/test';

test('loading more gallery assets appends results without moving the viewport', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/tests/fixtures/image-studio-harness.html');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const gallery = page.locator('image-gallery-modal');
  const body = gallery.locator('.is-gallery-body');
  await expect(gallery.locator('.is-asset')).toHaveCount(40);

  const beforeScroll = await body.evaluate(element => {
    element.scrollTop = Math.min(520, element.scrollHeight - element.clientHeight);
    return element.scrollTop;
  });
  expect(beforeScroll).toBeGreaterThan(0);

  await gallery.locator('[data-action="more"]').click();
  await expect(gallery.locator('.is-asset')).toHaveCount(80);

  const state = await body.evaluate(element => ({
    scrollTop: element.scrollTop,
    titles: [...element.querySelectorAll('.is-asset-title')].slice(-2).map(node => node.textContent)
  }));
  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(8);
  expect(state.titles).toEqual(['Fixture image 079', 'Fixture image 080']);
  expect(pageErrors).toEqual([]);
});

test('protecting a gallery asset preserves its action focus and list position', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const gallery = page.locator('image-gallery-modal');
  const body = gallery.locator('.is-gallery-body');
  const assetId = 'fixture-asset-016';
  const protect = gallery.locator(`[data-action="asset-protect"][data-asset-id="${assetId}"]`);
  await expect(gallery.locator('.is-asset')).toHaveCount(40);
  await protect.scrollIntoViewIfNeeded();
  const beforeScroll = await body.evaluate(element => {
    element.scrollTop += 48;
    return element.scrollTop;
  });
  expect(beforeScroll).toBeGreaterThan(0);

  await protect.click();
  await expect(protect).toHaveText('取消保护');

  const state = await gallery.evaluate((host, id) => {
    const root = host.shadowRoot;
    const active = root.activeElement;
    return {
      scrollTop: root.querySelector('.is-gallery-body').scrollTop,
      focusedAction: active?.dataset.action || '',
      focusedAssetId: active?.dataset.assetId || ''
    };
  }, assetId);
  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(8);
  expect(state.focusedAction).toBe('asset-protect');
  expect(state.focusedAssetId).toBe(assetId);
});

test('refreshing portrait state preserves the open profile draft and text selection', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=portrait');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const portrait = page.locator('image-portrait-controls');
  await expect(portrait.locator('.is-version')).toHaveCount(18);
  await portrait.locator('.is-profile summary').click();
  const appearance = portrait.locator('[name="profile.appearance"]');
  await appearance.fill('Unsaved silver hair and scar draft');
  await appearance.evaluate(element => {
    element.focus();
    element.setSelectionRange(8, 19, 'forward');
  });

  await page.evaluate(() => window.__IMAGE_PORTRAIT__.refresh());

  await expect(portrait.locator('.is-profile')).toHaveAttribute('open', '');
  await expect(appearance).toHaveValue('Unsaved silver hair and scar draft');
  const state = await portrait.evaluate(host => {
    const root = host.shadowRoot;
    const field = root.querySelector('[name="profile.appearance"]');
    return {
      focused: root.activeElement === field,
      selectionStart: field.selectionStart,
      selectionEnd: field.selectionEnd
    };
  });
  expect(state).toEqual({ focused: true, selectionStart: 8, selectionEnd: 19 });
});

test('selecting an image version preserves horizontal scroll and version focus', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=portrait');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const portrait = page.locator('image-portrait-controls');
  const versions = portrait.locator('.is-versions');
  const targetId = 'fixture-asset-018';
  const target = portrait.locator(`[data-action="select"][data-asset-id="${targetId}"]`);
  await expect(portrait.locator('.is-version')).toHaveCount(18);

  const beforeScroll = await versions.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
    return element.scrollLeft;
  });
  expect(beforeScroll).toBeGreaterThan(0);
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'true');

  const state = await portrait.evaluate((host, id) => {
    const root = host.shadowRoot;
    const active = root.activeElement;
    return {
      scrollLeft: root.querySelector('.is-versions').scrollLeft,
      focusedAssetId: active?.dataset.assetId || '',
      focusedAction: active?.dataset.action || ''
    };
  }, targetId);
  expect(Math.abs(state.scrollLeft - beforeScroll)).toBeLessThanOrEqual(2);
  expect(state.focusedAction).toBe('select');
  expect(state.focusedAssetId).toBe(targetId);
});

test('adding an image worldbook entry focuses the new name and preserves drafts', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const settings = page.locator('image-studio-settings');
  const entries = settings.locator('[data-worldbook-index]');
  await expect(entries).toHaveCount(6);
  const existingDraft = entries.nth(5).locator('[data-wb-field="prompt"]');
  await existingDraft.fill('Unsaved worldbook prompt draft');

  await settings.locator('[data-action="worldbook-add"]').click();

  await expect(entries).toHaveCount(7);
  await expect(existingDraft).toHaveValue('Unsaved worldbook prompt draft');
  const state = await settings.evaluate(host => {
    const root = host.shadowRoot;
    const active = root.activeElement;
    const entry = active?.closest('[data-worldbook-index]');
    return {
      focusedField: active?.dataset.wbField || '',
      focusedIndex: entry?.dataset.worldbookIndex || '',
      focusedValue: active?.value || ''
    };
  });
  expect(state).toEqual({ focusedField: 'name', focusedIndex: '6', focusedValue: '新条目' });
});

test('deleting an image worldbook entry focuses the neighboring name', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const settings = page.locator('image-studio-settings');
  const entries = settings.locator('[data-worldbook-index]');
  await expect(entries).toHaveCount(6);
  await entries.nth(3).locator('[data-action="worldbook-delete"]').click();

  await expect(entries).toHaveCount(5);
  const state = await settings.evaluate(host => {
    const root = host.shadowRoot;
    const active = root.activeElement;
    const entry = active?.closest('[data-worldbook-index]');
    return {
      focusedField: active?.dataset.wbField || '',
      focusedIndex: entry?.dataset.worldbookIndex || '',
      focusedValue: active?.value || ''
    };
  });
  expect(state).toEqual({
    focusedField: 'name', focusedIndex: '3', focusedValue: 'Fixture worldbook 5'
  });
});

test('reading image models preserves the manual value and lets the user choose an image candidate', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const settings = page.locator('image-studio-settings');
  const modelInput = settings.locator('[name="openai.model"]');
  await modelInput.fill('my-private-image-model');

  await settings.locator('[data-action="fetch-image-models"]').click();

  await expect(modelInput).toHaveValue('my-private-image-model');
  await expect(settings.locator('[data-model-group="image"] [data-model-id]')).toHaveText([
    'flux-pro', 'gpt-image-1'
  ]);
  await expect(settings.locator('[data-model-group="all"] [data-model-value]')).toHaveText([
    'gpt-4.1', 'gpt-image-1', 'text-embedding-3-small', 'flux-pro', 'my-private-image-model'
  ]);
  await settings.locator('[data-model-group="all"] summary').click();
  await settings.locator('[data-model-value="gpt-4.1"]').click();
  await expect(modelInput).toHaveValue('gpt-4.1');
  await settings.locator('[data-model-id="gpt-image-1"]').click();
  await expect(modelInput).toHaveValue('gpt-image-1');
});

test('large model catalogs stay bounded and can select a later model through search', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);
  await page.evaluate(() => {
    window.__IMAGE_MODEL_PROBE__.result = {
      status: 'ready',
      models: Array.from({ length: 150 }, (_, index) => `language-model-${String(index + 1).padStart(3, '0')}`),
      imageModels: []
    };
  });

  const settings = page.locator('image-studio-settings');
  const modelInput = settings.locator('[name="openai.model"]');
  await settings.locator('[data-action="fetch-image-models"]').click();
  await expect(settings.locator('[data-model-group="all"] [data-model-value]')).toHaveCount(80);
  await settings.locator('[data-model-search]').fill('language-model-150');
  await expect(settings.locator('[data-model-group="all"] [data-model-value]')).toHaveCount(1);
  await settings.locator('[data-model-group="all"] summary').click();
  await settings.locator('[data-model-value="language-model-150"]').click();
  await expect(modelInput).toHaveValue('language-model-150');
});

test('a failed image model refresh keeps the manual value and previous catalog', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const settings = page.locator('image-studio-settings');
  const modelInput = settings.locator('[name="openai.model"]');
  await settings.locator('[data-action="fetch-image-models"]').click();
  await expect(settings.locator('[data-model-group="image"] [data-model-id]')).toHaveText([
    'flux-pro', 'gpt-image-1'
  ]);

  await modelInput.fill('keep-this-manual-model');
  await page.evaluate(() => { window.__IMAGE_MODEL_PROBE__.error = 'fixture catalog unavailable'; });
  await settings.locator('[data-action="fetch-image-models"]').click();

  await expect(modelInput).toHaveValue('keep-this-manual-model');
  await expect(settings.locator('[data-model-group="image"] [data-model-id]')).toHaveText([
    'flux-pro', 'gpt-image-1'
  ]);
  await expect(settings.locator('.is-status')).toContainText('fixture catalog unavailable');
});

test('a delayed model refresh preserves edits made while the request is running', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);
  await page.evaluate(() => {
    window.__IMAGE_MODEL_PROBE__.gate = new Promise(resolve => {
      window.__RELEASE_IMAGE_MODEL_PROBE__ = resolve;
    });
  });

  const settings = page.locator('image-studio-settings');
  const modelInput = settings.locator('[name="openai.model"]');
  await settings.locator('[data-action="fetch-image-models"]').click();
  await expect(settings.locator('[data-action="fetch-image-models"]')).toHaveText('读取中…');
  await modelInput.fill('edited-while-reading');
  await page.evaluate(() => {
    window.__IMAGE_MODEL_PROBE__.gate = null;
    window.__RELEASE_IMAGE_MODEL_PROBE__();
  });
  await page.waitForFunction(() => window.__IMAGE_MODEL_PROBE__.completed === 1);

  await expect(modelInput).toHaveValue('edited-while-reading');
  await expect(settings.locator('[data-model-value="edited-while-reading"]')).toHaveCount(1);
});

test('switching to the main API prevents an older model response from restoring the previous catalog', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);
  await page.evaluate(() => {
    window.__IMAGE_MODEL_PROBE__.gate = new Promise(resolve => {
      window.__RELEASE_IMAGE_MODEL_PROBE__ = resolve;
    });
  });

  const settings = page.locator('image-studio-settings');
  await settings.locator('[data-action="fetch-image-models"]').click();
  await settings.locator('[data-action="use-main-api"]').click();
  await expect(settings.locator('[name="openai.apiUrl"]')).toHaveValue('https://relay.example/v1/chat/completions');
  await page.evaluate(() => {
    window.__IMAGE_MODEL_PROBE__.gate = null;
    window.__RELEASE_IMAGE_MODEL_PROBE__();
  });
  await page.waitForFunction(() => window.__IMAGE_MODEL_PROBE__.completed === 1);

  await expect(settings.locator('[data-model-group]')).toHaveCount(0);
  await expect(settings.locator('.is-status')).toContainText('已复制正文 API');
});

test('reusing the main API copies connection fields and header without replacing the image model', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const settings = page.locator('image-studio-settings');
  const modelInput = settings.locator('[name="openai.model"]');
  await modelInput.fill('keep-image-model');
  await settings.locator('[data-action="use-main-api"]').click();

  await expect(settings.locator('[name="openai.apiUrl"]')).toHaveValue('https://relay.example/v1/chat/completions');
  await expect(settings.locator('[name="openai.apiKey"]')).toHaveValue('main-api-secret');
  await expect(settings.locator('[name="openai.apiKeyHeader"]')).toHaveValue('x-api-key');
  await expect(modelInput).toHaveValue('keep-image-model');
});

test('saving image settings persists the selected API key header', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);

  const settings = page.locator('image-studio-settings');
  await settings.locator('[name="openai.apiKeyHeader"]').selectOption('api-key');
  await settings.locator('[data-action="save"]').click();
  await expect(settings.locator('.is-status')).toContainText('已保存');

  const savedHeader = await page.evaluate(() => {
    const configure = window.__IMAGE_STUDIO_CALLS__.find(call => call.kind === 'execute' && call.type === 'configure');
    return configure?.settings?.providers?.['openai-compatible']?.apiKeyHeader || '';
  });
  expect(savedHeader).toBe('api-key');
});

test('a delayed main API lookup keeps a newer image model draft', async ({ page }) => {
  await page.goto('/tests/fixtures/image-studio-harness.html?view=settings');
  await page.waitForFunction(() => window.__IMAGE_STUDIO_HARNESS_READY__ === true);
  await page.evaluate(() => {
    window.__MAIN_API_CONFIG_GATE__ = new Promise(resolve => {
      window.__RELEASE_MAIN_API_CONFIG__ = resolve;
    });
  });

  const settings = page.locator('image-studio-settings');
  const modelInput = settings.locator('[name="openai.model"]');
  await settings.locator('[data-action="use-main-api"]').click();
  await modelInput.fill('newer-image-model-draft');
  await page.evaluate(() => {
    window.__MAIN_API_CONFIG_GATE__ = null;
    window.__RELEASE_MAIN_API_CONFIG__();
  });

  await expect(settings.locator('[name="openai.apiUrl"]')).toHaveValue('https://relay.example/v1/chat/completions');
  await expect(modelInput).toHaveValue('newer-image-model-draft');
});
