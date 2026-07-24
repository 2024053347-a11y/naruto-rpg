import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plotDir = path.join(root, 'data', 'canon', 'timeline', 'shards', 'plot');

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(plotDir, name), 'utf8'));
}

function write(name, data) {
  fs.writeFileSync(path.join(plotDir, name), `${JSON.stringify(data, null, 2)}\n`);
}

function markRange(file, start, end, role, note) {
  const data = read(file);
  let changed = 0;
  for (const record of data.records || []) {
    const number = Number(record.id.match(/-(\d{4})$/)?.[1]);
    if (number < start || number > end) continue;
    record.qa ||= {};
    record.qa.runtime_role = role;
    record.qa.structure_reviewed_by = 'manual-plot-structure-001';
    record.qa.structure_note = note;
    changed++;
  }
  write(file, data);
  return changed;
}

function setKaguyaDates() {
  const file = 'TL-NAR-P2-KAGUYA-AUTO.json';
  const data = read(file);
  const ranges = [
    [1, 139, 'K068-01-03', '辉夜战及战后即时处置，与战争结束基准日一致。'],
    [140, 187, 'K068-01-04', '佐助宣布革命后，终末之谷决战持续至夜间。'],
    [188, 193, 'K068-01-05', '原文明确为决战后的第二天早晨。'],
    [194, 194, 'K068-01-12', '战争善后、葬礼与羁押需要恢复及返村时间。'],
    [195, 196, 'K068-02-01', '卡卡西就任六代火影及义肢治疗属于战后重建阶段。'],
    [197, 199, 'K068-02-02', '佐助获赦后离村赎罪，不能与大战当天合并。']
  ];
  for (const record of data.records || []) {
    const number = Number(record.id.match(/-(\d{4})$/)?.[1]);
    const range = ranges.find(([start, end]) => number >= start && number <= end);
    if (!range) continue;
    const [, , date, rationale] = range;
    record.when.scheduled_start = date;
    record.when.scheduled_end = date;
    record.when.canon_window = { earliest: date, latest: date };
    record.when.rationale = `${rationale} 日期为 project_dates_v2 项目分配，不宣称为漫画明示。`;
    record.qa ||= {};
    record.qa.date_reviewed_by = 'manual-plot-structure-001';
  }
  data.shard.date_start = 'K068-01-03';
  data.shard.date_end = 'K068-02-02';
  write(file, data);
  return data.records.length;
}

let roleChanges = 0;
roleChanges += markRange(
  'TL-NAR-P1-CHUNIN-AUTO.json', 1, 12, 'recap',
  '中忍考试篇开头重复收录波之国篇结尾，只保留为来源回顾，不进入当前剧情。'
);
for (const [file, end] of [
  ['TL-BOR-MUJINA-AUTO.json', 4],
  ['TL-BOR-OMNIPOTENCE-AUTO.json', 4],
  ['TL-BOR-MATSURI-AUTO.json', 3]
]) {
  roleChanges += markRange(file, 1, end, 'metadata', '记录只有篇章目录或前后继说明，不是可发生的剧情。');
}

const dateChanges = setKaguyaDates();
console.log(`proofread plot structure: ${roleChanges} runtime roles, ${dateChanges} Kaguya dates`);
