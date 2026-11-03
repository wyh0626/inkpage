// The Safari Web Extension's native side. InkPage doesn't use native messaging, so it
// only answers; Safari still needs a principal class to load the extension.
import Foundation
import SafariServices

@objc(SafariWebExtensionHandler)
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [NSExtensionItem()], completionHandler: nil)
    }
}
