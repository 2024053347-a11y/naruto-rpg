import { test, expect } from '@playwright/test';

async function openDaily(page) {
  await page.goto('/tests/fixtures/shinobi-daily-harness.html');
  await page.waitForFunction(() => window.__SHINOBI_DAILY_HARNESS_READY__ === true);
  const trigger = page.locator('.shinobi-daily-launch');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const modal = page.locator('shinobi-daily-modal');
  await expect(modal.locator('dialog')).toHaveAttribute('open', '');
  return { trigger, modal };
}

test('daily trigger stays below narrative and opens the fixed newspaper renderer', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const { trigger, modal } = await openDaily(page);

  const lastParagraph = page.locator('.chat-content > p').last();
  const [paragraphBox, triggerBox] = await Promise.all([lastParagraph.boundingBox(), trigger.boundingBox()]);
  expect(triggerBox.y).toBeGreaterThan(paragraphBox.y + paragraphBox.height);

  await expect(modal.locator('h1')).toHaveText('忍界日报');
  await expect(modal.locator('[data-date]')).toHaveText('木叶48年3月12日');
  await expect(modal.locator('.news-card')).toHaveCount(4);
  await expect(modal.locator('.flavor-item')).toHaveCount(3);
  await expect(modal.locator('.mission-table tbody tr')).toHaveCount(4);
  await expect(modal.locator('.rank')).toHaveText(['D', 'C', 'B', 'A']);
  await expect(modal.locator('.quote-text')).toContainText('先确认情报来自何处');
  expect(pageErrors).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(modal.locator('dialog')).not.toHaveAttribute('open', '');
});

test('daily newspaper fits a narrow mobile viewport without horizontal clipping', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const { trigger, modal } = await openDaily(page);
  const paper = modal.locator('.paper');
  await expect(paper).toBeVisible();

  const triggerFits = await trigger.evaluate(element => element.scrollWidth <= element.clientWidth + 1);
  const paperFits = await paper.evaluate(element => element.scrollWidth <= element.clientWidth + 1);
  expect(triggerFits).toBe(true);
  expect(paperFits).toBe(true);

  const viewport = page.viewportSize();
  const paperBox = await paper.boundingBox();
  expect(paperBox.x).toBeGreaterThanOrEqual(0);
  expect(paperBox.x + paperBox.width).toBeLessThanOrEqual(viewport.width);
  await expect(modal.locator('.mission-table tbody tr')).toHaveCount(4);
  await modal.locator('.close').click();
  await expect(modal.locator('dialog')).not.toHaveAttribute('open', '');
});
