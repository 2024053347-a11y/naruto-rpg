import { test, expect } from '@playwright/test';

async function loadHarness(page) {
  await page.goto('/tests/fixtures/lingxi-navigation-harness.html');
  await page.waitForFunction(() => window.__LINGXI_NAVIGATION_READY__ === true);
}

test('assistant panel navigation is reversible and does not persist a UI setting', async ({ page }) => {
  await loadHarness(page);
  const before = await page.evaluate(() => window.__LINGXI_NAVIGATION__.snapshot());
  const result = await page.evaluate(() => window.__LINGXI_NAVIGATION__.openInfo('missions'));
  const after = await page.evaluate(() => window.__LINGXI_NAVIGATION__.snapshot());

  expect(before.persistedTab).toBe('attributes');
  expect(result).toEqual({ opened: true, area: 'info-panel', tab: 'missions' });
  expect(after.persistedTab).toBe('attributes');
  expect(after.visibleTab).toBe('missions');
  expect(after.panelCollapsed).toBe(false);
});

test('timeline and map navigation are idempotent', async ({ page }) => {
  await loadHarness(page);
  await page.evaluate(() => {
    window.__LINGXI_NAVIGATION__.openTimeline();
    window.__LINGXI_NAVIGATION__.openTimeline();
    window.__LINGXI_NAVIGATION__.openMap();
    window.__LINGXI_NAVIGATION__.openMap();
  });
  const state = await page.evaluate(() => window.__LINGXI_NAVIGATION__.snapshot());

  expect(state.timelineCollapsed).toBe(false);
  expect(state.timelineHidden).toBe('false');
  expect(state.mapCount).toBe(1);
});

test('mobile timeline navigation closes the character drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadHarness(page);
  await page.evaluate(() => window.__LINGXI_NAVIGATION__.openInfo('relations'));
  let state = await page.evaluate(() => window.__LINGXI_NAVIGATION__.snapshot());
  expect(state.panelOpen).toBe(true);
  expect(state.visibleTab).toBe('relations');

  await page.evaluate(() => window.__LINGXI_NAVIGATION__.openTimeline());
  state = await page.evaluate(() => window.__LINGXI_NAVIGATION__.snapshot());
  expect(state.panelOpen).toBe(false);
  expect(state.panelCollapsed).toBe(true);
  expect(state.panelHidden).toBe('true');
  expect(state.timelineCollapsed).toBe(false);
});

test('character panel rejects non-allowlisted tabs', async ({ page }) => {
  await loadHarness(page);
  const message = await page.evaluate(() => {
    try {
      window.__LINGXI_NAVIGATION__.openInfo('developer');
      return '';
    } catch (error) {
      return error.message;
    }
  });
  expect(message).toContain('不支持的角色面板分区');
});
