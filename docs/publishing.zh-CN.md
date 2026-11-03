# 发布指南

[English](publishing.md) · 中文

四个渠道用同一份代码：`npm run build` 生成 `dist/chrome`、`dist/firefox`、`dist/safari` 和两个 zip。商店文案在 [store/listing.md](../store/listing.md)，图片在 `store/`，隐私政策是 [PRIVACY.md](../PRIVACY.md)（需要放到一个公开网址，比如 GitHub 仓库）。

发布前先做两件事：

1. 在 `package.json` 里确认版本号。每次上传新版本都必须比上一版大。
2. 把 `scripts/build.mjs` 里的 Firefox 扩展 ID `inkpage@inkpage.app` 改成你自己的（例如 `inkpage@你的域名`）。**第一次上传后就不能再改**。

---

## Chrome 应用商店（同一个包也能上架 Edge）

1. 打开 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole)，用 Google 账号注册开发者。需要一次性支付 5 美元注册费，并验证邮箱。如果在欧盟地区面向用户发布，还要声明是否为“商家（trader）”。
2. 点“新增项”，上传 `dist/inkpage-chrome-<版本>.zip`。
3. **商品详情**：
   - 详细说明：复制 `store/listing.md` 里的英文。再添加“中文（简体）”语言，粘贴中文版。
   - 类别：无障碍（Accessibility），或 效率 › 工具。
   - 截图：英文用 `store/en/1-4`，中文用 `store/zh/1-4`。
   - 小宣传图：`promo-440x280.png`。大宣传图（可选）：`marquee-1400x560.png`。
4. **隐私权**：
   - 单一用途、每个权限的理由：照抄 `store/listing.md` 里的表格。
   - 远程代码：选“否”。
   - 数据使用：所有类别都不勾，然后勾选三项声明。
   - 隐私政策网址：填 PRIVACY.md 的公开地址。
5. **分发**：选公开，所有地区，然后提交审核。权限里含“所有网站”的扩展通常审核得更细，一般几天内出结果。

