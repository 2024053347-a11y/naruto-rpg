import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 360, height: 800 }
];

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
