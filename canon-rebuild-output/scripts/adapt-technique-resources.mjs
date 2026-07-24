import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/canon/techniques/shards/full');
const rankBase = { E: 8, D: 15, C: 28, B: 48, A: 78, S: 120, '特': 105 };
const pools = {
  chakra: { E: 50, D: 100, C: 190, B: 270, A: 415, S: 660, '特': 1550 },
  spirit: { E: 43, D: 88, C: 165, B: 230, A: 350, S: 555, '特': 1350 },
  stamina: { E: 110, D: 170, C: 245, B: 305, A: 405, S: 575, '特': 900 }
};
const powerValues = [0, 10, 35, 70, 120, 200, 300];
const text = value => String(value || '').toLowerCase();

function resourceFor(record) {
  if (record.state_type === 'genjutsu') return 'spirit';
  if (record.state_type === 'taijutsu') return 'stamina';
  return 'chakra';
}

function calculate(record) {
  const resource = resourceFor(record);
  const rank = rankBase[record.rank] ? record.rank : 'C';
  const blob = text(record.canonical_name) + ' ' + text(record.effect?.summary) + ' ' + text(record.classes?.join(' '));
  let cost = rankBase[rank];
  if (/(long|area|wide|multiple|barrier|summon|seal|space|continuous|sustained)/.test(blob)) cost += 12;
  if (/(forbidden|suicide|reaper|death|izanagi|izanami|kamui|infinite|planetary|eight gates|sage|bijuu|tailed|rinnegan)/.test(blob)) cost += 35;
  if (/(utility|support|sensory|disguise|clone|replacement|substitution|mobility)/.test(blob)) cost -= 8;
  if (record.power_mode === 'healing' || record.power_mode === 'summon' || record.power_mode === 'seal') cost += 12;
  if (record.state_type === 'taijutsu' && /(gate|lotus|night guy|daytime tiger)/.test(blob)) cost += 25;
  cost = Math.max(3, Math.min(300, Math.round(cost)));
  const pool = pools[resource][rank];
  const ratio = cost / pool;
  const pressure = ratio <= 0.1 ? 'light' : ratio <= 0.2 ? 'standard' : ratio <= 0.35 ? 'heavy' : 'extreme';
  const uses = Math.max(1, Math.floor(pool / cost));

  let power = rankBase[rank] * 2;
  if (record.power_mode === 'control' || record.power_mode === 'defense') power *= 0.8;
  if (record.power_mode === 'utility' || record.power_mode === 'mobility') power *= 0.45;
  if (/(long|area|wide|multiple)/.test(blob)) power += 35;
  if (/(forbidden|suicide|reaper|death|infinite|planetary|eight gates|bijuu|tailed)/.test(blob)) power += 70;
  const selectedPower = powerValues.reduce((best, value) => Math.abs(value - power) < Math.abs(best - power) ? value : best, powerValues[0]);
  return { resource, cost, pressure, pool, uses, power: selectedPower };
}

let changed = 0;
for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
  const full = path.join(dir, file);
  const shard = JSON.parse(fs.readFileSync(full, 'utf8'));
  for (const record of shard.records || []) {
    const value = calculate(record);
    record.cost = value.cost;
    record.power = value.power;
    record.value_basis = 'project_balance_v2';
    record.resource_type = value.resource;
    record.cost_design = {
      reference_rank: record.rank === '特' ? '影级' : record.rank,
      pressure: value.pressure,
      reference_pool: value.pool,
      expected_uses: [value.uses, Math.max(value.uses, Math.ceil(value.pool / value.cost))],
      rationale: '依据术式类型、覆盖范围、持续性、控制难度及禁术/召唤/封印特征逐术评估；不由忍术等级单独决定。'
    };
    changed++;
  }
  shard.balance_version = 'project_balance_v2';
  fs.writeFileSync(full, JSON.stringify(shard, null, 2) + '\n');
}
const manifestPath = path.join(root, 'data/canon/techniques/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.balance_version = 'project_balance_v2';
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`adapted ${changed} techniques`);
