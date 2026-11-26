import SwiftUI
import WebKit
import AppKit

struct WebView: NSViewRepresentable {
    typealias NSViewType = WKWebView

    @Binding var isLoading: Bool
    @Binding var url: URL
    @Binding var alertMessage: String?
    @Binding var messageFromWebView: String?
    var scriptExecutionRequest: String? = nil

    @AppStorage("pageZoom") var pageZoom: Double = 1

    var scriptExecutionToken: Int = 0
    var refreshSwitch: Bool = false
    /// Builds the web view's configuration. Called once, when the web view is created, rather than
    /// on every SwiftUI update: the configuration is only read at creation.
    var makeConfiguration: (() -> WKWebViewConfiguration)? = nil
    /// Whether 𝕏's side navigation is hidden. It can change while the page is open (columns were
    /// moved), and is then applied in place instead of rebuilding and reloading the web view.
    var isCompact: Bool? = nil
    /// Reports video downloads to the page's download buttons; runs again whenever the token changes.
    var downloadStatesScript: String? = nil
    var downloadStatesToken: Int = 0

    func makeNSView(context: Context) -> WKWebView {
        let configuration = makeConfiguration?() ?? WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: WebViewConfigurations.handlerName)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        // Pretend Safari because 𝕏 bans the user agent of WebView
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15"
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        let request = URLRequest(url: url)
        webView.load(request)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        if url != context.coordinator.lastUrl {
            let request = URLRequest(url: url)
            context.coordinator.lastUrl = url
            webView.load(request)
        }
        if refreshSwitch != context.coordinator.refreshSwitch {
            let request = URLRequest(url: url)
            webView.load(request)
            context.coordinator.refreshSwitch = refreshSwitch
        } else if let script = scriptExecutionRequest, scriptExecutionToken != context.coordinator.lastHandledScriptToken {
            webView.evaluateJavaScript(script)
            context.coordinator.lastHandledScriptToken = scriptExecutionToken
        }
        if isCompact != context.coordinator.lastIsCompact, let isCompact {
            context.coordinator.lastIsCompact = isCompact
            webView.evaluateJavaScript(WebViewConfigurations.setCompactScript(isCompact))
            // Future loads (a refresh, a navigation) get the scripts for the new role too.
            if let scripts = makeConfiguration?().userContentController.userScripts {
                let controller = webView.configuration.userContentController
                controller.removeAllUserScripts()
                scripts.forEach(controller.addUserScript)
            }
        }
        if downloadStatesToken != context.coordinator.lastDownloadStatesToken, let downloadStatesScript {
            context.coordinator.lastDownloadStatesToken = downloadStatesToken
            webView.evaluateJavaScript(downloadStatesScript)
        }
        if webView.pageZoom != pageZoom {
            webView.pageZoom = CGFloat(pageZoom)
        }
    }

    /// The content controller holds its message handler strongly, so a removed column's web view
    /// and coordinator would never be freed without this.
    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: WebViewConfigurations.handlerName)
        webView.stopLoading()
    }

    func makeCoordinator() -> Coordinator {
        return Coordinator(owner: self)
    }
}

class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let owner: WebView
    var lastUrl: URL
    var refreshSwitch: Bool
    var lastHandledScriptToken: Int
    var lastIsCompact: Bool?
    var lastDownloadStatesToken: Int = 0

    init(owner: WebView) {
        self.owner = owner
        self.lastUrl = owner.url
        // Start from the current value, so a column added after a refresh doesn't reload right away.
        self.refreshSwitch = owner.refreshSwitch
        self.lastHandledScriptToken = owner.scriptExecutionToken
        self.lastIsCompact = owner.isCompact
        super.init()
    }

    // MARK: WKNavigationDelegate
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if !owner.isLoading { owner.isLoading = true }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if owner.isLoading { owner.isLoading = false }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if case .linkActivated = navigationAction.navigationType, let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // MARK: WKUIDelegate
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        owner.alertMessage = message
        print("🚨️ \(message)")
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let openPanel = NSOpenPanel()
        openPanel.canChooseFiles = true
        openPanel.canChooseDirectories = false
        openPanel.allowsMultipleSelection = parameters.allowsMultipleSelection
        openPanel.begin { response in
            if response == .OK {
                completionHandler(openPanel.urls)
            } else {
                completionHandler(nil)
            }
        }
    }

    // MARK: WKScriptMessageHandler
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == WebViewConfigurations.handlerName,
              let body = message.body as? String else { return }
        // 𝕏 writes to the console constantly. Forwarding those messages would redraw every column
        // each time, so they only go to the debug log.
        if body.hasPrefix(#"{"type":"debug""#) {
            #if DEBUG
            print("[WKScriptMessage] \(body)")
            #endif
            return
        }
        owner.messageFromWebView = body
    }
}
