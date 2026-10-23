# 公开系统对照与适配结论

核查日期：2026-10-22。这是公开文档与源码设计审查，不是产品收益排名。没有登录商业产品内部或验证其广告绩效；未购买服务、引入模型、迁移交易框架或修改策略。

| 系统/公开依据 | 可借鉴能力 | 本项目适配与验证 | 当前决定 |
|---|---|---|---|
| [Freqtrade未来数据检查](https://www.freqtrade.io/en/stable/lookahead-analysis/)及[递归检查](https://www.freqtrade.io/en/stable/recursive-analysis/) | 检测回测读取未来K线与指标预热差异 | 对八模型逐时截断重放，确认历史时刻决策不受未来数据影响；报告样本量和成本 | 验证方法可采用；未迁移策略 |
| [FreqAI运行与回测](https://www.freqtrade.io/en/stable/freqai-running/) | 模型生命周期、训练与预测时间区分 | 本系统先记录模型规则版本和数据时点；若新增机器学习，须有样本外滚动验证与过期模型处理 | 新增预测模型属于范围变化，未实施 |
| [Hummingbot控制器](https://hummingbot.org/strategies/v2-strategies/controllers/) | 数据提供、策略决定与执行生命周期分离 | 保留共享行情拥有者；分别验收采样、八模型复核、通知阶段；隔离故障不能互相冒充成功 | 与现有架构吻合，采用验证边界；不增加自动交易 |
| [NautilusTrader状态对账](https://nautilustrader.io/docs/latest/concepts/execution/reconciliation/) | 区分已确认状态、缺失状态和未知命令结果；启动恢复 | 提醒审计与待处理状态对账；缺失回执不当成未发送；重启后验证同事件去重 | 适配提醒状态，非交易所订单对账；原生磁盘状态强制重启检查已补齐；服务接受与落盘之间的未知窗口仍须披露 |
| [QuantConnect实盘对照](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/reconciliation) | 数据、时间、费用和成交模型差异解释 | 实际报价与研究价、第一目标、费用/滑点/资金费率分别存证；未来样本外/模拟/实盘各自报告 | 新增独立成本手算测试；尚无真实交易绩效证明 |
| [TradingAgents官方论文](https://arxiv.org/abs/2412.20138)和[项目](https://github.com/tauricresearch/tradingagents) | 新闻、技术与风险角色分工、保留分析依据 | 新闻作为带来源和时间的证据，必须与价格响应和原策略复核；不能仅凭语言模型结论放行 | 论文主要股票实验，不外推为ETH盈利；多代理/额外模型未引入 |
| [3Commas信号机器人](https://3commas.io/signal-bot)与[官方连接说明](https://help.3commas.io/en/articles/16281111-how-to-set-up-a-bot-with-the-tradingview-strategy-start-condition-using-placeholders) | 公开的信号接收→执行工作流、日志追踪 | 借鉴端到端阶段可见性：技术准备、入队、尝试、服务接受、设备收到分别标记 | 仅研究公开说明；内部算法、去重实现与真实收益未访问；不接入付费服务 |

## 八个维度的落点

行情：来源/交易所时间/抓取时间/缓存年龄分开，过期失效而非继续给许可。策略：已收盘数据、确定性重放、完整事件冻结及失效。订单流：采样窗口、缺口与价格响应明确，不能声称连续全量或巨鲸身份。新闻：发布、发现、采集、消费分开，源失败不伪装为无风险。风险：第一现实目标净RR、结构止损、成本压力独立计算。提醒：阶段和回执关联。恢复：冷却、租约、持久化及重启验证。效果：防前视、样本外、成本、模拟与实盘独立评估。

现有范围优先吸收可验证的工程方法。WebSocket常驻服务、付费盘口历史、额外AI代理/模型、自动执行及新策略都需要额外资源或改变范围，未纳入本次修复。以上来源没有证明本系统已盈利，也没有证明商业系统内部实现优于当前系统。
