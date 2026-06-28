export class InstructionParser {
  parse(text) {
    if (!text) {
      return {
        variables: [],
        combat: null,
        combats: [],
        mission: null,
        missions: [],
        relationship: null,
        relationships: [],
        event: null,
        events: [],
        memory: null,
        memories: []
      };
    }

    const combats = this.extractCombatStates(text);
    const missions = this.extractMissionUpdates(text);
    const relationships = this.extractRelationshipChanges(text);
    const events = this.extractEventTriggers(text);
    const memories = this.extractMemoryUpdates(text);

    return {
      variables: this.extractVariableUpdates(text),
      combat: combats[0] || null,
      combats,
      mission: missions[0] || null,
      missions,
      relationship: relationships[0] || null,
      relationships,
      event: events[0] || null,
      events,
      memory: memories[0] || null,
      memories
    };
  }

  static _rescueTruncatedJSON(raw) {
    if (!raw || typeof raw !== 'string') return null;

    let s = raw.trim();
    let depth = 0, inStr = false, esc = false;
    for (const c of s) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') depth++;
      if (c === '}' || c === ']') depth--;
    }

    const startsObj = s.startsWith('{') || s.startsWith('[');
    if (!startsObj) return null;
    if (depth <= 0) return null;

    let rescued = s;
    while (depth > 0) {
      const lastChar = rescued[rescued.length - 1];
      if (inStr) {
        rescued += '"';
        inStr = false;
      } else if (lastChar !== '"' && lastChar !== '}' && lastChar !== ']' && lastChar !== ':' && lastChar !== ',') {
        rescued += '"';
        depth--;
      } else {
        rescued += rescued.startsWith('{') ? '}' : ']';
        depth--;
      }
    }
    if (rescued.startsWith('{') && !rescued.endsWith('}')) rescued += '}';
    if (rescued.startsWith('[') && !rescued.endsWith(']')) rescued += ']';
    return rescued;
  }

  extractVariableUpdates(text) {
    const updates = [];
    const VALID_OPS = new Set(['set', 'add', 'sub', 'assign', 'push', 'remove']);
    const regex = /<variable>([\s\S]*?)<\/variable>/g;
    let match;
    let raw = '';
    while ((match = regex.exec(text)) !== null) {
      try {
        raw = match[1].trim();
        const data = JSON.parse(raw);
        const candidates = Array.isArray(data.updates) ? data.updates : Array.isArray(data) ? data : data.path && data.op ? [data] : [];
        for (const item of candidates) {
          if (!item || typeof item !== 'object') {
            console.warn('[InstructionParser] Variable skipped: not an object', item);
            continue;
          }
          if (!item.path || typeof item.path !== 'string') {
            console.warn('[InstructionParser] Variable skipped: missing/invalid path', item);
            continue;
          }
          if (!VALID_OPS.has(item.op)) {
            console.warn('[InstructionParser] Variable skipped: unknown op', { path: item.path, op: item.op });
            continue;
          }
          updates.push(item);
        }
      } catch (e) {
        const rescued = InstructionParser._rescueTruncatedJSON(raw);
        if (rescued) {
          try {
            const data = JSON.parse(rescued);
            const candidates = Array.isArray(data.updates) ? data.updates : Array.isArray(data) ? data : data.path && data.op ? [data] : [];
            for (const item of candidates) {
              if (item && typeof item === 'object' && item.path && typeof item.path === 'string' && VALID_OPS.has(item.op)) {
                updates.push(item);
              }
            }
            console.warn('[InstructionParser] Truncated variable rescued:', rescued.length, 'chars');
          } catch { /* rescue attempt failed */ }
        }
        console.warn('[InstructionParser] Variable parse error:', e.message, raw?.slice(-40));
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
      try {
        states.push({ state: match[1], ...JSON.parse(match[2].trim()) });
      } catch (e) {
        console.warn('[InstructionParser] Combat parse error:', e);
      }
    }
    return states;
  }

  extractMissionUpdate(text) {
    return this.extractMissionUpdates(text)[0] || null;
  }

  extractMissionUpdates(text) {
    return this.extractJsonTags(text, 'mission', 'Mission');
  }

  extractRelationshipChange(text) {
    return this.extractRelationshipChanges(text)[0] || null;
  }

  extractRelationshipChanges(text) {
    return this.extractJsonTags(text, 'relationship', 'Relationship');
  }

  extractEventTrigger(text) {
    return this.extractEventTriggers(text)[0] || null;
  }

  extractEventTriggers(text) {
    return this.extractJsonTags(text, 'event', 'Event');
  }

  extractMemoryUpdate(text) {
    return this.extractMemoryUpdates(text)[0] || null;
  }

  extractMemoryUpdates(text) {
    return this.extractJsonTags(text, 'memory', 'Memory');
  }

  extractJsonTags(text, tagName, label = tagName) {
    const values = [];
    const regex = new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const open = `<${tagName}>`;
      const close = `</${tagName}>`;
      const raw = match[0].slice(open.length, -close.length).trim();
      try {
        values.push(JSON.parse(raw));
      } catch (e) {
        console.warn(`[InstructionParser] ${label} parse error:`, e);
      }
    }
    return values;
  }

  extractAllXMLTags(text) {
    const tags = [];
    const regex = /<(\w+)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      tags.push({ tag: match[1], content: match[2].trim() });
    }
    const selfClosing = /<(\w+)\s*\/>/g;
    while ((match = selfClosing.exec(text)) !== null) {
      tags.push({ tag: match[1], content: null, selfClosing: true });
    }
    return tags;
  }

  cleanupResponse(text) {
    if (!text) return '';
    
    // Fallback: remove everything before [回映结束] if thinking tags are missing
    if (!/<think(?:ing|)?\s*>/i.test(text) && text.includes('[回映结束]')) {
      const parts = text.split('[回映结束]');
      text = parts.slice(1).join('[回映结束]');
    }

    return text
      .replace(/极其|共犯/g, '')
      .replace(/<variable>[\s\S]*?<\/variable>/g, '')
      .replace(/<combat[^>]*>[\s\S]*?<\/combat>/g, '')
      .replace(/<mission>[\s\S]*?<\/mission>/g, '')
      .replace(/<relationship>[\s\S]*?<\/relationship>/g, '')
      .replace(/<event>[\s\S]*?<\/event>/g, '')
      .replace(/<memory>[\s\S]*?<\/memory>/g, '')
      .replace(/<status_query\s*\/>/g, '')
      .replace(/<system_info>[\s\S]*?<\/system_info>/g, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
      .replace(/<思维链>[\s\S]*?<\/思维链>/gi, '')
      .replace(/<([a-zA-Z][\w.\-~]*)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/g, '')
      .replace(/<\/?[a-zA-Z][\w.\-~]*(?:\s+[^>]*)?>/g, '')
      .trim();
  }

  extractThinkContent(text) {
    if (!text) return '';
    let think = '';
    for (const tag of ['think', 'thinking', 'reasoning', '思维链']) {
      const m = text.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'i'));
      if (m) { think = m[0].replace(new RegExp(`</?${tag}>`, 'gi'), '').trim(); break; }
    }
    
    if (!think && text.includes('[回映结束]')) {
      const parts = text.split('[回映结束]');
      if (parts.length > 1) {
        think = parts[0].trim();
      }
    }
    return think;
  }

  extractVarThinkContent(text) {
    if (!text) return '';
    const m = text.match(/<variable_thinking>([\s\S]*?)<\/variable_thinking>/i);
    return m ? m[1].trim() : '';
  }

  cleanupPartialResponse(text) {
    if (!text) return '';
    return text
      .replace(/极其|共犯/g, '')
      .replace(/<variable>[\s\S]*?(?:<\/variable>|$)/g, '')
      .replace(/<combat[^>]*>[\s\S]*?(?:<\/combat>|$)/g, '')
      .replace(/<mission>[\s\S]*?(?:<\/mission>|$)/g, '')
      .replace(/<relationship>[\s\S]*?(?:<\/relationship>|$)/g, '')
      .replace(/<event>[\s\S]*?(?:<\/event>|$)/g, '')
      .replace(/<memory>[\s\S]*?(?:<\/memory>|$)/g, '')
      .replace(/<status_query\s*\/?\s*>?/g, '')
      .replace(/<system_info>[\s\S]*?(?:<\/system_info>|$)/g, '')
      .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
      .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, '')
      .replace(/<reasoning>[\s\S]*?(?:<\/reasoning>|$)/gi, '')
      .replace(/<思维链>[\s\S]*?(?:<\/思维链>|$)/gi, '')
      .replace(/<([a-zA-Z][\w.\-~]*)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/g, '')
      .replace(/<\/?[a-zA-Z][\w.\-~]*(?:\s+[^>]*)?>/g, '')
      .trim();
  }

  hasStatusQuery(text) {
    return text ? /<status_query\s*\/>/.test(text) : false;
  }
}

export const instructionParser = new InstructionParser();
export default instructionParser;
