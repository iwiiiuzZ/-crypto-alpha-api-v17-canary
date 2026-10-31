# 继承要求与验收矩阵

权威依据：本次用户要求、原完整核心指令7979字符、原完整知识库58530字符，以及PROJECT_REQUIREMENTS_AND_ACCEPTANCE.md。旧聊天全文不可完整读取，不能声称逐字恢复。本文是检查索引，完整规则仍在原件；不是缩减版策略或正式验收证书。

工程验证等级：R5f本地55套隔离/原生回归通过，其中7套为原生运行环境；GitHub对源锁定发布提交另行回归。R5f的37点/612.157秒、15项严格生产门槛全部通过，实际部署与源码证据见LATEST_RUNTIME_AND_ACCEPTANCE_20261031.md。独立运行41192466711已确认12源批次消费及BLS四源封装读取修复。隔离通过只说明指定软件行为，不证明盈利或GPT保存状态。

| 要求 | 可核查验收标准 | 已有依据/测试 | 生产或最终缺口 |
|---|---|---|---|
| 原规则/习惯接续 | 完整指令、课程、案例、开场白、接口原件可追溯，不用摘要替代 | 原ZIP CRC及五个完整资产哈希；私有装配186文件 | 不能证明不可读取的旧聊天没有其他未归档要求 |
| ETH执行/BTC过滤 | ETH欧易USDT永续，买一/卖一与真实成交，不用标记价替代 | test-v25-reliability、public-orderflow、final-swing-liquidity | R5f前后台一致、真实报价及十分钟全部采样通过 |
| 波段优先 | 1小时/4小时保护及目标，15分钟择时；2/7/14天费用情景 | final-swing-liquidity、cost-contract、course-engine | 收益未验证；日内次级保留 |
| 八模型全量 | A1/A2/B1/B2/C1/C2/D1/D2全部返回，逐项具体阻断和下一条件 | v24-models、v27-adaptive-news、regime-submodels；原知识库 | R5f生产八模型完整明细审计通过 |
| A2/B1/D类原条件 | 保留双路线、22—25动能例外、冻结边界、D1/D2真实事件与期限 | 原件逐字保留；源码门槛保留差异测试 | 不因少信号改参数造机会 |
| 真区间/结构 | 未确认参考区间不当箱体中部；完整保护优先；1日不是额外硬闸门 | v20-range、course-engine、final-swing-liquidity | 依实时数据逐案核验 |
| 结构数据 | 同源永续；Gate主源/欧易恢复；240根基线+增量8根；180/420/660秒；30秒收盘宽限 | v22-durable-structure、v26-1-data-access、resilience | R5f生产六组结构来源/质量/最新收盘及新鲜度审计通过 |
| 行情缓存/并发 | 单状态拥有者，原4秒成交盘口缓存，原报价新鲜度不放宽 | flow-cache-budget、v25-reliability、monitor-coordination | 不保证外部接口永不故障 |
| 真实429根因修复 | 原盘口冷却保留；官方400档完整盘口备用；错误与实际源可见 | 新增orderflow-book-fallback及真实workerd定时器测试 | R5f独立37点十分钟窗口全部门槛通过；不外推全天覆盖 |
| 异常拒绝/恢复 | 过期、交叉、错配、限流、异常返回、重启恢复均测试 | rate-protection、resilience、response-parser、owner-local、原生重启测试 | 当前生产故障窗口单独披露 |
| 第一目标/止损/净RR | 最近现实障碍，结构失效位，扣手续费/滑点/适用持有费用后净值>=2 | cost-contract、reviewed-cost-integration、final-swing-liquidity | 用户实际费用未知仍须终审；不改目标凑数 |
| 不拦未知账户状态 | 心理/仓位/杠杆自管，保留方案级风险与结构条件，不自动下单 | v26-actionable、consolidated-preservation；原指令 | 没有真实账户或自动执行能力 |
| 流动性与价格联动 | 两轮独立盘口/成交；至少两平台；合约单位、映射、持续/临时障碍区分 | multivenue-linkage、public-orderflow、原生并发测试 | 采样不是全市场或巨鲸真实持仓 |
| 大额/放量/突变 | 成交、位移和持续样本联合；12美元/0.5%/1.25倍波幅取最大值 | fast-monitor、v27-adaptive-news；原阈值保持 | 不是连续全量成交录制，不保证秒级送达 |
| 新闻真实性 | 发布/事件/首次见/抓取/消费时点分开，15分钟新事件与旧背景分开 | news-macro、news-integration、news-consumption-receipts | 12个既定源已作真实批次对账，延迟备用与直连分开标示 |
| 宏观监控 | CPI/PCE/PPI/就业初请/FOMC/日央行/美元/美债/ETF/期权/地缘 | 原清单完整保留；BEA/BOJ/PPI/Treasury解析及BLS运输测试 | BLS四源已由官方原文备用运输真实消费，直连403保留；美元实时及独立初请/ETF/期权数值仍有明确边界，日度美债不是盘中 |
| 金十授权与缓存 | 保留既有配置，不要求重填；认证/HTTP/解析/消费分别核验 | news-transport、news-runtime、逐源消费脚本 | 配置存在不等于新批次有效；不得沿用旧缓存 |
| 研究/准备/执行区分 | 真区域/数值失效/具体缺项；准备卡含范围、止损、目标、净RR、期限和剩余终审 | v26-actionable、push-observability；原件 | 不把技术准备冒充实际成本/新闻全部终审 |
| 提醒默认与三级能力 | 三级机制保留；普通研究到区默认静默，明确要求过程时ALL_STAGES | v23-lifecycle、push-observability、fast-monitor | 不能按旧摘要擅改最新默认模式 |
| 六类推送闭环 | 准备/消息/动态价格/正式计划/快链/技术进展独立入队、重试、去重 | push-observability、monitor-contention、communication-verification | 真实合格准备事件→队列→尝试→接受仍需实网事件；不再发通信测试 |
| 状态/期限/取消 | 有效研究暂时离区或单次错误不清空；失效/过期停止；按明确范围取消 | v23-lifecycle、consolidated-cross-module、owner-local-dispatch | 原状态命名空间须保持 |
| 分钟与快速监控 | 分钟心跳与10秒目标采样独立；30秒活跃复核；漏发/重复/断档可见 | fast-monitor、monitor-coordination、operations、soak-monitor | R5f15项门槛全部通过，成功心跳与复核在所有采样点推进 |
| 前后台/源码一致 | 入口、状态拥有者、协议、实际版本UUID及唯一源码hash一致 | release-identity、r5-preflight、postdeploy、guarded-rollback | R5f实际部署/版本UUID、原命名空间、前后台匹配及完整窗口均已核对 |
| 接口兼容与体积 | 7.6.0四操作；全部模型/候选数值保留；预算错误如实返回 | market-envelope、response-parser、transport-references、原生响应隔离 | 实际GPT Action调用仍需最终验收 |
| 课程/复盘 | 原32课、100案例、30—32待补学、独立盈亏/复盘规则完整保留 | 课程正文哈希原样保持；course-engine | 不能凭旧聊天摘要伪造新交易记录 |
| 输出格式 | 简短看板、唯一主方案、次级单列、八模型阻断、中文对照、北京时间、三种最终裁决 | 原7979字符指令及403字符入口 | GPT实际保存配置待查 |
| 主流系统研究 | 一手来源、可吸收能力/适配/验证边界明确，不编商业内部能力 | RESEARCH.md及RESEARCH_REFRESH_20261031.md | 未实施额外AI/常驻服务/付费源；不是收益排名 |
| 收益证据 | 回测、前向技术模拟、真实成交分列；无前视/样本外/成本和不确定样本披露 | 原规则与前向研究实现保留 | 没有完整同期盘口/新闻与实盘样本，不宣称盈利 |
| 完整交付 | 代码、依赖、原知识/指令、四开场、短/完整开场、架构、测试、限制、回滚同时提供 | assemble-delivery与verify-delivery-package实际通过 | 装配不是正式交付；待生产/安装/实际提醒证据 |
| 冻结与恢复 | 必要最小修复，固定源码/配置/依赖/接口/策略，保留回滚，不顺带改策略 | 依赖锁、不可变源码、精确发布意图、受控回滚 | 所有最终门槛完成前不标稳定基线 |
