<p align="right">
  <a href="./README.md">English</a>
</p>

# Noto Emoji Override

## 概述

Noto Emoji Override 是一个轻量级 Chrome 扩展，用于在网页中优先显示 Google Noto Color Emoji，同时不替换网站原本的正文字体。

它的范围刻意保持很窄：只单独包裹并设置 emoji，网页原来的正文、标题和代码字体会尽量保持不变。

## 功能

- 用轻量 span 包裹 emoji 字素簇，而不是全局覆盖 `font-family`。这些 span 使用 `display: contents`，不会给页面布局增加盒子。
- 页面自己的文本节点保持在原位，因此 React、Vue、Preact、Lit、Angular 等会继续使用这些节点的脚本可以照常工作。
- 在服务端渲染的页面上，会等页面框架接管标记之后才改动文字，让框架看到的页面和服务器发来的一致。
- 使用 `Intl.Segmenter` 保持常见 emoji 序列完整，包括旗帜、肤色、keycap 和 ZWJ 序列。
- 仅在扩展启用时使用 `MutationObserver` 处理动态页面更新，包括脚本原地改写的文本。
- 支持 open 和 closed 的 Shadow DOM root，包括元素出现后不久才挂载的 root。
- 避免改写 `input`、`textarea`、`select`、`contenteditable`、`pre`、`code`、`kbd`、`samp` 等编辑或代码区域，以及 Monaco 和 Ace 代码编辑器的内部。
- 提供全局启用/停用开关和 exact-host 站点屏蔽列表。关闭开关或屏蔽站点后，已打开页面里的文本会恢复原状。

## 安装

1. 下载或克隆这个仓库。
2. 打开 `chrome://extensions`。
3. 启用开发者模式。
4. 选择“加载已解压的扩展程序”，并选择 `extension/` 文件夹。

扩展需要 Chrome 111 或更高版本。

## 使用

- 点击扩展图标，用“停用”或“启用”在所有网页上关闭或打开 emoji 覆盖。
- 用同一个弹窗里的“在此站点停用”或“允许此站点”单独关闭或恢复当前站点（按 exact host）。
- 两者都会立即对已打开的页面生效，不需要刷新。
- 加载扩展后，可以打开 `tests/manual/index.html` 检查常见 emoji 序列和动态内容。要让扩展在本地文件上运行，需要先在 `chrome://extensions` 里为它打开“允许访问文件网址”。

站点屏蔽使用 exact-host 匹配。例如，屏蔽 `example.com` 不会自动屏蔽 `sub.example.com`。

## 隐私

扩展不会向任何地方发送浏览数据。它会存储：

- `enabled`：保存在 `chrome.storage.sync`，让全局开关随你的 Chrome 账号同步到其他设备。
- `blockedHosts`：保存在 `chrome.storage.local`，用于让站点屏蔽列表保留在当前浏览器配置内。

内容脚本会在匹配的网页中运行，因为扩展需要在页面 DOM 中本地检查文本节点。其中有一个很小的脚本运行在页面自己的环境里，用来判断页面框架是否已经启动完成。它只用“是”或“否”回答其他脚本，不读取别的内容，也不向任何地方发送数据。

完整隐私政策见 `PRIVACY.md`。

## 权限

- `storage`：保存全局开关和 exact-host 屏蔽列表。
- `activeTab`：用户打开扩展弹窗后，允许弹窗读取当前标签页 URL。
- `<all_urls>` 内容脚本匹配：允许扩展在可能出现 emoji 的网页中执行本地 DOM 处理。

## 技术说明

- Emoji 检测基于字素分割和 Unicode emoji 相关属性。这比按单个 code point 拆分更安全，但它仍然不是完整的 Unicode emoji 一致性测试实现。默认按文字显示的字符（例如 © 和 ™）只有在后面带 emoji 变体选择符时才算作 emoji。
- 含 emoji 的文本节点会被清空并留在原位，它的文字由紧跟在后面的节点显示：普通文本，以及每个 emoji 一个 span。页面之后再写入、移除或移动这个节点时，这些节点会随之被替换、移除或移动。节点所在的元素被移出文档期间（例如被缓存的视图）也是如此；包裹只在文档内进行，所以这类元素里的新文字要等元素回到文档后才会被包裹。
- 关闭扩展时，添加的节点会被移除，每个文本节点恢复原来的文字。如果其他脚本在此期间改动过这些节点（例如调用 `normalize()`），包裹用的元素会留在页面里，但不再带有样式。
- 服务端渲染的标记靠服务器留下的痕迹来识别：React、Vue、Svelte、Solid 放在文字之间和区块两端的注释，以及 Next.js、Nuxt、Gatsby、Docusaurus、Angular 用作渲染容器的元素。在这样的文档里，框架接管标记（hydration）之前不做任何包裹。对 React 和 Vue，接管完成的时刻是准确知道的：`scripts/page_probe.js` 运行在页面自己的环境里，能看到这些框架留在节点上的标记，并用“是”或“否”回答其他脚本。Angular 和 Vue 2 在接管时会把标记上的属性去掉。其他框架则按时间判断：文档解析完成、文档里的脚本都已运行，并且页面连续两次进入空闲。
- closed Shadow DOM root 通过 `chrome.dom.openOrClosedShadowRoot` 访问。
- 处理工作放在浏览器空闲时分片进行，所以在动态更新非常频繁的页面上，新内容可能会短暂显示为系统 emoji，然后才被包裹。
- 脚本原地改写的文本：如果已经确认该脚本每次都写入完整文本，会立即包裹；否则在文本停止变化后不久包裹。对流式输出的文本来说，就是在输出结束或暂停之后。

