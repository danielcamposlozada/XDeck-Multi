import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    // SwiftUI's WindowGroup persists the window frame to UserDefaults under an
    // auto-generated "NSWindow Frame ..." key and restores it on every launch, which
    // overrides `.defaultSize` and makes the configured columnWidth-based initial size
    // unreliable. Clearing it before the window is created keeps the initial size
    // deterministic and driven by the current config on every launch.
    func applicationWillFinishLaunching(_ notification: Notification) {
        // The deck is one window; macOS's tab bar would only take space above the columns.
        NSWindow.allowsAutomaticWindowTabbing = false
        let defaults = UserDefaults.standard
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("NSWindow Frame ") {
            defaults.removeObject(forKey: key)
        }
    }

    // Without this, macOS restores the window frame from the previous launch, which
    // overrides `.defaultSize` and makes the configured columnWidth-based initial size unreliable.
    func applicationShouldRestoreApplicationState(_ app: NSApplication) -> Bool { false }
    func applicationShouldSaveApplicationState(_ app: NSApplication) -> Bool { false }
}

@main
struct XDeckApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    private let appConfig = AppConfig.loadConfig()

    var body: some Scene {
        WindowGroup {
            if let appConfig {
                ContentView(appConfig: appConfig)
            } else {
                ConfigErrorView()
            }
        }
        .windowStyle(.hiddenTitleBar)
        // A rough starting size shown before login and before the actual column content has
        // rendered. ContentView resizes the window to fit the real rendered content width once
        // it's known, since the exact fit can't be computed in advance (WebView/scrollbar
        // rendering introduces small, hard-to-predict width differences).
        .defaultSize(width: AppConfig.defaultWindowWidth, height: AppConfig.defaultWindowHeight)
    }
}

/// Shown when settings.json can't be read, with a way to go fix it.
struct ConfigErrorView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundColor(.orange)
            Text("Couldn't load settings.json")
                .font(.title2.bold())
            Text("Check the file for a typo, or delete it and restart XDeck Multi to start over with the default columns.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
                .frame(maxWidth: 380)
            Button("Open Settings Folder") {
                NSWorkspace.shared.open(AppConfig.configDirectoryUrl)
            }
            .keyboardShortcut(.defaultAction)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
