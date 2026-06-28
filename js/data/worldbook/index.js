import { TIMELINE_ENTRIES } from './timeline.js';
import { DETAILED_TIMELINE_ENTRIES } from './timeline-detailed.js';
import { CHARACTER_ENTRIES } from './characters.js';
import { LOCATION_ORGANIZATION_ENTRIES } from './locations-organizations.js';
import { ARC_ENTRIES } from './arcs.js';
import { SYSTEM_ENTRIES } from './systems.js';
import { EXPANDED_CHARACTER_ENTRIES } from './expanded-characters.js';
import { CHARACTER_DETAIL_ENTRIES } from './character-details.js';
import { CHARACTER_DETAIL_ENTRIES_2 } from './character-details-2.js';
import { CHARACTER_APPEARANCE_ENTRIES } from './character-appearances.js';
import { SHINOBI_ROSTER_ENTRIES_2 } from './shinobi-roster-2.js';
import { BORUTO_ERA_ENTRIES, BORUTO_MISSION_ENTRIES } from './boruto-era.js';
import { ERA_CONSISTENCY_ENTRIES } from './era-consistency.js';
import { WORLD_EXPANSION_ENTRIES } from './world-expansion.js';

export const WORLD_BOOK_ENTRIES = [
  ...TIMELINE_ENTRIES,
  ...DETAILED_TIMELINE_ENTRIES,
  ...ERA_CONSISTENCY_ENTRIES,
  ...ARC_ENTRIES,
  ...CHARACTER_ENTRIES,
  ...SHINOBI_ROSTER_ENTRIES_2,
  ...CHARACTER_DETAIL_ENTRIES,
  ...CHARACTER_DETAIL_ENTRIES_2,
  ...CHARACTER_APPEARANCE_ENTRIES,
  ...EXPANDED_CHARACTER_ENTRIES,
  ...BORUTO_ERA_ENTRIES,
  ...BORUTO_MISSION_ENTRIES,
  ...LOCATION_ORGANIZATION_ENTRIES,
  ...WORLD_EXPANSION_ENTRIES,
  ...SYSTEM_ENTRIES
];

export const WORLD_BOOK_META = {
  version: '1.8',
  defaultEra: '木叶52年',
  sources: [
    'Naruto / 火影忍者公开剧情资料',
    'Wikipedia: Naruto',
    'Wikipedia: List of Naruto characters / 火影忍者角色列表'
  ],
  note: '本世界书为跑团检索用途的原创摘要，不复制百科原文。'
};

export default WORLD_BOOK_ENTRIES;