## 已知限制

- `input` 和 `textarea` 不能单独包裹其中的 emoji 字符，因此扩展会保持这些区域不变。
- 如果页面把 emoji 渲染成图片或 canvas 内容，则不在扩展处理范围内。
- 内联 SVG 和 MathML 元素绘制的文字保持不变，因为 HTML 包裹元素在其中不会被渲染。`<foreignObject>` 里的 HTML 照常处理。
- 如果脚本是在文本节点上原地追加内容（`appendData`、`nodeValue +=`），而不是写入完整文本，扩展无法把它和“替换文本”区分开。因此仍在增长的文本要等停止后才会被包裹。如果这类脚本在停顿一两秒以上之后继续追加，它之前显示的文字会丢失一次，之后该节点不再被包裹。
- Solid 以及 Svelte 3、4 在文本节点已经是新值时会跳过写入。这类页面把一段已被包裹的文字设为空字符串来清除时，文字会继续显示。
- 在服务端渲染的页面上，emoji 在页面框架接管之前保持系统样式，通常是页面加载完成后不到一秒。没有常见服务端渲染痕迹的页面识别不出来；比其余部分晚很多才被接管的部分也不会等，例如滚动到可见时才 hydrate 的 island，或等待超过几秒的 Suspense 边界。由脚本在加载之后放进页面、随后再 hydrate 的标记同样识别不出来。这些地方的文字会像以前一样被提前包裹，React 随后报告 hydration 错误并在浏览器里重新渲染这一部分，页面最终是正确的。
- 元素出现半分钟之后才挂载的 shadow root，或者页面加载完成后才挂载到非自定义元素上的 shadow root，不会被发现。
- 框架（`<iframe>`）里的内容不处理：扩展只在标签页的顶层文档里运行。
- 用 `cloneNode` 复制已包裹的内容时，包裹元素和被清空的文本节点会一起被复制，而扩展并不认识这份副本。之后如果脚本按位置改写副本里的文本节点，新文字会和旧文字同时显示。
- 页面的 `line-height` 保持 `normal` 时，开着扩展后带 emoji 的行可能比关闭时矮几个像素：系统的 emoji 字体会把这样的行撑高，而包裹元素不让内置字体这样做。
- Chrome 自带的网页翻译会把每个包裹元素当作句子的断点，所以中间带 emoji 的句子会被分段翻译。文字和 emoji 不会丢失，恢复显示原文也正常。
- 如果页面使用特殊的自定义文本渲染，扩展可能无法影响这些内容。

## 开发

`extension/` 里的扩展是纯 JavaScript 和 CSS，没有依赖，也没有构建步骤，Chrome 直接加载这个文件夹。周边的工具需要 Node.js 22 或更高版本。

```bash
npm install        # ESLint，只有检查时用到
npm run lint
npm test           # 先跑单元测试，再跑浏览器测试
npm run check      # 先 lint，再跑全部测试
npm run package    # dist/noto-emoji-override-<版本号>.zip
```

- `tests/unit/` 检查 emoji 识别、设置存储、对页面原地改写文本的判断，以及打包脚本，不需要浏览器。
- `tests/browser/` 把扩展的脚本加载到无头 Chrome 的页面里，检查它们在页面上的实际行为，其中一个测试文件会安装扩展本身。这些测试使用本机安装的 Chrome，找不到时会跳过；如果 Chrome 不在常见位置，请设置 `CHROME_PATH`。
- `tests/manual/index.html` 是用来肉眼检查的页面。

`npm run package` 会用 `extension/` 生成上传 Chrome 应用商店的 zip，并加入仓库根目录的 `LICENSE`、`NOTICE`、`PRIVACY.md` 和 `THIRD_PARTY_LICENSES.md`。发布时请用这个命令，而不是直接压缩文件夹，因为字体的许可证必须随字体一起分发。要对打好的包运行浏览器测试，把它解压后将 `EXTENSION_DIR` 设为解压出的文件夹即可。

## 第三方资源

打包的 `extension/fonts/NotoColorEmoji.ttf` 文件来自 Google Noto Emoji，并按照 SIL Open Font License 1.1 单独授权。其中 Chrome 用不到的 OpenType-SVG 表已被移除，以减小安装包体积。详情见 `THIRD_PARTY_LICENSES.md`。
