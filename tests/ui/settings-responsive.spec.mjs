import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 360, height: 800 }
];

test('global help control yields to the settings action bar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('naruto_seen_welcome', 'true'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/fixtures/settings-panel-harness.html?mode=creator');
  await page.waitForFunction(() => window.__SETTINGS_HARNESS_READY__ === true);
  await page.evaluate(() => import('/js/utils/help-guide.js'));

  await expect(page.locator('body')).toHaveClass(/settings-panel-open/);
  await expect(page.locator('#help-guide-btn')).toBeHidden();

  await page.locator('settings-panel').evaluate(element => element.remove());
  await expect(page.locator('body')).not.toHaveClass(/settings-panel-open/);
  await expect(page.locator('#help-guide-btn')).toBeVisible();
});

test('player settings keeps its navigation, content and actions inside supported viewports', async ({ page }) => {
  await mkdir('.codex-tmp/settings-visual', { recursive: true });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/tests/fixtures/settings-panel-harness.html');
    await page.waitForFunction(() => window.__SETTINGS_HARNESS_READY__ === true);

    const fit = await page.locator('settings-panel').evaluate((host, expected) => {
      const root = host.shadowRoot;
      const rect = selector => {
        const bounds = root.querySelector(selector).getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height
        };
      };
      const navButtons = [...root.querySelectorAll('.tab-btn')].map(button => {
        const bounds = button.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      });
      const mobileControls = [...root.querySelectorAll('.workbench-link, .close, .actions button')].map(button => {
        const bounds = button.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        expected,
        documentOverflow: {
          x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          y: document.documentElement.scrollHeight > document.documentElement.clientHeight
        },
        panel: rect('.panel'),
        head: rect('.head'),
        layout: rect('.layout'),
        sidebar: rect('.sidebar'),
        content: rect('.content'),
        actions: rect('.actions'),
        navButtons,
        mobileControls
      };
    }, viewport);

    expect(fit.viewport).toEqual(viewport);
    expect(fit.documentOverflow).toEqual({ x: false, y: false });
    expect(fit.panel.left).toBeGreaterThanOrEqual(-1);
    expect(fit.panel.top).toBeGreaterThanOrEqual(-1);
    expect(fit.panel.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(fit.panel.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(fit.head.bottom).toBeLessThanOrEqual(fit.layout.top + 1);
    expect(fit.layout.bottom).toBeLessThanOrEqual(fit.actions.top + 1);
    expect(fit.content.width).toBeGreaterThan(0);
    expect(fit.content.height).toBeGreaterThan(0);
    for (const button of fit.navButtons) {
      expect(button.width).toBeGreaterThan(0);
      expect(button.height).toBeGreaterThanOrEqual(34);
    }
    if (viewport.width <= 768) {
      expect(fit.sidebar.bottom).toBeLessThanOrEqual(fit.content.top + 1);
      for (const button of [...fit.navButtons, ...fit.mobileControls]) {
        expect(button.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      expect(fit.sidebar.right).toBeLessThanOrEqual(fit.content.left + 1);
    }

    await page.waitForTimeout(400);
    await page.screenshot({
      path: `.codex-tmp/settings-visual/player-${viewport.width}x${viewport.height}.png`,
      fullPage: false
    });
  }
});

test('archive controls stay readable on desktop and mobile', async ({ page }) => {
  await mkdir('.codex-tmp/settings-visual', { recursive: true });
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[3]]) {
    await page.setViewportSize(viewport);
    await page.goto('/tests/fixtures/settings-panel-harness.html');
    await page.waitForFunction(() => window.__SETTINGS_HARNESS_READY__ === true);
    const settings = page.locator('settings-panel');
    await settings.locator('[data-section="gameplay"]').click();
    await settings.locator('.storage-section').scrollIntoViewIfNeeded();

    const fit = await settings.evaluate(host => {
      const root = host.shadowRoot;
      const content = root.querySelector('.content');
      const tool = root.querySelector('.storage-tool').getBoundingClientRect();
      const buttons = [...root.querySelectorAll('.storage-actions .btn')].map(button => ({
        clientWidth: button.clientWidth,
        scrollWidth: button.scrollWidth,
        height: button.getBoundingClientRect().height
      }));
      return {
        contentOverflow: content.scrollWidth > content.clientWidth,
        tool: { left: tool.left, right: tool.right, width: tool.width },
        buttons
      };
    });
    expect(fit.contentOverflow).toBe(false);
    expect(fit.tool.left).toBeGreaterThanOrEqual(-1);
    expect(fit.tool.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(fit.tool.width).toBeGreaterThan(0);
    for (const button of fit.buttons) {
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
      expect(button.height).toBeGreaterThanOrEqual(viewport.width <= 768 ? 44 : 34);
    }
    await page.screenshot({
      path: `.codex-tmp/settings-visual/archive-${viewport.width}x${viewport.height}.png`,
      fullPage: false
    });
  }
});

test('support methods and reward code fit desktop and mobile settings', async ({ page }) => {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[3]]) {
    await page.setViewportSize(viewport);
    await page.goto('/tests/fixtures/settings-panel-harness.html');
    await page.waitForFunction(() => window.__SETTINGS_HARNESS_READY__ === true);
    const settings = page.locator('settings-panel');
    await settings.locator('[data-section="support"]').click();

    const fit = await settings.evaluate(host => {
      const root = host.shadowRoot;
      const content = root.querySelector('.content');
      const qr = root.querySelector('.support-qr-frame').getBoundingClientRect();
      const links = [...root.querySelectorAll('.support-primary-link, .support-image-actions a, .support-community-actions a')].map(link => ({
        clientWidth: link.clientWidth,
        scrollWidth: link.scrollWidth,
        height: link.getBoundingClientRect().height
      }));
      return {
        contentOverflow: content.scrollWidth > content.clientWidth,
        qr: { left: qr.left, right: qr.right, width: qr.width, height: qr.height },
        links
      };
    });

    expect(fit.contentOverflow).toBe(false);
    expect(fit.qr.left).toBeGreaterThanOrEqual(-1);
    expect(fit.qr.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(fit.qr.width).toBeGreaterThan(0);
    expect(Math.abs(fit.qr.width - fit.qr.height)).toBeLessThanOrEqual(1);
    for (const link of fit.links) {
      expect(link.scrollWidth).toBeLessThanOrEqual(link.clientWidth + 1);
      if (viewport.width <= 768) expect(link.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('creator editor layer fits between the header and actions at supported viewports', async ({ page }) => {
  await mkdir('.codex-tmp/settings-visual', { recursive: true });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/tests/fixtures/settings-panel-harness.html?mode=creator&tool=canon&resourceId=plot');
    await page.waitForFunction(() => window.__SETTINGS_HARNESS_READY__ === true);

    const workbench = page.locator('settings-panel');
    await workbench.locator('[data-action="open-canon-plot-editor"]').click();
    await expect(workbench.locator('.workbench-editor-layer.active > canon-database-editor[embedded]')).toBeVisible();

    const fit = await workbench.evaluate((host, expected) => {
      const root = host.shadowRoot;
      const bounds = selector => {
        const value = root.querySelector(selector).getBoundingClientRect();
        return {
          left: value.left,
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          width: value.width,
          height: value.height
        };
      };
      const editor = root.querySelector('canon-database-editor');
      const shell = editor.shadowRoot.querySelector('.db-shell');
      return {
        expected,
        panel: bounds('.panel'),
        head: bounds('.head'),
        actions: bounds('.actions'),
        layer: bounds('.workbench-editor-layer'),
        shellOverflowX: shell.scrollWidth > shell.clientWidth
      };
    }, viewport);

    expect(fit.layer.top).toBeGreaterThanOrEqual(fit.head.bottom - 1);
    expect(fit.layer.bottom).toBeLessThanOrEqual(fit.actions.top + 1);
    expect(fit.layer.left).toBeGreaterThanOrEqual(fit.panel.left - 1);
    expect(fit.layer.right).toBeLessThanOrEqual(fit.panel.right + 1);
    expect(fit.layer.width).toBeGreaterThan(0);
    expect(fit.layer.height).toBeGreaterThan(0);
    expect(fit.shellOverflowX).toBe(false);
    if (viewport.width <= 1100) {
      expect(fit.layer.width).toBeGreaterThanOrEqual(fit.panel.width - 2);
    }

    await page.waitForTimeout(400);
    await page.screenshot({
      path: `.codex-tmp/settings-visual/creator-canon-${viewport.width}x${viewport.height}.png`,
      fullPage: false
    });
  }
});
