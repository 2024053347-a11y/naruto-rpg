#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonRoot = path.join(root, 'canon-rebuild-output', 'data', 'canon', 'techniques');
const excerptFile = path.join(canonRoot, 'shards', 'full', '_all_summaries_utf8.txt');
const cacheDir = path.join(root, '.codex-tmp');
const cacheFile = path.join(cacheDir, 'canon-technique-description-backtranslations.json');
const reportFile = path.join(root, 'reports', 'technique-description-audit.json');
const translate = process.argv.includes('--translate');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = readJson(path.join(canonRoot, 'manifest.json'));
const records = manifest.shards.flatMap(shard => {
  const body = readJson(path.join(canonRoot, shard.path));
  return (body.records || []).map(record => ({ ...record, shard: shard.path }));
});

const excerpts = new Map();
for (const line of fs.readFileSync(excerptFile, 'utf16le').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const parts = line.split('|').map(part => part.trim());
  if (/^JT-[A-Z]+-\d+$/.test(parts[1] || '')) {
    excerpts.set(parts[1], parts.slice(3).join('|').trim());
  }
}

const auditedRecords = records.filter(record => excerpts.has(record.id));
if (auditedRecords.length !== excerpts.size) {
  throw new Error(`Matched ${auditedRecords.length}/${excerpts.size} saved source excerpts to canonical records`);
}

const stopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can',
  'do', 'does', 'for', 'from', 'has', 'have', 'he', 'her', 'his', 'if', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'one', 'or', 'that', 'the', 'their', 'them', 'they',
  'this', 'those', 'through', 'to', 'up', 'use', 'used', 'user', 'users', 'using',
  'was', 'when', 'which', 'while', 'with', 'would', 'technique', 'jutsu'
]);

function stem(word) {
  return word
    .replace(/(?:ingly|edly|ation|ations|ments|ment|ness)$/u, '')
    .replace(/(?:ing|ed|es|s)$/u, '');
}

function tokens(value) {
  return (String(value).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
    .map(stem)
    .filter(token => token.length > 2 && !stopWords.has(token));
}

function dice(left, right) {
  const a = new Map();
  const b = new Map();
  for (const token of tokens(left)) a.set(token, (a.get(token) || 0) + 1);
  for (const token of tokens(right)) b.set(token, (b.get(token) || 0) + 1);
  const sizeA = [...a.values()].reduce((sum, count) => sum + count, 0);
  const sizeB = [...b.values()].reduce((sum, count) => sum + count, 0);
  if (!sizeA || !sizeB) return 0;
  let overlap = 0;
  for (const [token, count] of a) overlap += Math.min(count, b.get(token) || 0);
  return (2 * overlap) / (sizeA + sizeB);
}

async function translateToEnglish(text) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'zh-CN',
    tl: 'en',
    dt: 't',
    q: text
  });
  const url = `https://translate.googleapis.com/translate_a/single?${params}`;
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'naruto-rpg-technique-audit/1.0' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      return (body[0] || []).map(part => part?.[0] || '').join('').trim();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

fs.mkdirSync(cacheDir, { recursive: true });
const cache = fs.existsSync(cacheFile) ? readJson(cacheFile) : {};

if (translate) {
  const pending = auditedRecords.filter(record => !Object.hasOwn(cache, record.id));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, pending.length) }, async () => {
    while (cursor < pending.length) {
      const record = pending[cursor];
      cursor += 1;
      cache[record.id] = await translateToEnglish(String(record.effect?.summary || ''));
      if (cursor % 25 === 0 || cursor === pending.length) {
        fs.writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
        process.stdout.write(`\rBack-translated ${cursor}/${pending.length}`);
      }
    }
  });
  await Promise.all(workers);
  fs.writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
  if (pending.length) process.stdout.write('\n');
}

const missing = auditedRecords.filter(record => !Object.hasOwn(cache, record.id));
if (missing.length) {
  throw new Error(`${missing.length} back-translations missing; rerun with --translate`);
}

const rows = auditedRecords.map(record => {
  const source = excerpts.get(record.id) || '';
  const backTranslation = cache[record.id] || '';
  return {
    id: record.id,
    shard: record.shard,
    name: record.canonical_name,
    english_name: record.lookup_aliases?.[0] || record.aliases?.[0] || '',
    score: Number(dice(source, backTranslation).toFixed(4)),
    source_excerpt: source,
    current_summary: record.effect?.summary || '',
    back_translation: backTranslation
  };
}).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));

const thresholds = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 1];
const histogram = thresholds.slice(0, -1).map((minimum, index) => ({
  minimum,
  maximum: thresholds[index + 1],
  count: rows.filter(row => row.score >= minimum && row.score < thresholds[index + 1]).length
}));
const byGroup = Object.fromEntries([...new Set(rows.map(row => row.id.split('-')[1]))]
  .sort()
  .map(group => {
    const groupRows = rows.filter(row => row.id.split('-')[1] === group);
    return [group, {
      total: groupRows.length,
      below_0_1: groupRows.filter(row => row.score < 0.1).length,
      below_0_2: groupRows.filter(row => row.score < 0.2).length,
      average: Number((groupRows.reduce((sum, row) => sum + row.score, 0) / groupRows.length).toFixed(4))
    }];
  }));

const report = {
  generated_at: new Date().toISOString(),
  method: 'Dice overlap between saved authoritative English lead excerpt and English back-translation of the current Chinese summary.',
  records: rows.length,
  histogram,
  by_group: byGroup,
  rows
};

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ records: rows.length, histogram, by_group: byGroup }, null, 2));
