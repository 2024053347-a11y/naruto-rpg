import { publishPromptTrace } from './prompt-trace.js';

const TRUNCATED_FINISH_REASONS = new Set([
  'length',
  'max_tokens',
  'max_output_tokens',
  'token_limit'
]);

const SUCCESS_FINISH_REASONS = new Set([
  'stop',
  'end_turn',
  'stop_sequence',
  'complete',
  'completed'
]);

export const NPC_SUMMARY_POLICIES = Object.freeze({
  stage: Object.freeze({
    kind: 'stage',
    maxTokens: 4096,
    retryMaxTokens: 8192,
    minChars: 80
  }),
  grand: Object.freeze({
    kind: 'grand',
    maxTokens: 8192,
    retryMaxTokens: 12288,
    minChars: 160
  })
});

function normalizeFinishReason(reason) {
  return typeof reason === 'string' ? reason.trim().toLowerCase() : '';
}

function hasCompleteSentenceEnding(text) {
  return /[。！？.!?…](?:["'”’」』】）》）\]])*$/.test(text);
}

export function inspectNpcSummaryCompletion(text, policy, finishReason = null) {
  const content = typeof text === 'string' ? text.trim() : '';
  const normalizedReason = normalizeFinishReason(finishReason);

  if (!content) return { complete: false, reason: 'empty' };
  if (TRUNCATED_FINISH_REASONS.has(normalizedReason)) {
    return { complete: false, reason: 'token-limit' };
  }
  if (normalizedReason && !SUCCESS_FINISH_REASONS.has(normalizedReason)) {
    return { complete: false, reason: `finish-${normalizedReason}` };
  }

  const characterCount = content.replace(/\s/g, '').length;
  if (characterCount < policy.minChars) {
    return { complete: false, reason: 'too-short', characterCount };
  }
  if (!hasCompleteSentenceEnding(content)) {
    return { complete: false, reason: 'unfinished-sentence', characterCount };
  }
  return { complete: true, reason: 'complete', characterCount };
}

function normalizeDetailedResponse(response) {
  if (typeof response === 'string') {
    return { text: response, finishReason: null, usage: null };
  }
  return {
    text: typeof response?.text === 'string' ? response.text : '',
    finishReason: response?.finishReason ?? null,
    usage: response?.usage ?? null
  };
}

export async function requestCompleteNpcSummary(client, messages, policy, options = {}) {
  let lastInspection = { complete: false, reason: 'empty' };
  let lastResponse = { text: '', finishReason: null, usage: null };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const requestMessages = messages.map(message => ({ ...message }));
    if (attempt === 2) {
      const retryInstruction = '上次输出不完整。请重新从头生成完整摘要，严格达到要求的字数，并以完整句子结束；不要续写半句话，也不要添加标签或解释。';
      let lastUserIndex = -1;
      for (let index = requestMessages.length - 1; index >= 0; index--) {
        if (requestMessages[index].role === 'user') {
          lastUserIndex = index;
          break;
        }
      }
      if (lastUserIndex >= 0) {
        const originalContent = requestMessages[lastUserIndex].content;
        requestMessages[lastUserIndex].content = `${typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent)}\n\n${retryInstruction}`;
      } else {
        requestMessages.push({ role: 'user', content: retryInstruction });
      }
    }
    const requestOptions = {
      ...options,
      temperature: options.temperature ?? 0.3,
      max_tokens: attempt === 1 ? policy.maxTokens : policy.retryMaxTokens
    };

    publishPromptTrace({
      kind: 'npc-summary',
      title: `NPC关系${policy.kind === 'grand' ? '总' : '阶段'}摘要请求${attempt > 1 ? '（重试）' : ''}`,
      model: client.getConfig?.()?.model || '',
      generationOptions: requestOptions,
      details: { summaryKind: policy.kind, attempt },
      messages: requestMessages,
      messageSources: requestMessages.map((_, index) => ({
        source: 'NPC关系记忆',
        label: `${policy.kind}#${attempt}.${index + 1}`
      }))
    });

    const rawResponse = typeof client.chatDetailed === 'function'
      ? await client.chatDetailed(requestMessages, requestOptions)
      : await client.chat(requestMessages, requestOptions);
    lastResponse = normalizeDetailedResponse(rawResponse);
    lastInspection = inspectNpcSummaryCompletion(
      lastResponse.text,
      policy,
      lastResponse.finishReason
    );

    if (lastInspection.complete) {
      return {
        text: lastResponse.text.trim(),
        finishReason: lastResponse.finishReason,
        usage: lastResponse.usage,
        attempts: attempt,
        reason: 'complete'
      };
    }
  }

  return {
    text: null,
    finishReason: lastResponse.finishReason,
    usage: lastResponse.usage,
    attempts: 2,
    reason: lastInspection.reason
  };
}

export function findRecoverableNpcSummary(summaries, history) {
  if (!Array.isArray(summaries) || !Array.isArray(history)) return null;

  for (let index = 0; index < summaries.length; index++) {
    const summary = summaries[index];
    if (inspectNpcSummaryCompletion(summary?.content, NPC_SUMMARY_POLICIES.stage).complete) continue;

    const coveredTurns = Array.isArray(summary?.covered_turns)
      ? summary.covered_turns.map(turn => String(turn))
      : [];
    if (!coveredTurns.length) continue;

    const coveredSet = new Set(coveredTurns);
    const historyEntries = history.filter(entry => (
      entry && coveredSet.has(String(entry.turn)) && typeof entry.summary === 'string' && entry.summary.trim()
    ));
    const foundTurns = new Set(historyEntries.map(entry => String(entry.turn)));
    if (coveredTurns.every(turn => foundTurns.has(turn))) {
      return { index, summary, historyEntries };
    }
  }

  return null;
}
