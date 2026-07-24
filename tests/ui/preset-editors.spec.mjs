import { test, expect } from '@playwright/test';

test('expanding a main preset entry keeps the long list in place', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=main');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const target = page.locator('main-preset-editor .mpe-item[data-idx="45"]');
  const beforeScroll = await target.evaluate(item => {
    const body = item.closest('#mpe-body');
    item.scrollIntoView({ block: 'center' });
    return body.scrollTop;
  });
  expect(beforeScroll).toBeGreaterThan(0);

  await target.locator('.mpe-item-header').click();
  await expect(target).toHaveClass(/expanded/);

  const afterScroll = await page.locator('main-preset-editor #mpe-body').evaluate(body => body.scrollTop);
  expect(Math.abs(afterScroll - beforeScroll)).toBeLessThanOrEqual(1);
});

test('closing a main preset draft does not change the runtime preset', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=main');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const first = page.locator('main-preset-editor .mpe-item[data-idx="0"]');
  await first.locator('.mpe-item-header').click();
  await first.locator('[data-field="name"]').fill('Unsaved runtime leak');
  await first.locator('[data-action="toggle"]').click();
  await page.locator('main-preset-editor #mpe-close').click();
  await expect(page.locator('main-preset-editor')).toHaveCount(0);

  const runtimeEntry = await page.evaluate(async () => {
    const { getMainPreset } = await import('/js/data/default-preset.js');
    const entry = getMainPreset().entries[0];
    return { name: entry.name, enabled: entry.enabled };
  });
  expect(runtimeEntry).toEqual({ name: 'Fixture preset entry 01', enabled: true });
});

test('main preset controls fit a 360px viewport without horizontal clipping', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=main');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);
  await page.locator('main-preset-editor .mpe-item[data-idx="0"] .mpe-item-header').click();

  const fit = await page.locator('main-preset-editor').evaluate(host => {
    const root = host.shadowRoot;
    const container = root.querySelector('.mpe-container');
    const bounds = container.getBoundingClientRect();
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const overflowers = [...root.querySelectorAll('.mpe-header,.mpe-actions,.mpe-bar,.mpe-item-header,.mpe-item-btns')]
      .filter(element => visible(element) && element.scrollWidth > element.clientWidth + 1)
      .map(element => element.className);
    const clippedButtons = [...root.querySelectorAll('button')]
      .filter(visible)
      .filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
      })
      .map(button => button.id || button.dataset.action || button.title || button.textContent.trim());
    return { overflowers, clippedButtons, documentOverflow: document.documentElement.scrollWidth - innerWidth };
  });

  expect(fit).toEqual({ overflowers: [], clippedButtons: [], documentOverflow: 0 });
});

test('reordering a main preset entry keeps its draft, viewport and focus', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=main');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const target = page.locator('main-preset-editor .mpe-item[data-idx="45"]');
  await target.locator('.mpe-item-header').click();
  await target.locator('[data-field="content"]').fill('Unsaved main preset draft');
  const beforeScroll = await target.evaluate(item => {
    item.scrollIntoView({ block: 'center' });
    return item.closest('#mpe-body').scrollTop;
  });

  await target.locator('[data-action="move-down"]').click();

  const moved = page.locator('main-preset-editor .mpe-item[data-idx="46"]');
  await expect(moved.locator('.mpe-item-name')).toHaveText('Fixture preset entry 46');
  await expect(moved.locator('[data-field="content"]')).toHaveValue('Unsaved main preset draft');
  const state = await moved.evaluate(item => {
    const root = item.getRootNode();
    const body = item.closest('#mpe-body');
    const bodyRect = body.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    return {
      scrollTop: body.scrollTop,
      visible: itemRect.top >= bodyRect.top && itemRect.bottom <= bodyRect.bottom,
      focusedAction: root.activeElement?.dataset.action || '',
      focusedIndex: root.activeElement?.closest('.mpe-item')?.dataset.idx || ''
    };
  });

  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(1);
  expect(state.visible).toBe(true);
  expect(state.focusedAction).toBe('move-down');
  expect(state.focusedIndex).toBe('46');
});

test('deleting a main preset entry preserves another draft and focuses its neighbor', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=main');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const draftItem = page.locator('main-preset-editor .mpe-item[data-idx="44"]');
  await draftItem.locator('.mpe-item-header').click();
  await draftItem.locator('[data-field="content"]').fill('Draft beside the deleted entry');

  const deletedItem = page.locator('main-preset-editor .mpe-item[data-idx="45"]');
  const beforeScroll = await deletedItem.evaluate(item => {
    item.scrollIntoView({ block: 'center' });
    return item.closest('#mpe-body').scrollTop;
  });
  page.once('dialog', dialog => dialog.accept());
  await deletedItem.locator('[data-action="delete"]').click();

  const neighbor = page.locator('main-preset-editor .mpe-item[data-idx="45"]');
  await expect(neighbor.locator('.mpe-item-name')).toHaveText('Fixture preset entry 47');
  await expect(page.locator('main-preset-editor .mpe-item[data-idx="44"] [data-field="content"]'))
    .toHaveValue('Draft beside the deleted entry');

  const state = await neighbor.evaluate(item => {
    const root = item.getRootNode();
    return {
      scrollTop: item.closest('#mpe-body').scrollTop,
      focusedIndex: root.activeElement?.closest('.mpe-item')?.dataset.idx || '',
      focusedHeader: root.activeElement?.classList.contains('mpe-item-header') || false
    };
  });
  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(1);
  expect(state.focusedIndex).toBe('45');
  expect(state.focusedHeader).toBe(true);
});

