import Foundation
import Capacitor

// PDF שנפתח באפליקציה מתפריט "שתף" של אפליקציה אחרת. requirements.md, סעיפים 3.1 ו-6.5.
//
// ‏iOS מעתיק את הקובץ לאפליקציה (LSSupportsOpeningDocumentsInPlace = false) ומעביר אותו ל-SceneDelegate,
// גם כשהאפליקציה נפתחת ממנו, לפני שה-WebView עלה. לכן הקובץ נקרא מיד ונשמר כאן, העותק נמחק, ו-JS לוקח
// אותו (take) כשהוא עולה, או כשמגיע האירוע incomingfile. רק הקובץ האחרון נשמר.

@objc(IncomingFilePlugin)
public class IncomingFilePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IncomingFilePlugin"
    public let jsName = "IncomingFile"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
    ]

    private static var pending: (name: String, data: Data)?
    private static let lock = NSLock()
    private static weak var current: IncomingFilePlugin?

    override public func load() {
        Self.current = self
    }

    /// מ-SceneDelegate: הקבצים שהתקבלו. רק PDF.
    static func receive(_ urls: [URL]) {
        guard let url = urls.last(where: { $0.pathExtension.lowercased() == "pdf" }) else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), !data.isEmpty else { return }
        // העותק ש-iOS יצר (Documents/Inbox) לא נשאר במכשיר.
        if url.path.contains("/Inbox/") { try? FileManager.default.removeItem(at: url) }
        lock.lock()
        pending = (url.lastPathComponent, data)
        lock.unlock()
        DispatchQueue.main.async {
            current?.bridge?.triggerWindowJSEvent(eventName: "incomingfile")
        }
    }

    /// → { name, data (base64) }, או {} כשאין קובץ.
    @objc func take(_ call: CAPPluginCall) {
        Self.lock.lock()
        let file = Self.pending
        Self.pending = nil
        Self.lock.unlock()
        guard let file = file else { call.resolve([:]); return }
        call.resolve(["name": file.name, "data": file.data.base64EncodedString()])
    }
}
