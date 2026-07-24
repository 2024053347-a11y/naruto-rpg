# 来源、联网核对与冲突裁定

## 已读取的项目资料

- `js/data/worldbook/timeline.js`
- `js/data/worldbook/timeline-detailed.js`
- `js/data/worldbook/arcs.js`
- `js/data/worldbook/era-consistency.js`
- 人物、地点组织与系统世界书中全部木叶纪年引用

## 联网核对（2026-07-18）

- NARUTO OFFICIAL SITE：`https://naruto-official.com/en/news/01_1755`
- Naruto Wiki MediaWiki API：`Timeline of the Naruto Universe`（只用于事件/章节定位）
- Naruto Wiki MediaWiki API：`Jutsu`（只用于分类与名称定位）

资料站正文可能包含动画、小说或游戏资料，因此只有能回指漫画章节或公式书的事实才进入正式记录。

## 项目内冲突

| 冲突 | 裁定 |
|---|---|
| 旧 `README.md` 写默认木叶48年；加载配置和详细时间线写木叶52年 | 采用木叶52年，48年视为废弃残留 |
| 通用现实年表通常以鸣人出生为“12年前”，没有木叶纪年 | 使用项目世界书的 K051/K052/K064 映射 |
| 原作只提供大量相对顺序，缺少完整年月日 | 项目分配唯一日期并标 `allocated`，不得声称原著明示 |
| 世界书将日向外交事件写作木叶51年前后，但又提示未来发生 | 置于审核队列，不进入已审核运行时索引 |
| 世界书把纲手回归与佐助叛逃写作K064至K065 | 当前调度到K064，但明确标记为allocated/low，不宣称原著明示 |

正式索引构建只接收 `qa.status = "approved"` 的记录；当前全部草稿仅存在于权威源分片。

## 覆盖声明

本交付完成数据库架构、核心原著事件/忍术样本、索引、适配器和全库机械校验。
“全部具名忍术”需要合法的漫画/公式书逐条源材料才能继续批量录入；本目录不会用模型记忆伪造全集。
