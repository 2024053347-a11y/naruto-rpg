// @ts-check
/**
 * SillyTavern 正则脚本（regex_scripts）对象工厂。
 * 此前该 13 字段结构在 build-regex.mjs 与 sync-to-card.cjs 中重复手写，
 * 字段一旦漂移（例如 markdownOnly 不一致）酒馆端会静默渲染失败，故收敛为单一工厂。
 */
import { randomUUID } from 'node:crypto';

/**
 * @typedef {object} TavernRegexScript
 * @property {string} id
 * @property {string} scriptName
 * @property {string} findRegex
 * @property {string} replaceString
 * @property {string[]} trimStrings
 * @property {number[]} placement
 * @property {boolean} disabled
 * @property {boolean} markdownOnly
 * @property {boolean} promptOnly
 * @property {boolean} runOnEdit
 * @property {boolean} substituteRegex
 * @property {number | null} minDepth
 * @property {number | null} maxDepth
 */

/**
 * 创建一个酒馆正则脚本对象。
 * 注意：字段顺序刻意与历史产物保持一致，保证 dist JSON 可与旧版本逐字节比对。
 * @param {object} params
 * @param {string} params.scriptName 酒馆中显示的脚本名
 * @param {string} params.findRegex 触发正则（酒馆语义的字符串形式）
 * @param {string} params.replaceString 替换内容
 * @param {number[]} params.placement 酒馆 placement 位掩码（1=用户输入, 2=AI输出）
 * @param {string} [params.id] 不传则生成新 UUID
 * @returns {TavernRegexScript}
 */
export function createRegexScript({ scriptName, findRegex, replaceString, placement, id = randomUUID() }) {
  return {
    id,
    scriptName,
    findRegex,
    replaceString,
    trimStrings: [],
    placement,
    disabled: false,
    markdownOnly: true, // 仅在 Markdown 渲染阶段生效 —— 酒馆助手据此把代码块渲染为沙箱 iframe
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: false,
    minDepth: null,
    maxDepth: null,
  };
}

/**
 * 酒馆助手约定：HTML 包裹在 Markdown 代码块中时会被自动渲染为沙箱 iframe。
 * 前导换行是必须的 —— 确保代码块起始符独占一行。
 * @param {string} html
 * @returns {string}
 */
export function wrapHtmlAsCodeBlock(html) {
  return '\n```\n' + html + '\n```';
}
