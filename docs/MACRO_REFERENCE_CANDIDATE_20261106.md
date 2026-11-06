# 宏观参考数据候选：真实来源验证，尚未接入生产

本轮处理原缺口中的初请/续请、ETF日度持仓和期权独立数值，不改八模型、开仓权限、止损、目标或提醒门槛。生产仍为原G代码和部署；本分支仅候选采集/解析与独立验证，不是已交付新版本。

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

候选采集成功不等于生产扫描器已消费。与Worker缓存、后台消费回执、GPT响应预算及故障恢复的集成和联合回归尚未完成，生产未部署。本轮不更改现有source manifest或部署基线，不把新文件重新交给用户上传试错。

原DXY实时需求保留，仍需可复用的正式实时行情接口及文档；当前没有该接口授权。新增付费依赖须所有者明确确认，未擅自购买或添加账单。ETF全市场资金净流入尚未由两基金日度持仓替代。

其他剩余证据不被本研究关闭：自然准备提醒实际送达、GPT编辑器保存全文及策略效果。当前研究产出与生产运行证据分开记录。
