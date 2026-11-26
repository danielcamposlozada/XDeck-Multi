import SwiftUI

struct LoginView: View {
    /// Login session to sign in to ("" is the default session).
    var accountKey: String = ""
    /// Shown above the login page when the columns use more than one account.
    var accountLabel: String? = nil
    /// Where this account falls among the ones to sign in to, such as "Account 2 of 3".
    var progress: String? = nil
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
                HStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.badge.plus")
                        .font(.system(size: 22))
                        .foregroundColor(.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sign in to the “\(accountLabel)” account")
                            .font(.headline)
                        Text(progress.map { "\($0) · Each account keeps its own session." }
                             ?? "Each account keeps its own session.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    if let onSkip {
                        Button("Skip for Now", action: onSkip)
                            .help("Its columns show 𝕏's login page until you sign in there")
                    }
                }
                .padding(.bottom, 4)
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
