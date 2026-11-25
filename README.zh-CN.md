<p align="right">
  <a href="./README.md">English</a>
</p>

# Noto Emoji Override

## 概述

Noto Emoji Override 是一个轻量级 Chrome 扩展，用于在网页中优先显示 Google Noto Color Emoji，同时不替换网站原本的正文字体。

它的范围刻意保持很窄：只单独包裹并设置 emoji，网页原来的正文、标题和代码字体会尽量保持不变。

## 功能

- 用轻量 span 包裹 emoji 字素簇，而不是全局覆盖 `font-family`。这些 span 使用 `display: contents`，不会给页面布局增加盒子。
- 使用 `Intl.Segmenter` 保持常见 emoji 序列完整，包括旗帜、肤色、keycap 和 ZWJ 序列。
- 仅在扩展启用时使用 `MutationObserver` 处理动态页面更新。
- 支持可发现的 open Shadow DOM root。
- 避免改写 `input`、`textarea`、`select`、`contenteditable`、`pre`、`code`、`kbd`、`samp` 等编辑或代码区域，以及 Monaco 和 Ace 代码编辑器的内部。
- 提供全局启用/停用开关和 exact-host 站点屏蔽列表。

## 安装

1. 下载或克隆这个仓库。
2. 打开 `chrome://extensions`。
3. 启用开发者模式。
4. 选择“加载已解压的扩展程序”，并选择 `extension/` 文件夹。

## 使用

- 点击扩展图标可以全局启用或停用 emoji 覆盖。
- 使用 “Block This Site” 或 “Unblock This Site” 管理当前 exact host。
- 加载扩展后，可以打开 `extension/test/index.html` 检查常见 emoji 序列和动态内容。

站点屏蔽使用 exact-host 匹配。例如，屏蔽 `example.com` 不会自动屏蔽 `sub.example.com`。

## 隐私

扩展不会向任何地方发送浏览数据。它会存储：

- `enabled`：保存在 `chrome.storage.sync`，用于让全局开关在 Chrome 配置间同步。
- `blockedHosts`：保存在 `chrome.storage.local`，用于让站点屏蔽列表保留在当前浏览器配置内。

内容脚本会在匹配的网页中运行，因为扩展需要在页面 DOM 中本地检查文本节点。

完整隐私政策见 `PRIVACY.md`。

## 权限

- `storage`：保存全局开关和 exact-host 屏蔽列表。
- `activeTab`：用户打开扩展弹窗后，允许弹窗读取当前标签页 URL。
- `<all_urls>` 内容脚本匹配：允许扩展在可能出现 emoji 的网页中执行本地 DOM 处理。

## 技术说明

- Emoji 检测基于字素分割和 Unicode emoji 相关属性。这比按单个 code point 拆分更安全，但它仍然不是完整的 Unicode emoji 一致性测试实现。
- 被包裹的 emoji 使用 `font-family: var(--emoji-override-font-family, inherit)`，所以关闭扩展后，已经包裹过的 span 会在视觉上重新继承网页字体。
- 扩展无法检查或修改 closed Shadow DOM。
- 在动态更新非常频繁的页面上，新插入的内容可能会短暂显示为系统 emoji，然后再被队列中的 DOM 处理替换。

## 已知限制

- `input` 和 `textarea` 不能单独包裹其中的 emoji 字符，因此扩展会保持这些区域不变。
- 如果页面把 emoji 渲染成图片或 canvas 内容，则不在扩展处理范围内。
- 内联 SVG 和 MathML 元素绘制的文字保持不变，因为 HTML 包裹元素在其中不会被渲染。`<foreignObject>` 里的 HTML 照常处理。
- 页面原地改写的文本（例如通过 `nodeValue`）会继续使用系统 emoji。
- 如果页面使用特殊的自定义文本渲染或 closed Shadow DOM，扩展可能无法影响这些内容。

## 第三方资源

打包的 `extension/fonts/NotoColorEmoji.ttf` 文件来自 Google Noto Emoji，并按照 SIL Open Font License 1.1 单独授权。详情见 `THIRD_PARTY_LICENSES.md`。
