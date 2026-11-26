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
    /// The column being dragged by its title bar. While it moves, the others slide out of its way.
    @State var draggingColumnID: UUID? = nil
    /// How far the dragged column sits from its current slot, so it stays under the cursor.
    @State var dragOffset: CGFloat = 0
    /// Width of the slots the dragged column has passed, subtracted from the cursor's travel.
    @State var dragShift: CGFloat = 0
    /// The column order when the drag began. Each column's role (side navigation, theme detection)
    /// comes from it until the drop, so no web view reloads while the user is still moving things.
    @State var columnsAtDragStart: [AppConfig.Column]? = nil

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

    private static let zoomRange: ClosedRange<Double> = 0.5...2.5
    private static let zoomStep: Double = 0.1

    private func zoom(by delta: Double) {
        let zoomed = ((pageZoom + delta) * 10).rounded() / 10
        pageZoom = min(max(zoomed, Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
    }

    private func openSettingsFolder() {
        NSWorkspace.shared.open(AppConfig.configDirectoryUrl)
    }

    private var toolbarDivider: some View {
        Rectangle()
            .fill(Self.borderColor(for: backgroundColor))
            .frame(width: 1, height: 18)
    }

    /// Spring used when columns slide; none when the user asked macOS to reduce motion.
    private var reorderAnimation: Animation? {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            ? nil : .spring(response: 0.3, dampingFraction: 0.82)
    }

    private func slotWidth(of column: AppConfig.Column, columnWidth: CGFloat) -> CGFloat {
        sideHeaderColumnIDs.contains(column.id) ? columnWidth + Self.sideHeaderWidth : columnWidth
    }

    /// Moves the dragged column with the cursor and swaps it with a neighbor once it passes that
    /// neighbor's middle, so the order changes live while the user drags.
    private func updateColumnDrag(_ column: AppConfig.Column, translation: CGFloat, columnWidth: CGFloat) {
        if draggingColumnID == nil {
            // Not while a photo or video fills the window, nor while the last drop is still settling.
            guard expandedColumnID == nil, columnsAtDragStart == nil else { return }
            columnsAtDragStart = appConfig.columns
            draggingColumnID = column.id
            dragShift = 0
        }
        guard draggingColumnID == column.id else { return }
        NSCursor.closedHand.set()

        var offset = translation - dragShift
        while let index = appConfig.columns.firstIndex(where: { $0.id == column.id }) {
            let neighborIndex = offset > 0 ? index + 1 : index - 1
            guard appConfig.columns.indices.contains(neighborIndex) else { break }
            let neighborWidth = slotWidth(of: appConfig.columns[neighborIndex], columnWidth: columnWidth)
            guard abs(offset) > neighborWidth / 2 else { break }
            withAnimation(reorderAnimation) {
                appConfig.columns.swapAt(index, neighborIndex)
            }
            dragShift += offset > 0 ? neighborWidth : -neighborWidth
            offset = translation - dragShift
            NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        }
        dragOffset = offset
    }

    /// Lets the column settle into its slot, then saves the new order.
    private func endColumnDrag(_ column: AppConfig.Column) {
        guard draggingColumnID == column.id else { return }
        let didChangeOrder = columnsAtDragStart?.map(\.id) != appConfig.columns.map(\.id)
        withAnimation(reorderAnimation) {
            draggingColumnID = nil
            dragOffset = 0
        }
        dragShift = 0
        NSCursor.openHand.set()
        // Roles are recomputed after the settle animation, so a column that gains or loses the
        // side navigation reloads once it has landed, not mid-flight.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            columnsAtDragStart = nil
            if didChangeOrder {
                applyColumns(appConfig.columns)
            }
        }
    }

    /// Keyboard, VoiceOver and right-click alternative to dragging: moves a column one place over.
    private func moveColumn(_ column: AppConfig.Column, by delta: Int) {
        guard draggingColumnID == nil,
              let index = appConfig.columns.firstIndex(where: { $0.id == column.id }),
              appConfig.columns.indices.contains(index + delta) else { return }
        var columns = appConfig.columns
        columns.swapAt(index, index + delta)
        withAnimation(reorderAnimation) {
            applyColumns(columns)
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

    /// The order that decides each column's role: frozen while a column is being dragged.
    private var roleColumns: [AppConfig.Column] { columnsAtDragStart ?? appConfig.columns }

    /// Columns that keep 𝕏's side navigation: the first 𝕏 column of each account,
    /// so every account has its own navigation, Post button and avatar.
    private var sideHeaderColumnIDs: Set<UUID> {
        var seenAccountKeys: Set<String> = []
        var ids: Set<UUID> = []
        for column in roleColumns where column.isXColumn {
            if seenAccountKeys.insert(column.accountKey).inserted {
                ids.insert(column.id)
            }
        }
        return ids
    }

    /// The column whose page reports 𝕏's theme color.
    private var leftMostXColumnID: UUID? { roleColumns.first { $0.isXColumn }?.id }

    /// Names the column and the account it uses, so similar-looking columns can be told apart.
    private func columnTitleBar(column: AppConfig.Column, columnWidth: CGFloat) -> some View {
        let title = column.displayTitle
        let handle: String? = {
            if let profileUrl = profileUrls[column.accountKey] {
                return "@" + profileUrl.lastPathComponent
            }
            return column.accountKey.isEmpty ? nil : column.account
        }()
        let isDragging = draggingColumnID == column.id
        let index = appConfig.columns.firstIndex { $0.id == column.id } ?? 0
        let canMoveLeft = index > 0
        let canMoveRight = index < appConfig.columns.count - 1
        return HStack(spacing: 6) {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 10, weight: .semibold))
                .opacity(isDragging ? 1 : 0.55)
            Image(systemName: column.displaySystemImage)
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
        .background(isDragging ? Color.accentColor.opacity(0.16) : Color.clear)
        .foregroundColor(isDragging ? .accentColor : Self.textColor(for: backgroundColor))
        .clipped()
        .contentShape(Rectangle())
        .onHover { inside in
            guard draggingColumnID == nil else { return }
            if inside {
                NSCursor.openHand.push()
            } else {
                NSCursor.pop()
            }
        }
        .gesture(
            DragGesture(minimumDistance: 3, coordinateSpace: .global)
                .onChanged { value in
                    updateColumnDrag(column, translation: value.translation.width, columnWidth: columnWidth)
                }
                .onEnded { _ in endColumnDrag(column) }
        )
        .contextMenu {
            Button("Move Left") { moveColumn(column, by: -1) }
                .disabled(!canMoveLeft)
            Button("Move Right") { moveColumn(column, by: 1) }
                .disabled(!canMoveRight)
        }
        .help("Drag to move this column. Right-click to move it one place over.")
        .accessibilityElement(children: .combine)
        .accessibilityHint("Drag to move this column")
        .accessibilityAction(named: "Move Left") { moveColumn(column, by: -1) }
        .accessibilityAction(named: "Move Right") { moveColumn(column, by: 1) }
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
                    let sideHeaderColumnIDs = self.sideHeaderColumnIDs
                    let leftMostXColumnID = self.leftMostXColumnID
                    let sideHeaderCount = CGFloat(max(sideHeaderColumnIDs.count, 1))

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
                            zoom(by: Self.zoomStep)
                        }
                        .keyboardShortcut("+")
                        .opacity(0)

                        Button("-") {
                            zoom(by: -Self.zoomStep)
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
                                title: Text("Open the settings folder?"),
                                message: Text("Edit settings.json, then restart XDeck Multi. To add, remove or move columns, use the Columns button instead."),
                                primaryButton: .default(
                                    Text("Open Folder"),
                                    action: {
                                        openSettingsFolder()
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
                                            ForEach(appConfig.columns) { column in
                                                let isLeftMostXColumn = column.id == leftMostXColumnID
                                                let showsSideHeader = sideHeaderColumnIDs.contains(column.id)
                                                let isExpanded = expandedColumnID == column.id
                                                let isHidden = expandedColumnID != nil && !isExpanded
                                                let isDragging = draggingColumnID == column.id
                                                let effectiveWidth: CGFloat = isExpanded
                                                    ? (showsSideHeader ? geometry.size.width - Self.sideHeaderWidth : geometry.size.width)
                                                    : dynamicColumnWidth
                                                let barWidth = isHidden ? 0 : (showsSideHeader ? effectiveWidth + Self.sideHeaderWidth : effectiveWidth)
                                                VStack(spacing: 0) {
                                                    columnTitleBar(column: column, columnWidth: dynamicColumnWidth)
                                                        .frame(width: barWidth)
                                                    makeColumn(
                                                        column: column,
                                                        isLeftMostXColumn: isLeftMostXColumn,
                                                        showsSideHeader: showsSideHeader,
                                                        profileUrl: profileUrls[column.accountKey],
                                                        columnWidth: isHidden ? 0 : effectiveWidth
                                                    )
                                                }
                                                // The lifted column: an accent outline and a shadow on an
                                                // opaque backing, since the web view itself can't cast one.
                                                .overlay {
                                                    if isDragging {
                                                        Rectangle().strokeBorder(Color.accentColor, lineWidth: 2)
                                                    }
                                                }
                                                .background(
                                                    Rectangle()
                                                        .fill(backgroundColor)
                                                        .shadow(
                                                            color: .black.opacity(isDragging ? 0.35 : 0),
                                                            radius: 18, x: 0, y: 8)
                                                )
                                                .offset(x: isDragging ? dragOffset : 0)
                                                // The slot it will drop into stays marked under it.
                                                .background {
                                                    if isDragging {
                                                        RoundedRectangle(cornerRadius: 10)
                                                            .fill(Color.accentColor.opacity(0.08))
                                                            .overlay(
                                                                RoundedRectangle(cornerRadius: 10)
                                                                    .strokeBorder(
                                                                        Color.accentColor.opacity(0.55),
                                                                        style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                                                            )
                                                            .padding(8)
                                                    }
                                                }
                                                .zIndex(isDragging ? 1 : 0)
                                                // It follows the cursor exactly; only the columns around it animate.
                                                .transaction { transaction in
                                                    if isDragging { transaction.animation = nil }
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

                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 14) {
                                        Button {
                                            isShowingColumnsSheet = true
                                        } label: {
                                            Label("Columns", systemImage: "plus.rectangle.on.rectangle")
                                                .padding(.horizontal, 10)
                                                .padding(.vertical, 5)
                                                .background(
                                                    Capsule().fill(Self.textColor(for: backgroundColor).opacity(0.14)))
                                        }
                                        .buttonStyle(.plain)
                                        .help("Add, remove or reorder columns")

                                        toolbarDivider

                                        HideAdsToggle(isOn: $hideAds) { Text("Hide Ads") }
                                            .help("Hide promoted posts in every column")
                                            .onChange(of: hideAds) { newValue in
                                                scriptExecutionRequest = newValue
                                                    ? WebViewConfigurations.hideAds
                                                    : WebViewConfigurations.showAds
                                                scriptExecutionToken += 1
                                            }
                                        AppearanceToggle(isOn: $isDarkMode) { }
                                            .accessibilityLabel("Dark Mode")
                                            .help(isDarkMode ? "Switch to light mode" : "Switch to dark mode")
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

                                        toolbarDivider

                                        // Zoom: out, current level (click to reset), in.
                                        HStack(spacing: 2) {
                                            ToolbarIconButton(systemImage: "minus", help: "Zoom Out (⌘-)") {
                                                zoom(by: -Self.zoomStep)
                                            }
                                            .disabled(pageZoom <= Self.zoomRange.lowerBound)
                                            Button {
                                                pageZoom = 1
                                            } label: {
                                                Text("\(Int((pageZoom * 100).rounded()))%")
                                                    .monospacedDigit()
                                                    .frame(minWidth: 42)
                                                    .contentShape(Rectangle())
                                            }
                                            .buttonStyle(.plain)
                                            .help("Reset Zoom (⌘.)")
                                            .accessibilityLabel("Zoom \(Int((pageZoom * 100).rounded())) percent. Reset zoom")
                                            ToolbarIconButton(systemImage: "plus", help: "Zoom In (⌘+)") {
                                                zoom(by: Self.zoomStep)
                                            }
                                            .disabled(pageZoom >= Self.zoomRange.upperBound)
                                        }
                                        ToolbarIconButton(systemImage: "arrow.clockwise", help: "Refresh All Columns (⌘R)") {
                                            refreshSwitch.toggle()
                                        }
                                        if isWindowFittingEnabled {
                                            ToolbarIconButton(
                                                systemImage: "arrow.left.and.right.square", help: "Fit Window to Columns (⌘F)"
                                            ) {
                                                fitWindowRequestToken += 1
                                            }
                                        }
                                        ToolbarIconButton(systemImage: "gearshape", help: "Open Settings Folder (⌘,)") {
                                            openSettingsFolder()
                                        }

                                        toolbarDivider

                                        HStack(spacing: 8) {
                                            Button {
                                                openURL(URL(string: "https://github.com/danielcamposlozada/XDeck-Multi")!)
                                            } label: {
                                                GitHubIcon()
                                                    .foregroundColor(Self.textColor(for: backgroundColor))
                                                    .frame(width: 18, height: 18)
                                            }
                                            .buttonStyle(.plain)
                                            .help("XDeck Multi on GitHub")
                                            .accessibilityLabel("XDeck Multi on GitHub")
                                            .onHover { inside in
                                                if inside {
                                                    NSCursor.pointingHand.push()
                                                } else {
                                                    NSCursor.pop()
                                                }
                                            }
                                            UpdateButton()
                                        }
                                    }
                                    .font(.system(size: 13))
                                    .foregroundColor(Self.textColor(for: backgroundColor))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .frame(minWidth: geometry.size.width, alignment: .leading)
                                    .overlay(
                                        Rectangle()
                                            .frame(height: 1, alignment: .top)
                                            .foregroundColor(Self.borderColor(for: backgroundColor)),
                                        alignment: .top
                                    )
                                }
                            }
                        } else {
                            // One account at a time; accounts already signed in pass through on their own.
                            let loginAccountKey = pendingLoginAccountKey ?? ""
                            let loginAccountLabel: String? = hasMultipleAccounts
                                ? (loginAccountKey.isEmpty ? "default" : loginAccountKey) : nil
                            let loginProgress: String? = hasMultipleAccounts
                                ? (appConfig.accountKeys.firstIndex(of: loginAccountKey)).map {
                                    "Account \($0 + 1) of \(appConfig.accountKeys.count)"
                                } : nil
                            let skipLogin: (() -> Void)? = hasMultipleAccounts
                                ? { _ = skippedAccountKeys.insert(loginAccountKey) } : nil
                            LoginView(
                                accountKey: loginAccountKey,
                                accountLabel: loginAccountLabel,
                                progress: loginProgress,
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

/// An icon button for the bottom toolbar, with a hover highlight and its shortcut in the tooltip.
private struct ToolbarIconButton: View {
    let systemImage: String
    let help: String
    let action: () -> Void
    @State private var isHovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .medium))
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.primary.opacity(isHovering && isEnabled ? 0.1 : 0)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.4)
        .onHover { isHovering = $0 }
        .help(help)
        .accessibilityLabel(help)
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
