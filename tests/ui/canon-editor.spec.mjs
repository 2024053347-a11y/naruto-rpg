import { test, expect } from '@playwright/test';

test('selecting a Canon record preserves the list position and starts its detail at the top', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/tests/fixtures/canon-editor-harness.html');
  await page.waitForFunction(() => window.__CANON_HARNESS_READY__ === true);

  const editor = page.locator('canon-database-editor');
  const items = editor.locator('.db-item');
  await expect(items).toHaveCount(40);
  await items.first().click();

  const before = await editor.evaluate(host => {
    const root = host.shadowRoot;
    const list = root.querySelector('.db-list');
    const detail = root.querySelector('.form-scroll');
    list.scrollTop = list.scrollHeight;
    detail.scrollTop = detail.scrollHeight;
    return { list: list.scrollTop, detail: detail.scrollTop };
  });
  expect(before.list).toBeGreaterThan(0);
  expect(before.detail).toBeGreaterThan(0);

  await items.last().click();

  const state = await editor.evaluate(host => {
    const root = host.shadowRoot;
    const list = root.querySelector('.db-list');
    const detail = root.querySelector('.form-scroll');
    const active = root.querySelector('.db-item.active');
    return {
      listScrollTop: list.scrollTop,
      detailScrollTop: detail.scrollTop,
      activeId: active?.dataset.select,
      activeFocused: root.activeElement === active
    };
  });

  expect(Math.abs(state.listScrollTop - before.list)).toBeLessThanOrEqual(1);
  expect(state.detailScrollTop).toBe(0);
  expect(state.activeId).toBe('DAY-HIST-ANNUAL-040');
  expect(state.activeFocused).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('adding a deep Canon scene keeps existing IDs stable and focuses the new scene', async ({ page }) => {
  await page.goto('/tests/fixtures/canon-editor-harness.html');
  await page.waitForFunction(() => window.__CANON_HARNESS_READY__ === true);

  const editor = page.locator('canon-database-editor');
  await editor.locator('.db-item').first().click();
  await editor.locator('[data-field="day_goal"]').fill('Unsaved Canon scene draft');

  const originalIds = await editor.evaluate(host => {
    const root = host.shadowRoot;
    return {
      scene: root.querySelector('[data-field="scene.0.id"]').value,
      beat: root.querySelector('[data-field="scene.0.beat.0.id"]').value
    };
  });

  await editor.locator('[data-action="add-scene"]').click();
  await expect(editor.locator('[data-scene-card]')).toHaveCount(2);

  const state = await editor.evaluate(host => {
    const root = host.shadowRoot;
    const detail = root.querySelector('.form-scroll');
    const title = root.querySelector('[data-field="scene.1.title"]');
    const titleRect = title.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    return {
      originalSceneId: root.querySelector('[data-field="scene.0.id"]').value,
      originalBeatId: root.querySelector('[data-field="scene.0.beat.0.id"]').value,
      dayGoal: root.querySelector('[data-field="day_goal"]').value,
      newSceneId: root.querySelector('[data-field="scene.1.id"]').value,
      newBeatId: root.querySelector('[data-field="scene.1.beat.0.id"]').value,
      detailScrollTop: detail.scrollTop,
      titleVisible: titleRect.top >= detailRect.top && titleRect.bottom <= detailRect.bottom,
      titleFocused: root.activeElement === title
    };
  });

  expect(state.originalSceneId).toBe(originalIds.scene);
  expect(state.originalBeatId).toBe(originalIds.beat);
  expect(state.dayGoal).toBe('Unsaved Canon scene draft');
  expect(state.newSceneId).not.toBe(originalIds.scene);
  expect(state.newBeatId).not.toBe(originalIds.beat);
  expect(state.detailScrollTop).toBeGreaterThan(0);
  expect(state.titleVisible).toBe(true);
  expect(state.titleFocused).toBe(true);
});

test('deleting a deep Canon scene keeps the neighboring scene visible, focused and stable', async ({ page }) => {
  await page.goto('/tests/fixtures/canon-editor-harness.html');
  await page.waitForFunction(() => window.__CANON_HARNESS_READY__ === true);

  const editor = page.locator('canon-database-editor');
  await editor.locator('#db-search').fill('DAY-P1-CRUSH-406');
  await expect(editor.locator('.db-item')).toHaveCount(1);
  await editor.locator('.db-item').click();
  await expect(editor.locator('[data-scene-card]')).toHaveCount(8);

  const survivingId = await editor.locator('[data-field="scene.7.id"]').inputValue();
  await editor.locator('[data-action="remove-scene"][data-scene-index="6"]').click();
  await expect(editor.locator('[data-scene-card]')).toHaveCount(7);

  const state = await editor.evaluate(host => {
    const root = host.shadowRoot;
    const detail = root.querySelector('.form-scroll');
    const title = root.querySelector('[data-field="scene.6.title"]');
    const titleRect = title.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    return {
      survivingId: root.querySelector('[data-field="scene.6.id"]').value,
      detailScrollTop: detail.scrollTop,
      titleVisible: titleRect.top >= detailRect.top && titleRect.bottom <= detailRect.bottom,
      titleFocused: root.activeElement === title
    };
  });

  expect(state.survivingId).toBe(survivingId);
  expect(state.detailScrollTop).toBeGreaterThan(0);
  expect(state.titleVisible).toBe(true);
  expect(state.titleFocused).toBe(true);
});

test('adding a deep Canon beat preserves the scene draft and focuses a stable new beat', async ({ page }) => {
  await page.goto('/tests/fixtures/canon-editor-harness.html');
  await page.waitForFunction(() => window.__CANON_HARNESS_READY__ === true);

  const editor = page.locator('canon-database-editor');
  await editor.locator('.db-item').first().click();
  await editor.locator('[data-field="scene.0.setup"]').fill('Unsaved Canon beat draft');

  const originalIds = await editor.locator('[data-scene-index="0"][data-beat-card] [data-field$=".id"]').evaluateAll(fields => fields.map(field => field.value));
  await editor.locator('[data-action="add-beat"][data-scene-index="0"]').click();
  await expect(editor.locator('[data-scene-index="0"][data-beat-card]')).toHaveCount(originalIds.length + 1);

  const state = await editor.evaluate((host, priorIds) => {
    const root = host.shadowRoot;
    const detail = root.querySelector('.form-scroll');
    const beatIndex = priorIds.length;
    const summary = root.querySelector(`[data-field="scene.0.beat.${beatIndex}.summary"]`);
    const summaryRect = summary.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    return {
      existingIds: priorIds.map((_, index) => root.querySelector(`[data-field="scene.0.beat.${index}.id"]`).value),
      newId: root.querySelector(`[data-field="scene.0.beat.${beatIndex}.id"]`).value,
      setup: root.querySelector('[data-field="scene.0.setup"]').value,
      detailScrollTop: detail.scrollTop,
      summaryVisible: summaryRect.top >= detailRect.top && summaryRect.bottom <= detailRect.bottom,
      summaryFocused: root.activeElement === summary
    };
  }, originalIds);

  expect(state.existingIds).toEqual(originalIds);
  expect(originalIds).not.toContain(state.newId);
  expect(state.setup).toBe('Unsaved Canon beat draft');
  expect(state.detailScrollTop).toBeGreaterThan(0);
  expect(state.summaryVisible).toBe(true);
  expect(state.summaryFocused).toBe(true);
});

test('deleting a deep Canon beat keeps the neighboring beat visible, focused and stable', async ({ page }) => {
  await page.goto('/tests/fixtures/canon-editor-harness.html');
  await page.waitForFunction(() => window.__CANON_HARNESS_READY__ === true);

  const editor = page.locator('canon-database-editor');
  await editor.locator('#db-search').fill('DAY-P1-CRUSH-406');
  await expect(editor.locator('.db-item')).toHaveCount(1);
  await editor.locator('.db-item').click();

  const survivingId = await editor.locator('[data-field="scene.7.beat.4.id"]').inputValue();
  await editor.locator('[data-action="remove-beat"][data-scene-index="7"][data-beat-index="3"]').click();
  await expect(editor.locator('[data-scene-index="7"][data-beat-card]')).toHaveCount(4);

  const state = await editor.evaluate(host => {
    const root = host.shadowRoot;
    const detail = root.querySelector('.form-scroll');
    const summary = root.querySelector('[data-field="scene.7.beat.3.summary"]');
    const summaryRect = summary.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    return {
      survivingId: root.querySelector('[data-field="scene.7.beat.3.id"]').value,
      detailScrollTop: detail.scrollTop,
      summaryVisible: summaryRect.top >= detailRect.top && summaryRect.bottom <= detailRect.bottom,
      summaryFocused: root.activeElement === summary
    };
  });

  expect(state.survivingId).toBe(survivingId);
  expect(state.detailScrollTop).toBeGreaterThan(0);
  expect(state.summaryVisible).toBe(true);
  expect(state.summaryFocused).toBe(true);
});
