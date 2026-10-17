---
name: video-render-check
description: Read-only health check of a code-video project's render chain — toolchain availability, spec/timeline frame-count consistency, and exported stream facts. Use when a render fails, when output looks wrong, or before claiming a video is delivered.
whenToUse: 代码视频制作中渲染失败、成片与规格不符、或在声称"已交付"之前需要一次只读核查时。
---

# 渲染链路只读核查

只取证，不修改工程、不重渲染、不安装依赖。核查顺序固定，先便宜后昂贵。

## 1. 工具链
调用 `video_render_capabilities` 取得真实路径：帧渲染器（Chrome/Edge/Playwright）、编码器（ffmpeg/ffprobe）、语音（edge-tts）、Node。结论以工具返回为准，不要用记忆或估计。缺失项要在结论里明确指出"这会导致什么"（例如无 ffmpeg ⇒ 无法输出 MP4）。

## 2. 方案自洽
读取 `spec/timeline.csv` 与 `spec/storyboard.yml`：
- 累计帧数 = 总帧数 = 时长 × fps（取整）；不一致就是方案错误，先修方案而非改代码。
- 每个镜头 id 在两份文件里都存在且时间区间不重叠。
- `spec/animation-guide.md` 引用的曲线/常量在全局常量表里存在。

## 3. 渲染产物
- 帧序列：文件数量是否等于预期帧数；命名是否连续无缺口（缺帧是卡顿的常见根因）。
- 单帧耗时日志：是否存在异常尖峰（超过均值 3 倍），尖峰帧在成片里表现为卡顿。
- 成片：用 `ffprobe` 读流（编码、像素格式、分辨率、帧率、时长、音频流），与 `spec/brief.md` 的规格逐项比较。
- 抽帧：在转场与运动镜头中点抽帧，用 `read_image` 目视核对运动连续与文字安全区。

## 4. 结论格式
```
链路：可用 / 部分可用（缺 <组件>，影响 <后果>）
方案：自洽 / 不自洽（<具体冲突>）
产物：帧序列 <数量>，成片 <ffprobe 摘要>
证据：<命令与帧文件名>
需修：<按优先级列出，无则写"无">
```
任何"通过"都必须对应上面的可复查证据；没有证据的项目写"未验证"，不要写成通过。
