# Forge AI IDE

Forge 是基于 [Code - OSS](https://github.com/microsoft/vscode) 的独立桌面 IDE，把官方 [Codex](https://github.com/openai/codex) 作为原生 Agent 运行时嵌进工作台。它不是 VS Code 扩展，也不另开一套聊天壳：编辑器仍是主界面，Codex 在可独立缩放的侧栏里工作。

当前源码面向 **Windows x64**。产品名称为 Forge AI IDE，应用标识为 `forge-ai`。

## 能做什么

- **完整 IDE**：编辑器、终端、SCM、Problems、通知、扩展体系沿用 Code - OSS。
- **原生 Codex**：通过官方 `codex app-server`（JSON-RPC / stdio）驱动会话，不重写一套 Agent 运行时。
- **只保留 Codex**：Agent 窗口默认且仅展示 Codex，不再混入 Local / Copilot 会话类型。
- **流式改文件**：官方模型走原生 `apply_patch` 时，可边生成边出 Diff 预览；自定义模型走宿主 `write_file` 工具，完成后在编辑器里播放写入动画。
- **审批与变更**：补丁仍走 Codex 的审批与沙箱；完成后可在 Changes / Multi Diff 里 Accept、Reject、Revert。
- **账号与额度**：聊天标题和 Codex Settings 的 Account 页支持 GitHub / Codex 登录，展示剩余额度、身份与套餐（不展示已消耗量）。
- **自定义模型**：在 Codex Settings 里配置 OpenAI、DeepSeek、通义、Ollama、LM Studio 等提供商；保存的模型写入 `%USERPROFILE%\.forge\codex\forge-models.json`。
- **中文界面**：Codex Settings 的外观里可切换 Language；确认后可启用内置简体中文语言包。

## 和现有产品的关系

| | Forge | VS Code | Codex Desktop |
| --- | --- | --- | --- |
| 工作台 | Code - OSS 完整 IDE | 官方发行版 | 独立客户端 |
| Agent | 内置官方 Codex `app-server` | 需扩展或其它 Agent | 官方 Codex |
| 配置目录 | `%USERPROFILE%\.forge\codex` | 不适用 | `%USERPROFILE%\.codex` |
| 登录 | 可复用已有 `auth.json` / `config.toml` | GitHub 等 | ChatGPT / Codex |

首次启动时，Forge 只会从已有的 `%USERPROFILE%\.codex` **复制** `auth.json` 和 `config.toml`。模型缓存、会话和数据库不会与其它 Codex 客户端共用，避免两边升级不同步导致 schema 冲突。

## 仓库结构

```
src/                 # 工作台、Agent Host、Codex 桥接
extensions/          # 内置扩展
build/               # 编译、打包、Inno Setup
resources/           # 图标、安装向导图等
test/                # 单元 / 冒烟测试
scripts/             # 开发启动与 Forge 辅助脚本
└── forge/           # 启动器、Codex 暂存、检查上游
docs/                # 架构与路线图
codex/               # 上游 Codex 运行时与 app-server 源码
start-forge.cmd      # Windows 启动入口
product.json         # 产品名、协议、Windows 安装标识
```

更细的接缝说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，里程碑见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 环境要求

从源码构建时需要：

- Windows 10/11 x64
- [Node.js](https://nodejs.org/) **24.18.x**（见 `.nvmrc`）
- Git
- 打包安装包时还需要仓库自带的 Inno Setup（`node_modules/innosetup`）以及一次完整的 `vscode-win32-x64` 发布构建

日常双击运行已打包的 `Forge.exe` 时，不要求本机安装 Node、Python、Visual Studio 或 Rust。

## 快速开始

### 已有发布目录

若本机已有 `.build\VSCode-win32-x64\Forge.exe` 或根目录的 `start-forge.exe`：

```bat
start-forge.cmd
```

也可以直接运行 `.build\VSCode-win32-x64\Forge.exe`。

### 从源码编译并启动

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

开发期也可用 `scripts\forge\dev.ps1` 传额外启动参数。

要用本地 `codex/` 源码编出的二进制，而不是 Code - OSS 钉死的官方包，可先运行：

```bat
scripts\forge\stage-codex.ps1
```

暂存成功后启动器会自动选用这份二进制。Forge 本身不重新实现 Codex 协议。

## Codex 使用说明

1. 打开右侧 Agent / 聊天窗，应默认就是 Codex。
2. 点 **Open Codex Settings**（或标题栏对应按钮）。
3. **登录 Codex**：走官方 OAuth；失败时设置页会给出具体错误，而不是无反应。
4. **模型提供商**：下拉选择云端或本地厂商；Ollama 会尝试读取本机 `ollama list`；云端需填写 Base URL 与 API Key。
5. 每个提供商、每个已保存模型名都有开关，打开后才会出现在 Agent 的模型列表里。

安装版 Codex 二进制位于 `node_modules.asar.unpacked\@openai\codex-win32-x64\...`。Agent Host 会优先从解包目录解析 `codex.exe`（Windows 上用存在性检查，而不是 Unix 的可执行位）。

对自定义 / 兼容接口模型，宿主会注册 JSON 工具 `write_file`（`path` + 完整 `contents`）。不要把该工具命名为 `apply_patch`：Codex 若已注册原生 `apply_patch`，重名会直接 panic。Windows 上也不要通过 `shell_command` 去调 `apply_patch.bat`。

## 打 Windows 安装包

在能完整构建的开发树里：

```bat
set BUILD_SOURCEVERSION=c125b2a2432ff78b2d1f7b8ed8b0c67cf3af6187
set VSCODE_QUALITY=stable
npm run gulp vscode-win32-x64
npm run gulp vscode-win32-x64-inno-updater
npm run gulp vscode-win32-x64-system-setup
```

产物默认在 `.build\win32-x64\system-setup\VSCodeSetup.exe`。发布目录是 `.build\VSCode-win32-x64`，其中应包含 `Forge.exe` 以及解包后的 Codex 原生二进制。未签名的安装包在 Windows 上可能出现 SmartScreen 提示。

`.gitignore` 会忽略 `node_modules/` 和 `.build/`。把工程拷到另一台机器时，需要重新 `npm install` 并构建，不能只拷源码目录就当发布版用。

## 数据与日志

| 路径 | 用途 |
| --- | --- |
| `%USERPROFILE%\.forge\codex` | Forge 专用 Codex home（配置、会话） |
| `%USERPROFILE%\.forge\codex\forge-models.json` | 自定义提供商与模型列表 |
| `%APPDATA%\.forge-ai\logs\` | 工作台与 Agent Host 日志 |

排查 Codex 起不来或登录无反应时，优先看：

`%APPDATA%\.forge-ai\logs\<日期>\window1\exthost\agenthost\agenthost.log`

## 架构（简图）

```
工作台 Chat / 编辑器 / 终端
        │
   Agent Host（会话状态、审批、FileEdit）
        │
   CodexAgent + 事件映射
        │  JSON-RPC over stdio
   codex app-server
        │
   Codex Core（工具、沙箱、MCP、技能）
```

流式补丁走 `item/fileChange/patchUpdated`；`write_file` 在落盘前拍完整快照，再交给同一套 Live Edit 预览。隐藏思维链不会被还原，界面只渲染 app-server 公开的摘要与状态。

## 许可证

源码以 [MIT](LICENSE.txt) 授权，主体来自 Microsoft 的 Code - OSS，并包含 OpenAI Codex 相关运行时。使用时请同时遵守上游项目的许可证与第三方声明（见 `ThirdPartyNotices.txt`）。
