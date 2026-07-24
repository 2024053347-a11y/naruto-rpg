import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outDir=path.join(root,'data/canon/timeline/yearly');
const earlyHistoryEntityMap=JSON.parse(fs.readFileSync(
  path.join(root,'data/canon/registries/early-history-entity-map.json'),
  'utf8'
));
const raw=`
千手柱间|-32|10|23|17
宇智波斑|-32|12|24|68
千手扉间|-28|2|19|20
宇智波泉奈|-27|2|10|0
金角|-24|3|7|20
银角|-24|3|7|20
角都|-24|8|15|67
大野木|-11|10|8|68
千代|-6|10|15|67
志村团藏|-5|1|6|67
猿飞日斩|-5|2|8|64
水户门炎|-5|5|8|
转寝小春|-5|9|1|
秋道取风|-5|9|15|
宇智波镜|-5|9|15|20
猿飞琵琶湖|-5|9|15|51
海老藏|-4|1|26|
三船|3|4|1|
达兹纳|4|4|5|
加藤断|12|12|4|40
纲手|13|8|2|
旗木朔茂|13|9|3|45
土台|13|10|23|
大蛇丸|13|10|27|
自来也|13|11|11|67
迈特戴|13|12|10|49
宇智波富岳|19|8|16|59
四代雷影艾|21|6|1|
手打|21|8|10|
日向日足|22|1|8|
日向日差|22|1|8|54
青|22|8|1|
绳树|23|8|9|36
黄土|24|3|22|
罗砂|24|3|29|67
宇智波美琴|24|6|1|59
加瑠罗|24|11|11|51
油女志微|25|9|7|
山中亥一|26|1|24|68
秋道丁座|26|4|22|
奈良鹿久|26|7|15|68
波风水门|27|1|25|51
漩涡玖辛奈|27|7|10|51
奈良吉野|28|2|24|
犬冢爪|29|8|12|
药师野乃宇|30|3|5|60
夜叉丸|30|5|23|57
弥彦|32|2|20|48
奇拉比|32|5|15|
长门|32|9|19|67
蝎|32|11|8|67
小南|33|2|20|67
马基|33|7|4|
并足雷同|33|8|28|
山城青叶|34|9|3|
惠比寿|35|3|8|
干柿鬼鲛|35|3|18|67
不知火玄间|35|7|17|
森乃伊比喜|36|3|20|
夕日红|36|6|11|
地陆|36|7|1|67
猿飞阿斯玛|36|10|18|67
静音|36|11|18|
迈特凯|37|1|1|
宇智波带土|37|2|10|68
飞竹蜻蜓|37|4|4|
照美冥|37|5|21|
桃地再不斩|37|8|15|64
旗木卡卡西|37|9|15|
野原琳|37|11|15|50
二位柚木人|38|7|24|67
萨姆伊|39|1|7|
麻布依|39|2|1|68
御手洗红豆|39|10|24|
神月出云|39|11|25|
钢子铁|40|7|21|
月光疾风|40|11|2|64
海野伊鲁卡|41|5|26|
泡沫|41|6|16|67
大和|41|8|10|
达鲁伊|42|1|6|
希|42|4|3|
卯月夕颜|42|11|3|
宇智波止水|43|10|19|58
药师兜|44|2|29|
飞段|46|4|2|67
犬冢花|46|4|13|
宇智波鼬|46|6|9|67
菖蒲|47|2|14|
手鞠|47|8|23|
赤土|48|1|11|
迪达拉|48|5|5|67
山中风|48|8|20|67
油女取根|48|10|24|67
长十郎|48|11|1|
白|49|1|9|64
堪九郎|49|5|15|
君麻吕|49|6|15|64
阿茨伊|49|8|2|
重吾|49|10|1|
多由也|50|2|15|64
天天|50|3|9|
左近右近|50|6|20|64
次郎坊|50|6|26|64
日向宁次|50|7|3|68
黑土|50|9|6|
佐井|50|11|25|
李洛克|50|11|27|
鬼童丸|50|12|16|64
我爱罗|51|1|19|
油女志乃|51|1|23|
卡鲁伊|51|2|14|
鬼灯水月|51|2|18|
春野樱|51|3|28|
秋道丁次|51|5|1|
志保|51|6|18|
香磷|51|6|20|
犬冢牙|51|7|17|
宇智波佐助|51|7|23|
奈良鹿丸|51|9|22|
山中井野|51|9|23|
漩涡鸣人|51|10|10|
奥摩伊|51|12|26|
日向雏田|51|12|27|
伊势乌冬|55|4|3|
风祭萌黄|55|6|8|
伊那利|55|12|25|
猿飞木叶丸|55|12|30|
日向花火|57|3|27|
赤丸|60|7|7|
川木|69|5|13|
漩涡博人|71|3|27|
宇智波佐良娜|71|3|30|
梅塔尔·李|71|5|1|
笕堇|71|6|12|
巳月|71|7|25|
秋道蝶蝶|71|8|8|
奈良鹿戴|71|9|23|
山中井阵|71|12|5|
漩涡向日葵|73|8|1|
`.trim();

