# Crypto Alpha Pro Ultimate — 统一安装与交付索引

本文只描述安装资产和受控流程。当前源码身份以 ops/release-manifest.json 为准；实际生产状态以新的发布证据为准。没有全部最终门槛的证据时，不称稳定交付。

## 唯一源码入口

- 源码仓库：https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary
- 本轮审核分支：https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/tree/integration/r5-freeze-candidate-20261031
- 唯一运行入口：main-v188.js。仓库保留的旧 worker.js 等不是本轮入口。
- 依赖、配置、分钟任务与持久状态协议保持；同名构建不足以证明源码一致。
- 发布、预检和本次失败回退见 R5_INSTALL_AND_FINAL_GATES.md；本轮验证与完整需求矩阵见 docs/。

## 完整私有安装资料

在公开仓库中不保存用户的私有完整指令和课程。使用原ZIP与 ops/assemble-delivery.py 装配；不得把CI工程候选ZIP当作完整安装包。

| 位置 | 资产 | 处理 |
|---|---|---|
| 后台 | 01_CODE/main-v188.js 与 wrangler.jsonc | 由受控发布完成，实际通过前不要求用户上传 |
| GPT核心指令 | 02_INSTRUCTIONS/CRYPTO_ALPHA_V27_INSTRUCTIONS.txt | 完整7979字符；本轮原样保留；已安装正确时不重复替换 |
| GPT知识 | 03_KNOWLEDGE/CRYPTO_ALPHA_V27_KNOWLEDGE_FULL.md | 完整课程与规则原样保留；已安装正确时不重复上传 |
| 四条入口 | 02_INSTRUCTIONS/CONVERSATION_STARTERS.txt | 原四条，不删减 |
| 完整开场白 | 02_INSTRUCTIONS/FULL_OPENING_MESSAGE.txt | 只同步实际验收构建标识，不改策略 |
| 500字内开场白 | 02_INSTRUCTIONS/OPENING_UNDER_500.txt | 403字符；不是完整核心指令的替代品 |
| 操作架构 | 06_ACTION/openapi.json | 7.6.0、四项操作，与源码生成结果全文核对 |

现有GPT入口：https://chatgpt.com/g/g-6a7aa3acb8e48191a49c95d59396fa77-crypto-alpha-pro-ultimate-v13-1

架构链接：https://crypto-alpha-api-v17-canary.id-mranran.workers.dev/openapi.json?v=27.6.0

已有授权和令牌保留；不要把令牌写入聊天、URL或包内。不能读取GPT实际保存配置时，只能证明安装文件正确，不能声称实际已经安装。

## 最后验收与恢复

助手完成工程回归、精确部署、前后台/协议、十分钟严格窗口、新闻消费和故障恢复核对。只读最终文案见 USER_ACCEPTANCE.md。通信测试已获用户实收确认，不重复发送；不制造交易信号。

最终安装位置数按实际保存状态核实，不把所有资产一律要求重新上传。当前代码/配置/依赖/原交易规则只有在全部最终验收完成后才冻结。更新缺陷不顺带改变策略或新增收费。

历史验收文档保留其原有范围和时间，不能用旧R3/R4通过替代当前源码的生产证据。回滚只针对本次已核对的部署和上一版本，保留持久状态；若部署已被他人更新则停止回滚。
