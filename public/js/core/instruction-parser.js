import {
  isKnownKey,
  coerceValue,
  resolveAlias,
  normalizeStructuredVariableUpdate,
  normalizeRelationshipInstruction
} from '../data/var-schema.js';
import {
  sanitizeNarrativeDisplayText,
  sanitizeNarrativePartialText
} from './narrative-artifact.js';
import {
  extractImageContract as extractVisualImageContract,
  stripImageContracts as stripVisualImageContracts
} from './image-studio/contracts.js';
import { normalizeCombatState } from '../data/instruction-contract.js';

function sanitizeInstructionData(value, depth = 0) {
  if (depth > 24) return null;
  if (typeof value === 'string') return sanitizeNarrativeDisplayText(value);
  if (Array.isArray(value)) return value.map(item => sanitizeInstructionData(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      sanitizeInstructionData(item, depth + 1)
    ]));
  }
  return value;
}

export class InstructionParser {
  parse(text) {
    if (!text) {
      return {
        variables: [],
        combat: null, combats: [],
        mission: null, missions: [],
        relationship: null, relationships: [],
        event: null, events: [],
        memory: null, memories: []
      };
    }
    const combats = this.extractCombatStates(text);
    const missions = this.extractMissionUpdates(text);
    const relationships = this.extractRelationshipChanges(text);
    const events = this.extractEventTriggers(text);
    const memories = this.extractMemoryUpdates(text);
    return sanitizeInstructionData({
      variables: this.extractVarUpdates(text),
      combat: combats[0] || null, combats,
      mission: missions[0] || null, missions,
      relationship: relationships[0] || null, relationships,
      event: events[0] || null, events,
      memory: memories[0] || null, memories
    });
  }

