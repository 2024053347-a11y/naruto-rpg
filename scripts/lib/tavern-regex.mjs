/**
 * tavern-regex.mjs — SillyTavern「正则脚本」JSON 结构的唯一工厂
 *
 * 该结构此前在 build-regex 与 sync-to-card 中各硬编码一份，
 * 字段一旦增删极易漏改其一。现收敛为单一工厂函数。
 *
 * 注意：字段顺序即产物 JSON 的键序，是既有文件格式的一部分，请勿调整。
 */
import crypto from 'node:crypto';

/**
 * @typedef {object} TavernRegexScript
 * @property {string} id
 * @property {string} scriptName
 * @property {string} findRegex
 * @property {string} replaceString
 * @property {string[]} trimStrings
 * @property {number[]} placement 酒馆注入位置（1=用户输入, 2=AI 输出）
 * @property {boolean} disabled
 * @property {boolean} markdownOnly
 * @property {boolean} promptOnly
 * @property {boolean} runOnEdit
 * @property {boolean} substituteRegex
 * @property {number|null} minDepth
 * @property {number|null} maxDepth
 */

/**
 * 构造一条酒馆正则脚本。
 * @param {object} options
 * @param {string} options.scriptName 展示名称
 * @param {string} options.findRegex 触发正则
 * @param {string} options.replaceString 替换内容（通常是整包 HTML）
 * @param {number[]} options.placement 注入位置
 * @param {string} [options.id] 不传则生成新 UUID
 * @returns {TavernRegexScript}
 */
export function createRegexScript({ scriptName, findRegex, replaceString, placement, id }) {
  return {
    id: id ?? crypto.randomUUID(),
    scriptName,
    findRegex,
    replaceString,
    trimStrings: [],
    placement,
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: false,
    minDepth: null,
    maxDepth: null,
  };
}

/**
 * 将打包好的 HTML 包装为酒馆助手可识别的替换串：
 * Markdown 代码块包裹的 HTML，酒馆助手据此自动渲染为沙箱 iframe。
 * @param {string} htmlContent
 * @returns {string}
 */
export function wrapHtmlAsReplaceString(htmlContent) {
  return '\n```\n' + htmlContent + '\n```';
}
