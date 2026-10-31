# Crypto Alpha Pro Ultimate — R5 受控交付说明（待生产验收）

> **注意**：此文件是部署/验收操作说明，不代表 R5 已经上线。不得用线上 R4 的结果冒充 R5；不能以代码测试通过宣称交易盈利。

## 交付身份（只对应唯一源代码）

- 源码分支：`integration/r5-freeze-candidate-20261031`
- Worker 构建：`crypto-alpha-worker-v27.6.3-macro-r5b`
- 接口协议：`7.6.0`；状态拥有者协议：`owner-local-dispatch-v1`
- Wrangler 唯一入口：`main-v188.js`
- 文件精确源码 SHA：见 `ops/release-manifest.json`，经 `test-release-identity.mjs` 强制核对。
- Cloudflare Worker: https://crypto-alpha-api-v17-canary.id-mranran.workers.dev
- GPT Action 架构：https://crypto-alpha-api-v17-canary.id-mranran.workers.dev/openapi.json?v=27.6.0
- GPT 编辑器现有入口：https://chatgpt.com/g/g-6a7aa3acb8e48191a49c95d59396fa77-crypto-alpha-pro-ultimate-v13-1
- 开场白：`GPT_OPENING_V27_6_3_CANDIDATE.txt`，长度为 438 个 Unicode 字符（不超过500字）。该文件是开场白，不替代原完整核心指令或原知识库。

## 最小必要改动位置

1. **Cloudflare**：只部署验收通过的 `main-v188.js`，保留 Wrangler 依赖锁、Cron `* * * * *` 和原 `SCANNER_STATE / ScannerState` 持久命名空间；现有安全令牌不可打印或覆盖。受控发布工作流会核对部署UUID、历史版本及持久绑定。
2. **GPT Actions（操作）**：原四个操作仍按 API 7.6.0。未直接读取 GPT 编辑器的实际保存状态时，标记「尚待终审」，不要假称已安装更新。不要重新上传旧备份作为当前代码。
3. **GPT Instructions（指令）与知识文件**：继续保留既有完整交易规则、课程和知识库，不重做、不删减。开场白可沿用上述 438 字文本；只有旧版文字确实不符时才做必要替换。

## 发布步骤（GitHub Actions 自动运行）

1. 完成完整 Node（节点环境）/ native workerd（原生 Cloudflare 运行环境）回归、官方新闻源解析及故障注入测试。
2. 检查当前生产仍为 R4，Cloudflare 部署 ID `f18315e1-0726-4d3d-9f5e-4011f7770b5d`，Durable Object（持久对象）指纹 `aedfbcd14cd1`，实时 OKX 买卖盘和八模型回执正常。
3. **仅当上述门槛满足**，由 `.github/workflows/r5-controlled-release.yml` 中「经审核唯一源提交」的发布意图触发生产更新。审核文件必须是唯一修改，不能夹带其他文件。
4. 记录部署前 R4 的实际 Cloudflare 版本 UUID（不是臆测），部署后记录新部署 UUID、运行版本和状态绑定。
5. 核验前后台构建/状态协议匹配，观察超过10分钟的分钟扫描与八模型回执持续推进（不能只看180秒新鲜度）。
6. 请求 `/?view=news` 后再读取扫描器状态，把逐源抓取批次与后台消费批次逐一比对；这是只读观察，不制造通知或交易信号。
7. 失败时仅允许回滚本次 R5 部署到已经核验的 R4 版本；如果线上被其他人更新，**停止而不盲目回退**。保留故障和恢复证据。
8. 只有生产闭环及 GPT 实际配置核实后，才标记稳定基线并交付最终版。

## 必须保留的限制

- R4 线上独立审计 2026-10-31 的 BLS CPI、就业、PPI 和日历均 HTTP 403；旧缓存不能作为新鲜数据。R5 增加了逐源回执保留，但不能靠该修复消除上游 403。需要真实备用数据/网络出口验证。
- 已接入美国财政部 2年/10年**日度**国债收益率，绝不是盘中实时收益率；DXY 实时数据仍未连接。不得根据旧收益率冒充实时交易方向。
- 准备交易提醒必须等真正合格事件出现才有完整实盘链路证据；不能篡改净 RR>=1:2、止损/目标及模型规则来制造信号。
- 已有 Bark 服务接收与一次用户确认实收不等于每一类通知完整生产送达；GPS/心理/仓位数据未知不得作为交易权限阻断。
- 回测、纸上交易、真实成交与胜率必须分开记录。没有完整可复核数据时，不宣称盈利已验证。

## 验收材料

- R4 实际部署：https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/41020415424
- R4 新闻逐源审计（揭示状态精简回执遗漏与 BLS 403）：https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/41157063416
- R5 的代码回归和生产发布记录以本分支后续成功的 Actions 运行、实际发布构建和部署 UUID 为准；未成功前不得伪填。
