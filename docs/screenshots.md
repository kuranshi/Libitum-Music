# 项目截图

[返回 README](../README.md) · [使用指南](user-guide.md) · [开发指南](development.md)

本页七张 PNG 均直接截取自当前源码构建的 Electron 应用，没有重绘界面、拼接控件或替换显示内容。所有页面只使用项目内置的合成账号、曲目、歌单与评论，不展示真实账号、头像、个人歌单、下载记录或音乐文件。

## 内容来源

| 文件 | 展示内容 | 数据来源 |
| --- | --- | --- |
| [home.png](images/home.png) | 浅色首页、每日推荐入口、音乐漫游和精选歌单 | 未登录的隔离示例会话；推荐与封面占位图均为合成数据，不请求公开音乐目录。 |
| [platform-accounts.png](images/platform-accounts.png) | 两端启用开关、同时登录及各自账号操作 | 内置“测试听众”与“QQ测试听众”，没有真实头像或账号标识。密钥环不可用提示保留实际状态。 |
| [search-netease.png](images/search-netease.png) | “晚风”在网易云音乐端的搜索结果 | 内置示例曲目与歌手，底部保留同一首示例歌曲。 |
| [search-qq.png](images/search-qq.png) | 同一关键词切换到 QQ 音乐结果 | QQ 内置示例曲目与歌手，切换后底部歌曲不变。 |
| [listening.png](images/listening.png) | 深色播放详情、大封面和独立评论面板 | 合成曲目“晚风经过”、合成听众与示例评论；音频是脚本临时生成的静音 WAV。 |
| [equalizer.png](images/equalizer.png) | 图形频响、十段控制点、增益／Q 滑杆与前级 | v0.3.0-rc.2 中的编辑器；同一示例会话，通过真实界面修改并应用示例参数，不是耳机校准建议。 |
| [mini-player.png](images/mini-player.png) | 独立悬浮播放卡片 | 同一示例曲目和真实播放器进度，独立 Electron 窗口。 |

示例定义见 [`test-fixtures.ts`](../src/main/test-fixtures.ts) 与 [`qqmusic-fixtures.ts`](../src/main/qqmusic-fixtures.ts)。画面仅展示交互，不代表真实账号权限、同步或硬件验收已完成；边界见[验证记录](../VALIDATION.md)。

## 拍摄环境

- 日期：2026-11-02；图形均衡器配图更新于 2026-11-03。
- 使用项目锁定的 Electron 45.2.1 与生产构建的 main / preload / renderer，以无头模式拍摄应用内容区。
- 首页、播放详情及搜索为 1440 × 940，账号卡片为 1440 × 1100，图形 PEQ 为 1440 × 1400，悬浮卡片为 280 × 64；截图不包含系统窗口装饰。
- 使用应用原有样式和系统字体，明确选择浅色或深色主题；不启用频谱采集。

## 复现截图

准备好[开发环境](development.md)，再执行：

```bash
npm ci
# 若 Electron 二进制尚未安装：
node node_modules/electron/install.js
npm run build
node scripts/capture-readme.cjs
npm run audit:release
```

默认命令会拍摄全部七张合成示例图；`--mini-only` 仅更新卡片，`--equalizer-only` 仅更新均衡器。旧的 `--public-home` 选项可额外请求未登录的真实公开首页，但本页此次图片没有使用该选项。

脚本只使用新建临时资料目录，不读取已有配置、Cookie、历史、下载或私人媒体；结束后关闭应用并删除临时目录。示例音频由本地临时 HTTP 服务提供，mpv 使用空输出，不播放到硬件。截图参数中的 `--no-sandbox` 仅用于这次隔离无头流程，日常运行使用 README 中的命令。

七个 PNG 按文件名在 `.gitignore` 与发布审计中放行；其他图片、运行日志和账号数据仍保持忽略。DEB 将这些公开文档与图片放在离线文档目录，AppImage 不包含文档截图，应用运行时也不加载它们。
