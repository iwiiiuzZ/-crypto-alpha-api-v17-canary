# 公开资料复核与本次适配

复核日期：2026-10-31。本页补充已有十类系统对照，不作收益或产品排名。

| 一手来源 | 公开能力或事实 | 本项目具体适配 | 验证边界 |
|---|---|---|---|
| [欧易官方API](https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-order-book) 与 [完整盘口](https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-full-order-book) | 常规盘口最多400档、每2秒40次；完整盘口最多5000档、每秒刷新、每2秒10次；按IP计数 | 使用同合约400档完整盘口作显式备用，原接口保持冷却；三列响应正确转换数量和订单数；原10秒新鲜度、4秒缓存上限保持 | 官方文档有三列示例与通用注释四列的差异，适配两种格式；隔离测试与原生运行测试，生产仍独立验收 |
| [Hummingbot连接器要求](https://hummingbot.org/connectors/connectors/build/) | 要求公开行情/成交通道、端点及连接的限流说明 | 同一状态拥有者合并并发请求；主备错误分别保留，不把服务连接当作数据或交易权限 | 本次未引入Hummingbot依赖、自动下单或常驻网络服务 |
| [Freqtrade前视检查](https://www.freqtrade.io/en/stable/lookahead-analysis/) | 逐次切片回测对比指标与入出场时点，寻找未来数据污染 | 保留已收盘数据与冻结事件；历史回放、无前视和样本外验证仍列为策略证据门槛 | 未运行Freqtrade策略或获得其盈利结果；工程回归不冒充历史收益验证 |
| [NautilusTrader状态对账](https://nautilustrader.io/docs/latest/concepts/execution/reconciliation/) | 启动及连续运行时对齐系统内部状态与外部确认报告；缺报告不代表无状态 | 继续区分通知入队、尝试、服务接受和设备实收；版本、部署UUID及持久状态分别对账 | 我们对账的是提醒及状态拥有者，不是用户交易账户 |
| [QuantConnect实盘对照](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/reconciliation) | 讨论实时数据时点、预热、重启、成本与模拟成交差异 | 交易所时点、采集、新闻发布时间、消费和研究/实际执行价分开；回滚保留状态 | 未订阅其数据或验证本系统实盘绩效 |
| [TradingAgents原论文](https://arxiv.org/abs/2412.20138) | 技术、新闻/情绪及风险角色分工，实验对象为股票框架 | 借鉴证据分工与终审职责，不让新闻标题直接替代原模型条件 | 商业内部实现和加密资产收益不可由论文推断；未新增代理或预测模型 |

本次吸收的是公开、可验证的工程方法。原八模型、净2倍、波段保护与目标规则保持；原RESEARCH.md中的其余系统仍保留各自已注明的访问及验证限制。没有新增收费依赖。
