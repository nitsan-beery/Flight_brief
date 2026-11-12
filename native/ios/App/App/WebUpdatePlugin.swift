import Foundation
import Capacitor

// עדכון קבצי האפליקציה מהרשת, בלי בנייה חדשה. requirements.md, סעיף 6.5.
//
// במקום ה-Service Worker, שלא פועל באפליקציה. הפתיחה לא מחכה לרשת: האפליקציה עולה מהגרסה השמורה, ורק
// אחר כך, ברקע, בודקת ב-GitHub Pages אם יש גרסה חדשה ומורידה את הקבצים שברשימת SHELL ב-sw.js.
// גרסה שהורדה ועוד לא דיווחה שעלתה (ready) נחשבת לניסיון: אם לא דיווחה, הפתיחה הבאה חוזרת לקודמת.
//
// ‏UserDefaults: web.active – הגרסה שנטענת (0 = הארוזה בבנייה), web.confirmed – גרסה שדיווחה שעלתה,
// ‏web.tries – פתיחות של web.active בלי דיווח, web.bad – גרסה שנכשלה ולא מוצעת שוב.

@objc(WebUpdatePlugin)
public class WebUpdatePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebUpdatePlugin"
    public let jsName = "WebUpdate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "apply", returnType: CAPPluginReturnPromise),
    ]

    static let site = URL(string: "https://nitsan-beery.github.io/Flight_brief/")!
    private static let defaults = UserDefaults.standard
    private var checking = false

    // MARK: - פתיחה (מ-AppViewController, לפני שה-WebView נטען)

    /// התיקייה שממנה האפליקציה עולה, או nil לגרסה הארוזה בבנייה.
    static func launchLocation() -> URL? {
        let bundled = bundledVersion()
        let confirmed = defaults.integer(forKey: "web.confirmed")
        var bad = defaults.integer(forKey: "web.bad")
        var active = defaults.integer(forKey: "web.active")
        if active > 0 && (active <= bundled || !isComplete(active)) {
            active = 0 // בנייה חדשה עם גרסה חדשה יותר, או הורדה שאבדה
        }
        if active > 0 && active != confirmed && defaults.integer(forKey: "web.tries") >= 1 {
            // הגרסה עלתה ולא דיווחה: חוזרים לקודמת, והיא לא מוצעת שוב.
            bad = active
            defaults.set(bad, forKey: "web.bad")
            active = confirmed > bundled && isComplete(confirmed) ? confirmed : 0
        }
        // גרסה שהורדה ולא עברו אליה בלחיצה: עוברים אליה עכשיו.
        if let newest = downloaded().filter({ $0 > max(active, bundled) && $0 != bad }).max() {
            active = newest
        }
        let trial = active > 0 && active != confirmed
        defaults.set(active, forKey: "web.active")
        defaults.set(trial ? 1 : 0, forKey: "web.tries")
        removeVersions(keep: [active, confirmed])
        return active > 0 ? dir(active) : nil
    }

    // MARK: - JS

    /// האפליקציה עלתה. { version } – APP_VERSION של הקבצים שרצים.
    @objc func ready(_ call: CAPPluginCall) {
        let version = call.getInt("version") ?? -1
        let active = Self.defaults.integer(forKey: "web.active")
        if version == (active > 0 ? active : Self.bundledVersion()) {
            Self.defaults.set(active, forKey: "web.confirmed")
            Self.defaults.set(0, forKey: "web.tries")
            Self.removeVersions(keep: [active])
        }
        call.resolve()
    }

    /// בדיקה והורדה ברקע. → { ready?: N } כשגרסה N הורדה, אומתה ומוכנה למעבר.
    @objc func check(_ call: CAPPluginCall) {
        if checking { call.resolve([:]); return }
        checking = true
        Task {
            defer { self.checking = false }
            do {
                if let n = try await Self.download() { call.resolve(["ready": n]) } else { call.resolve([:]) }
            } catch {
                call.resolve([:]) // בלי רשת, או הורדה חלקית: ננסה בפעם הבאה
            }
        }
    }

    /// מעבר לגרסה שהורדה. { version }
    @objc func apply(_ call: CAPPluginCall) {
        guard let n = call.getInt("version"), Self.isComplete(n) else {
            call.reject("הגרסה לא מוכנה.")
            return
        }
        Self.defaults.set(n, forKey: "web.active")
        Self.defaults.set(1, forKey: "web.tries")
        call.resolve()
        DispatchQueue.main.async {
            (self.bridge?.viewController as? CAPBridgeViewController)?.setServerBasePath(path: Self.dir(n).path)
        }
    }

    // MARK: - הורדה

    private static func download() async throws -> Int? {
        let (sw, swVersion) = try await fetchSW()
        let active = defaults.integer(forKey: "web.active")
        let running = active > 0 ? active : bundledVersion()
        if swVersion <= running || swVersion == defaults.integer(forKey: "web.bad") { return nil }
        if isComplete(swVersion) { return swVersion }

        let files = shell(sw)
        guard files.contains("index.html"), files.contains("js/app.js") else { return nil }
        let fm = FileManager.default
        let partial = root().appendingPathComponent("v\(swVersion).partial", isDirectory: true)
        try? fm.removeItem(at: partial)
        try fm.createDirectory(at: partial, withIntermediateDirectories: true)

        for file in files {
            let data = try await get(file)
            let target = partial.appendingPathComponent(file)
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: target)
        }
        try Data(sw.utf8).write(to: partial.appendingPathComponent("sw.js"))

        // אימות: app.js מאותה גרסה, ו-sw.js לא השתנה בזמן ההורדה.
        let app = String(decoding: try Data(contentsOf: partial.appendingPathComponent("js/app.js")), as: UTF8.self)
        let (_, again) = try await fetchSW()
        guard app.contains("APP_VERSION = \(swVersion);"), again == swVersion else {
            try? fm.removeItem(at: partial)
            return nil
        }

        let final = dir(swVersion)
        try? fm.removeItem(at: final)
        try fm.moveItem(at: partial, to: final)
        try Data().write(to: final.appendingPathComponent(".complete"))
        return swVersion
    }

    private static func fetchSW() async throws -> (String, Int) {
        let text = String(decoding: try await get("sw.js"), as: UTF8.self)
        guard let n = version(in: text) else { throw URLError(.cannotParseResponse) }
        return (text, n)
    }

    private static func get(_ path: String) async throws -> Data {
        var req = URLRequest(url: site.appendingPathComponent(path))
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty else { throw URLError(.badServerResponse) }
        return data
    }

    // MARK: - עזר

    /// מספר הגרסה מ-sw.js: const CACHE = 'flight-brief-vN'.
    static func version(in sw: String) -> Int? {
        guard let r = sw.range(of: #"flight-brief-v(\d+)"#, options: .regularExpression) else { return nil }
        return Int(sw[r].dropFirst("flight-brief-v".count))
    }

    /// רשימת הקבצים מ-SHELL ב-sw.js, בלי './'.
    static func shell(_ sw: String) -> [String] {
        guard let start = sw.range(of: "const SHELL = ["),
              let end = sw.range(of: "];", range: start.upperBound..<sw.endIndex) else { return [] }
        let block = sw[start.upperBound..<end.lowerBound]
        var files: [String] = []
        var rest = block[...]
        while let open = rest.firstIndex(of: "'") {
            let after = rest.index(after: open)
            guard let close = rest[after...].firstIndex(of: "'") else { break }
            let name = String(rest[after..<close])
            if name != "./" && !name.contains("..") { files.append(name) }
            rest = rest[rest.index(after: close)...]
        }
        return files
    }

    static func bundledVersion() -> Int {
        let url = Bundle.main.bundleURL.appendingPathComponent("public/sw.js")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return 0 }
        return version(in: text) ?? 0
    }

    private static func root() -> URL {
        let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        var url = lib.appendingPathComponent("NoCloud/web", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }

    static func dir(_ n: Int) -> URL { root().appendingPathComponent("v\(n)", isDirectory: true) }

    private static func isComplete(_ n: Int) -> Bool {
        n > 0 && FileManager.default.fileExists(atPath: dir(n).appendingPathComponent(".complete").path)
    }

    /// הגרסאות שהורדו במלואן.
    private static func downloaded() -> [Int] {
        let items = (try? FileManager.default.contentsOfDirectory(at: root(), includingPropertiesForKeys: nil)) ?? []
        return items.compactMap { Int($0.lastPathComponent.dropFirst()) }.filter { isComplete($0) }
    }

    /// מוחק כל תיקייה אחרת, כולל הורדות חלקיות (vN.partial).
    private static func removeVersions(keep: Set<Int>) {
        let fm = FileManager.default
        let items = (try? fm.contentsOfDirectory(at: root(), includingPropertiesForKeys: nil)) ?? []
        for item in items {
            if let n = Int(item.lastPathComponent.dropFirst()), n > 0, keep.contains(n) { continue }
            try? fm.removeItem(at: item)
        }
    }
}
