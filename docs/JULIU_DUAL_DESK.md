# 聚流双币决策与闭站监控

[打开聚流](https://market-desk-cn.darkboard1.chatgpt.site) 后，点「一键分析 BTC + ETH」。两币各扫描八个既有模型。波段优先，同一持有类型内比较第一目标的净盈亏比。研究卡、欧易图层和监控共用计划编号与修订号。图上标注可保存为复盘快照。

站点优先读取本版本的共享 Worker，连接未就绪时用固定来源的原版策略做只读复核。页面标出来源。闭站监控只有在签名接口和原扫描器配置通过时可登记。Bark 发送服务接收和手机实收分别记录。

## 接口和存储

- 原行情、监控状态、计划保存和取消接口继续兼容。
- `GET /?view=desk` 返回双币分析。给站点使用的 `/desk/v1/analysis` 和 `/desk/v1/monitors` 使用仅限此站的服务端签名。
- 新监控按币种、计划编号和修订号保存。原 GPT 的正式计划和观察保留在原状态键中。
- 到区使用两次不同盘口时间的欧易真实成交及买卖盘，再重算模型和净盈亏比。待消息、实际费用与流动性终审的提醒标为待复核。

## 生产发布

本候选通过仓库现有的 [Managed operations](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/workflows/maintenance.yml) 发布入口。由有仓库操作权的会话在合入后选择 `main`、`deploy`，运行一次。普通提交只运行回归与只读检查。发布前核对原构建、物理部署、状态命名空间和受保护接口，发布后核对共享版本、双币十六行模型和原扫描器认证。现场行情、签名写入和手机实收须取得实际回执。

需要撤回站点界面时，用聚流的发布历史恢复已知版本。Worker 只通过已核对当前物理部署与绑定的维护入口恢复到已验收版本。现有基线记录在 `ops/production-baseline.json`。

## 原 GPT

待生产验证后，更新原 GPT 的操作架构，使用 [接口地址](https://crypto-alpha-api-v17-canary.id-mranran.workers.dev/openapi.json?v=desk-dual-r1)。新开场见 `GPT_DUAL_DESK_OPENING.txt`。长期指令中把 BTC 与 ETH 都设为可执行标的，BTC 对 ETH 的系统性环境过滤继续生效。资金、仓位和杠杆由所有者自行管理。
