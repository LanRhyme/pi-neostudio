<div align="center">

# Pi NeoStudio

<p>
  <a href="https://www.npmjs.com/package/pi-neostudio"><img alt="npm" src="https://img.shields.io/npm/v/pi-neostudio?style=for-the-badge&logo=npm&logoColor=white&color=CB3837"></a>
  <a href="https://github.com/LanRhyme/pi-neostudio/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/pi-neostudio?style=for-the-badge&color=946ce6"></a>
  <a href="https://github.com/badlogic/pi-mono"><img alt="pi" src="https://img.shields.io/badge/pi-coding%20agent-0B7F6E?style=for-the-badge"></a>
</p>

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面，fork 自 [agegr/pi-web](https://github.com/agegr/pi-web)
读取本机会话文件，会话管理、实时对话、模型配置、技能管理、Git 操作、用量统计与内嵌浏览器一站搞定

![Screenshot](https://raw.githubusercontent.com/LanRhyme/pi-neostudio/main/docs/screenshot2.png)

</div>

## 功能特性

- **会话管理**：按项目浏览历史对话，全文搜索、Fork、会话内分支，长会话不再像黑箱
- **实时对话**：结构化 Markdown、思考块流式展开、逐字动画、自动滚动跟随、工具调用结果渲染
- **Git 面板**：状态与历史查看、拉取/推送/同步、分支切换、手动提交与 **AI commit**（自定义提示词、模型和参数）
- **内嵌浏览器**：应用内打开网页，外部链接先确认再跳转，可把页面内容直接插入对话
- **用量统计**：GitHub 风格贡献网格展示每日 token 与费用，支持按模型、按会话明细
- **工作区管理**：侧边栏切换、创建、删除 Git worktree，新会话与文件浏览跟随 checkout
- **模型与技能配置**：Models 面板管理模型、登录/API key、模型测试，Skills 面板管理技能开关
- **莫兰迪主题**：预设配色加自定义颜色，聊天气泡跟随主题色，深色中性灰阶适配
- **桌面版**：以 Electron 应用运行整个工作区，见[桌面版](#桌面版)

## 兼容性

| 平台 | 运行方式 | Node.js | 状态 |
| ------ | --------- | --------- | ------ |
| Linux | npm / npx | 22.19.0+ | 完全支持 |
| Windows | npm / npx | 22.19.0+ | 完全支持 |
| macOS | npm / npx | 22.19.0+ | 完全支持 |

桌面版安装包见 [Releases](https://github.com/LanRhyme/pi-neostudio/releases)

## 安装

**无需安装，直接运行**

```bash
npx pi-neostudio@latest
```

**或全局安装后使用**

```bash
npm install -g pi-neostudio
pi-web
```

启动后打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)，命令行版本会在服务就绪后尝试自动打开浏览器
Pi NeoStudio 默认仅监听 `127.0.0.1`

### 可选参数

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 0.0.0.0       # 在可信网络中开放访问
pi-web -p 8080 -H 0.0.0.0       # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # 显式开放网络访问
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # 允许指定的代理或自定义主机名
PI_WEB_PASSWORD='足够长的随机密码' pi-web  # 启用 Basic Auth（用户名固定为 pi）
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启
```

设置 `PI_WEB_PASSWORD` 后，网页和所有 API 端点都会启用 HTTP Basic Auth，用户名固定为 `pi`
Pi NeoStudio 可以调用高权限智能体，Basic Auth 不加密传输中的密码，不要把明文 HTTP 暴露到互联网，远程访问应使用可信反向代理提供 HTTPS 或通过可信 VPN

## HTTP 代理

服务端模型请求和 API 请求读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量

macOS 或 Linux

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx pi-neostudio@latest
```

Windows PowerShell

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx pi-neostudio@latest
```

## 桌面版

Electron 桌面应用打包同一套工作区

```bash
npm install
npm run desktop        # 构建网页并启动 Electron
npm run desktop:dev    # 针对正在运行的 dev server（30141）启动 Electron
npm run desktop:start  # 针对已有构建启动 Electron
```

打包发布用

```bash
npm run dist:linux     # AppImage / deb
npm run dist:win       # NSIS 安装包
npm run dist:mac       # dmg（需 macOS 或 CI）
```

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://127.0.0.1:30141](http://127.0.0.1:30141)

常用检查

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server，发布流程再执行构建

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions`，可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录
- **用量统计**：用量记录保存在 pi agent 目录下的 `pi-web-usage.jsonl`，实时记录并回填历史数据
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件，"Edit from here" 是同一会话文件里的分支

## 目录结构

- `app/api`：AgentSession 驱动与 SSE、认证、Git、模型、会话、技能、用量、worktree 等 API 路由
- `components`：AppShell、会话侧边栏、聊天窗口、内嵌浏览器、Git 面板、设置对话框、用量统计等 UI 组件
- `lib`：rpc-manager、session-reader、HTTP dispatcher、文件访问边界、用量记录等核心逻辑
- `hooks`：会话状态机、主题、音频、拖拽、UI 设置等 React hooks
- `bin`：npm CLI 入口 `pi-web.js`
- `electron`：Electron 主进程 `main.cjs`
- `docs`：worktree、i18n、发布流程等文档
