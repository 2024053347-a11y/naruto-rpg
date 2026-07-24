import { test, expect } from '@playwright/test';

test('cross-mode settings routing waits for draft confirmation before replacing the panel', async ({ page }) => {
  await page.goto('/tests/fixtures/app-settings-routing-harness.html');
  await page.waitForFunction(() => window.__APP_SETTINGS_HARNESS_READY__ === true);
  await page.evaluate(() => window.__APP__._openSettings({ mode: 'player', section: 'appearance' }));

  const player = page.locator('settings-panel:not([mode="creator"])');
  await player.locator('[name="fontSize"]').fill('19');
  await page.evaluate(() => {
    window.__SETTINGS_TRANSITION__ = window.__APP__._openSettings({ mode: 'creator', tool: 'pipeline' });
  });

  const modal = page.locator('game-modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.evaluate(() => window.__SETTINGS_TRANSITION__.then(() => true));
  await expect(player).toHaveCount(1);
  await expect(player.locator('[name="fontSize"]')).toHaveValue('19');
  await expect(page.locator('settings-panel[mode="creator"]')).toHaveCount(0);

  await page.evaluate(() => {
    window.__SETTINGS_TRANSITION__ = window.__APP__._openSettings({ mode: 'creator', tool: 'pipeline' });
  });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '放弃并退出', exact: true }).click();
  await page.evaluate(() => window.__SETTINGS_TRANSITION__.then(() => true));
  await expect(player).toHaveCount(0);
  await expect(page.locator('settings-panel[mode="creator"]')).toHaveCount(1);
});

test('player media settings opens the live image studio and preserves saved settings when rebuilt', async ({ page }) => {
  await page.goto('/tests/fixtures/app-settings-routing-harness.html');
  await page.waitForFunction(() => window.__APP_SETTINGS_HARNESS_READY__ === true);
  await page.evaluate(() => window.__APP__._openSettings({ mode: 'player', section: 'appearance' }));

  const player = page.locator('settings-panel:not([mode="creator"])');
  await player.getByRole('button', { name: '声音与画面', exact: true }).click();
  await expect(player.locator('#tab-audio')).toHaveClass(/active/);
  await player.getByRole('button', { name: '画面工坊', exact: true }).click();

  const creator = page.locator('settings-panel[mode="creator"]');
  await expect(creator).toHaveCount(1);
  await expect(creator.getByRole('button', { name: '画面工坊', exact: true })).toHaveClass(/active/);
  const imageSettings = creator.locator('image-studio-settings');
  await expect(imageSettings).toHaveCount(1);
  await expect(imageSettings.locator('[data-action="save"]')).toBeEnabled();

  await imageSettings.locator('[name="openai.apiUrl"]').fill('https://persist.example/v1');
  await imageSettings.locator('[name="openai.apiKeyHeader"]').selectOption('api-key');
  await imageSettings.locator('[name="openai.model"]').fill('persist-image-model');
  await imageSettings.locator('[data-action="save"]').click();
  await expect(imageSettings.locator('.is-status')).toContainText('已保存');

  await creator.getByRole('button', { name: '玩家设置', exact: true }).click();
  const rebuiltPlayer = page.locator('settings-panel:not([mode="creator"])');
  await expect(rebuiltPlayer).toHaveCount(1);
  await rebuiltPlayer.getByRole('button', { name: '声音与画面', exact: true }).click();
  await rebuiltPlayer.getByRole('button', { name: '画面工坊', exact: true }).click();

  const rebuiltImageSettings = page.locator('settings-panel[mode="creator"] image-studio-settings');
  await expect(rebuiltImageSettings.locator('[data-action="save"]')).toBeEnabled();
  await expect(rebuiltImageSettings.locator('[name="openai.apiUrl"]')).toHaveValue('https://persist.example/v1');
  await expect(rebuiltImageSettings.locator('[name="openai.apiKeyHeader"]')).toHaveValue('api-key');
  await expect(rebuiltImageSettings.locator('[name="openai.model"]')).toHaveValue('persist-image-model');
});
