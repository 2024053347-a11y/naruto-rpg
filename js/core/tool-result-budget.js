export const DEFAULT_TOOL_RESULT_MAX_CHARS = 8_000;
export const DEFAULT_TOOL_RESULT_TOTAL_CHARS = 16_000;

const MAX_CONFIGURED_CHARS = 200_000;

function boundedInteger(value, fallback, minimum = 128) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_CONFIGURED_CHARS, Math.max(minimum, parsed));
}

function serialize(value) {
  try {
    const result = JSON.stringify(value);
    return result === undefined ? 'null' : result;
  } catch {
    return JSON.stringify({ error: 'tool_result_not_serializable' });
  }
}

function fitTruncationReceipt({ serialized, tool, allowed }) {
  const base = {
    truncated: true,
    reason: 'tool_result_budget',
    originalChars: serialized.length,
    ...(tool ? { tool: String(tool).slice(0, 100) } : {})
  };
  const compactCandidates = [
    base,
    { truncated: true, reason: 'tool_result_budget' },
    { truncated: true }
  ];
  for (const candidate of compactCandidates) {
    if (serialize(candidate).length <= allowed) {
      if (candidate !== base) return candidate;
      let low = 0;
      let high = serialized.length;
      let best = candidate;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const receipt = { ...base, preview: serialized.slice(0, middle) };
        if (serialize(receipt).length <= allowed) {
          best = receipt;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      return best;
    }
  }
  return null;
}

export function createToolResultBudget(options = {}) {
  const perResultMax = boundedInteger(
    options.toolResultMaxChars,
    DEFAULT_TOOL_RESULT_MAX_CHARS
  );
  const totalMax = boundedInteger(
    options.toolResultTotalChars,
    DEFAULT_TOOL_RESULT_TOTAL_CHARS
  );
  const maxCalls = Math.min(100, Math.max(1, Math.trunc(Number(options.maxSteps) || 8)));
  let usedChars = 0;
  let calls = 0;

  return Object.freeze({
    get usedChars() { return usedChars; },
    get remainingChars() { return Math.max(0, totalMax - usedChars); },
    limit(value, { tool = '' } = {}) {
      calls += 1;
      const serialized = serialize(value);
      const remaining = Math.max(0, totalMax - usedChars);
      const remainingCalls = Math.max(1, maxCalls - calls + 1);
      const receiptFloor = serialize({ truncated: true, reason: 'tool_result_budget' }).length;
      const reservedForLater = Math.min(
        remaining,
        Math.max(0, remainingCalls - 1) * receiptFloor
      );
      const allowed = Math.min(perResultMax, Math.max(0, remaining - reservedForLater));
      if (serialized.length <= allowed) {
        usedChars += serialized.length;
        return value;
      }

      const receipt = fitTruncationReceipt({ serialized, tool, allowed });
      const receiptChars = serialize(receipt).length;
      if (receiptChars > remaining) return null;
      usedChars += receiptChars;
      return receipt;
    }
  });
}

export default createToolResultBudget;
