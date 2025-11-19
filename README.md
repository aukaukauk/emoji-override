# Noto Emoji Override / Noto Emoji 覆盖

## Overview / 概述
- **Smart Replacement**: Wraps emoji sequences in lightweight spans to apply Google's Noto Emoji font *only* to emojis, preserving the original font of the surrounding text.
- **智能替换**: 通过脚本自动包裹 emoji 序列，仅对表情应用 Noto Emoji 字体，完美保留网页原有字体（如衬线体、等宽代码等）。
- **SPA Support**: Supports Shadow DOM and dynamic content (e.g., ChatGPT, Gemini).
- **SPA 支持**: 支持 Shadow DOM 和动态内容（如 ChatGPT, Gemini）。
- **Fallback**: Comes with bundled Noto Emoji fonts.
- **后备字体**: 内置 Noto Emoji 字体，即使系统未安装也可以显示 Google 风格表情。

## Installation / 安装
1. Download or clone this repository.
   - 下载或克隆此仓库。
2. Open Chrome → chrome://extensions → enable Developer Mode → Load unpacked → choose the `extension/` folder.
   - 打开 Chrome → chrome://extensions → 启用开发者模式 → “加载已解压的扩展程序” → 选择 `extension/` 目录。

## Usage / 使用
- Click the extension icon and press the button to enable or disable the override.
- 点击扩展图标，使用按钮启用或关闭表情覆盖。
- Use “Block This Site” / “Unblock This Site” to maintain a per-site block list (based on domain).
- 通过 “Block This Site” / “Unblock This Site” 按钮维护站点黑名单（基于域名）。
- Refresh pages (or open any page with emoji) to confirm the Noto Emoji style.
- 刷新页面（或任意包含表情的页面）验证是否显示为 Noto 风格。

## Technical Details / 技术细节
- Uses `TreeWalker` and `MutationObserver` to efficiently scan and wrap emojis.
- 使用 `TreeWalker` 和 `MutationObserver` 高效扫描并包裹表情。
- Recursively traverses Shadow DOM to support Web Components.
- 递归遍历 Shadow DOM 以支持 Web Components。
- Skips `input`, `textarea`, and contentEditable elements to avoid interfering with editing.
- 跳过 `input`, `textarea` 和可编辑元素，避免干扰输入。

## Known Issues / 已知问题
- Inputs and Textareas still use a global font override for emojis to work, which might affect the font of the entire input field.
- 输入框和文本域为了显示表情，仍然使用整体字体覆盖，可能会影响输入框内的字体样式。
- Very dynamic pages (streaming text) may momentarily show system emoji before the wrapper updates.
- 极高频动态页面（如流式文本）可能短暂出现系统表情，脚本会很快重新包裹。

