// The container app's one screen: Main.html, plus the extension's on/off state and a button
// that opens its settings. scripts/safari-xcode.sh copies this over the converter's template.

import WebKit
import SafariServices

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
let becameActive = UIApplication.didBecomeActiveNotification
#elseif os(macOS)
import Cocoa
typealias PlatformViewController = NSViewController
let becameActive = NSApplication.didBecomeActiveNotification
#endif

let extensionBundleIdentifier = Bundle.main.bundleIdentifier! + ".Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self
#if os(iOS)
        // Paper behind the page (Style.css) so loading and edge drags never show black.
        let paper = UIColor { $0.userInterfaceStyle == .dark
            ? UIColor(red: 0x12 / 255, green: 0x12 / 255, blue: 0x11 / 255, alpha: 1)
            : UIColor(red: 0xfb / 255, green: 0xf9 / 255, blue: 0xf4 / 255, alpha: 1) }
        self.view.backgroundColor = paper
        self.webView.isOpaque = false
        self.webView.backgroundColor = paper
        self.webView.scrollView.backgroundColor = paper
        self.webView.scrollView.bounces = false
#endif
        self.webView.configuration.userContentController.add(self, name: "controller")
        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)

        // Coming back from Settings: show the new state.
        NotificationCenter.default.addObserver(forName: becameActive, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refresh()
    }

    func refresh() {
#if os(iOS)
        guard #available(iOS 26.2, *) else {
            webView.evaluateJavaScript("show('ios', null, false)")
            return
        }
        Task {
            let state = try? await SFSafariExtensionManager.stateOfExtension(withIdentifier: extensionBundleIdentifier)
            let enabled = state.map { $0.isEnabled ? "true" : "false" } ?? "null"
            try? await webView.evaluateJavaScript("show('ios', \(enabled), true)")
        }
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac', null, true)")
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            guard let state = state, error == nil else { return }
            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("show('mac', \(state.isEnabled), true)")
            }
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.body as? String == "open-settings" else { return }
#if os(iOS)
        if #available(iOS 26.2, *) {
            Task { try? await SFSafariSettings.openExtensionsSettings(forIdentifiers: [extensionBundleIdentifier]) }
        }
#elseif os(macOS)
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            guard error == nil else { return }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
#endif
    }

}
