import Foundation

enum AppConfigError: Error {
    case failedToReadFile
    case failedToCreateConfigFile
    case failedToWriteConfigFile
}

struct AppConfig: Decodable {
    static let sideHeaderWidth: CGFloat = 68
    static let defaultWindowWidth: CGFloat = 1280
    static let defaultWindowHeight: CGFloat = 900

    var columnWidth: Int?
    var columns: [Column]

    struct Column: Codable, Identifiable, Equatable {
        enum ColumnType: String, Codable, CaseIterable {
            case forYou
            case following
            case notifications
            case profile
            case search
            case custom
        }

        /// Identifies the column while the app runs, so adding, removing or reordering columns
        /// keeps every other column's web view (and its scroll position) as it is. Not saved.
        var id = UUID()
        var type: ColumnType
        var url: String?
        /// Optional name of the 𝕏 account this column belongs to. Columns with the same name share
        /// one login session; columns without a name use the default session.
        var account: String?

        private enum CodingKeys: String, CodingKey {
            case type, url, account
        }

        init(type: ColumnType, url: String? = nil, account: String? = nil) {
            self.type = type
            self.url = url
            self.account = account
        }

        /// Key of the login session this column uses ("" is the default session).
        /// Case-insensitive, so "Work" and "work" open the same session.
        var accountKey: String {
            account?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        }

        var isXColumn: Bool {
            switch type {
            case .following, .forYou, .notifications, .profile, .search:
                return true
            case .custom:
                if let url = url.flatMap({ URL(string: $0)}), ["x.com", "twitter.com"].contains(url.host()) {
                    return true
                }
                return false
            }
        }
    }

    /// The login sessions the 𝕏 columns need, in order of first appearance.
    /// Without any 𝕏 column it's just the default session, as before accounts existed.
    var accountKeys: [String] {
        var keys: [String] = []
        for column in columns where column.isXColumn && !keys.contains(column.accountKey) {
            keys.append(column.accountKey)
        }
        return keys.isEmpty ? [""] : keys
    }

    static let configDirectoryUrl = FileManager.default.homeDirectoryForCurrentUser.appending(components: ".config", "XDeckMulti")
    private static let configFileUrl = configDirectoryUrl.appending(path: "settings.json")
    private static let configSchemaFileUrl = configDirectoryUrl.appending(path: "schema.json")
    private static func createConfigFileIfNotExist() throws {
        try FileManager.default.createDirectory(at: configDirectoryUrl, withIntermediateDirectories: true)

        // Create settings.json if not exists
        if !FileManager.default.fileExists(atPath: configFileUrl.path()) {
            guard let initialConfigFile = Bundle.main.path(forResource: "settings", ofType: "json"),
                let initialConfigData = try? Data(contentsOf: URL(filePath: initialConfigFile))
            else { throw AppConfigError.failedToReadFile }
            let isSucceededCreatingConfigFile = FileManager.default.createFile(
                atPath: configFileUrl.path(), contents: initialConfigData)
            guard isSucceededCreatingConfigFile else {
                throw AppConfigError.failedToCreateConfigFile
            }
        }

        // Create or Update schema.json
        guard let schemaFile = Bundle.main.path(forResource: "schema", ofType: "json"),
              let schemaData = try? Data(contentsOf: URL(filePath: schemaFile))
        else { throw AppConfigError.failedToReadFile }
        let isSucceededCreatingSchemaFile = FileManager.default.createFile(
            atPath: configSchemaFileUrl.path(), contents: schemaData)
        guard isSucceededCreatingSchemaFile else {
            throw AppConfigError.failedToCreateConfigFile
        }
    }

    /// Writes `columns` to settings.json, keeping the file's other settings as they are.
    static func saveColumns(_ columns: [Column]) throws {
        var root: [String: Any] = [:]
        if let data = FileManager.default.contents(atPath: configFileUrl.path()),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            root = object
        }
        if root["$schema"] == nil {
            root["$schema"] = "./schema.json"
        }
        root["columns"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(columns))
        let data = try JSONSerialization.data(
            withJSONObject: root, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        do {
            try data.write(to: configFileUrl, options: .atomic)
        } catch {
            throw AppConfigError.failedToWriteConfigFile
        }
    }

    static func loadConfig() -> AppConfig? {
        do {
            try createConfigFileIfNotExist()
            guard let loadedData = FileManager.default.contents(atPath: configFileUrl.path()) else { throw AppConfigError.failedToReadFile }
            return try JSONDecoder().decode(AppConfig.self, from: loadedData)
        } catch {
            print(error.localizedDescription.debugDescription)
            return nil
        }
    }
}
