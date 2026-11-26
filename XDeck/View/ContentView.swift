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
    /// The column order when the drag began. Which columns show 𝕏's side navigation comes from it
    /// until the drop, so widths don't jump while the user is still moving things.
    @State var columnsAtDragStart: [AppConfig.Column]? = nil
    /// Video downloads of this session, by video address, newest last.
    @State var videoDownloads: [VideoDownload] = []
    /// Bumped whenever a download moves on, so the pages' download buttons update.
    @State var downloadStatesToken = 0
    /// The last finished download stays in the toolbar for a while.
    @State var finishedDownloadID: UUID? = nil

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

    private func updateDownload(_ id: UUID, _ change: (inout VideoDownload) -> Void) {
        guard let index = videoDownloads.firstIndex(where: { $0.id == id }) else { return }
        change(&videoDownloads[index])
        downloadStatesToken += 1
    }

    /// The JavaScript that tells every page's download buttons how each download is going.
    private var downloadStatesScript: String {
        var states: [String: [String: Any]] = [:]
        for download in videoDownloads {
            var state: [String: Any] = ["state": download.state.rawValue]
            if let fraction = download.fraction { state["fraction"] = fraction }
            states[download.url.absoluteString] = state
        }
        let json = (try? JSONSerialization.data(withJSONObject: states))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__xdeckDownloadStates && window.__xdeckDownloadStates(\(json));"
    }

    /// Saves a video a column's download button asked for to the Downloads folder.
    private func startVideoDownload(_ body: String) {
        guard let (url, name) = VideoDownloader.request(from: body),
              !videoDownloads.contains(where: { $0.url == url && $0.state == .downloading })
        else { return }
        // A finished or failed earlier try of the same video starts over.
        videoDownloads.removeAll { $0.url == url }
        let download = VideoDownload(url: url, fileName: name + ".mp4")
        videoDownloads.append(download)
        downloadStatesToken += 1
        let id = download.id
        Task {
            do {
                let file = try await VideoDownloader.download(url, baseName: name) { completed, total in
                    DispatchQueue.main.async {
                        updateDownload(id) { item in
                            item.completedBytes = completed
                            item.totalBytes = total
                        }
                    }
                }
                await MainActor.run {
                    updateDownload(id) { item in
                        item.state = .done
                        item.fileURL = file
                        item.fileName = file.lastPathComponent
                    }
                    finishedDownload(id, file: file)
                }
            } catch {
                await MainActor.run {
                    updateDownload(id) { $0.state = .failed }
                    finishedDownload(id, file: nil)
                }
            }
        }
    }

    /// Keeps the result in the toolbar for a while and lets macOS show it too.
    private func finishedDownload(_ id: UUID, file: URL?) {
        finishedDownloadID = id
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            if finishedDownloadID == id { finishedDownloadID = nil }
        }
        if let file {
            // Makes the Downloads stack in the Dock bounce, as browsers do.
            DistributedNotificationCenter.default().post(
                name: Notification.Name("com.apple.DownloadFileFinished"), object: file.path(percentEncoded: false))
        }
        if !NSApp.isActive {
            NSApp.requestUserAttention(.informationalRequest)
        }
    }

    /// Progress of the downloads still running, or the last one that finished.
    @ViewBuilder
    private var downloadNoticeView: some View {
        let active = videoDownloads.filter { $0.state == .downloading }
        let finished = finishedDownloadID.flatMap { id in videoDownloads.first { $0.id == id } }
        if !active.isEmpty {
            let fraction = VideoDownload.combinedFraction(of: active)
            HStack(spacing: 8) {
                Image(systemName: "arrow.down.circle")
                    .foregroundColor(.accentColor)
                VStack(alignment: .leading, spacing: 3) {
                    Text(active.count == 1 ? "Downloading \(active[0].fileName)" : "Downloading \(active.count) videos")
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let fraction {
                        ProgressView(value: fraction)
                            .progressViewStyle(.linear)
                    } else {
                        ProgressView()
                            .progressViewStyle(.linear)
                    }
                }
                .frame(width: 200)
                Text(VideoDownload.progressText(of: active))
                    .monospacedDigit()
                    .foregroundColor(Self.textColor(for: backgroundColor))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.accentColor.opacity(0.14)))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Downloading. \(VideoDownload.progressText(of: active))")
        } else if let finished {
            HStack(spacing: 8) {
                Image(systemName: finished.state == .done ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundColor(finished.state == .done ? .green : .orange)
                Text(finished.state == .done ? "Saved to Downloads" : "Couldn't download the video")
                    .lineLimit(1)
                Text(finished.state == .done ? finished.fileName : "Click its button to try again")
                    .foregroundColor(Self.textColor(for: backgroundColor))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 240)
                if let file = finished.fileURL {
                    Button("Show in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([file])
                    }
                    .buttonStyle(.link)
                }
                Button {
                    finishedDownloadID = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                }
                .buttonStyle(.plain)
                .help("Dismiss")
                .accessibilityLabel("Dismiss")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill((finished.state == .done ? Color.green : Color.orange).opacity(0.14)))
            .accessibilityElement(children: .contain)
        }
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
        // The side navigation moves to its new column after the settle animation, in place.
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

    /// The order that decides which columns show 𝕏's side navigation: frozen while a column is dragged.
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
        column: AppConfig.Column, showsSideHeader: Bool,
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
                    if column.isXColumn {
                        // Every 𝕏 column reports the theme (they all share it), so no column has to
                        // be rebuilt when a different one becomes the leftmost.
                        scripts.append(contentsOf: [.findThemeColor, .hideBottomBar, .videoDownload])
                        if !showsSideHeader {
                            scripts.append(contentsOf: [.hideSideHeader, .hidePostArea])
                        }
                    }
                    if hideAds {
                        scripts.append(.hideAds)
                    }
                    return WebViewConfigurations.makeConfiguration(
                        onLoadScripts: scripts + typeScripts, accountKey: column.accountKey)
                },
                isCompact: column.isXColumn ? !showsSideHeader : nil,
                downloadStatesScript: downloadStatesToken == 0 ? nil : downloadStatesScript,
                downloadStatesToken: downloadStatesToken
            ).frame(width: width)
        }
    }


    var body: some View {
        GeometryReader { geometry in
                    // Determine the number of columns from the appConfig.
                    let columnCount = appConfig.columns.count
                    // Each account's first 𝕏 column keeps the side header, so there can be several.
                    let sideHeaderColumnIDs = self.sideHeaderColumnIDs
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
                                                // Identity is the column alone: moving it or changing its role
                                                // (side navigation) never rebuilds and reloads its page.
                                                .id(column.id)
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
                                        downloadNoticeView
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
                            case .mediaOverlay, .downloadVideo:
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
                            case .downloadVideo:
                                startVideoDownload(message.body)
                                // Clear it, so downloading the same video again still registers.
                                self.webViewMessage = nil
                            }
                        }
                    }
                    .onChange(of: alertMessage) { message in
                        isShowingAlert = message != nil
                    }
                } // End of GeometryReader
    }
}

