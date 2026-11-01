# 项目截图

[返回 README](../README.md) · [开发指南](development.md)

README 中的 PNG 均直接截取自本项目构建后的 Electron 应用界面，没有重绘界面、拼接控件或替换显示内容。

## 内容来源

| 文件 | 展示内容 | 数据来源 |
| --- | --- | --- |
| [home.png](images/home.png) | 浅色首页、每日推荐入口、音乐漫游和精选歌单 | 临时空资料目录，未登录；应用正常读取网易云公开推荐。封面与歌单名称可能随服务更新。 |
| [listening.png](images/listening.png) | 深色播放详情、大封面和独立评论面板 | 项目自带的隔离测试曲目“晚风经过”、合成听众及示例评论；音频为脚本临时生成的静音 WAV。 |
| [equalizer.png](images/equalizer.png) | 十段参数均衡器与前级 | 同一隔离示例会话；通过实际设置界面修改并应用示例参数，不是耳机校准建议。 |
| [mini-player.png](images/mini-player.png) | 独立悬浮播放卡片 | 同一示例曲目和实际播放进度，独立 Electron 窗口。 |

示例账号与曲目定义在 [`src/main/test-fixtures.ts`](https://github.com/kuranshi/Libitum-Music/blob/cd3e41b993a879b77c572cc9591c3bbd00e2950c/src/main/test-fixtures.ts)。这些画面展示应用交互，不代表真实账号的收藏同步、会员权限、硬件音频或桌面窗口置顶已完成验收；验证边界见 [VALIDATION.md](../VALIDATION.md)。公开推荐中的封面和内容来自网易云服务，相关权利归原权利人所有。

## 拍摄环境

- 日期：2026-11-01。
- Ubuntu 22.04.5 LTS x86_64，Node.js 24，项目锁定的 Electron 45.2.1。
- 使用生产构建的 main / preload / renderer，以 Electron 无头模式截取应用内容区。
- 首页与播放详情窗口为 1440 × 940，PEQ 为 1440 × 1100，悬浮卡片为 280 × 64；截图不包含系统窗口装饰。
- 明确设置浅色或深色主题，使用系统字体与应用原有样式。

## 更新截图

准备好[开发环境](development.md)，再执行：

```bash
npm ci
# 若 Electron 二进制尚未安装：
node node_modules/electron/install.js
npm run build
node scripts/capture-readme.cjs --public-home
npm run audit:release
```

`--public-home` 会先启动未登录的正常应用，等公开推荐和封面加载完成后截取首页；这一阶段需要网络，不会登录或播放真实歌曲。随后启动独立的示例会话，截取播放详情、PEQ 和悬浮卡片。更新另外三张图而保留首页时，可省略该参数；仅更新卡片可使用 `node scripts/capture-readme.cjs --mini-only`。

脚本仅使用新建的临时资料目录，不读取已有配置、Cookie、历史、下载或私人媒体；结束后关闭应用并删除临时目录。示例音频由本地临时 HTTP 服务提供，mpv 在测试模式中使用空输出，不播放到硬件。此流程不启用频谱采集。

截图脚本沿用隔离 Electron 流程的无头启动参数，其中 `--no-sandbox` 仅用于这次临时截图过程，普通安装与日常启动请使用 README 中的命令。

四个 PNG 是专门审核的公开文档资源，在 `.gitignore` 和发布审计中按文件名放行。测试截图、运行日志、个人媒体和账号数据仍保持忽略。DEB 附带这些公开图片与指南供离线阅读；AppImage 不包含文档截图，应用本身也不加载它们。
