# HyperWeave Desktop

HyperWeave Desktop 是面向 HyperWeave 平台的独立桌面 Agent 工作台。用户可创建不同角色的 Agent、绑定 HyperWeave 管理的 Skills、选择本地资料上传到平台知识库，并查看远程任务的进度、审批、结果和产物。

Agent 任务始终由 HyperWeave 平台在隔离沙箱中执行。桌面客户端不启动本地 Agent、终端执行器或 DeepSeek Harness runtime。打包客户端的 API 和目录请求只发往管理员配置的 HyperWeave 地址；外部导航和渲染进程网络请求会被拒绝。

本项目基于 [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop) 的 MIT 开源代码建立独立 fork，保留上游许可与第三方许可声明。HyperWeave Desktop 不连接 DSH 市场、遥测或更新服务。

业务插件已暂缓，已有接口保留供后续方案调整；当前交付不要求安装 Kata。

## 开发

需要 Node.js `^22.19.0` 或 `>=24.0.0`，并使用仓库锁定的 Yarn 4.18.0：

```sh
corepack yarn install --immutable
HYPERWEAVE_PLATFORM_URL=https://hyperweave.example.internal corepack yarn start
```

Windows PowerShell 可先设置平台地址：

```powershell
$env:HYPERWEAVE_PLATFORM_URL = 'https://hyperweave.example.internal'
corepack yarn start
```

也可以由管理员在 Electron `userData` 目录放置 `hyperweave-desktop.json`：

```json
{ "platformUrl": "https://hyperweave.example.internal" }
```

除本机 loopback 开发地址外，客户端只接受 HTTPS 平台地址。

## 验证与打包

```sh
corepack yarn check
corepack yarn verify:desktop
corepack yarn dist
corepack yarn verify:package
```

根目录的 `start` / `dev` 启动 HyperWeave，`build` 只构建 HyperWeave 主进程和工作台，`dist` 生成当前系统的安装包。`check` 可在无图形界面的环境执行；`verify:desktop` 会启动真实 Electron，Linux CI 使用 Xvfb。历史 DSH 默认命令保留为 `dsh:*`，显式的 Beta/Next 命令也仍属于上游维护工具，不用于 HyperWeave 发布。

Windows、macOS 和 Linux 的专用 CI 会分别构建 HyperWeave 安装包并检查应用内容；三个系统均启动 Electron 验证网络边界。当前任务由远程 HyperWeave runtime 执行，本地 Deep Agents runtime 属于后续独立执行适配器。

桌面客户端设计说明与安全边界见 [`dsh-desktop-next/HYPERWEAVE.md`](dsh-desktop-next/HYPERWEAVE.md) 和 [`dsh-desktop-next/HYPERWEAVE-ADAPTATION-REVIEW.md`](dsh-desktop-next/HYPERWEAVE-ADAPTATION-REVIEW.md)。

## 许可

项目采用 MIT License。请保留仓库中的上游版权、[`LICENSE`](LICENSE)、打包所带的 `LICENSE.upstream`、`LICENSES.third-party.txt`，以及 Electron/Chromium 随应用分发的许可文件。