test('adding a main preset entry reveals it and focuses its name without losing drafts', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=main');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const draftItem = page.locator('main-preset-editor .mpe-item[data-idx="45"]');
  await draftItem.locator('.mpe-item-header').click();
  await draftItem.locator('[data-field="content"]').fill('Draft retained while adding');
  await page.locator('main-preset-editor #mpe-add-entry').click();

  const added = page.locator('main-preset-editor .mpe-item[data-idx="60"]');
  await expect(added).toHaveClass(/expanded/);
  await expect(page.locator('main-preset-editor .mpe-item[data-idx="45"] [data-field="content"]'))
    .toHaveValue('Draft retained while adding');

  const state = await added.evaluate(item => {
    const root = item.getRootNode();
    const bodyRect = item.closest('#mpe-body').getBoundingClientRect();
    const headerRect = item.querySelector('.mpe-item-header').getBoundingClientRect();
    return {
      headerVisible: headerRect.top >= bodyRect.top && headerRect.bottom <= bodyRect.bottom,
      focusedName: root.activeElement === item.querySelector('[data-field="name"]')
    };
  });
  expect(state.headerVisible).toBe(true);
  expect(state.focusedName).toBe(true);
});

test('duplicating a main preset entry keeps the copy in view and focuses its name', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=main');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const source = page.locator('main-preset-editor .mpe-item[data-idx="45"]');
  await source.locator('.mpe-item-header').click();
  await source.locator('[data-field="content"]').fill('Draft copied into duplicate');
  await source.evaluate(item => item.scrollIntoView({ block: 'center' }));
  await source.locator('[data-action="duplicate"]').click();

  const copy = page.locator('main-preset-editor .mpe-item[data-idx="46"]');
  await expect(copy).toHaveClass(/expanded/);
  await expect(copy.locator('[data-field="content"]')).toHaveValue('Draft copied into duplicate');
  const state = await copy.evaluate(item => {
    const root = item.getRootNode();
    const bodyRect = item.closest('#mpe-body').getBoundingClientRect();
    const headerRect = item.querySelector('.mpe-item-header').getBoundingClientRect();
    return {
      headerVisible: headerRect.top >= bodyRect.top && headerRect.bottom <= bodyRect.bottom,
      focusedName: root.activeElement === item.querySelector('[data-field="name"]')
    };
  });
  expect(state.headerVisible).toBe(true);
  expect(state.focusedName).toBe(true);
});

test('expanding a variable updater preset entry keeps the long list in place', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=variable');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const target = page.locator('variable-updater-preset-editor .entry[data-index="45"]');
  const beforeScroll = await target.evaluate(item => {
    item.scrollIntoView({ block: 'center' });
    return item.closest('main').scrollTop;
  });
  expect(beforeScroll).toBeGreaterThan(0);

  await target.locator('.entry-head').click();
  await expect(target).toHaveClass(/open/);
  const afterScroll = await page.locator('variable-updater-preset-editor main').evaluate(main => main.scrollTop);
  expect(Math.abs(afterScroll - beforeScroll)).toBeLessThanOrEqual(1);
});

test('variable updater preset controls fit a 360px viewport without horizontal clipping', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=variable');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const fit = await page.locator('variable-updater-preset-editor').evaluate(host => {
    const root = host.shadowRoot;
    const editor = root.querySelector('.editor');
    const bounds = editor.getBoundingClientRect();
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const overflowers = [...root.querySelectorAll('header,.actions,.toolbar,.entry-head,.entry-tools')]
      .filter(element => visible(element) && element.scrollWidth > element.clientWidth + 1)
      .map(element => element.className || element.tagName.toLowerCase());
    const clippedButtons = [...root.querySelectorAll('button')]
      .filter(visible)
      .filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
      })
      .map(button => button.dataset.action || button.title || button.textContent.trim());
    return { overflowers, clippedButtons, documentOverflow: document.documentElement.scrollWidth - innerWidth };
  });

  expect(fit).toEqual({ overflowers: [], clippedButtons: [], documentOverflow: 0 });
});

