# Store listing copy · 商店文案

Copy-paste text for the Chrome Web Store, Edge Add-ons, Firefox Add-ons (AMO) and the App Store.
可直接粘贴到 Chrome 应用商店、Edge 加载项、Firefox 附加组件站和 App Store。

Images · 图片: `store/en/*.png`, `store/zh/*.png` (1280×800), `promo-440x280.png`, `marquee-1400x560.png`, `icon-1024.png`.

---

## English

**Name** (from the manifest): InkPage — E-ink Reading Mode

**Short description** (manifest, 127 / 132 characters):
Calm black-on-white pages for e-ink and paper-like screens: page turns that never cut a line, plus an e-reader-style book view.

**Detailed description**

InkPage makes the web comfortable to read on e-ink tablets, paper-like monitors and any screen you want to keep calm.

TWO WAYS TO READ
• Web page mode keeps a site's own layout and links and repaints it in ink on paper. Dark backgrounds turn to paper, menus and pop-ups stay opaque and readable, fixed headers and cookie bars stop following you, and animations, autoplaying video and GIFs stop.
• Book view keeps just the article and re-typesets it like an e-reader. Pick the font, size, line spacing and margins; pages turn a screen (or a two-page spread) at a time; the footer shows your page, progress and time left; it remembers where you stopped.

PAGE TURNS THAT NEVER CUT A LINE
Space, Page Down, the arrow keys, a tap on the screen edges or one flick of the wheel turns exactly one page. A line cut by the bottom edge is held back and opens the next page instead.

FIVE PAPER TONES
White, gray, warm, green and night, with optional paper grain and soft edge shading.

MADE FOR E-INK
A full-screen refresh to clear ghosting (by hand or every few pages), bolder text for thin web fonts, and a picker to hide clutter you never want to see again.

Every switch is remembered per site. English and Chinese interface.

PRIVATE BY DESIGN
No account, no tracking, no network requests. Settings stay in your browser.

Shortcuts: Alt+Shift+E on/off · Alt+Shift+B book view · Alt+Shift+R refresh the screen.

**Category**: Chrome → Accessibility (or Productivity › Tools) · Firefox → Appearance, Accessibility

**Single purpose** (Chrome): Make web pages comfortable to read on e-ink and paper-like screens.

**Permission justifications** (Chrome “Privacy practices” tab)

| Permission | Why |
|---|---|
| `storage` | Saves the user's per-site switches, hidden-element choices and book reading positions locally. |
| `scripting` | Loads the book-view code (Mozilla Readability and the typesetter) only into a page where the user turns book view on. |
| Host access `<all_urls>` | The user can turn the reading mode on for any site, so the content script has to be able to restyle any page. Nothing is read out of or sent from the page. |
| Remote code | No. All code ships in the package. |

**Data usage**: none of the listed data types is collected. Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

**Privacy policy URL**: host `PRIVACY.md` (for example on GitHub) and paste its address.

---

## 中文

**名称**（来自 manifest）：墨页 InkPage · 墨水屏阅读模式

**简短说明**（manifest）：
把网页变成墨水屏友好的黑白页面：按屏翻页、永不切半行，还有像电子书一样排版翻页的书页模式。

**详细说明**

墨页让网页在墨水屏平板、类纸显示器，以及任何你想让它安静下来的屏幕上都好读。

两种阅读方式
• 原网页模式：保留网站原本的版式和链接，改成白纸黑字。深色背景变成纸色，菜单和弹窗保持不透明、不叠字，固定顶栏和 cookie 条不再跟着滚动，动画、自动播放视频和 GIF 全部停下。
• 书页模式：只留正文，像电子书一样重新排版。字体、字号、行距、页边距都能调；一次翻一屏（宽屏是双页对开）；页脚显示页码、进度和剩余时间；下次打开回到上次读到的地方。

翻页永不切半行
空格、PageDown、方向键、点屏幕两侧或滚轮一拨，都正好翻一页。被屏幕底边截断的那一行会留到下一页开头。

五种纸张配色
白纸、灰白纸、暖纸、护眼绿、夜读，可加纸纹和边缘明暗。

为墨水屏而做
全屏黑白刷新清残影（手动或每隔几页自动），细字体可加粗，一键隐藏页面上不想看的元素。

每个网站的设置分别记住。中英文界面。

隐私
不需要账号，不追踪，不联网。所有设置只存在你的浏览器里。

快捷键：Alt+Shift+E 开关 · Alt+Shift+B 书页模式 · Alt+Shift+R 清屏刷新。

**单一用途**：让网页在墨水屏和类纸屏幕上更好读。

**权限说明**：同上方英文表格（商店后台只需英文填写）。
