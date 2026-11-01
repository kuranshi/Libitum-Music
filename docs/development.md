# 开发与构建

[返回 README](../README.md) · [使用指南](user-guide.md) · [更新日志](../CHANGELOG.md) · [验证记录](../VALIDATION.md)

项目使用 Electron、React、TypeScript、electron-vite 和系统 mpv。下列命令说明开发与验证流程，执行结果应以对应环境的实际输出为准。

## 环境要求

| 组件 | 用途 |
| --- | --- |
| Node.js 24、npm | 依赖安装、开发、构建与测试 |
| mpv ≥ 0.34.1 | 播放与 lavfi PEQ |
| FFmpeg | 壁纸视频转换、媒体集成检查；视频导入需要 `libx264` |
| pulseaudio-utils | 播放流监听与音频检查 |
| libsecret、已解锁的桌面密钥环 | 持久加密账号会话 |
| dpkg-deb、du | 生成 `.deb` |
| Docker、网络 | 可选的 Ubuntu 22.04 隔离兼容检查 |

原生 PipeWire 输出的频谱识别还需要 `pw-dump`，Ubuntu 可由 `pipewire-bin` 提供。普通开发应在桌面用户会话中进行。

## 启动开发环境

```bash
git clone --branch test-other-platform https://github.com/kuranshi/Libitum-Music.git
cd Libitum-Music
npm ci
npm run dev
```

若 Electron 安装脚本尚未运行，可先执行：

```bash
node node_modules/electron/install.js
```

预览生产构建：

```bash
npm run build
npm run preview
```

`npm run build` 会先进行 TypeScript 检查，再编译 main、preload 与 renderer，输出位于 `out/`。

## 源码导航

| 目录或文件 | 职责 |
| --- | --- |
| `src/main/index.ts` | Electron 生命周期、IPC、窗口、会话和服务协调 |
| `src/main/provider.ts` | 网易云接口调用、账号与内容操作 |
| `src/main/qqmusic-provider.ts`、`qqmusic-runtime.ts` | QQ 字段转换、扫码、会话与本机 MQTT 连接 |
| `src/main/platform-router.ts` | 未登录默认网易云、登录候选与活动平台隔离、过期结果丢弃 |
| `src/main/player.ts`、`mpv.ts` | 播放状态、队列协调与 mpv JSON IPC |
| `src/main/downloads.ts` | 下载任务及本地文件处理 |
| `src/main/media.ts` | 壁纸导入、转换与资源访问 |
| `src/main/spectrum*.ts` | 播放流监听、FFT 与频谱工作线程 |
| `src/preload/` | 受限的渲染进程接口 |
| `src/renderer/src/` | 页面、播放详情、卡片、设置与样式 |
| `src/shared/` | 类型、校验相关数据、歌词、PEQ 及外观算法 |
| `tests/` | 单元、集成与 Electron 流程测试 |
| `scripts/` | 安装包、运行检查与发布审计 |

网易云接口依赖锁定为 `@neteasecloudmusicapienhanced/api@4.41.1`，QQ 音乐锁定为 `@yakult-green-tea/qq-music-api@3.3.5`。QQ 在 worker 内调用公共 `serverless` 处理函数并注入本机 MQTT 连接，不加载会启动 HTTP 服务的包根入口，不需要部署代理。平台字段由各自 provider 转换为现有歌曲、歌单、歌词和播放结构，renderer 和 mpv 继续复用。

默认仅初始化网易云；选择 QQ 登录才创建 QQ runtime，登录候选不会提前切换活动平台。账号提交、取消和恢复沿用现有 safeStorage 流程，旧版未标记平台的数据按网易云迁移。项目不启用跨平台替代音源。当前范围不包括音乐云盘、手机号验证码、多账号并行、网易云／QQ 以外的平台及应用内自动更新。

## 验证命令

| 命令 | 范围 |
| --- | --- |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 单元测试 |
| `npm run test:e2e` | 先构建，再运行 Playwright Electron 流程 |
| `npm run test:media` | 媒体资源、视频转换及 PEQ 集成 |
| `npm run test:network` | 真实公开接口，需要网络 |
| `npm run test:audio` | 先构建，再检查真实音频链路及频谱 |
| `npm run test:desktop` | 先构建，再检查桌面窗口运行 |
| `npm run audit:release` | 源码发布允许列表与敏感内容检查 |

常用的本地检查：

```bash
npm run typecheck
npm test
npm run test:media
npm run test:e2e
```

网络与音频检查对运行环境有额外要求，应按需要分别执行：

```bash
npm run test:network
npm run test:audio
npm run test:desktop
```

单元及 Electron 流程使用明确启用的合成测试数据与临时目录。模拟账号只在未打包、显式启用测试模式时可用，正式安装包不能通过测试环境变量启用。公开网络检查不使用真实账号。