/// A video download of this session.
struct VideoDownload: Identifiable {
    enum State: String {
        case downloading, done, failed
    }

    let id = UUID()
    let url: URL
    var fileName: String
    var state: State = .downloading
    var completedBytes: Int64 = 0
    /// Unknown (0 or less) until the server sends the size.
    var totalBytes: Int64 = 0
    var fileURL: URL? = nil

    var fraction: Double? {
        totalBytes > 0 ? min(1, Double(completedBytes) / Double(totalBytes)) : nil
    }

    /// The share done of all the given downloads together, or nil while a size is unknown.
    static func combinedFraction(of downloads: [VideoDownload]) -> Double? {
        guard downloads.allSatisfy({ $0.totalBytes > 0 }) else { return nil }
        let total = downloads.reduce(Int64(0)) { $0 + $1.totalBytes }
        let done = downloads.reduce(Int64(0)) { $0 + $1.completedBytes }
        return total > 0 ? min(1, Double(done) / Double(total)) : nil
    }

    /// "45% · 12 of 40 MB", or just the megabytes so far while the size is unknown.
    static func progressText(of downloads: [VideoDownload]) -> String {
        let done = downloads.reduce(Int64(0)) { $0 + $1.completedBytes }
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        guard let fraction = combinedFraction(of: downloads) else { return formatter.string(fromByteCount: done) }
        let total = downloads.reduce(Int64(0)) { $0 + $1.totalBytes }
        return "\(Int((fraction * 100).rounded()))% · \(formatter.string(fromByteCount: done)) of \(formatter.string(fromByteCount: total))"
    }
}

/// Downloads 𝕏 videos (only from 𝕏's video server) into the Downloads folder.
enum VideoDownloader {
    private struct Request: Decodable {
        let url: String
        let name: String
    }

    /// The video address and a safe file name from a download button's message.
    static func request(from body: String) -> (URL, String)? {
        guard let data = body.data(using: .utf8),
              let request = try? JSONDecoder().decode(Request.self, from: data),
              let url = URL(string: request.url), url.scheme == "https", url.host() == "video.twimg.com"
        else { return nil }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let name = String(String.UnicodeScalarView(request.name.unicodeScalars.filter { allowed.contains($0) }))
        return (url, "x-" + (name.isEmpty ? "video" : String(name.prefix(80))))
    }

    /// Downloads the video, reporting the bytes received so far and the total (0 or less while
    /// unknown), and moves it into the Downloads folder.
    static func download(
        _ url: URL, baseName: String, progress: @escaping (Int64, Int64) -> Void
    ) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            var observation: NSKeyValueObservation?
            var lastReported = Date.distantPast
            let task = URLSession.shared.downloadTask(with: url) { temporaryFile, response, error in
                observation?.invalidate()
                do {
                    if let error { throw error }
                    guard let temporaryFile, (response as? HTTPURLResponse)?.statusCode == 200 else {
                        throw URLError(.badServerResponse)
                    }
                    // The temporary file is deleted when this handler returns, so move it now.
                    continuation.resume(returning: try moveToDownloads(temporaryFile, baseName: baseName))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            observation = task.observe(\.countOfBytesReceived) { task, _ in
                // About ten updates a second is plenty for a progress bar.
                let now = Date()
                guard now.timeIntervalSince(lastReported) > 0.1 else { return }
                lastReported = now
                progress(task.countOfBytesReceived, task.countOfBytesExpectedToReceive)
            }
            task.resume()
        }
    }

    private static func moveToDownloads(_ temporaryFile: URL, baseName: String) throws -> URL {
        let folder = try FileManager.default.url(
            for: .downloadsDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var destination = folder.appending(path: baseName + ".mp4")
        var copy = 1
        while FileManager.default.fileExists(atPath: destination.path(percentEncoded: false)) {
            copy += 1
            destination = folder.appending(path: "\(baseName) (\(copy)).mp4")
        }
        try FileManager.default.moveItem(at: temporaryFile, to: destination)
        return destination
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
