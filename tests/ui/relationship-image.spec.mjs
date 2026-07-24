import { test, expect } from '@playwright/test';

test('relationship pin and delete actions reveal on hover and keyboard focus', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/tests/fixtures/relationship-image-harness.html');
  await page.waitForFunction(() => window.__RELATIONSHIP_IMAGE_HARNESS_READY__ === true);

  const panel = page.locator('info-panel');
  await panel.locator('.tab[data-t="relations"]').click();

  let card = panel.locator('.ema-card[data-rel-name="小樱"]');
  let actions = card.locator('.rel-actions');
  const pin = card.locator('[data-action="pin"]');
  const remove = card.locator('[data-action="delete"]');

  await card.hover();
  await expect(actions).toHaveCSS('opacity', '1');

  const cardBox = await card.boundingBox();
  const pinBox = await pin.boundingBox();
  const removeBox = await remove.boundingBox();
  const sealBox = await card.locator('.ema-seal').boundingBox();
  expect(cardBox).not.toBeNull();
  expect(pinBox).not.toBeNull();
  expect(removeBox).not.toBeNull();
  expect(sealBox).not.toBeNull();
  expect(pinBox.x).toBeGreaterThanOrEqual(cardBox.x);
  expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  expect(pinBox.y).toBeGreaterThanOrEqual(cardBox.y);
  expect(removeBox.y + removeBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
  expect(sealBox.x + sealBox.width).toBeLessThanOrEqual(pinBox.x);

  await pin.click();
  card = panel.locator('.ema-card[data-rel-name="小樱"]');
  await expect(card).toHaveClass(/\bpinned\b/);

  await page.mouse.move(0, 0);
  actions = card.locator('.rel-actions');
  const focusedRemove = card.locator('[data-action="delete"]');
  await focusedRemove.focus();
  await expect(actions).toHaveCSS('opacity', '1');

  await focusedRemove.click();
  const confirm = page.locator('game-modal');
  await expect(confirm.locator('.title')).toHaveText('解除羁绊');
  await confirm.locator('.btn[data-idx="0"]').click();
  await expect(panel.locator('.ema-card[data-rel-name="小樱"]')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('relationship portrait opens through real clicks and clears a detached avatar', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/tests/fixtures/relationship-image-harness.html');
  await page.waitForFunction(() => window.__RELATIONSHIP_IMAGE_HARNESS_READY__ === true);

  const panel = page.locator('info-panel');
  await panel.locator('.tab[data-t="relations"]').click();
  await panel.locator('.ema-card[data-rel-name="小樱"]').click();

  const modal = page.locator('game-modal');
  const portrait = modal.locator('image-portrait-controls');
  await expect(modal).toBeVisible();
  await expect(portrait).toBeVisible();
  await expect(portrait.locator('[data-action="portrait-generate"]')).toBeEnabled();
  await expect(portrait.locator('[data-action="gallery"]')).toBeEnabled();
  await expect(modal.locator('.npc-avatar img')).toHaveCount(1);

  const target = await portrait.evaluate(host => host.target);
  expect(target).toEqual({ kind: 'portrait', subjectId: 'relationship-subject-sakura' });

  await portrait.locator('[data-action="portrait-generate"]').click();
  await expect.poll(() => page.evaluate(() => window.__RELATIONSHIP_IMAGE_HARNESS__.commands.length)).toBe(1);
  const commandTarget = await page.evaluate(() => window.__RELATIONSHIP_IMAGE_HARNESS__.commands[0].target);
  expect(commandTarget).toEqual(target);

  await page.evaluate(() => window.__RELATIONSHIP_IMAGE_HARNESS__.detach());
  await expect(modal.locator('.npc-avatar img')).toHaveCount(0);
  await expect(modal.locator('.npc-avatar')).toHaveText('小');
  expect(pageErrors).toEqual([]);
});

test('a late portrait response cannot restore an avatar after detaching it', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/tests/fixtures/relationship-image-harness.html');
  await page.waitForFunction(() => window.__RELATIONSHIP_IMAGE_HARNESS_READY__ === true);

  const panel = page.locator('info-panel');
  await panel.locator('.tab[data-t="relations"]').click();
  await panel.locator('.ema-card[data-rel-name="小樱"]').click();

  const avatar = page.locator('game-modal').locator('.npc-avatar');
  await expect(avatar.locator('img')).toHaveCount(1);

  await page.evaluate(() => window.__RELATIONSHIP_IMAGE_HARNESS__.beginSlowRefresh());
  await page.waitForFunction(() => window.__RELATIONSHIP_IMAGE_HARNESS__.slowReadPending === true);
  await page.evaluate(() => window.__RELATIONSHIP_IMAGE_HARNESS__.detach());
  await expect(avatar.locator('img')).toHaveCount(0);
  await expect(avatar).toHaveText('小');

  await page.evaluate(() => window.__RELATIONSHIP_IMAGE_HARNESS__.releaseSlowRefresh());
  await page.waitForFunction(() => window.__RELATIONSHIP_IMAGE_HARNESS__.slowReadCompleted === true);
  await expect(avatar.locator('img')).toHaveCount(0);
  await expect(avatar).toHaveText('小');
  expect(pageErrors).toEqual([]);
});
