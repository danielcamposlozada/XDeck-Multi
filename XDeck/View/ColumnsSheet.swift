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

/// Lets the user add, remove and reorder columns without editing settings.json by hand.
/// Works on a copy of the columns; nothing changes until Save.
struct ColumnsSheet: View {
    let onSave: ([AppConfig.Column]) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var columns: [AppConfig.Column]

    // New column form
    @State private var newType: AppConfig.Column.ColumnType = .following
    @State private var newUrl: String = ""
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
            Text("Drag to reorder.")
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
            Image(systemName: column.type.systemImage)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(column.type.displayName)
                if column.type == .custom, let url = column.url {
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
        }
        .padding(.vertical, 2)
    }

    private func addColumn() {
        let account = newColumnAccount
        let url = newType == .custom ? normalizedNewUrl?.absoluteString : nil
        columns.append(AppConfig.Column(type: newType, url: url, account: account))
        newUrl = ""
        if newAccountChoice == Self.newAccountTag, let account {
            // The new account now appears in the list; keep it selected for the next column.
            newAccountChoice = existingAccounts.first { $0.lowercased() == account.lowercased() } ?? account
            newAccountName = ""
        }
    }
}
