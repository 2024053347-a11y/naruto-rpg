import { isKnownKey, coerceValue, resolveAlias } from '../data/var-schema.js';

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
    return {
      variables: this.extractVarUpdates(text),
      combat: combats[0] || null, combats,
      mission: missions[0] || null, missions,
      relationship: relationships[0] || null, relationships,
      event: events[0] || null, events,
      memory: memories[0] || null, memories
    };
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
              for (const u of data.updates) {
                if (u.key && u.op && ['=', '+', '-'].includes(u.op)) {
                  if (!isKnownKey(u.key)) {
                    console.warn('[InstructionParser] 未知变量，跳过:', u.key);
                    continue;
                  }
                  updates.push({ key: u.key, op: u.op, value: coerceValue(u.key, u.value) });
                } else if (u.path && u.op && ['set','add','sub','assign','push','remove'].includes(u.op)) {
                  updates.push(u);
                }
              }
            } 
            // Format B: The new single object format: {"path":"...", "op":"...", "value":...}
            else {
              const u = data;
              if (u.key && u.op && ['=', '+', '-'].includes(u.op)) {
                if (!isKnownKey(u.key)) {
                  console.warn('[InstructionParser] 未知变量，跳过:', u.key);
                  continue;
                }
                updates.push({ key: u.key, op: u.op, value: coerceValue(u.key, u.value) });
              } else if (u.path && u.op && ['set','add','sub','assign','push','remove'].includes(u.op)) {
                updates.push(u);
              }
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

  extractCombatState(text) {
    return this.extractCombatStates(text)[0] || null;
  }

  extractCombatStates(text) {
    const states = [];
    const regex = /<combat\s+state="(\w+)">([\s\S]*?)<\/combat>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      try { states.push({ state: match[1], ...JSON.parse(match[2].trim()) }); }
      catch (e) { console.warn('[InstructionParser] 战斗解析错误:', e); }
    }
    return states;
  }

  extractMissionUpdate(text) { return this.extractMissionUpdates(text)[0] || null; }

  extractMissionUpdates(text) { return this.extractJsonTags(text, 'mission', '任务'); }

  extractRelationshipChange(text) { return this.extractRelationshipChanges(text)[0] || null; }

  extractRelationshipChanges(text) { return this.extractJsonTags(text, 'relationship', '关系'); }

  extractEventTrigger(text) { return this.extractEventTriggers(text)[0] || null; }

  extractEventTriggers(text) { return this.extractJsonTags(text, 'event', '事件'); }

  extractMemoryUpdate(text) { return this.extractMemoryUpdates(text)[0] || null; }

  extractMemoryUpdates(text) { return this.extractJsonTags(text, 'memory', '记忆'); }

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
    if (!/<think(?:ing|)?\s*>/i.test(text) && text.includes('[回映结束]')) {
      const parts = text.split('[回映结束]');
      text = parts.slice(1).join('[回映结束]');
    }
    return text
      .replace(/极其|共犯/g, '')
      .replace(/<var>[\s\S]*?<\/var>/g, '')
      .replace(/<variable>[\s\S]*?<\/variable>/g, '')
      .replace(/<combat[^>]*>[\s\S]*?<\/combat>/g, '')
      .replace(/<mission>[\s\S]*?<\/mission>/g, '')
      .replace(/<relationship>[\s\S]*?<\/relationship>/g, '')
      .replace(/<event>[\s\S]*?<\/event>/g, '')
      .replace(/<memory>[\s\S]*?<\/memory>/g, '')
      .replace(/<status_query\s*\/>/g, '')
      .replace(/<recall\s+[^>]*\/>/g, '')
      .replace(/<system_info>[\s\S]*?<\/system_info>/g, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
      .replace(/<思维链>[\s\S]*?<\/思维链>/gi, '')
      // Modern model thinking tags (DeepSeek R1, Claude extended thinking, etc.)
      .replace(/<anthropic_thinking>[\s\S]*?<\/anthropic_thinking>/gi, '')
      .replace(/<anthropic_think>[\s\S]*?<\/anthropic_think>/gi, '')
      .replace(/<deepseek_thinking>[\s\S]*?<\/deepseek_thinking>/gi, '')
      .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
      .replace(/<([a-zA-Z][\w.\-~]*)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/g, '$2')
      .replace(/<\/?[a-zA-Z][\w.\-~]*(?:\s+[^>]*)?>/g, '')
      .trim();
  }

  extractThinkContent(text) {
    if (!text) return '';
    let think = '';
    for (const tag of ['think', 'thinking', 'reasoning', '思维链', 'anthropic_thinking', 'anthropic_think', 'deepseek_thinking', 'analysis']) {
      const m = text.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'i'));
      if (m) { think = m[0].replace(new RegExp(`</?${tag}>`, 'gi'), '').trim(); break; }
    }
    if (!think && text.includes('[回映结束]')) {
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
    return text
      .replace(/极其|共犯/g, '')
      .replace(/<var>[\s\S]*?(?:<\/var>|$)/g, '')
      .replace(/<variable>[\s\S]*?(?:<\/variable>|$)/g, '')
      .replace(/<combat[^>]*>[\s\S]*?(?:<\/combat>|$)/g, '')
      .replace(/<mission>[\s\S]*?(?:<\/mission>|$)/g, '')
      .replace(/<relationship>[\s\S]*?(?:<\/relationship>|$)/g, '')
      .replace(/<event>[\s\S]*?(?:<\/event>|$)/g, '')
      .replace(/<memory>[\s\S]*?(?:<\/memory>|$)/g, '')
      .replace(/<status_query\s*\/?\s*>?/g, '')
      .replace(/<recall\s+[^>]*\/?\s*>?/g, '')
      .replace(/<system_info>[\s\S]*?(?:<\/system_info>|$)/g, '')
      .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
      .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, '')
      .replace(/<reasoning>[\s\S]*?(?:<\/reasoning>|$)/gi, '')
      .replace(/<思维链>[\s\S]*?(?:<\/思维链>|$)/gi, '')
      .replace(/<anthropic_thinking>[\s\S]*?(?:<\/anthropic_thinking>|$)/gi, '')
      .replace(/<anthropic_think>[\s\S]*?(?:<\/anthropic_think>|$)/gi, '')
      .replace(/<deepseek_thinking>[\s\S]*?(?:<\/deepseek_thinking>|$)/gi, '')
      .replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '')
      .replace(/<([a-zA-Z][\w.\-~]*)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/g, '')
      .replace(/<\/?[a-zA-Z][\w.\-~]*(?:\s+[^>]*)?>/g, '')
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
