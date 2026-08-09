# Pi NeoStudio

[English](./README.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

基于 [pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面，fork 自 [agegr/pi-web](https://github.com/agegr/pi-web)
Pi NeoStudio 读取本机 pi 会话文件，在浏览器里提供会话管理、实时对话、模型配置、技能管理、项目文件预览、Git 操作、用量统计和内嵌浏览器

![Pi NeoStudio 以结构化 Markdown、工具调用和项目导航展示与 CLI 相同的 pi 会话](https://raw.githubusercontent.com/LanRhyme/pi-neostudio/main/docs/screenshot2.png)

CLI 与 Pi NeoStudio 中的同一会话：结构化工具调用、可读的 Markdown、会话浏览与更清爽的结果

## 快速开始

Pi NeoStudio 要求 Node.js 22.19.0 或更高版本，可通过 `node --version` 检查

**无需安装，直接运行**

```bash
npx pi-neostudio@latest
```

**或全局安装后使用**

```bash
npm install -g pi-neostudio
pi-web
```

启动后打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)
命令行版本会在服务就绪后尝试自动打开浏览器
Pi NeoStudio 默认仅监听 `127.0.0.1`

**可选参数**

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
未设置或设置为空值时禁用认证

Pi NeoStudio 可以调用高权限智能体
Basic Auth 不加密传输中的密码，因此不要把明文 HTTP 暴露到互联网
远程访问时应使用可信反向代理提供 HTTPS，或通过可信 VPN 访问
API 请求仅接受 loopback 名称、IP 字面量、当前监听主机名，以及 `PI_WEB_ALLOWED_HOSTS` 中以逗号分隔的精确主机名
可信反向代理使用不同的外部主机名时，请配置该变量

## HTTP 代理

Pi NeoStudio 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量

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

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径
- **放心试不同方向**：可以从某条历史消息重新开始，也可以 fork 出一条独立的新路线，探索方案时不怕弄乱原来的对话
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF，适合边让 agent 改边检查结果
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理
- **统计每天的 token 用量**：设置里的用量标签页用 GitHub 风格贡献网格展示每日 token、费用，以及按模型和按会话的明细
- **会话搜索**：在侧边栏按文本搜索历史对话
- **工作区管理**：在侧边栏切换、创建和删除 Git worktree
- **Git 面板**：查看状态和历史，拉取、推送、同步、切换分支、提交
- **AI commit**：用 LLM 生成提交信息，支持自定义提示词、模型和参数
- **内嵌浏览器**：在应用内浏览器标签页打开网页，外部链接先弹确认，可在应用内打开而不跳出
- **设置对话框**：自动滚动、逐字动画、思考自动展开、动画强度、完成提示音、字体大小、主题等
- **莫兰迪主题**：预设配色加自定义颜色，聊天气泡跟随主题色
- **桌面版**：以 Electron 应用运行整个工作区，见[桌面版](#桌面版)
- **界面多语言**：在顶部栏切换受支持的界面语言

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件，可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [Pi NeoStudio 里的 Worktree](./docs/worktrees.zh-CN.md)
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件，"Edit from here" 是同一会话文件里的分支
- **国际化**：翻译使用与新增语言或界面文案的方法见 [Internationalization](./docs/i18n.md)
- **用量统计**：用量记录保存在 pi agent 目录下的 `pi-web-usage.jsonl`，Pi NeoStudio 实时记录每条助手消息的用量，打开用量标签页时也会从会话文件回填历史数据

## 桌面版

Electron 桌面应用打包同一套工作区

```bash
npm install
npm run desktop        # 构建网页并启动 Electron
npm run desktop:dev    # 针对正在运行的 dev server（30141）启动 Electron
npm run desktop:start  # 针对已有构建启动 Electron
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

开发时不要运行 `next build` / `npm run build`
它会写入 `.next/`，容易影响正在运行的 dev server，发布流程再执行构建

## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/browse/     # 服务端目录浏览
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    file-index/     # Explorer 文件索引
    git/            # status、log、diff、操作与 AI commit 生成
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    sessions/search # 会话全文搜索
    skills/         # skills 列表、搜索、安装、启停
    usage/          # token 用量汇总与明细
    worktrees/      # git worktree 管理
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # 项目选择、会话树、搜索、Explorer、工作区管理
  DirectoryPicker.tsx # 支持浏览和路径输入的工作目录选择器
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
  SimpleBrowser.tsx   # 内嵌浏览器标签页
  GitPanel.tsx        # git 状态、历史、拉取/推送/同步、提交
  SettingsDialog.tsx  # 流式、外观、git、用量设置
  UsageStats.tsx      # 每日 token 用量网格与明细
lib/
  directory-browser.ts # 目录规范化和安全枚举工具
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理配置
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
  usage.ts            # 用量记录持久化与回填
  git-changes.ts      # git diff/status 工具
  model-scope.ts      # enabledModels 作用域解析
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
  useUiSettings.tsx   # UI 设置 store
bin/
  pi-web.js           # npm CLI 入口
electron/
  main.cjs            # Electron 主进程
instrumentation.ts    # 初始化服务端 HTTP dispatcher
```
