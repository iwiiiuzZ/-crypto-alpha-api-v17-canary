# 宏观参考数据候选：真实来源验证，尚未接入生产

本轮处理原缺口中的初请/续请、ETF日度持仓和期权独立数值，不改八模型、开仓权限、止损、目标或提醒门槛。生产仍为原G代码和部署；本分支为候选集成与独立验证，不是已交付新版本。

## 已执行

- `ops/macro-reference.mjs`：严格CSV与官方HTML观察表解析，明确观测日期、币种/美元单位、缺失值、延迟/覆盖边界；没有交易方向推断。
- `tests/test-macro-reference.mjs`：26个边界场景通过，包含真实官方HTML布局回归、过期合约排除、未来/过期时间、数字格式、错误页面、API错误、重复记录和失败请求不冒充通过。
- `ops/macro-reference-live.mjs`：只GET六个公开来源，无密钥、无Worker调用、无状态或通知写入。
- 实际运行42206463908于2026-11-06 18:56:36—18:56:37（北京时间）六源均HTTP200且解析成功。初请截至10月31日189000，续请截至10月24日1718000；两个发行方持仓文件截至11月4日，不能当成实时或全ETF资金流。ETH/BTC期权分别保留680/696个未到期合约，排除1052/1094个已到期返回项；不是只把HTTP200算成功。
- 初请CSV路径实测404，官方HTML可用；旧解析失败与修复过程保留，不用旧值伪造实时数据。前两次现场解析失败不计通过。

## 来源及解释

1. [FRED初请](https://fred.stlouisfed.org/series/ICSA)、[续请](https://fred.stlouisfed.org/series/CCSA)，原始提供方为美国劳工部ETA。周末观测日与新闻发布时间、抓取时间不同；未导入市场预期值，不计算虚构的超预期幅度。
2. [IBIT发行方](https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf)、[ETHA发行方](https://www.ishares.com/us/products/337614/ishares-ethereum-trust-etf)的latest-holdings.csv。只涵盖这两个基金，持币量/流通份额不直接冒充现金净流入，日度文件存在滞后。
3. [欧易官方open-interest接口说明](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-open-interest)。使用OPTION、明确ETH-USD/BTC-USD、oiCcy/oiUsd单位、合约到期日及ts字段。ts是响应数据时间，不保证所有经济信息零延迟，OI比率不是开仓方向。
4. [Deribit公告](https://support.deribit.com/hc/en-us/articles/40275495462301-5-November-2026)有8小时延迟变更描述，但同页明确发布延期；不能只摘变更正文声称已上线。此次只作来源研究，不将其作为候选实时OI主源。
5. [ICE官方DXY资料](https://developer.ice.com/fixed-income-data-services/catalog/ice-data-indices-currency-indices)区分实时、延迟、日终及正式分发渠道。尚未验证到可用的免费官方实时接口，未把美联储广义美元指数或自行计算篮子替代ICE DXY。

## 未完成及外部条件

候选采集成功不等于生产扫描器已消费。已接入独立持久缓存、后台逐源消费回执、响应预算和失败恢复；此前63套回归通过，本次新增授权备用链后正在重跑。真实Cloudflare出口测试42209216483证实FRED两路HTTP520，其他四路HTTP200，临时探针已删除且生产身份未变；因此添加同一授权调度中的FRED原文备用运输，独立哈希、来源、时间和内容复核，20分钟运输有效期，保留直连故障，不修改原四路BLS协议。新增生产六源消费门禁要求实际新鲜值及后续消费回执，不能由采集HTTP成功替代。生产尚未部署。本轮不更改现有source manifest或部署基线，不把新文件重新交给用户上传试错。

原DXY实时需求保留，仍需可复用的正式实时行情接口及文档；用户明确表示没有该接口授权；保持未接入，不阻塞其余六路，不买服务、不使用替代指数。新增付费依赖须所有者明确确认，未擅自购买或添加账单。ETF全市场资金净流入尚未由两基金日度持仓替代。

其他剩余证据不被本研究关闭：自然准备提醒实际送达、GPT编辑器保存全文及策略效果。当前研究产出与生产运行证据分开记录。

## 行情传输修复与线上回滚记录

H 在 11 月 6 日北京时间 19:42 确认六路参考数据被扫描器消费。随后完整行情接口因 `MARKET_RESPONSE_BUDGET_EXCEEDED` 返回 HTTP 503，受控流程恢复到 G 的原版本 `c2bf71c1-c841-45f2-ba6e-f74e6d8d247e`。回滚产生部署 `53126941-a9f4-49f4-823d-ec31d30f214a`，原状态绑定保留。实际失败和回滚证据见 [42210611259](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/42210611259)。

回滚后的 G 也出现同一 503，原始响应 132083 字节，压缩后仍为 93042 字节。详见 [42212452789](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/42212452789) 和 `evidence/2026-11-06-g-rollback-market-budget.json`。这是原有传输预算在较大行情和新闻负载下暴露的缺口。

实际行情形状取自 [影子采集 42212992723](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/42212992723)。临时诊断 Worker 已删除，生产部署身份未变。回归样本遮蔽了新闻正文和链接，保留字段形状和字节级负载。测试叠加六路参考值、16 条多字节风险新闻和 12 项当前事件，复现原传输 503。

I 对原市场响应增加逐级压缩。行情仍携带八模型、六组结构、报价、参考数据值、当前事件、风险标签及时间。压力较大时提供原 `view=news` 的读取提示，用该视图获取完整标题、远期日历和逐源运行诊断。完整新闻为终审必读项。此次沿用 90000 字节上限，部署前后分别读取完整行情和架构并核对传输体积。