  extractVarUpdates(text) {
    const updates = [];

    const varRegex = /<var>([\s\S]*?)<\/var>/g;
    let match;
    while ((match = varRegex.exec(text)) !== null) {
      const block = match[1].trim();
      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^(.+?)\s*([=+\-])\s*(.+)$/);
        if (!m) {
          console.warn('[InstructionParser] 无法解析变量行:', trimmed);
          continue;
        }
        const [, rawKey, op, rawValue] = m;
        const key = resolveAlias(rawKey);
        if (!isKnownKey(key)) {
          console.warn('[InstructionParser] 未知变量，跳过:', rawKey, '(resolved:', key, ')');
          continue;
        }
        updates.push({ key, op, value: coerceValue(key, rawValue.trim()) });
      }
    }

    const variableRegex = /<variable>([\s\S]*?)<\/variable>/g;
    while ((match = variableRegex.exec(text)) !== null) {
      try {
        let content = match[1].trim();
        // Robustly extract all JSON objects using brace matching
        let jsonBlocks = [];
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        let startIdx = -1;
        for (let i = 0; i < content.length; i++) {
          const char = content[i];
          if (escapeNext) { escapeNext = false; continue; }
          if (char === '\\') { escapeNext = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (!inString) {
            if (char === '{') {
              if (braceCount === 0) startIdx = i;
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0 && startIdx !== -1) {
                jsonBlocks.push(content.substring(startIdx, i + 1));
                startIdx = -1;
              }
            }
          }
        }
        if (jsonBlocks.length === 0) jsonBlocks = [content];
        
        for (const jsonStr of jsonBlocks) {
          if (!jsonStr.trim()) continue;
          try {
            const data = JSON.parse(jsonStr.trim());
            
            // Format A: The old {"updates": [...]} format
            if (data.updates && Array.isArray(data.updates)) {
              for (const u of data.updates) this._pushParsedVariableUpdate(updates, u);
            } 
            // Format B: The new single object format: {"path":"...", "op":"...", "value":...}
            else {
              this._pushParsedVariableUpdate(updates, data);
            }
          } catch (innerE) {
            console.warn('[InstructionParser] 单个变量JSON解析错误:', innerE);
          }
        }
      } catch (e) {
        console.warn('[InstructionParser] 变量提取过程出错:', e);
      }
    }

    return updates;
  }

  _pushParsedVariableUpdate(updates, raw) {
    if (!raw || typeof raw !== 'object') return;
    if (raw.key && raw.op && ['=', '+', '-'].includes(raw.op)) {
      const key = resolveAlias(raw.key);
      if (!isKnownKey(key)) {
        console.warn('[InstructionParser] 未知变量，跳过:', raw.key, '(resolved:', key, ')');
        return;
      }
      updates.push({ key, op: raw.op, value: coerceValue(key, raw.value) });
      return;
    }
    const normalized = normalizeStructuredVariableUpdate(raw);
    if (normalized?.key && ['=', '+', '-'].includes(normalized.op)) {
      const key = resolveAlias(normalized.key);
      if (!isKnownKey(key)) {
        console.warn('[InstructionParser] 未知变量，跳过:', normalized.key, '(resolved:', key, ')');
        return;
      }
      updates.push({
        key,
        op: normalized.op,
        value: coerceValue(key, normalized.value)
      });
      return;
    }
    if (normalized?.path && normalized?.op && ['set', 'add', 'sub', 'assign', 'push', 'remove'].includes(normalized.op)) {
      updates.push(normalized);
    }
  }

  extractCombatState(text) {
    return this.extractCombatStates(text)[0] || null;
  }

  extractCombatStates(text) {
    const states = [];
    const regex = /<combat\s+state="(\w+)">([\s\S]*?)<\/combat>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      try { states.push({ state: normalizeCombatState(match[1]), ...JSON.parse(match[2].trim()) }); }
      catch (e) { console.warn('[InstructionParser] 战斗解析错误:', e); }
    }
    return states;
  }

  extractMissionUpdate(text) { return this.extractMissionUpdates(text)[0] || null; }

  extractMissionUpdates(text) { return this.extractJsonTags(text, 'mission', '任务'); }

  extractRelationshipChange(text) { return this.extractRelationshipChanges(text)[0] || null; }

  extractRelationshipChanges(text) {
    return this.extractJsonTags(text, 'relationship', '关系')
      .map(value => normalizeRelationshipInstruction(value))
      .filter(Boolean);
  }

  extractEventTrigger(text) { return this.extractEventTriggers(text)[0] || null; }

  extractEventTriggers(text) { return this.extractJsonTags(text, 'event', '事件'); }

  extractMemoryUpdate(text) { return this.extractMemoryUpdates(text)[0] || null; }

  extractMemoryUpdates(text) { return this.extractJsonTags(text, 'memory', '记忆'); }

  /**
   * 提取最终叙事模型附带的隐藏绘图契约。契约的完整校验由
   * image-studio 域负责；解析器只负责确保它不会进入正文或存档文本。
   */
  extractImageContract(text) {
    if (!text) return { contract: null, raw: null, error: null };
    const result = extractVisualImageContract(text);
    return { contract: result.contract, raw: result.rawContract, error: result.error };
  }

  stripImageContracts(text, { streaming = false } = {}) {
    return stripVisualImageContracts(text, { streaming });
  }

  extractJsonTags(text, tagName, label) {
    const values = [];
    const regex = new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const open = `<${tagName}>`;
      const close = `</${tagName}>`;
      const raw = match[0].slice(open.length, -close.length).trim();
      // Try parsing as single JSON first
      try {
        values.push(JSON.parse(raw));
        continue;
      } catch { /* fall through to multi-object recovery */ }

      // Recovery: AI sometimes puts multiple JSON objects in one tag
      // or adds trailing text after the JSON
      const jsonObjects = this._extractJsonObjects(raw);
      if (jsonObjects) {
        for (const jsonStr of jsonObjects) {
          try {
            values.push(JSON.parse(jsonStr));
          } catch (e2) {
            console.warn(`[InstructionParser] ${label} 子对象解析错误:`, e2.message);
          }
        }
      } else {
        console.warn(`[InstructionParser] ${label} 解析错误: 无法从内容中提取JSON`);
      }
    }
    return values;
  }

  cleanupResponse(text) {
    if (!text) return '';
    return sanitizeNarrativeDisplayText(this.stripImageContracts(text))
      .replace(/极其|共犯/g, '')
      .trim();
  }

  extractThinkContent(text, preferredTags = []) {
    if (!text) return '';

    const extractFirst = tags => {
      const seen = new Set();
      for (const value of tags) {
        const tag = String(value || '').trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(text).match(new RegExp(
          `<\\s*${escaped}(?=[\\s>])[^>]*>([\\s\\S]*?)<\\s*\\/\\s*${escaped}\\s*>`,
          'i'
        ));
        if (match) return { matched: true, content: match[1].trim() };
      }
      return { matched: false, content: '' };
    };

    const preferred = extractFirst(Array.isArray(preferredTags) ? preferredTags : []);
    if (preferred.matched) return preferred.content;

    const legacy = extractFirst([
      'think',
      'thinking',
      'reasoning',
      '思维链',
      'anthropic_thinking',
      'anthropic_think',
      'deepseek_thinking',
      'analysis'
    ]);
    if (legacy.matched) return legacy.content;

    let think = '';
    if (text.includes('[回映结束]')) {
      const parts = text.split('[回映结束]');
      if (parts.length > 1) think = parts[0].trim();
    }
    return think;
  }

  extractVarThinkContent(text) {
    if (!text) return '';
    const m = text.match(/<var(?:iable)?_thinking>([\s\S]*?)<\/var(?:iable)?_thinking>/i);
    return m ? m[1].trim() : '';
  }

  cleanupPartialResponse(text) {
    if (!text) return '';
    return sanitizeNarrativePartialText(this.stripImageContracts(text, { streaming: true }))
      .replace(/极其|共犯/g, '')
      .trim();
  }

  hasStatusQuery(text) {
    return text ? /<status_query\s*\/>/.test(text) : false;
  }

  _extractJsonObjects(str) {
    const results = [];
    let depth = 0, start = -1;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (str[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          results.push(str.slice(start, i + 1));
          start = -1;
        } else if (depth < 0) depth = 0;
      }
    }
    return results.length ? results : null;
  }
}

export const instructionParser = new InstructionParser();
export default instructionParser;
