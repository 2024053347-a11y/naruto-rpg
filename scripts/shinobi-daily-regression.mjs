import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SHINOBI_DAILY_DELEGATION_PROMPT,
  SHINOBI_DAILY_EXAMPLE,
  SHINOBI_DAILY_SCHEMA,
  buildShinobiDailyPrompt,
  parseShinobiDailyContract,
  validateShinobiDaily
} from '../js/core/shinobi-daily.js';
import { createNarrativeArtifact, renderNarrativeInstructions } from '../js/core/narrative-artifact.js';
import {
  buildNarrativeReviewMessages,
  parseNarrativeReviewPreview
} from '../js/core/narrative-review.js';
import { buildVariableUpdaterMessages } from '../js/core/variable-updater.js';
import { DEFAULT_VARIABLE_UPDATER_PRESET } from '../js/data/variable-updater-preset.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

const contract = value => `<shinobi_daily>${JSON.stringify(value)}</shinobi_daily>`;

await test('the canonical example passes the exact daily schema', () => {
  const result = validateShinobiDaily(SHINOBI_DAILY_EXAMPLE);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.daily.schema, SHINOBI_DAILY_SCHEMA);
  assert.equal(result.daily.world.length, 4);
  assert.equal(result.daily.flavor.length, 3);
  assert.deepEqual(result.daily.missions.map(item => item.rank), ['D', 'C', 'B', 'A']);
  assert.equal(Object.isFrozen(result.daily), true);
});

await test('the tagged contract parses exactly once and normalizes whitespace', () => {
  const value = structuredClone(SHINOBI_DAILY_EXAMPLE);
  value.headline.title = '  木叶任务发布所完成春季委托名录复核  ';
  const result = parseShinobiDailyContract(`正文\n${contract(value)}`, { required: true });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.daily.headline.title, '木叶任务发布所完成春季委托名录复核');
  assert.match(result.raw, /^<shinobi_daily>/);

  const duplicate = parseShinobiDailyContract(`${contract(value)}\n${contract(value)}`, { required: true });
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join('\n'), /只能输出一个/);
});

await test('daily contracts inside private reasoning blocks never become public instructions', () => {
  for (const [label, hiddenSource] of [
    ['private', `<private>${contract(SHINOBI_DAILY_EXAMPLE)}</private>`],
    ['audit', `<audit_internal>${contract(SHINOBI_DAILY_EXAMPLE)}</audit_internal>`],
    ['thinking', `<variable_thinking>${contract(SHINOBI_DAILY_EXAMPLE)}</variable_thinking>`],
    ['truncated private', `<private>${contract(SHINOBI_DAILY_EXAMPLE)}`],
    ['private attribute', `<context visibility="private">${contract(SHINOBI_DAILY_EXAMPLE)}`]
  ]) {
    const hidden = parseShinobiDailyContract(hiddenSource, { required: true });
    assert.equal(hidden.valid, false, label);
    assert.match(hidden.errors.join('\n'), /缺少顶层/);
  }

  const publicContract = parseShinobiDailyContract([
    contract(SHINOBI_DAILY_EXAMPLE),
    `<private>${contract(SHINOBI_DAILY_EXAMPLE)}</private>`
  ].join('\n'), { required: true });
  assert.equal(publicContract.valid, true, publicContract.errors.join('; '));
});

await test('invalid counts, mission order, extra fields and markup are rejected', () => {
  const wrongCount = structuredClone(SHINOBI_DAILY_EXAMPLE);
  wrongCount.world.pop();
  assert.match(validateShinobiDaily(wrongCount).errors.join('\n'), /恰好包含 4 条/);

  const wrongRank = structuredClone(SHINOBI_DAILY_EXAMPLE);
  [wrongRank.missions[0], wrongRank.missions[1]] = [wrongRank.missions[1], wrongRank.missions[0]];
  assert.match(validateShinobiDaily(wrongRank).errors.join('\n'), /rank 必须是 D/);

  const extra = structuredClone(SHINOBI_DAILY_EXAMPLE);
  extra.html = '<style>body{display:none}</style>';
  assert.match(validateShinobiDaily(extra).errors.join('\n'), /未定义字段 html/);

  const markup = structuredClone(SHINOBI_DAILY_EXAMPLE);
  markup.headline.title = '<img src=x onerror=alert(1)>木叶任务发布所公告';
  assert.match(validateShinobiDaily(markup).errors.join('\n'), /不得包含 HTML/);
});

await test('daily JSON is hidden from visible and persisted narrative projections', () => {
  const artifact = createNarrativeArtifact(`公开正文。\n${contract(SHINOBI_DAILY_EXAMPLE)}`);
  assert.equal(artifact.displayText, '公开正文。');
  assert.deepEqual(artifact.instructions.map(item => item.tag), ['shinobi_daily']);
  assert.match(renderNarrativeInstructions(artifact), /naruto\.shinobi-daily\/v1/);
  assert.doesNotMatch(artifact.displayText, /headline|任务发布所|shinobi_daily/);
});

