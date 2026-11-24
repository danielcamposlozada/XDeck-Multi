import SwiftUI

struct LoginView: View {
    /// Login session to sign in to ("" is the default session).
    var accountKey: String = ""
    /// Shown above the login page when the columns use more than one account.
    var accountLabel: String? = nil
    /// Lets the user continue without signing in to this account for now.
    var onSkip: (() -> Void)? = nil
    @State var isLoading: Bool = false
    @State var url: URL = URL(string: "https://x.com/login")!
    @State var scriptExecutionRequest: String? = nil
    @Binding var isShowingAlert: Bool
    @Binding var alertMessage: String?
    @Binding var loginViewMessage: String?

    var body: some View {
        VStack {
            if let accountLabel {
                HStack {
                    Text("Log in to 𝕏 for account: \(accountLabel)")
                        .font(.headline)
                    Spacer()
                    if let onSkip {
                        Button("Skip for now", action: onSkip)
                    }
                }
            }
            WebView(
                isLoading: $isLoading, url: $url, alertMessage: $alertMessage,
                messageFromWebView: $loginViewMessage,
                scriptExecutionRequest: scriptExecutionRequest,
                makeConfiguration: { WebViewConfigurations.makeConfiguration(
                    onLoadScripts: [.findUserName, .findThemeColor], accountKey: accountKey) })
        }
        .padding()
        .onChange(of: alertMessage) { message in
            isShowingAlert = message != nil
        }
    }
}
