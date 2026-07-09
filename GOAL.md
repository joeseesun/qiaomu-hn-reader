# Goal

```text
/goal 开发并上线 hn.qiaomu.ai 第一版：基于 HNRSS 官方 feed 能力，构建面向中文用户的 Hacker News 中文阅读网站与未来 iOS 可复用 API，支持主题订阅、筛选、DeepSeek V4 Flash 服务端翻译、乔木网站风格与 PWA 基础能力。
验证：读取 HNRSS 与 DeepSeek 官方文档；运行项目检查和 API smoke；启动本地站点，验证首页、主题切换、订阅、本地偏好、翻译降级/启用状态、API 文档、移动端布局；部署到乔木 VPS 后验证 HTTPS 首页、/api/health、/api/topics、/api/stories、/api/openapi.json、Umami 脚本、打赏/关注弹窗与社交链接。
约束：不做账号系统，不把 DeepSeek key 写入代码、日志、README 或公开前端；不破坏乔木服务器现有站点；不绕过 Git hooks 或直接推送默认分支；DeepSeek 模型名、HNRSS 能力和部署状态以实时验证为准。
边界：本地只写入 /Users/joe/Documents/Hackernews App 及必要部署进度记录；服务器只写入 hn.qiaomu.ai 对应独立应用目录、Nginx vhost、systemd/env 配置和必要 DNS/TLS 项。
迭代策略：先实现最小可用阅读/API 流程，再基于构建日志、API 响应、浏览器截图和 live curl 结果做聚焦改进；同一失败连续 2 次后更换证据来源。
完成条件：本地检查和 smoke 通过，线上 hn.qiaomu.ai 可访问，核心 API 返回真实 HNRSS 数据，翻译能力在有密钥时走 DeepSeek V4 Flash、无密钥时有明确降级，桌面/移动端无明显溢出或遮挡。
暂停条件：需要新购买服务、无法取得服务器/DNS/证书权限、生产站点存在高风险故障、DeepSeek 密钥缺失且用户要求必须现场验证真实翻译、或需破坏性迁移时暂停。
```
