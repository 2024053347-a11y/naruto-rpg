import { test, expect } from '@playwright/test';

async function openCreator(page) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/tests/fixtures/character-creator-harness.html?creatorPrototype=1&variant=A');
  await page.waitForFunction(() => window.__CHARACTER_CREATOR_HARNESS_READY__ === true);
  return { creator: page.locator('character-creator'), pageErrors };
}

test('rank benchmark follows the selected official rank immediately', async ({ page }) => {
  const { creator, pageErrors } = await openCreator(page);
  await creator.locator('[data-action="stage"][data-stage="2"]').click();

  const benchmark = creator.locator('[data-rank-benchmark]');
  await expect(benchmark).toContainText('忍校学生中性参考线');
  await creator.locator('[data-path="power.officialRank"]').selectOption('上忍');
  await expect(benchmark).toContainText('上忍中性参考线');
  await expect(benchmark).toContainText('查 180–650');
  expect(pageErrors).toEqual([]);
});

test('opening date exposes month and day controls and keeps the chosen date in the draft', async ({ page }) => {
  const { creator, pageErrors } = await openCreator(page);

  await creator.locator('[data-path="campaign.month"]').selectOption('4');
  await creator.locator('[data-path="campaign.day"]').selectOption('23');

  const campaign = await creator.evaluate(host => host._draft.campaign);
  expect(campaign.month).toBe(4);
  expect(campaign.day).toBe(23);
  await expect(creator.locator('[data-live-summary]')).toContainText('4月23日');
  expect(pageErrors).toEqual([]);
});

test('canon technique library supports rich filters, page sizes and real pagination', async ({ page }) => {
  const { creator, pageErrors } = await openCreator(page);
  await creator.locator('[data-action="stage"][data-stage="3"]').click();

  const cards = creator.locator('[data-technique-result]');
  await expect(cards).toHaveCount(12);
  await expect(creator.locator('[data-technique-page-state]')).toContainText('第 1 / 62 页');
  const firstPageIds = await cards.evaluateAll(items => items.map(item => item.dataset.techniqueResult));

  await creator.locator('[data-technique-page="next"]').first().click();
  await expect(creator.locator('[data-technique-page-state]')).toContainText('第 2 / 62 页');
  const secondPageIds = await cards.evaluateAll(items => items.map(item => item.dataset.techniqueResult));
  expect(secondPageIds[0]).not.toBe(firstPageIds[0]);

  await expect(creator.locator('[data-technique-filter="element"]')).toBeVisible();
  await expect(creator.locator('[data-technique-filter="role"]')).toBeVisible();
  await expect(creator.locator('[data-technique-filter="resource"]')).toBeVisible();
  await expect(creator.locator('[data-technique-filter="class"]')).toBeVisible();
  await creator.locator('[data-technique-filter="element"]').selectOption('火');
  await expect(creator.locator('[data-technique-page-state]')).toContainText('第 1 / 3 页');
  for (const label of await cards.locator('header span').allTextContents()) expect(label).toContain('火');

  await creator.locator('[data-technique-page-size]').selectOption('24');
  await expect(cards).toHaveCount(24);
  await expect(creator.locator('[data-technique-page-state]')).toContainText('第 1 / 2 页');
  expect(pageErrors).toEqual([]);
});

test('a canon technique can be searched and added once while custom creation remains available', async ({ page }) => {
  const { creator, pageErrors } = await openCreator(page);
  await creator.locator('[data-action="stage"][data-stage="3"]').click();
  const initialCount = await creator.locator('[data-ability-entry]').count();
  const scrollBeforeSearch = await creator.evaluate(host => {
    const container = host.closest('.chat-container');
    const search = host.shadowRoot.querySelector('[data-technique-query]');
    container.scrollTop += search.getBoundingClientRect().top - container.getBoundingClientRect().top - 120;
    return container.scrollTop;
  });
  expect(scrollBeforeSearch).toBeGreaterThan(0);

  await creator.locator('[data-technique-query]').fill('豪火球');
  const scrollAfterSearch = await creator.evaluate(host => host.closest('.chat-container').scrollTop);
  expect(Math.abs(scrollAfterSearch - scrollBeforeSearch)).toBeLessThanOrEqual(1);
  const result = creator.locator('[data-technique-result="JT-FIRE-0024"]');
  await expect(result).toContainText('火遁·豪火球之术');
  await result.scrollIntoViewIfNeeded();
  const scrollBeforeAdd = await creator.evaluate(host => host.closest('.chat-container').scrollTop);
  await result.locator('[data-add-technique]').click();
  const scrollAfterAdd = await creator.evaluate(host => host.closest('.chat-container').scrollTop);
  expect(scrollAfterAdd).toBeGreaterThan(0);
  expect(Math.abs(scrollAfterAdd - scrollBeforeAdd)).toBeLessThanOrEqual(2);

  await expect(creator.locator('[data-ability-entry]')).toHaveCount(initialCount + 1);
  const canonEntry = creator.locator('[data-ability-entry][data-technique-id="JT-FIRE-0024"]');
  await expect(canonEntry).toContainText('火遁·豪火球之术');
  await expect(canonEntry).toContainText('正史忍术库');
  await expect(creator.locator('[data-technique-result="JT-FIRE-0024"] [data-add-technique]')).toBeDisabled();

  await creator.locator('[data-action="add-entry"][data-list="abilities"]').click();
  await expect(creator.locator('[data-ability-entry]')).toHaveCount(initialCount + 2);
  await creator.locator(`[data-path="abilities.${initialCount + 1}.name"]`).fill('自创·风火轮');
  const names = await creator.evaluate(host => host._draft.abilities.map(item => item.name));
  expect(names).toContain('火遁·豪火球之术');
  expect(names).toContain('自创·风火轮');
  expect(pageErrors).toEqual([]);
});

test('saved personas can be switched by draft content and the selected one can be deleted', async ({ page }) => {
  const { creator, pageErrors } = await openCreator(page);
  const select = creator.locator('#persona-select');

  await creator.locator('[data-action="stage"][data-stage="1"]').click();
  await creator.locator('[data-path="identity.name"]').fill('夜枭');
  await creator.locator('#persona-name').fill('雾隐暗部·夜枭');
  await creator.locator('[data-action="persona-save"]').click();
  await expect(select.locator('option')).toHaveCount(2);
  const nightOwlId = await select.locator('option').nth(1).getAttribute('value');

  await creator.locator('[data-path="identity.name"]').fill('白狐');
  await creator.locator('#persona-name').fill('木叶暗号部·白狐');
  await creator.locator('[data-action="persona-save"]').click();
  await expect(select.locator('option')).toHaveCount(3);

  expect(nightOwlId).toBeTruthy();
  await select.selectOption(nightOwlId);
  await expect(select).toHaveValue(nightOwlId);
  await expect(creator.locator('[data-path="identity.name"]')).toHaveValue('夜枭');

  await creator.locator('[data-action="persona-delete"]').click();
  await expect(select.locator('option')).toHaveCount(2);
  await expect(select.locator('option').nth(1)).toContainText('木叶暗号部·白狐');
  await expect(select).toHaveValue('');
  expect(pageErrors).toEqual([]);
});
