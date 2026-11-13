import Foundation
import Capacitor
import QuickLook

// פתיחת קובץ התדריך השמור בלחיצה על שמו. requirements.md, סעיפים 3.1 ו-6.5.
//
// ב-WebView של האפליקציה window.open לא פותח דבר, ולכן הקובץ מגיע מ-JS (base64), נכתב לתיקייה זמנית בשמו
// המקורי ומוצג ב-Quick Look מעל האפליקציה. הקובץ הזמני נמחק כש-Quick Look נסגר, ובעליית האפליקציה.

@objc(OpenFilePlugin)
public class OpenFilePlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    public let identifier = "OpenFilePlugin"
    public let jsName = "OpenFile"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    private static let folder = FileManager.default.temporaryDirectory.appendingPathComponent("brief-preview", isDirectory: true)
    private var fileURL: URL?

    override public func load() {
        try? FileManager.default.removeItem(at: Self.folder)
    }

    /// { name, data (base64) } → מציג את הקובץ. נפתר כש-Quick Look מוצג.
    @objc func open(_ call: CAPPluginCall) {
        guard let base64 = call.getString("data"), let data = Data(base64Encoded: base64), !data.isEmpty else {
            call.reject("אין קובץ לפתוח.", "bad_data")
            return
        }
        let url = Self.folder.appendingPathComponent(Self.safeName(call.getString("name")))
        do {
            try? FileManager.default.removeItem(at: Self.folder)
            try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
        } catch {
            call.reject("לא ניתן לפתוח את הקובץ.", "failed")
            return
        }
        DispatchQueue.main.async {
            guard var top = self.bridge?.viewController else {
                self.cleanup()
                call.reject("לא ניתן לפתוח את הקובץ.", "failed")
                return
            }
            while let presented = top.presentedViewController { top = presented }
            self.fileURL = url
            let preview = QLPreviewController()
            preview.dataSource = self
            preview.delegate = self
            top.present(preview, animated: true)
            call.resolve()
        }
    }

    /// שם קובץ בטוח לתיקייה הזמנית, שמסתיים ב-.pdf.
    private static func safeName(_ raw: String?) -> String {
        var name = (raw ?? "")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name.hasPrefix(".") { name = "brief.pdf" }
        if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
        return name
    }

    private func cleanup() {
        fileURL = nil
        try? FileManager.default.removeItem(at: Self.folder)
    }

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        fileURL == nil ? 0 : 1
    }

    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (fileURL ?? Self.folder) as NSURL
    }

    public func previewControllerDidDismiss(_ controller: QLPreviewController) {
        cleanup()
    }
}
