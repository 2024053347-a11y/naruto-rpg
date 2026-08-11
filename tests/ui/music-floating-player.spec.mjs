import { test, expect } from '@playwright/test';

async function loadHarness(page) {
  await page.goto('/tests/fixtures/music-floating-player-harness.html');
  await page.waitForFunction(() => window.__MUSIC_FLOATING_PLAYER_READY__ === true);
}

test('Ling Xi music opens a visible minimized floating player', async ({ page }) => {
  await loadHarness(page);
  const player = page.locator('#naruto-desktop-lyrics');
  await expect(player).toBeVisible();
  await expect(player).toHaveClass(/minimized/);
  await expect(player.locator('.lyric-text')).toContainText('青鸟');
  await expect(player.locator('.lyric-controls')).toBeHidden();
  expect(await player.evaluate(element => getComputedStyle(element).opacity)).not.toBe('0');
});

test('floating player expands and controls playback without opening settings', async ({ page }) => {
  await loadHarness(page);
  const player = page.locator('#naruto-desktop-lyrics');
  await player.hover();
  await player.locator('[data-music-window="minimize"]').click();
  await expect(player).not.toHaveClass(/minimized/);
  await expect(player.locator('.lyric-controls')).toBeVisible();
  expect(await player.evaluate(element => getComputedStyle(element).opacity)).not.toBe('0');
  expect(await player.evaluate(element => getComputedStyle(element).pointerEvents)).not.toBe('none');

  await player.locator('[data-music-control="toggle"]').click();
  await expect(player).toHaveAttribute('data-status', 'paused');
  await expect(player.locator('[data-music-control="toggle"]')).toHaveAttribute('aria-label', '播放');
  await expect(page.locator('settings-panel')).toHaveCount(0);
});

test('minimized floating player stays inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadHarness(page);
  const bounds = await page.locator('#naruto-desktop-lyrics').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