音频检查使用隔离测试音频和临时虚拟输出，不录制麦克风，结束后清理。它们不等同于物理设备有声试听、拔插设备或各桌面环境的长期验收。项目历史检查结果与未覆盖项集中记录在 [VALIDATION.md](../VALIDATION.md)，不要将已有记录当作每次修改后都已重新执行。

### 真实账号验收

QQ 公开接口与未扫描二维码可以独立检查，不接入真实账号：

```bash
LIBITUM_QQ_PUBLIC_SMOKE=1 npx vitest run tests/unit/qqmusic.test.ts
LIBITUM_QQ_QR_SMOKE=1 npx vitest run tests/unit/qqmusic.test.ts
```

前者会访问公开目录，仍可能遇到 QQ 业务拒绝或旧歌单 CGI 超时；后者只生成 QQ 音乐 App 二维码、确认本机 MQTT 等待状态并取消，不自动完成登录。普通 `npm test` 会跳过这两项联网检查。

完整账号验收请使用自己的账号在应用内登录完成：收藏及取消一个歌单、一个专辑，在官方客户端核对，再重启检查状态。不要将真实凭证写入自动化脚本或测试样例。模拟收藏流程通过不证明服务端权限、风控或真实同步已通过验收。

当前 `test-other-platform` 分支对应双平台测试版 [`v0.3.0-rc.1`](https://github.com/kuranshi/Libitum-Music/releases/tag/v0.3.0-rc.1)，应用版本为 `0.3.0-rc.1`。发布状态与实际验证范围应同时核对[更新日志](../CHANGELOG.md)、验证记录与 Releases。

### Ubuntu 22.04 隔离兼容

先生成 `.deb`，再运行：

```bash
npm run package:deb
npm run test:ubuntu22
```

若 Docker 桥接 DNS 不可用，可显式使用主机网络，不修改本机 DNS 配置：

```bash
LIBITUM_COMPAT_NETWORK=host npm run test:ubuntu22
```

脚本使用公开基础镜像，一次性容器只读挂载安装包与检查脚本，不挂载个人目录、音频 socket 或 Docker socket。检查包括依赖安装、正式模式启动、mpv、PK / LS / HS 滤镜、视频 H.264 编码及工具接口。

容器内 root 的 `--no-sandbox` 仅服务于隔离检查，不作为普通桌面启动方法。容器检查不覆盖 Ubuntu 22.04 实际桌面、硬件输出、设备拔插、系统密钥环和完整窗口管理器行为。

## 构建安装包

生成 AppImage 与 `.deb`：

```bash
npm run package
```

只生成 `.deb`：

```bash
npm run package:deb
```

只生成未压缩的应用目录：

```bash
npm run package:dir
```

产物位于 `release/`，当前目标为 Linux x86_64。安装包名为 `libitum-music-0.3.0-rc.1-x86_64.AppImage` 与 `libitum-music-0.3.0-rc.1-amd64.deb`。应用和 npm 版本为 `0.3.0-rc.1`，Debian 控制字段使用 `0.3.0~rc.1`，确保候选版先于未来正式版排序；文件名保留 SemVer 形式。Debian 内部包名和命令入口保持 `cloud-music-player`。构建配置位于 `package.json`，`.deb` 依赖由配置统一读取。

打包后可检查正式运行与包内内容：

```bash
node scripts/smoke-packaged.cjs --network
npm run audit:release -- --packaged
```

前者使用隔离目录检查正式包启动及真实公开首页；后者检查源码发布允许列表、敏感内容及 `release/linux-unpacked/resources/app.asar` 中的应用内容。执行前须已生成对应未压缩应用目录。工具输出通过只代表其实际检查范围。

## 公开文档与本机资料

仓库采用允许列表。依赖、构建目录、安装包、日志、会话、历史、下载、私人壁纸、私人 PEQ、测试截图及 Chromium 用户资料不应提交。不要使用强制添加绕过私人资料的忽略规则。

`docs/images/` 中经审核的项目展示截图是公开文档资源；它们与本机测试输出分开管理。截图应来自实际运行界面，使用示例数据时明确注明，发布前确认不含账号凭证、个人资料或私人路径。新增公开资源时，应同步核对 `.gitignore` 与 `scripts/audit-release.cjs` 的精确允许范围。

Release 附件仅包含明确生成的安装包及校验文件。应用运行时状态位于 `~/.config/cloud-music-player/`，不要将该目录用于仓库截图或测试输入。

## 许可证

项目使用 [MIT 许可证](../LICENSE)。第三方依赖说明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。mpv、FFmpeg 和 PulseAudio 工具通过系统单独安装，分别遵循各自许可证。
