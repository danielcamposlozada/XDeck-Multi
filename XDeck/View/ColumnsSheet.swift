import SwiftUI

extension AppConfig.Column.ColumnType {
    var displayName: String {
        switch self {
        case .forYou: return "For You"
        case .following: return "Following"
        case .notifications: return "Notifications"
        case .profile: return "Profile"
        case .search: return "Search"
        case .custom: return "Custom URL"
        }
    }

    var systemImage: String {
        switch self {
        case .forYou: return "sparkles"
        case .following: return "house"
        case .notifications: return "bell"
        case .profile: return "person"
        case .search: return "magnifyingglass"
        case .custom: return "link"
        }
    }
}

extension AppConfig.Column {
    /// The query of a column that shows 𝕏 search results, if it has one.
    var searchQuery: String? {
        guard type == .custom, let url = url.flatMap({ URL(string: $0) }), url.path() == "/search",
              let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                  .queryItems?.first(where: { $0.name == "q" })?.value,
              !query.isEmpty else { return nil }
        return query
    }

    /// A short name for the column: its search query, a custom URL's path, or the type's name.
    var displayTitle: String {
        if let searchQuery { return searchQuery }
        guard type == .custom, let url = url.flatMap({ URL(string: $0) }) else { return type.displayName }
        let path = url.path()
        return path.isEmpty || path == "/" ? (url.host() ?? url.absoluteString) : path
    }

    var displaySystemImage: String { searchQuery != nil ? "magnifyingglass" : type.systemImage }

    /// A column with 𝕏's latest results for a search.
    static func search(_ query: String, account: String?) -> AppConfig.Column? {
        var components = URLComponents(string: "https://x.com/search")!
        components.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "f", value: "live")]
        guard let url = components.url else { return nil }
        return AppConfig.Column(type: .custom, url: url.absoluteString, account: account)
    }
}

/// Lets the user add, remove and reorder columns without editing settings.json by hand.
/// Works on a copy of the columns; nothing changes until Save.
struct ColumnsSheet: View {
    let onSave: ([AppConfig.Column]) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var columns: [AppConfig.Column]

    // New column form
    @State private var newType: AppConfig.Column.ColumnType = .following
    @State private var newUrl: String = ""
    @State private var newSearchQuery: String = ""
    @State private var newAccountChoice: String = Self.defaultAccountTag
    @State private var newAccountName: String = ""

    private static let defaultAccountTag = "\u{0}default"
    private static let newAccountTag = "\u{0}new"

    init(columns: [AppConfig.Column], onSave: @escaping ([AppConfig.Column]) -> Void) {
        self.onSave = onSave
        _columns = State(initialValue: columns)
    }

    /// Account names already used by some column, one per session, in column order.
    private var existingAccounts: [String] {
        var seen: Set<String> = []
        var names: [String] = []
        for column in columns where !column.accountKey.isEmpty {
            if seen.insert(column.accountKey).inserted {
                names.append(column.account!.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }
        return names
    }

    private var newColumnAccount: String? {
        switch newAccountChoice {
        case Self.defaultAccountTag:
            return nil
        case Self.newAccountTag:
            let name = newAccountName.trimmingCharacters(in: .whitespacesAndNewlines)
            return name.isEmpty ? nil : name
        default:
            return newAccountChoice
        }
    }

    /// The custom URL as typed, with https:// added when the scheme is missing.
    private var normalizedNewUrl: URL? {
        var text = newUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") {
            text = "https://" + text
        }
        guard let url = URL(string: text), url.host() != nil else { return nil }
        return url
    }

    private var canAddColumn: Bool {
        if newType == .custom && normalizedNewUrl == nil { return false }
        if newAccountChoice == Self.newAccountTag && newColumnAccount == nil { return false }
        return true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Columns")
                .font(.title2.bold())

            List {
                ForEach(columns) { column in
                    columnRow(column)
                }
                .onMove { columns.move(fromOffsets: $0, toOffset: $1) }
            }
            .frame(minHeight: 180)
            .overlay {
                if columns.isEmpty {
                    Text("No columns yet. Add one below.")
                        .foregroundColor(.secondary)
                }
            }
            Text("Drag to reorder. In the main window, you can also drag a column by its title bar.")
                .font(.caption)
                .foregroundColor(.secondary)

            Divider()

            Text("Add a column")
                .font(.headline)
            Form {
                Picker("Type", selection: $newType) {
                    ForEach(AppConfig.Column.ColumnType.allCases, id: \.self) { type in
                        Label(type.displayName, systemImage: type.systemImage).tag(type)
                    }
                }
                if newType == .custom {
                    TextField("URL", text: $newUrl, prompt: Text("https://x.com/i/lists/123456789"))
                }
                if newType == .search {
                    TextField("Search for", text: $newSearchQuery, prompt: Text("from:NASA, #design, a topic…"))
                    Text("Shows the latest posts. Leave it empty for 𝕏's Explore page.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Picker("Account", selection: $newAccountChoice) {
                    Text("Default").tag(Self.defaultAccountTag)
                    ForEach(existingAccounts, id: \.self) { name in
                        Text(name).tag(name)
                    }
                    Divider()
                    Text("New account…").tag(Self.newAccountTag)
                }
                if newAccountChoice == Self.newAccountTag {
                    TextField("Account name", text: $newAccountName, prompt: Text("work"))
                    Text("You'll be asked to log in to this account after saving.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                HStack {
                    Spacer()
                    Button("Add Column", action: addColumn)
                        .disabled(!canAddColumn)
                }
            }

            Divider()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") {
                    onSave(columns)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(columns.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 460, height: 600)
    }

    private func columnRow(_ column: AppConfig.Column) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal")
                .foregroundColor(.secondary)
            Image(systemName: column.displaySystemImage)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(column.displayTitle)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if column.searchQuery != nil {
                    Text("Search · Latest")
                        .font(.caption)
                        .foregroundColor(.secondary)
                } else if column.type == .custom, let url = column.url {
                    Text(url)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer()
            if let account = column.account, !column.accountKey.isEmpty {
                Text(account)
                    .font(.caption)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.secondary.opacity(0.15)))
            }
            Button {
                columns.removeAll { $0.id == column.id }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .help("Remove column")
            .accessibilityLabel("Remove \(column.displayTitle)")
        }
        .padding(.vertical, 2)
    }

    private func addColumn() {
        let account = newColumnAccount
        let query = newSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if newType == .search, !query.isEmpty, let column = AppConfig.Column.search(query, account: account) {
            columns.append(column)
        } else {
            let url = newType == .custom ? normalizedNewUrl?.absoluteString : nil
            columns.append(AppConfig.Column(type: newType, url: url, account: account))
        }
        newUrl = ""
        newSearchQuery = ""
        if newAccountChoice == Self.newAccountTag, let account {
            // The new account now appears in the list; keep it selected for the next column.
            newAccountChoice = existingAccounts.first { $0.lowercased() == account.lowercased() } ?? account
            newAccountName = ""
        }
    }
}
