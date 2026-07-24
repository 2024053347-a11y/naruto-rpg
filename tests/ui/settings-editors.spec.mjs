import { test, expect } from '@playwright/test';

const readDownload = async download => {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

test('selecting a worldbook entry keeps the long list in place', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/tests/fixtures/editor-harness.html');
  await page.waitForFunction(() => window.__EDITOR_HARNESS_READY__ === true);

  const customItems = page.locator('worldbook-editor .wb-item[data-type="custom"]');
  await expect(customItems).toHaveCount(80);

  const beforeScroll = await page.locator('worldbook-editor #entry-list').evaluate(list => {
    list.scrollTop = list.scrollHeight;
    return list.scrollTop;
  });
  expect(beforeScroll).toBeGreaterThan(0);

  await customItems.last().click();
  await expect(page.locator('worldbook-editor #entry-title')).toHaveValue('Fixture entry 80');

  const state = await page.locator('worldbook-editor').evaluate(host => {
    const root = host.shadowRoot;
    const list = root.querySelector('#entry-list');
    const activeItem = root.querySelector('.wb-item.active');
    const listRect = list.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    return {
      scrollTop: list.scrollTop,
      activeVisible: itemRect.top >= listRect.top && itemRect.bottom <= listRect.bottom,
      focusedId: root.activeElement?.id || ''
    };
  });

  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(1);
  expect(state.activeVisible).toBe(true);
  expect(state.focusedId).toBe('entry-title');
  expect(pageErrors).toEqual([]);
});

test('toggling a worldbook entry preserves its draft and list position', async ({ page }) => {
  await page.goto('/tests/fixtures/editor-harness.html');
  await page.waitForFunction(() => window.__EDITOR_HARNESS_READY__ === true);

  const lastItem = page.locator('worldbook-editor .wb-item[data-type="custom"]').last();
  const list = page.locator('worldbook-editor #entry-list');
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await lastItem.click();
  await page.locator('worldbook-editor #entry-content').fill('Unsaved fixture draft');
  const beforeScroll = await list.evaluate(element => element.scrollTop);

  await page.locator('worldbook-editor .wb-item.active .wb-item-toggle').click();

  await expect(page.locator('worldbook-editor #entry-content')).toHaveValue('Unsaved fixture draft');
  const state = await page.locator('worldbook-editor').evaluate(host => {
    const root = host.shadowRoot;
    const activeToggle = root.querySelector('.wb-item.active .wb-item-toggle');
    const saved = JSON.parse(localStorage.getItem('naruto_worldbook_custom'));
    return {
      scrollTop: root.querySelector('#entry-list').scrollTop,
      focusedToggle: root.activeElement === activeToggle,
      savedContent: saved.at(-1).content,
      enabled: saved.at(-1).enabled
    };
  });

  expect(Math.abs(state.scrollTop - beforeScroll)).toBeLessThanOrEqual(1);
  expect(state.focusedToggle).toBe(true);
  expect(state.savedContent).toBe('Unsaved fixture draft');
  expect(state.enabled).toBe(false);
});

test('adding a worldbook entry reveals it and focuses its title', async ({ page }) => {
  await page.goto('/tests/fixtures/editor-harness.html');
  await page.waitForFunction(() => window.__EDITOR_HARNESS_READY__ === true);

  await page.locator('worldbook-editor #btn-add').click();
  await expect(page.locator('worldbook-editor .wb-item[data-type="custom"]')).toHaveCount(81);

  const state = await page.locator('worldbook-editor').evaluate(host => {
    const root = host.shadowRoot;
    const list = root.querySelector('#entry-list');
    const activeItem = root.querySelector('.wb-item.active');
    const listRect = list.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    return {
      activeVisible: itemRect.top >= listRect.top && itemRect.bottom <= listRect.bottom,
      focusedId: root.activeElement?.id || '',
      scrollTop: list.scrollTop
    };
  });

  expect(state.activeVisible).toBe(true);
  expect(state.focusedId).toBe('entry-title');
  expect(state.scrollTop).toBeGreaterThan(0);
});

test('deleting a worldbook entry reveals and focuses its neighbor', async ({ page }) => {
  await page.goto('/tests/fixtures/editor-harness.html');
  await page.waitForFunction(() => window.__EDITOR_HARNESS_READY__ === true);
  await page.evaluate(async () => {
    const { default: GameModal } = await import('/js/ui/modal.js');
    GameModal.confirm = async () => true;
  });

  const list = page.locator('worldbook-editor #entry-list');
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('worldbook-editor .wb-item[data-type="custom"]').last().click();
  await page.locator('worldbook-editor #btn-delete').click();
  await expect(page.locator('worldbook-editor .wb-item[data-type="custom"]')).toHaveCount(79);
  await expect(page.locator('worldbook-editor #entry-title')).toHaveValue('Fixture entry 79');

  const state = await page.locator('worldbook-editor').evaluate(host => {
    const root = host.shadowRoot;
    const listElement = root.querySelector('#entry-list');
    const activeItem = root.querySelector('.wb-item.active');
    const listRect = listElement.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    return {
      activeVisible: itemRect.top >= listRect.top && itemRect.bottom <= listRect.bottom,
      focusedId: root.activeElement?.id || '',
      scrollTop: listElement.scrollTop
    };
  });

  expect(state.activeVisible).toBe(true);
  expect(state.focusedId).toBe('entry-title');
  expect(state.scrollTop).toBeGreaterThan(0);
});

test('exporting the worldbook includes the current editor draft', async ({ page }) => {
  await page.goto('/tests/fixtures/editor-harness.html');
  await page.waitForFunction(() => window.__EDITOR_HARNESS_READY__ === true);

  await page.locator('worldbook-editor .wb-item[data-type="custom"]').last().click();
  await page.locator('worldbook-editor #entry-content').fill('Draft included in export');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('worldbook-editor #btn-export').click()
  ]);
  const exported = JSON.parse(await readDownload(download));

  expect(exported.custom.at(-1).content).toBe('Draft included in export');
});

test.describe('worldbook mobile layout', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('header actions fit the viewport in two touch-friendly rows', async ({ page }) => {
    await page.goto('/tests/fixtures/editor-harness.html');
    await page.waitForFunction(() => window.__EDITOR_HARNESS_READY__ === true);

    const state = await page.locator('worldbook-editor').evaluate(host => {
      const root = host.shadowRoot;
      const container = root.querySelector('.wb-container');
      const header = root.querySelector('.wb-header');
      const actions = root.querySelector('.wb-actions');
      const buttons = [...actions.querySelectorAll('button')];
      const containerRect = container.getBoundingClientRect();
      const actionRect = actions.getBoundingClientRect();
      return {
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        containerLeft: containerRect.left,
        containerRight: containerRect.right,
        headerOverflow: header.scrollWidth - header.clientWidth,
        actionsOverflow: actions.scrollWidth - actions.clientWidth,
        actionsInside: actionRect.left >= containerRect.left && actionRect.right <= containerRect.right,
        actionRows: new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size,
        minimumButtonHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height))
      };
    });

    expect(state.documentOverflow).toBeLessThanOrEqual(1);
    expect(state.containerLeft).toBeGreaterThanOrEqual(0);
    expect(state.containerRight).toBeLessThanOrEqual(361);
    expect(state.headerOverflow).toBeLessThanOrEqual(1);
    expect(state.actionsOverflow).toBeLessThanOrEqual(1);
    expect(state.actionsInside).toBe(true);
    expect(state.actionRows).toBe(2);
    expect(state.minimumButtonHeight).toBeGreaterThanOrEqual(44);
  });
});