**Edge 加载项**：在 [Microsoft 合作伙伴中心](https://partner.microsoft.com/dashboard/microsoftedge/overview) 免费注册，上传同一个 Chrome zip，文案和图片照搬即可。

## Firefox 附加组件（AMO）

1. 用 Firefox 账号登录 [AMO 开发者中心](https://addons.mozilla.org/developers/)，免费。
2. 点“提交新附加组件”，选“在本网站上发布”（listed），上传 `dist/inkpage-firefox-<版本>.zip`。自动检查应为 0 错误（`npm run lint:firefox` 本地可以先跑一遍）。
3. 被问到是否用了压缩或打包工具时，选“否”。所有代码都是可读源码（Readability 也是官方未压缩版），所以不需要另外上传源码包。
4. 填写详情：
   - 摘要（250 字以内）：用简短说明。详细说明：复制 `store/listing.md`。
   - 类别：外观、无障碍。
   - 许可证：自己选，比如 MIT。注意包内的 Readability 是 Apache-2.0，三款字体是 SIL OFL，许可证文件都已经在包里。
   - 隐私政策、截图、支持邮箱。
5. 自动检查会剩下两条警告：“Unsafe assignment to innerHTML”，位置在 `vendor/Readability.js`。它们来自 Mozilla 官方的 Readability 0.6.0 原版文件，只对一份复制出来、不显示在页面上的文档操作。可以在“给审核员的备注”里写：
   > vendor/Readability.js is the unmodified upstream Mozilla Readability 0.6.0 (https://github.com/mozilla/readability). Its innerHTML assignments run on a detached clone of the document used for article extraction.
6. 提交后会先自动签名，人工审核可能在上架后进行，一般几小时到几天。manifest 里已经声明“不收集数据”，最低版本是 Firefox 140 / 安卓 Firefox 142。

## Safari：Mac 直接分发（不需要 Xcode）

和 Tact 一样，只用命令行工具和 Developer ID 证书：

```bash
npm run safari:app                                  # 生成并签名 dist/InkPage.app
INKPAGE_NOTARY_PROFILE=<notarytool 配置名> npm run safari:app   # 另外生成公证过的 DMG
```

- 会自动使用钥匙串里的 “Developer ID Application” 证书，也可以用 `INKPAGE_SIGN_IDENTITY` 指定。Bundle ID 默认是 `io.github.wyh0626.inkpage`，可以用 `INKPAGE_BUNDLE_ID` 修改。
- 用户打开 DMG，把 InkPage 拖进“应用程序”，打开一次，然后在 Safari → 设置 → 扩展 里勾选墨页，并允许它访问网站。
- 发布方式和 Tact 一样：DMG 放到 GitHub Releases 或网站上供下载。

## Safari：App Store（iPhone / iPad，可同时带上 Mac）

iPhone 和 iPad 上的 Safari 扩展只能通过 App Store 安装，而 iOS 版只能用 **完整版 Xcode** 打包（命令行工具里没有 iOS 的开发包）。你已有 Apple 开发者账号（团队 PFM45ATWW9），不需要再付费。

**推荐分工**：iPhone / iPad 走 App Store；Mac 继续用上面的 DMG 直接分发。如果以后 Mac 也想上 App Store，用同一个 Bundle ID 一起提交即可，用户一次购买两端通用。

1. **装 Xcode**：在 Mac App Store 安装 Xcode，打开一次，同意许可协议。要用模拟器，还得下载 iOS 平台组件（Xcode → 设置 → Components，或运行 `xcodebuild -downloadPlatform iOS`，约 8 GB）。
2. **生成工程**（同时包含 iOS / iPadOS 和 macOS 两个 App）：
   ```bash
   npm run safari:xcode
   ```
   工程生成在 `safari-app/InkPage/`，并自动补上转换工具模板里缺的东西：
   - `safari/xcode` 里的 App 说明页：中文或英文，显示扩展是否已开启；iOS 26.2 及以后还有一个按钮，直接跳到墨页的设置页；
   - 用 `store/icon-1024.png` 生成的各尺寸图标；
   - `package.json` 里的版本号、团队 PFM45ATWW9（自动签名），以及“未使用非豁免加密”的出口合规声明。

   可以用 `INKPAGE_BUNDLE_ID`、`INKPAGE_TEAM_ID`、`INKPAGE_BUILD`（构建号，同一版本每上传一次就加 1）修改这些设置。每次运行都会重新生成工程，所以要改的话改 `safari/xcode`，不要改 `safari-app`。
3. **签名**：用 Xcode 打开 `InkPage.xcodeproj`。先在 Xcode → 设置 → Accounts 里登录你的 Apple ID。团队已经设好，Signing & Capabilities 里应该没有报错。
4. **测试**：选一个 iPhone 或 iPad 模拟器运行。然后打开“设置”App：
   - iOS 18 及以后：设置 → App → Safari → 扩展 → 墨页，打开，并把“所有网站”设为允许；
   - iOS 17：设置 → Safari → 扩展 → 墨页。

   回到 Safari，点地址栏的“大小”按钮（aA），就能看到墨页。真机测试只需用数据线连接设备，选它运行即可。
5. **上传**：运行 `npm run ios:upload`，自动打包并上传到 App Store Connect，上传后也会出现在 TestFlight 里，可以先装到自己的 iPhone / iPad 上试用。同一版本再次上传要加大构建号：`INKPAGE_BUILD=2 npm run ios:upload`。（在 Xcode 里用 Product → Archive 会先按开发版签名，团队没有登记任何设备时会失败；这个脚本先不签名打包，导出时再签 App Store 发布证书。）
6. **App Store Connect**：在 [App Store Connect](https://appstoreconnect.apple.com/) 新建 App，平台选 iOS，Bundle ID 选上一步的那个。
   - App 隐私：选“不收集数据”，隐私政策网址填 PRIVACY.md 的公开地址。
   - 截图（必填）：iPhone 6.1 / 6.3 英寸（1206×2622，`store/ios/zh/iphone63-*.png`）和 13 英寸 iPad（2064×2752，`store/ios/zh/ipad-*.png`），每种 1–10 张。App Store Connect 会自动缩放到其他尺寸，英文页面也沿用这组截图。1320×2868 的原图（iPhone 18 Pro Max 模拟器，iOS 27.2）保留为 `iphone-*.png`。
   - 说明、关键词、支持网址：说明可直接用 `store/listing.md` 的中文 / 英文文案。
   - 审核备注：写明如何启用扩展（设置 → App → Safari → 扩展 → 墨页），并说明 App 本身只是扩展的载体。
7. **提交审核**：在 App Store Connect 里选择刚上传的构建版本，提交审核，通常 1–3 天出结果。

## 从 GitHub 自动发版

`.github/workflows/release.yml` 会在你推送 `v` 开头的标签时自动运行：

```bash
git tag v1.2.0
git push origin v1.2.0
```

它会按标签设置版本号并打包，然后：
1. 把新版本提交到 Firefox、Chrome、Edge 三个商店（每个版本仍然要经过商店审核）；
2. 在 GitHub 的 macOS 机器上打包 Safari Mac 版，签名、公证后生成 DMG；
3. 把 iPhone / iPad 版上传到 App Store Connect；
4. 新建 GitHub Release，附上所有安装包。

哪个商店的密钥还没配置，就跳过哪个，所以可以一个一个慢慢接入。密钥填在仓库的 Settings → Secrets and variables → Actions 里，也可以用 `gh secret set 名称` 设置。

| 商店 | 密钥 | 从哪里拿 |
|---|---|---|
| Firefox | `AMO_JWT_ISSUER`、`AMO_JWT_SECRET` | AMO 开发者中心 → 工具 → [管理 API 密钥](https://addons.mozilla.org/developers/addon/api/key/) |
| Chrome | `CHROME_EXTENSION_ID`、`CHROME_CLIENT_ID`、`CHROME_CLIENT_SECRET`、`CHROME_REFRESH_TOKEN` | 先手动上架一次，拿到扩展 ID；再按 [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys) 的步骤，在 Google Cloud 开启 Chrome Web Store API 并生成 OAuth 凭据 |
| Edge | `EDGE_PRODUCT_ID`、`EDGE_CLIENT_ID`、`EDGE_API_KEY` | 先手动上架一次；再到合作伙伴中心 → Microsoft Edge → 发布 API，创建 API 凭据 |
| Safari Mac（DMG） | `MACOS_CERT_P12`、`MACOS_CERT_PASSWORD` | 在“钥匙串访问”里把 “Developer ID Application: Eric Wang” 证书（连同私钥）导出为 .p12，然后 `base64 -i 证书.p12 \| pbcopy` |
| | `ASC_KEY_P8_BASE64`、`ASC_KEY_ID`、`ASC_ISSUER_ID` | App Store Connect → 用户和访问 → 集成 → App Store Connect API，新建一个“管理”（Admin）角色的密钥（用于公证，以及 iPhone / iPad 版签名），把下载的 .p8 文件转成 base64 |
| iPhone / iPad | 上面三个 `ASC_…` 密钥，再加一个仓库**变量** `IOS_APP_STORE` = `true` | Settings → Secrets and variables → Actions → Variables。等 App Store Connect 里建好 App 之后再打开 |

注意：
- 标签里的版本号必须比各商店上现有的版本大。
- iPhone / iPad 版用工作流的运行编号作为构建号，上传后出现在 App Store Connect（和 TestFlight）里。提交审核仍需要在那里点一下：在新版本里选这个构建，点“提交以供审核”。

## 每次发版的检查清单（Safari Mac 版另跑 `npm run safari:app`）

```bash
npm run build
npm run check:i18n
npm run lint:firefox
python3 -m http.server 8765 &      # 在项目根目录
node test/e2e.mjs                   # Chrome 端到端 25 项
```

再用 Safari 打开 `http://localhost:8765/test/fixture.html?ext&selftest`，确认标题显示 PASS。
