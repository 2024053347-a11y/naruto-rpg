// @ts-check
/**
 * 将酒馆正则脚本写入角色卡 PNG（ccv3 元数据）的领域逻辑。
 * sync-to-card 与 watch-and-sync 此前各自实现了一套，现以“策略参数”统一：
 *  - mode 'replace-all'：用单个脚本整体覆盖 regex_scripts（旧 sync-to-card.cjs 行为）
 *  - mode 'upsert'：按脚本名模糊匹配就地更新，未命中则追加（旧 watch-and-sync.mjs 行为）
 */
import fs from 'node:fs';
import {
  PngCardError,
  decodeCardPayload,
  encodeCardPayload,
  readTextChunks,
  replaceTextChunks,
} from './png-card.mjs';

/** upsert 模式下用于识别“本项目脚本”的名称关键字 */
const SCRIPT_NAME_KEYWORD = '忍者手记';

/**
 * @param {string} cardPath 角色卡 PNG 路径
 * @param {import('./tavern-regex.mjs').TavernRegexScript} regexScript 待写入的正则脚本
 * @param {object} opts
 * @param {'replace-all' | 'upsert'} opts.mode 写入策略（见文件头注释）
 * @param {boolean} [opts.updateCharaChunk=false]
 *   是否把角色卡 JSON 原文同步写入 chara tEXt 块。
 *   保留自旧 watch-and-sync.mjs：它写入的是未经 base64 的裸 JSON，与 v2 卡片
 *   规范（base64）不符，疑似历史 bug，但不确定是否有下游依赖，故保留可选开关
 *   并在技术文档中标注存疑（见 docs/standardization-workflow-refactor.md）。
 * @throws {PngCardError} 卡片缺失、损坏或无 ccv3 元数据
 */
export function writeRegexToCard(cardPath, regexScript, { mode, updateCharaChunk = false }) {
  if (!fs.existsSync(cardPath)) {
    throw new PngCardError(`角色卡不存在: ${cardPath}`);
  }
  const png = fs.readFileSync(cardPath);
  const texts = readTextChunks(png);
  if (texts.ccv3 == null) {
    throw new PngCardError('角色卡中未找到 ccv3 数据');
  }

  const card = decodeCardPayload(texts.ccv3);
  // 容错：老卡片可能缺少 data/extensions 层级
  card.data ??= {};
  card.data.extensions ??= {};

  if (mode === 'replace-all') {
    card.data.extensions.regex_scripts = [regexScript];
  } else {
    const scripts = (card.data.extensions.regex_scripts ??= []);
    const existing = scripts.find(
      (r) => r.scriptName && r.scriptName.includes(SCRIPT_NAME_KEYWORD)
    );
    if (existing) {
      // 就地更新，保留原有 id / placement 等字段（与旧行为一致）
      existing.findRegex = regexScript.findRegex;
      existing.replaceString = regexScript.replaceString;
    } else {
      scripts.push(regexScript);
    }
  }

  const { base64, rawJson } = encodeCardPayload(card);
  /** @type {Record<string, string>} */
  const updates = { ccv3: base64 };
  if (updateCharaChunk) updates.chara = rawJson;

  fs.writeFileSync(cardPath, replaceTextChunks(png, updates));
}