test('toggling a variable updater preset entry preserves its draft, viewport and focus', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=variable');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const target = page.locator('variable-updater-preset-editor .entry[data-index="45"]');
  await target.locator('.entry-head').click();
  await target.locator('[data-field="content"]').fill('Unsaved variable updater draft');
  const beforeScroll = await target.evaluate(item => {
    item.scrollIntoView({ block: 'center' });
    return item.closest('main').scrollTop;
  });

  await target.locator('[data-action="toggle"]').click();

  await expect(target.locator('[data-field="content"]')).toHaveValue('Unsaved variable updater draft');
  await expect(target.locator('.entry-name')).toHaveClass(/off/);
  const state = await target.evaluate(item => {
    const root = item.getRootNode();
    const toggle = item.querySelector('[data-action="toggle"]');
    return {
      scrollTop: item.closest('main').scrollTop,
      focusedToggle: root.activeElement === toggle
    };
  });
  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(1);
  expect(state.focusedToggle).toBe(true);
});

test('reordering a variable updater preset entry keeps its draft, viewport and focus', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=variable');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const target = page.locator('variable-updater-preset-editor .entry[data-index="45"]');
  await target.locator('.entry-head').click();
  await target.locator('[data-field="content"]').fill('Draft retained during variable reorder');
  const beforeScroll = await target.evaluate(item => {
    item.scrollIntoView({ block: 'center' });
    return item.closest('main').scrollTop;
  });

  await target.locator('[data-action="down"]').click();

  const moved = page.locator('variable-updater-preset-editor .entry[data-index="46"]');
  await expect(moved.locator('.entry-name')).toHaveText('Fixture preset entry 46');
  await expect(moved.locator('[data-field="content"]')).toHaveValue('Draft retained during variable reorder');
  const state = await moved.evaluate(item => {
    const root = item.getRootNode();
    const main = item.closest('main');
    const mainRect = main.getBoundingClientRect();
    const headerRect = item.querySelector('.entry-head').getBoundingClientRect();
    return {
      scrollTop: main.scrollTop,
      headerVisible: headerRect.top >= mainRect.top && headerRect.bottom <= mainRect.bottom,
      focusedAction: root.activeElement?.dataset.action || '',
      focusedIndex: root.activeElement?.closest('.entry')?.dataset.index || ''
    };
  });
  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(1);
  expect(state.headerVisible).toBe(true);
  expect(state.focusedAction).toBe('down');
  expect(state.focusedIndex).toBe('46');
});

test('adding a variable updater preset entry reveals it and focuses its name without losing drafts', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=variable');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const draftItem = page.locator('variable-updater-preset-editor .entry[data-index="45"]');
  await draftItem.locator('.entry-head').click();
  await draftItem.locator('[data-field="content"]').fill('Variable draft retained while adding');
  await page.locator('variable-updater-preset-editor [data-action="add"]').click();

  const added = page.locator('variable-updater-preset-editor .entry[data-index="60"]');
  await expect(added).toHaveClass(/open/);
  await expect(page.locator('variable-updater-preset-editor .entry[data-index="45"] [data-field="content"]'))
    .toHaveValue('Variable draft retained while adding');
  const state = await added.evaluate(item => {
    const root = item.getRootNode();
    const mainRect = item.closest('main').getBoundingClientRect();
    const headerRect = item.querySelector('.entry-head').getBoundingClientRect();
    return {
      headerVisible: headerRect.top >= mainRect.top && headerRect.bottom <= mainRect.bottom,
      focusedName: root.activeElement === item.querySelector('[data-field="name"]')
    };
  });
  expect(state.headerVisible).toBe(true);
  expect(state.focusedName).toBe(true);
});

test('deleting a variable updater preset entry preserves another draft and focuses its neighbor', async ({ page }) => {
  await page.goto('/tests/fixtures/preset-editors-harness.html?editor=variable');
  await page.waitForFunction(() => window.__PRESET_EDITOR_HARNESS_READY__ === true);

  const draftItem = page.locator('variable-updater-preset-editor .entry[data-index="44"]');
  await draftItem.locator('.entry-head').click();
  await draftItem.locator('[data-field="content"]').fill('Variable draft beside deleted entry');
  const deletedItem = page.locator('variable-updater-preset-editor .entry[data-index="45"]');
  const beforeScroll = await deletedItem.evaluate(item => {
    item.scrollIntoView({ block: 'center' });
    return item.closest('main').scrollTop;
  });

  await deletedItem.locator('[data-action="delete"]').click();
  await page.locator('game-modal .btn-p').click();

  const neighbor = page.locator('variable-updater-preset-editor .entry[data-index="45"]');
  await expect(neighbor.locator('.entry-name')).toHaveText('Fixture preset entry 47');
  await expect(page.locator('variable-updater-preset-editor .entry[data-index="44"] [data-field="content"]'))
    .toHaveValue('Variable draft beside deleted entry');
  const state = await neighbor.evaluate(item => {
    const root = item.getRootNode();
    return {
      scrollTop: item.closest('main').scrollTop,
      focusedIndex: root.activeElement?.closest('.entry')?.dataset.index || '',
      focusedHeader: root.activeElement?.classList.contains('entry-head') || false
    };
  });
  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(1);
  expect(state.focusedIndex).toBe('45');
  expect(state.focusedHeader).toBe(true);
});
