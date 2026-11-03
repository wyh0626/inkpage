// InkPage for Safari on macOS: the app only exists to carry the extension. It shows
// whether the extension is on and opens Safari's Extensions settings.
// `extensionBundleID` comes from Generated.swift, written by scripts/build-safari-app.sh.
import Cocoa
import SafariServices

let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") ?? false
func text(_ en: String, _ zh: String) -> String { chinese ? zh : en }

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let status = NSTextField(wrappingLabelWithString: "")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 96).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 96).isActive = true

        let title = NSTextField(labelWithString: text("InkPage", "墨页 InkPage"))
        title.font = NSFont(name: "Georgia", size: 26) ?? .systemFont(ofSize: 26, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString: text(
            "E-ink reading mode for Safari. Turn it on in Safari's Extensions settings, then click the InkPage button in Safari's toolbar on any page.",
            "Safari 的墨水屏阅读模式。在 Safari 的扩展设置里打开它，之后在任意网页点工具栏上的墨页按钮即可。"))
        subtitle.alignment = .center
        status.alignment = .center
        status.textColor = .secondaryLabelColor

        let open = NSButton(title: text("Open Safari Extensions Settings…", "打开 Safari 扩展设置…"),
                            target: self, action: #selector(openSettings))
        open.bezelStyle = .rounded
        open.keyEquivalent = "\r"

        let stack = NSStackView(views: [icon, title, subtitle, status, open])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.edgeInsets = NSEdgeInsets(top: 32, left: 36, bottom: 30, right: 36)
        stack.translatesAutoresizingMaskIntoConstraints = false
        subtitle.widthAnchor.constraint(equalToConstant: 380).isActive = true

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 400),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = text("InkPage", "墨页 InkPage")
        window.contentView = stack
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refresh()
    }

    // Safari doesn't say whether the extension is on until asked; ask on launch and on focus.
    func applicationDidBecomeActive(_ notification: Notification) { refresh() }

    private func refresh() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleID) { state, error in
            DispatchQueue.main.async {
                if let state {
                    self.status.stringValue = state.isEnabled
                        ? text("The extension is on.", "扩展已开启。")
                        : text("The extension is off.", "扩展还没有开启。")
                } else {
                    self.status.stringValue = text("Open Safari once so it finds the extension.", "先打开一次 Safari，让它发现这个扩展。")
                    _ = error
                }
            }
        }
    }

    @objc private func openSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleID) { _ in }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// A minimal menu so ⌘Q and ⌘W work.
let menu = NSMenu()
let appItem = NSMenuItem()
menu.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(withTitle: text("Quit InkPage", "退出墨页"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu
let windowItem = NSMenuItem()
menu.addItem(windowItem)
let windowMenu = NSMenu(title: text("Window", "窗口"))
windowMenu.addItem(withTitle: text("Close", "关闭"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
windowItem.submenu = windowMenu
app.mainMenu = menu

app.run()
