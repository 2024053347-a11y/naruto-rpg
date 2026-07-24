# 运行时接口与适配

## 资源消耗适配（project_balance_v2）

每条技术记录现在额外包含 `resource_type` 与 `cost_design`：

- `jutsu` 默认消耗 `chakra`；`genjutsu` 固定消耗 `spirit`；`taijutsu` 固定消耗 `stamina`。
- 运行时只读取逐术 `cost`，不根据 `rank` 重新计算。
- `cost_design` 仅用于审计，记录参考忍阶、资源池、压力档位、预期使用次数和逐术评估理由。
- `toStateSkill` 适配结果应包含 `resource_type`，使角色技能档案与战斗结算保持一致。

## 时间线

- `timelineDB.getDueEvents({date, unresolvedOnly, branchId})`
- `timelineDB.query({date, query, entityIds, limit})`
- `timelineDB.resolveDueEvent({eventId, status, reason, resultSummary, rescheduleTo})`
- `timelineDB.toWorldbookEntries(results)`

缓存键必须包含：标准化查询、完整日期、分支 ID、人物 ID、活跃事件 ID。
到期状态只允许 `pending/occurred/altered/skipped/postponed`。适配器只展开检索结果，禁止展开全库。

## 忍术

- `techniqueDB.getById(id)`
- `techniqueDB.resolve(nameOrAlias)`
- `techniqueDB.search(filters)`
- `techniqueDB.canLearn({techniqueId, actorState, date})`
- `techniqueDB.toStateSkill(id, {mastery = 0})`

`toStateSkill` 只返回 `type/name/rank/element/cost/power/mastery/description`。角色现有熟练度优先，
且必须先检查血继、瞳术、契约、秘传、身体改造、时代与学习来源。
