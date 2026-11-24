import SwiftUI
import WebKit

private struct ContentWidthPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// Resizes the window's width to match the actual rendered content width: once automatically,
/// the first time it's known, and again whenever `fitRequestToken` changes (the user pressing
/// ⌘F). The exact fit can't be computed in advance from config alone (WebView/scrollbar
/// rendering introduces small, hard-to-predict width differences), so this measures the real
/// layout instead.
private struct WindowWidthFitter: NSViewRepresentable {
    let contentWidth: CGFloat
    @Binding var hasFit: Bool
    let fitRequestToken: Int

    func makeNSView(context: Context) -> NSView {
        NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        guard contentWidth > 0, let window = nsView.window else { return }
        let isManualRequest = fitRequestToken != context.coordinator.lastHandledFitRequestToken
        guard !hasFit || isManualRequest else { return }
        context.coordinator.lastHandledFitRequestToken = fitRequestToken

        let maxWidth = (window.screen ?? NSScreen.main)?.visibleFrame.width ?? contentWidth
        let targetWidth = min(contentWidth, maxWidth)
        DispatchQueue.main.async {
            var frame = window.frame
            frame.size.width = targetWidth
            window.setFrame(frame, display: true)
            hasFit = true
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator {
        var lastHandledFitRequestToken = 0
    }
}

struct ContentView: View {
    @State var appConfig: AppConfig

    @AppStorage("pageZoom") var pageZoom: Double = 1
    @AppStorage("isDarkMode") var isDarkMode: Bool = false
    @AppStorage("hideAds") var hideAds: Bool = false

    @State var isLoading: Bool = false
    @State var isShowingAlert: Bool = false
    @State var alertMessage: String? = nil
    @State var backgroundColor: Color = .white

    @State var refreshSwitch: Bool = false
    @State var scriptExecutionRequest: String? = nil
    @State var scriptExecutionToken: Int = 0
    @State var isDarkModeUpdating: Bool = false
    @State var isShowConfirmOpenPreference: Bool = false

    @State var webViewMessage: String? = nil
    @State var loginViewMessage: String? = nil
    @State var expandedColumnID: UUID? = nil
    @State var isShowingColumnsSheet = false

    @State var measuredContentWidth: CGFloat = 0
    @State var hasFitWindowToContent = false
    @State var fitWindowRequestToken = 0

    @State var homeUrl: URL = URL(string: "https://x.com/home")!
    @State var notificationsUrl: URL = URL(string: "https://x.com/notifications")!
    /// Profile URL of each signed-in account, keyed by account key ("" is the default session).
    @State var profileUrls: [String: URL] = [:]
    /// Accounts the user chose not to sign in to yet; their columns show 𝕏's own login page.
    @State var skippedAccountKeys: Set<String> = []

    @Environment(\.openURL) private var openURL

    private static let sideHeaderWidth: CGFloat = AppConfig.sideHeaderWidth
    /// 𝕏's Explore page, which has the search box at the top.
    private static let searchUrl = URL(string: "https://x.com/explore")!
    // Covers the reload plus the theme-color stabilization debounce in findThemeColor; acts as a
    // fallback in case the confirmation message from the page never arrives.
    private static let darkModeUpdateTimeout: TimeInterval = 5
    private static func defaultBackgroundColor(isDarkMode: Bool) -> Color {
        isDarkMode ? Color(hex: "#17202A") : Color(hex: "#FFFFFF")
    }
    private static func borderColor(for backgroundColor: Color) -> Color {
        backgroundColor == Color.white ? Color(hex: "#EFF3F4") : Color(hex: "#38444D")
    }
    private static func textColor(for backgroundColor: Color) -> Color {
        backgroundColor == Color.white ? Color(hex: "#536471") : Color(hex: "#8b98a5")
    }
    private static func setNightModeCookieScript(isDarkMode: Bool) -> String {
        return """
                document.cookie = "night_mode=\(isDarkMode ? 1 : 0); domain=.x.com; path=/";
                location.reload();
            """
    }

    init(appConfig: AppConfig) {
        _appConfig = State(initialValue: appConfig)
    }

    /// Saves the columns edited in the Columns sheet and shows them right away, without a restart.
    private func applyColumns(_ columns: [AppConfig.Column]) {
        do {
            try AppConfig.saveColumns(columns)
        } catch {
            alertMessage = "Couldn't save settings.json. The new columns will be lost when the app quits."
        }
        expandedColumnID = nil
        appConfig.columns = columns
        if isWindowFittingEnabled {
            // Give the new layout a moment to render and report its width before fitting to it.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                fitWindowRequestToken += 1
            }
        }
    }

    // When columnWidth isn't set, column width is derived from the window's own width
    // (see `baseWidth` below), so fitting the window to the column width would be circular.
    // The fit-to-content feature only makes sense when columnWidth is explicitly configured.
    private var isWindowFittingEnabled: Bool { appConfig.columnWidth != nil }

    /// The account whose login screen is showing, or nil once every account is ready.
    private var pendingLoginAccountKey: String? {
        appConfig.accountKeys.first { profileUrls[$0] == nil && !skippedAccountKeys.contains($0) }
    }

    private var hasMultipleAccounts: Bool { appConfig.accountKeys.count > 1 }

    /// Indices of the columns that keep 𝕏's side navigation: the first 𝕏 column of each account,
    /// so every account has its own navigation, Post button and avatar.
    private var sideHeaderColumnIndices: Set<Int> {
        var seenAccountKeys: Set<String> = []
        var indices: Set<Int> = []
        for (index, column) in appConfig.columns.enumerated() where column.isXColumn {
            if seenAccountKeys.insert(column.accountKey).inserted {
                indices.insert(index)
            }
        }
        return indices
    }

    /// Names the column and the account it uses, so similar-looking columns can be told apart.
    private func columnTitleBar(column: AppConfig.Column) -> some View {
        let title: String = {
            guard column.type == .custom, let url = column.url.flatMap({ URL(string: $0) }) else {
                return column.type.displayName
            }
            // A search shows its query, not the "/search" path every search shares.
            if url.path() == "/search",
               let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                   .queryItems?.first(where: { $0.name == "q" })?.value, !query.isEmpty {
                return query
            }
            let path = url.path()
            return path.isEmpty || path == "/" ? (url.host() ?? url.absoluteString) : path
        }()
        let handle: String? = {
            if let profileUrl = profileUrls[column.accountKey] {
                return "@" + profileUrl.lastPathComponent
            }
            return column.accountKey.isEmpty ? nil : column.account
        }()
        return HStack(spacing: 6) {
            Image(systemName: column.type.systemImage)
            Text(title)
                .fontWeight(.semibold)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 4)
            if let handle {
                Text(handle)
                    .lineLimit(1)
            }
        }
        .font(.system(size: 12))
        .foregroundColor(Self.textColor(for: backgroundColor))
        .padding(.horizontal, 10)
        .frame(height: 26)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(Self.borderColor(for: backgroundColor)),
            alignment: .bottom
        )
        .overlay(
            Rectangle()
                .frame(width: 1)
                .foregroundColor(Self.borderColor(for: backgroundColor)),
            alignment: .trailing
        )
        .clipped()
    }

    @ViewBuilder
    private func makeColumn(
        column: AppConfig.Column, isLeftMostXColumn: Bool, showsSideHeader: Bool,
        profileUrl: URL?, columnWidth: CGFloat
    )
        -> some View
    {
        let width = showsSideHeader ? columnWidth + Self.sideHeaderWidth : columnWidth
        let (url, typeScripts): (Binding<URL>?, [WebViewConfigurations.OnLoadScript]) = {
            switch column.type {
            case .forYou: return ($homeUrl, [.clickForYouTab])
            case .following: return ($homeUrl, [.clickFollowingTab])
            case .notifications: return ($notificationsUrl, [])
            // Shows nothing until the account's profile URL is known.
            case .profile: return (profileUrl.map { .constant($0) }, [])
            case .search: return (.constant(Self.searchUrl), [])
            case .custom: return (column.url.flatMap { URL(string: $0) }.map { .constant($0) }, [])
            }
        }()

        if let url {
            WebView(
                isLoading: $isLoading, url: url, alertMessage: $alertMessage,
                messageFromWebView: $webViewMessage,
                scriptExecutionRequest: scriptExecutionRequest,
                scriptExecutionToken: scriptExecutionToken,
                refreshSwitch: refreshSwitch,
                makeConfiguration: { [hideAds] in
                    var scripts: [WebViewConfigurations.OnLoadScript] = [
                        .global, .detectMediaOverlay(columnID: column.id.uuidString),
                    ]
                    if isLeftMostXColumn {
                        scripts.append(.findThemeColor)
                    }
                    if column.isXColumn {
                        scripts.append(.hideBottomBar)
                        if !showsSideHeader {
                            scripts.append(contentsOf: [.hideSideHeader, .hidePostArea])
                        }
                    }
                    if hideAds {
                        scripts.append(.hideAds)
                    }
                    return WebViewConfigurations.makeConfiguration(
                        onLoadScripts: scripts + typeScripts, accountKey: column.accountKey)
                }
            ).frame(width: width)
        }
    }


    var body: some View {
        GeometryReader { geometry in
                    // Determine the number of columns from the appConfig.
                    let columnCount = appConfig.columns.count
                    // Each account's first 𝕏 column keeps the side header, so there can be several.
                    let sideHeaderColumnIndices = self.sideHeaderColumnIndices
                    let sideHeaderCount = CGFloat(max(sideHeaderColumnIndices.count, 1))

                    // If a manual width is provided in the app config, use it;
                    // otherwise compute the base width dynamically.
                    let manualWidth = appConfig.columnWidth.map(CGFloat.init)
                    let baseWidth: CGFloat = {
                        if let manualWidth = manualWidth {
                            return manualWidth
                        } else {
                            // For one column, reserve space for the side header.
                            if columnCount == 1 {
                                return geometry.size.width - Self.sideHeaderWidth
                            } else {
                                // With multiple columns, subtract the side headers' width from the total available width.
                                return (geometry.size.width - Self.sideHeaderWidth * sideHeaderCount) / CGFloat(columnCount)
                            }
                        }
                    }()

                    // Apply the zoom factor.
                    let dynamicColumnWidth = baseWidth * CGFloat(pageZoom)

                    ZStack {
                        // Update zoom buttons to change only the zoom factor.
                        Button("+") {
                            pageZoom += 0.2
                        }
                        .keyboardShortcut("+")
                        .opacity(0)

                        Button("-") {
                            pageZoom -= 0.2
                        }
                        .keyboardShortcut("-")
                        .opacity(0)

                        Button(".") {
                            pageZoom = 1
                        }
                        .keyboardShortcut(".")
                        .opacity(0)

                        Button("r") {
                            refreshSwitch.toggle()
                        }
                        .keyboardShortcut("r")
                        .opacity(0)

                        if isWindowFittingEnabled {
                            Button("f") {
                                fitWindowRequestToken += 1
                            }
                            .keyboardShortcut("f")
                            .opacity(0)
                        }

                        Button(",") {
                            isShowConfirmOpenPreference = true
                        }
                        .keyboardShortcut(",")
                        .opacity(0)
                        .alert(isPresented: $isShowConfirmOpenPreference) {
                            Alert(
                                title: Text("Do you open settings folder?"),
                                message: Text("Please edit settings.json and restart app."),
                                primaryButton: .default(
                                    Text("Open Folder"),
                                    action: {
                                        NSWorkspace.shared.open(AppConfig.configDirectoryUrl)
                                        isShowConfirmOpenPreference = false
                                    }),
                                secondaryButton: .cancel(Text("Cancel"), action: {
                                    isShowConfirmOpenPreference = false
                                })
                            )
                        }

                        if pendingLoginAccountKey == nil {
                            VStack(alignment: .leading, spacing: 0) {
                                // Its own ScrollView, separate from the bottom toolbar below: the toolbar's
                                // natural width can be wider than a narrow column configuration, and scrolling
                                // to see the rest of it shouldn't also scroll the columns out of view.
                                ScrollView(.horizontal) {
                                    VStack(alignment: .leading, spacing: 0) {
                                        HStack(spacing: 0) {
                                            ForEach(Array(appConfig.columns.enumerated()), id: \.element.id) { index, column in
                                                let isLeftMostXColumn =
                                                    index == (appConfig.columns.firstIndex { $0.isXColumn } ?? -1)
                                                let showsSideHeader = sideHeaderColumnIndices.contains(index)
                                                let isExpanded = expandedColumnID == column.id
                                                let isHidden = expandedColumnID != nil && !isExpanded
                                                let effectiveWidth: CGFloat = isExpanded
                                                    ? (showsSideHeader ? geometry.size.width - Self.sideHeaderWidth : geometry.size.width)
                                                    : dynamicColumnWidth
                                                let barWidth = isHidden ? 0 : (showsSideHeader ? effectiveWidth + Self.sideHeaderWidth : effectiveWidth)
                                                VStack(spacing: 0) {
                                                columnTitleBar(column: column)
                                                    .frame(width: barWidth)
                                                makeColumn(
                                                    column: column,
                                                    isLeftMostXColumn: isLeftMostXColumn,
                                                    showsSideHeader: showsSideHeader,
                                                    profileUrl: profileUrls[column.accountKey],
                                                    columnWidth: isHidden ? 0 : effectiveWidth
                                                )
                                                }
                                                .opacity(isHidden ? 0 : 1)
                                                // Its scripts are fixed when the web view is created, so rebuild it
                                                // if adding or removing columns changes which role it plays.
                                                .id("\(column.id)|\(isLeftMostXColumn)|\(showsSideHeader)")
                                            }
                                        }
                                    }
                                    // Measured here so the window fits the columns themselves.
                                    .background {
                                        if isWindowFittingEnabled {
                                            GeometryReader { contentGeometry in
                                                Color.clear.preference(
                                                    key: ContentWidthPreferenceKey.self, value: contentGeometry.size.width)
                                            }
                                        }
                                    }
                                    .frame(minWidth: geometry.size.width, alignment: .leading)
                                }
                                .alert(isPresented: $isShowingAlert) {
                                    Alert(title: Text(alertMessage ?? ""))
                                }

                                ScrollView(.horizontal) {
                                    HStack(spacing: 24) {
                                        HStack(spacing: 8) {
                                            Button {
                                                openURL(URL(string: "https://github.com/danielcamposlozada/XDeck-Multi")!)
                                            } label: {
                                                GitHubIcon()
                                                    .foregroundColor(Self.textColor(for: backgroundColor))
                                                    .frame(width: 20, height: 20)
                                            }
                                            .buttonStyle(.plain)
                                            .onHover { inside in
                                                if inside {
                                                    NSCursor.pointingHand.push()
                                                } else {
                                                    NSCursor.pop()
                                                }
                                            }
                                            UpdateButton()
                                        }
                                        Button {
                                            isShowingColumnsSheet = true
                                        } label: {
                                            Label("Columns", systemImage: "plus.rectangle.on.rectangle")
                                                .foregroundColor(Self.textColor(for: backgroundColor))
                                        }
                                        .buttonStyle(.plain)
                                        .help("Add, remove or reorder columns")
                                        AppearanceToggle(isOn: $isDarkMode) { }
                                            .disabled(isDarkModeUpdating)
                                            .onChange(of: isDarkMode) { newValue in
                                                scriptExecutionRequest = Self.setNightModeCookieScript(isDarkMode: isDarkMode)
                                                scriptExecutionToken += 1
                                                backgroundColor = Self.defaultBackgroundColor(isDarkMode: isDarkMode)
                                                isDarkModeUpdating = true
                                                let requestToken = scriptExecutionToken
                                                DispatchQueue.main.asyncAfter(deadline: .now() + Self.darkModeUpdateTimeout) {
                                                    if scriptExecutionToken == requestToken {
                                                        isDarkModeUpdating = false
                                                    }
                                                }
                                            }
                                        HideAdsToggle(isOn: $hideAds) { Text("Hide Ads") }
                                            .onChange(of: hideAds) { newValue in
                                                scriptExecutionRequest = newValue
                                                    ? WebViewConfigurations.hideAds
                                                    : WebViewConfigurations.showAds
                                                scriptExecutionToken += 1
                                            }
                                        Text("⌘+ Zoom In")
                                            .foregroundColor(Self.textColor(for: backgroundColor))
                                        Text("⌘- Zoom out")
                                            .foregroundColor(Self.textColor(for: backgroundColor))
                                        Text("⌘. Reset Zoom")
                                            .foregroundColor(Self.textColor(for: backgroundColor))
                                        Text("⌘R Refresh")
                                            .foregroundColor(Self.textColor(for: backgroundColor))
                                        if isWindowFittingEnabled {
                                            Text("⌘F Fit Window")
                                                .foregroundColor(Self.textColor(for: backgroundColor))
                                        }
                                        Text("⌘, Settings")
                                            .foregroundColor(Self.textColor(for: backgroundColor))
                                        Spacer()
                                    }
                                    // Without this, the trailing Spacer expands to fill whatever width the
                                    // enclosing ScrollView proposes, making this row's measured width track the
                                    // window's current width instead of its own natural content width.
                                    .fixedSize(horizontal: true, vertical: false)
                                    .foregroundColor(Self.textColor(for: backgroundColor))
                                    .padding()
                                    .overlay(
                                        Rectangle()
                                            .frame(height: 1, alignment: .top)
                                            .foregroundColor(Self.borderColor(for: backgroundColor)),
                                        alignment: .top
                                    )
                                    .frame(minWidth: geometry.size.width, alignment: .leading)
                                }
                            }
                        } else {
                            // One account at a time; accounts already signed in pass through on their own.
                            let loginAccountKey = pendingLoginAccountKey ?? ""
                            let loginAccountLabel: String? = hasMultipleAccounts
                                ? (loginAccountKey.isEmpty ? "default" : loginAccountKey) : nil
                            let skipLogin: (() -> Void)? = hasMultipleAccounts
                                ? { _ = skippedAccountKeys.insert(loginAccountKey) } : nil
                            LoginView(
                                accountKey: loginAccountKey,
                                accountLabel: loginAccountLabel,
                                onSkip: skipLogin,
                                isShowingAlert: $isShowingAlert,
                                alertMessage: $alertMessage,
                                loginViewMessage: $loginViewMessage
                            )
                            // A fresh web view for each account, so each one uses its own session.
                            .id(loginAccountKey)
                        }

                    }
                    .background(backgroundColor)
                    .sheet(isPresented: $isShowingColumnsSheet) {
                        ColumnsSheet(columns: appConfig.columns, onSave: applyColumns)
                    }
                    .background {
                        if isWindowFittingEnabled {
                            WindowWidthFitter(
                                contentWidth: measuredContentWidth, hasFit: $hasFitWindowToContent,
                                fitRequestToken: fitWindowRequestToken)
                        }
                    }
                    .onPreferenceChange(ContentWidthPreferenceKey.self) { measuredContentWidth = $0 }
                    .colorScheme(isDarkMode ? .dark : .light)
                    // The onChange modifiers for loginViewMessage, webViewMessage, and alertMessage remain unchanged.
                    .onChange(of: loginViewMessage) { loginViewMessage in
                        if let messageText = loginViewMessage,
                           let messageData = messageText.data(using: .utf8),
                           let message = try? JSONDecoder().decode(WebViewMessage.self, from: messageData) {
                            switch message.type {
                            case .userName:
                                // The login screen is showing the account that's still pending.
                                if let url = URL(string: "https://x.com/\(message.body)"),
                                   let accountKey = pendingLoginAccountKey {
                                    profileUrls[accountKey] = url
                                }
                            case .themeColor:
                                let color = Color(hex: message.body)
                                backgroundColor = color
                                isDarkMode = color != Color.white
                            case .mediaOverlay:
                                break
                            }
                            // Clear it so the next account's messages register even if they repeat this one.
                            self.loginViewMessage = nil
                        }
                    }
                    .onChange(of: webViewMessage) { rawMessage in
                        if let messageText = rawMessage,
                           let messageData = messageText.data(using: .utf8),
                           let message = try? JSONDecoder().decode(WebViewMessage.self, from: messageData) {
                            switch message.type {
                            case .userName:
                                // Usernames come from the login screen, one per account.
                                break
                            case .themeColor:
                                let color = Color(hex: message.body)
                                backgroundColor = color
                                isDarkMode = color != Color.white
                                isDarkModeUpdating = false
                            case .mediaOverlay:
                                if message.body == "close" {
                                    expandedColumnID = nil
                                } else if let id = UUID(uuidString: message.body) {
                                    expandedColumnID = id
                                }
                            }
                        }
                    }
                    .onChange(of: alertMessage) { message in
                        isShowingAlert = message != nil
                    }
                } // End of GeometryReader
    }
}

//struct ContentView_Previews: PreviewProvider {
//    private static var defaultConfig: AppConfig {
//        return AppConfig(columns: [
//            AppConfig.Column(type: .forYou),
//            AppConfig.Column(type: .following),
//            AppConfig.Column(type: .notifications),
//            AppConfig.Column(type: .profile),
//        ])
//    }
//
//    static var previews: some View {
//        ContentView(appConfig: defaultConfig)
//            .frame(minWidth: 1280, minHeight: 900)
//    }
//}