const people=raw.split('\n').map(line=>{const [name,y,m,d,death]=line.split('|');return {name,birth_year:Number(y),birth_month:Number(m),birth_day:Number(d),death_year:death?Number(death):null,entity_id:earlyHistoryEntityMap[name]??null}});
const anchors={
  1:['木叶隐村建立并形成一国一村制度；具体月日为项目推定。'],
  2:['宇智波斑离开木叶；砂、雾、岩、云在本项目中进入建村完成期。'],
  3:['终结之谷决战在本项目中发生；斑自此公开推定死亡、真实转入隐秘地下活动。'],
  11:['扉间建立木叶学堂、警务部队与暗部等制度；“首届36名毕业生”仅作项目资料候选。'],
  15:['木叶学堂发展为承担军事人才培养的忍者学校。'],
  17:['柱间于本年去世，扉间继任第二代火影；具体年份为兼顾纲手幼年记忆与二代任期的项目分配。'],
  18:['项目纪年将第一次忍界大战爆发分配在本年；原著只支持相对年代。'],
  20:['扉间在云隐追击战中牺牲，金角与银角死亡，日斩继任第三代火影；第一次忍界大战逐步结束。'],
  36:['绳树在任务中死亡；第二次忍界大战前的紧张局势升级。'],
  37:['项目纪年将第二次忍界大战全面爆发分配在本年，雨之国成为主要战场。'],
  38:['涡潮隐村于本年遭毁灭；精确年份为低置信项目分配，之后只保留遗址与漩涡流亡者。'],
  39:['半藏赐予自来也、纲手、大蛇丸“木叶三忍”称号；自来也留下照顾雨隐三孤儿。'],
  40:['加藤断战死，纲手产生恐血症；第二次忍界大战进入尾声。'],
  41:['云隐绑架玖辛奈失败，水门将其救回。'],
  42:['自来也结束对弥彦、长门、小南约三年的教导；三人开始筹建以和平为目标的初代晓。'],
  43:['卡卡西五岁从忍者学校毕业；初代晓进入雨之国和平组织阶段。'],
  44:['卡卡西晋升中忍；迈特凯从忍者学校毕业。'],
  45:['旗木朔茂自杀；同代木叶忍者陆续毕业。'],
  46:['鼬出生；带土、琳等人从忍者学校毕业。'],
  47:['第三代风影失踪，第三次忍界大战爆发；各村提前动员年轻忍者。'],
  48:['木叶年轻一代在战争中晋升并投入各战线；弥彦遭半藏与团藏暗线围杀，初代晓瓦解并转型。'],
  49:['桔梗山相关战斗；药师兜被野乃宇收养；迈特戴开启八门掩护凯小队并死亡。'],
  50:['神无毗桥任务、带土被判定阵亡、琳死亡；三战结束，水门继任第四代火影。'],
  51:['鸣人等主角一代出生；K051-10-10九尾之乱，水门与玖辛奈牺牲，三代复任。'],
  52:['大蛇丸人体实验暴露并叛逃；木叶处于九尾之乱后的重建期。'],
  53:['鼬提前从忍者学校毕业。'],
  54:['鼬开启写轮眼；K054-12-27云隐白眼外交事件，日向日差死亡。'],
  55:['木叶丸、萌黄、乌冬等下一代人物出生。'],
  56:['鼬晋升中忍。'],
  57:['日向花火出生。'],
  58:['鸣人同届进入忍者学校；止水死亡，鼬开启万花筒写轮眼。'],
  59:['鼬成为暗部分队长；宇智波灭族，鼬成为叛忍并加入晓。'],
  60:['野乃宇死亡，兜投靠大蛇丸；赤丸出生。'],
  61:['大蛇丸袭击鼬失败后脱离晓；迪达拉加入晓；卡卡西转任担当上忍。'],
  62:['没有冻结到具体日期的重大漫画事件；原作第一部的组织与人物状态继续发展。'],
  63:['宁次、李、天天毕业并组成凯班。'],
  64:['第一部开始：毕业、第七班、波之国、中忍考试、木叶崩溃、纲手继任、佐助叛逃。'],
  65:['第一部收尾与鸣人外出修行阶段；具体跨年边界属于项目分配。'],
  66:['鸣人与自来也修行；晓推进尾兽捕捉准备，木叶处于纲手执政期。'],
  67:['疾风传主要事件：风影夺还、天地桥、飞段角都、鼬决战、自来也与佩恩相关事件。'],
  68:['佩恩后续、五影会谈与第四次忍界大战；战争结束后进入重建。'],
  69:['战后恢复、忍村外交缓和；卡卡西逐步进入六代火影时期。'],
  70:['战后任务与制度重建期；具体小说事件必须保存在独立连续性数据集。'],
  71:['鸣人与雏田婚礼前后；非漫画主线材料独立标注来源。'],
  72:['战后和平发展期。'],73:['战后和平发展期。'],74:['战后和平发展期。'],75:['战后和平发展期。'],76:['战后和平发展期。'],77:['战后和平发展期。'],78:['战后和平发展期。'],79:['战后和平发展期。'],80:['鸣人成为七代火影前后的制度交接期；具体年份为项目分配。'],81:['新时代木叶发展，科学忍具开始进入公共体系。'],82:['新时代主角一代进入忍者学校与毕业前后。'],
  83:['《BORUTO》主线项目起始年：毕业、下忍编组、中忍考试与大筒木桃式事件；后续事件使用boruto_manga独立连续性。'],
  84:['《BORUTO》第一部中段：壳组织、青、川木与楔相关事件按漫画顺序推进。'],
  85:['《BORUTO》第一部后段：考德袭击、全能与博人离村；具体月日为项目分配。'],
  86:['《BORUTO: TWO BLUE VORTEX》阶段：三年时间跳跃后博人返回木叶。']
};
function era(y){if(y<=10)return'建村初期';if(y<=20)return'制度建立与第一次忍界大战';if(y<=35)return'战间期';if(y<=42)return'第二次忍界大战及余波';if(y<=50)return'第三次忍界大战';if(y<=63)return'九尾之乱后与宇智波危机';if(y<=65)return'NARUTO第一部';if(y<=68)return'NARUTO第二部';if(y<=82)return'战后和平期';return'BORUTO时代'}
fs.mkdirSync(outDir,{recursive:true});
const manifest=[];
for(let year=1;year<=86;year++){
  const birthdays=people.filter(p=>p.birth_year===year).map(p=>({entity_id:p.entity_id,name:p.name,date:`K${String(year).padStart(3,'0')}-${String(p.birth_month).padStart(2,'0')}-${String(p.birth_day).padStart(2,'0')}`,type:'birth'}));
  const ages=people.filter(p=>p.birth_year<=year&&(p.death_year===null||p.death_year>=year)).map(p=>({entity_id:p.entity_id,name:p.name,birth_year:p.birth_year,birthday:`${String(p.birth_month).padStart(2,'0')}-${String(p.birth_day).padStart(2,'0')}`,age_at_year_start:p.birth_year===year?null:year-p.birth_year-1,age_after_birthday:year-p.birth_year,status:p.birth_year===year?'born_this_year':p.death_year===year?'dies_this_year':'alive'}));
  const data={schema_version:'naruto.yearly-almanac.v1',calendar:'konoha-360-v1',year:`K${String(year).padStart(3,'0')}`,era:era(year),continuity:year>=83?'boruto_manga':'manga_canon',date_basis:'project_allocation',annual_events:[...(anchors[year]||['没有冻结到具体日期的重大原著事件；保留年度状态边界。']),...birthdays.map(b=>`${b.date}：${b.name}出生。`)],birthdays,character_ages:ages};
  const file=`K${String(year).padStart(3,'0')}.json`;fs.writeFileSync(path.join(outDir,file),JSON.stringify(data,null,2)+'\n');manifest.push({year:data.year,path:file,event_count:data.annual_events.length,birth_count:birthdays.length,age_count:ages.length,continuity:data.continuity});
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify({schema_version:'naruto.yearly-almanac.manifest.v1',year_start:'K001',year_end:'K086',age_rule:'出生当年年初尚未出生，age_at_year_start=null；其余年份age_at_year_start=year-birth_year-1；age_after_birthday=year-birth_year',source_priority:['project_worldbook','NARUTO manga','official databooks','user_supplied_project_chronology'],notes:['宇智波佐良娜官方生日3月31日映射到项目30日制日历的3月30日。','新时代人物出生年份为配合K083约12岁及K086三年时间跳跃的项目分配。'],years:manifest},null,2)+'\n');
fs.writeFileSync(path.join(root,'data/canon/registries/project-births.json'),JSON.stringify(people,null,2)+'\n');
console.log(`built 86 yearly files for ${people.length} people`);
