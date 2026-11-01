# BLS持续采集修复与验收计划（2026-11-01）

状态：本分支R5g是未部署研发候选。实际生产仍R5f、部署f11b44aa-0e29-4260-8104-c12fef44a68a、版本f7b3fdd9-0053-4ee0-83a8-4802ba0fc7fe、原状态指纹aedfbcd14cd1。没有把候选当正式交付，没有新增付费服务或改变八模型、净RR、通知模式、止损与目标。

## 隔夜实证

合并源码d5083d1之后已取得4次真正的schedule采集，触发北京时间为10月31日22:41:58、11月1日02:48:54、05:57:34、08:58:10。相邻间隔为4小时6分56秒、3小时8分40秒、3小时0分36秒，未满足原10分钟目标。4次定时运维巡检（41217200376、41235370960、41249881235、41261448904）均因BLS四源超过原20分钟期限而失败。不能把已配置cron（定时配置）或采集任务显示成功写成持续正常。

其中多数采样的实际行情、分钟扫描、八模型成功回执继续推进，也保留了真实429备用成功、过期成交拒绝及至少两次完整报价路径不可用后的恢复记录。样本不是全天连续监控或零错误保证。自然准备提醒尝试仍为0；B1研究到区不能替代完整准备事件实证。

[GitHub官方调度说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)明确调度可能延迟或丢弃；这里只确认本仓库发生了超期，未推断GitHub内部具体排队原因。根因是把需要20分钟内更新的备用链路依赖于没有准点保障的启动机制，不能通过延长数据期限掩盖。

[隔离Cloudflare出口实测41270976261](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/41270976261)：原请求及增加诚实客户端标识后，四个官方地址仍403；临时无状态测试Worker已删除，生产身份前后不变。因此没有发布无实证的“改User-Agent（客户端标识）即可恢复”补丁。

## 必要最小修复

现有Cloudflare分钟任务独立维护官方备用：四份原文达到10分钟更新点时，向本仓库同一官方采集工作流发受认证的workflow_dispatch（受控触发）。采集代码固定到明确源标签；原文、哈希、官方URL、认证接收和原20分钟期限保留。HTTP（响应码）200/204只代表请求接收，必须继续观察真实原文回执和扫描消费。

请求前落盘短期租约，并发合并和重启去重；未取得新源回执时2/4/8分钟有界重试；限流尊重Retry-After（重试等待时间），授权失效明确停用，凭据变更可重新核验。实际交易规则和未知账户状态处理不动，不产生测试信号或通知。

跨平台实证已取得[41271839680](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/41271839680)：临时隔离Worker调用候选函数，GitHub返回真实运行41271851069；该任务真实读取四个官方源，随后扫描器消费12:07:51（北京时间）的四个新批次。临时资源清理、去重和原生产身份均验证。此轮使用作业临时凭据，只是兼容性/网络验证，不能冒充生产持续授权或长期续采证明。

## 凭据与受控上线

专用凭据名称GITHUB_ACTIONS_DISPATCH_TOKEN（持续触发密钥）。目前生产中未发现此项。当前连接工具的授权不能作为Cloudflare后台永久凭据；GitHub作业令牌在任务结束失效。代码只从这个明确的仓库密钥取持续授权，绝不把作业测试令牌装入生产。

用户仅需在GitHub仓库的Settings（设置）→ Secrets and variables（密钥与变量）→ Actions（工作流）增加一个同名repository secret（仓库密钥）。凭据为仅选择本仓库、Actions Read and write（工作流读写）的fine-grained token（细粒度令牌）；不需要Contents Write（代码写入）或交易所权限。令牌只填GitHub密钥页面，不发聊天。到期/撤销会停止触发并报告授权问题，不继续将旧数据认作新鲜。

受控发布时通过锁定Wrangler的--secrets-file把新代码与专用密钥一次上传，原密钥保留；文件仅临时0600权限，成功/失败均清理。已使用合成值完成编译演练，未把值编入运行代码。用户不需要手动部署、修改Cloudflare或重传原安装材料。

持续授权到位后才可验证其实际权限、创建候选采集源标签、发出锁定源/父提交的发布意图、核验原F部署/绑定并部署。工作流继续原十分钟37点严格验收；另增加25分钟纯被动状态窗口，要求四源每点有效、实际工作流为workflow_dispatch（受控触发）且来自固定源提交，并至少两次相隔9分钟以上的新批次成功消费，第二次不早于窗口18分钟。不把手动补取、早期重试或旧回执算续采。任一门槛失败按原守卫恢复精确上一版本。

完整原核心7979字符、知识58530字符、4操作架构及默认ACTIONABLE_ONLY（仅完整准备提醒）均保持。GPT实际保存配置、自然准备提醒及收益证据仍独立待验，不要求用户重做基本功能测试或重复Bark通信测试。正式稳定冻结仍等待最终验收。

## 最少一次配置入口

[创建细粒度授权（已预填工作流读写）](https://github.com/settings/personal-access-tokens/new?name=CryptoAlpha-BLS-Dispatch&target_name=iwiiiuzZ&actions=write)：选择Only select repositories（仅选指定仓库），只选-crypto-alpha-api-v17-canary，保留Actions Read and write（工作流读写），核对到期日后生成。只将值填入[本仓库密钥入口](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/settings/secrets/actions)，名称GITHUB_ACTIONS_DISPATCH_TOKEN（持续触发密钥）。不要把值发到聊天、代码或截图。配置后由助手核验权限、部署、续采和回归，用户不承担基础测试。

依据：[细粒度权限与触发接口](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)、[作业令牌生命周期](https://docs.github.com/en/actions/concepts/security/github_token)、[代码与密钥同时上传](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code)。

## 最终代码与真实单轮核验（2026-11-01 17:38，北京时间）

代码提交[e64208ca38f861ee20705ae79e9c2c5d168eacb5](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/tree/e64208ca38f861ee20705ae79e9c2c5d168eacb5)，Worker源码Git blob为75cd9af6323b90fcf411a1ff661a3bb3c7c2e81e，SHA-256为e5b5b43bf3364d408c1d308f94be361a104c34fe90f8afbadc61f5078b29e5b6。本地和[CI41293876705](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/41293876705)实际59组全部通过，含8组原生workerd检查；隔离夹具不算生产验证。

[最终隔离实测41293876720](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/41293876720)使用上述精确候选函数。真实受控触发[41293910898](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/41293910898)固定到crypto-alpha-collector-r5f-20261031标签及d5083d1ead0dbb2ea19ed624d11792bdfcbab7e0提交，任务成功；四源抓取17:37:14.877—17:37:14.913，扫描消费17:38:25.153，17:38:38.766观察确认四源均ok。起始观察时四源仍为15:22:43批次且过期；恢复后状态与先前失败一并保留。去重未额外发第二次请求，临时Worker删除确认，生产精确部署、版本和原绑定不变，无交易信号、无设备推送。

此轮实际检查仓库专用密钥存在=false、生产同名密钥存在=false，使用EPHEMERAL_TEST_JOB_ONLY（仅测试作业临时授权）。它没有装入生产；因此不能把兼容性/真实单轮消费判为G生产安装或持续续采已通过。G默认来源标签、长期权限、25分钟两次自主续采仍待受控上线验证。

[修复PR5](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/pull/5)保持草稿。发布意图未修改，主分支与生产仍F。最终单轮、CI和隔夜失败JSON均保存在本分支evidence/，没有用绿色结果覆盖失败。