await test('main and secondary prompts enforce one fixed data-only renderer contract', () => {
  const main = buildShinobiDailyPrompt({ producer: 'main' });
  const secondary = buildShinobiDailyPrompt({ producer: 'secondary' });
  for (const prompt of [main, secondary]) {
    assert.match(prompt, /固定前端数据源/);
    assert.match(prompt, /world 恰好 4 条/);
    assert.match(prompt, /D、C、B、A/);
    assert.match(prompt, /不得泄露私密意图/);
    assert.match(prompt, /仅示范结构与写法/);
  }
  assert.match(main, /完成可见正文/);
  assert.match(secondary, /完成全部变量标签后/);
  assert.match(SHINOBI_DAILY_DELEGATION_PROMPT, /由二次变量模型独立生成/);
});

await test('secondary updater always receives the daily contract after custom preset content', () => {
  const messages = buildVariableUpdaterMessages(DEFAULT_VARIABLE_UPDATER_PRESET, {
    state: {}, compactState: {}, userInput: '查看公告', enrichedInput: '查看公告',
    narrativeResponse: '玩家在公开栏前停下。'
  });
  const prompt = messages.map(message => message.content).join('\n\n');
  assert.match(prompt, /忍界日报结构契约/);
  assert.match(prompt, /完成全部变量标签后/);
  assert.match(prompt, /naruto\.shinobi-daily\/v1/);
});

await test('narrative review is told to preserve a valid daily as a machine contract', () => {
  const messages = buildNarrativeReviewMessages({
    sourceMessages: [{ role: 'system', content: 'E1：公开告示已经发布。' }],
    candidateResponse: `<final>公开正文。</final>${contract(SHINOBI_DAILY_EXAMPLE)}`
  });
  const prompt = messages.map(message => message.content).join('\n\n');
  assert.match(prompt, /忍界日报复检规则/);
  assert.match(prompt, /只能保留一个完整日报契约/);
  assert.match(prompt, /<shinobi_daily>/);
});

await test('narrative review locally rejects a missing or duplicated required daily', () => {
  const narrative = '任务发布所完成当日公开名录核对，值班忍者将已经确认的通行安排逐项张贴。玩家只阅读告示，没有替任何委托作出决定。';
  const candidateArtifact = createNarrativeArtifact(`${narrative}\n${contract(SHINOBI_DAILY_EXAMPLE)}`);
  const preview = daily => [
    '<audit_internal>已依据候选正文逐项复核公开事实、玩家行动边界与日报结构，未引入私密情报。</audit_internal>',
    `<final>${narrative}${daily}</final>`
  ].join('');

  assert.throws(
    () => parseNarrativeReviewPreview(preview(''), { candidateArtifact }),
    /未保留唯一有效的忍界日报契约/
  );
  assert.throws(
    () => parseNarrativeReviewPreview(preview(`${contract(SHINOBI_DAILY_EXAMPLE)}${contract(SHINOBI_DAILY_EXAMPLE)}`), { candidateArtifact }),
    /未保留唯一有效的忍界日报契约/
  );

  const accepted = parseNarrativeReviewPreview(preview(contract(SHINOBI_DAILY_EXAMPLE)), { candidateArtifact });
  assert.equal(accepted.instructions.filter(item => item.tag === 'shinobi_daily').length, 1);
});

await test('pipeline routes ownership and persists the validated daily separately', async () => {
  const [pipelineSource, timelineSource] = await Promise.all([
    readFile(new URL('../js/core/pipeline.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/systems/timeline-system.js', import.meta.url), 'utf8')
  ]);
  assert.match(pipelineSource, /updaterEnabled\s*\?\s*SHINOBI_DAILY_DELEGATION_PROMPT/);
  assert.match(pipelineSource, /parseShinobiDailyContract\(fullResponse, \{ required: true \}\)/);
  assert.match(pipelineSource, /onShinobiDaily/);
  assert.match(pipelineSource, /timelineNodeId:[\s\S]*shinobiDaily/);
  assert.match(timelineSource, /shinobi_daily:\s*shinobiDaily/);
});

await test('modal registration retries when the module was imported before DOM globals exist', async () => {
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const hadCustomElements = Object.hasOwn(globalThis, 'customElements');
  const originalDocument = globalThis.document;
  const originalCustomElements = globalThis.customElements;

  delete globalThis.document;
  delete globalThis.customElements;
  const modalModule = await import(`../js/ui/shinobi-daily-modal.js?domless=${Date.now()}`);

  const definitions = new Map();
  const modal = {
    openDaily(daily) {
      this.daily = daily;
    }
  };
  const createElement = tagName => {
    if (tagName === 'shinobi-daily-modal') return modal;
    const listeners = new Map();
    return {
      dataset: {},
      setAttribute() {},
      append() {},
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      click() {
        listeners.get('click')?.();
      }
    };
  };

  globalThis.customElements = {
    get: name => definitions.get(name),
    define: (name, constructor) => definitions.set(name, constructor)
  };
  globalThis.document = {
    querySelector: () => null,
    createElement,
    body: { appendChild() {} }
  };

  try {
    assert.equal(definitions.has('shinobi-daily-modal'), false);
    const trigger = modalModule.createShinobiDailyTrigger(SHINOBI_DAILY_EXAMPLE);
    trigger.click();
    assert.equal(definitions.get('shinobi-daily-modal'), modalModule.ShinobiDailyModal);
    assert.deepEqual(modal.daily, SHINOBI_DAILY_EXAMPLE);
  } finally {
    if (hadDocument) globalThis.document = originalDocument;
    else delete globalThis.document;
    if (hadCustomElements) globalThis.customElements = originalCustomElements;
    else delete globalThis.customElements;
  }
});

console.log(`PASS ${passed} shinobi daily regression checks.`);
