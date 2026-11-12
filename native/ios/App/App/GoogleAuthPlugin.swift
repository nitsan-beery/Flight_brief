import Foundation
import Capacitor
import AuthenticationServices
import CryptoKit
import Security

// התחברות לגוגל באפליקציית ה-iOS, ליומן בלבד. requirements.md, סעיף 6.5.
//
// גוגל חוסמת התחברות בתוך WebView, ולכן ההתחברות נפתחת בחלון ההתחברות המאובטח של iOS
// (ASWebAuthenticationSession), ב-OAuth עם PKCE ו-Client ID מסוג iOS (בלי סוד). ההחלפה של הקוד באסימון
// נעשית כאן ולא ב-JS. אסימון הרענון נשמר ב-Keychain של האפליקציה בלבד, כדי לקבל אסימון גישה חדש בשקט
// בלי חלון כל שעה. ל-JS חוזר רק אסימון הגישה.
//
// שגיאות (code): canceled, access_denied, no_refresh (אין אסימון רענון בתוקף), failed.

@objc(GoogleAuthPlugin)
public class GoogleAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "GoogleAuthPlugin"
    public let jsName = "GoogleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
    ]

    private let authURL = "https://accounts.google.com/o/oauth2/v2/auth"
    private let tokenURL = "https://oauth2.googleapis.com/token"
    private let revokeURL = "https://oauth2.googleapis.com/revoke"
    private let keychainService = "flight-brief.google"
    private let keychainAccount = "refresh-token"
    private var session: ASWebAuthenticationSession?

    // MARK: - JS

    /// חלון ההתחברות של גוגל. { clientId, scopes, hint? } → { accessToken, expiresIn, scope }
    @objc func signIn(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId"), !clientId.isEmpty,
              let scopes = call.getString("scopes") else {
            call.reject("חסרים פרטי התחברות.", "failed")
            return
        }
        // ה-scheme של ההפניה חזרה: ה-Client ID הפוך, כפי שגוגל מגדירה ל-Client ID מסוג iOS.
        let scheme = clientId.split(separator: ".").reversed().joined(separator: ".")
        let redirect = "\(scheme):/oauth2redirect"
        let verifier = Self.randomString()
        let state = Self.randomString()
        let challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))

        var comps = URLComponents(string: authURL)!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scopes),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]
        if let hint = call.getString("hint"), !hint.isEmpty {
            comps.queryItems?.append(URLQueryItem(name: "login_hint", value: hint))
        }
        guard let url = comps.url else { call.reject("ההתחברות לגוגל נכשלה.", "failed"); return }

        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
                guard let self = self else { return }
                self.session = nil
                if let error = error {
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        call.reject("החלון של גוגל נסגר לפני סיום ההתחברות.", "canceled")
                    } else {
                        call.reject("ההתחברות לגוגל נכשלה.", "failed")
                    }
                    return
                }
                let items = URLComponents(url: callback!, resolvingAgainstBaseURL: false)?.queryItems ?? []
                let value: (String) -> String? = { name in items.first(where: { $0.name == name })?.value }
                if value("error") != nil {
                    call.reject("לא ניתנה הרשאה לקרוא את היומן.", "access_denied")
                    return
                }
                guard value("state") == state, let code = value("code") else {
                    call.reject("ההתחברות לגוגל נכשלה.", "failed")
                    return
                }
                self.token(call, [
                    "code": code,
                    "client_id": clientId,
                    "redirect_uri": redirect,
                    "grant_type": "authorization_code",
                    "code_verifier": verifier,
                ])
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() { call.reject("ההתחברות לגוגל נכשלה.", "failed") }
        }
    }

    /// אסימון גישה חדש בשקט, מאסימון הרענון השמור. { clientId } → { accessToken, expiresIn, scope }
    @objc func refresh(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId"), let refresh = readRefreshToken() else {
            call.reject("אין התחברות שמורה.", "no_refresh")
            return
        }
        token(call, ["client_id": clientId, "refresh_token": refresh, "grant_type": "refresh_token"])
    }

    /// ניתוק: ביטול ההרשאה בגוגל ומחיקת אסימון הרענון מהמכשיר.
    @objc func signOut(_ call: CAPPluginCall) {
        let refresh = readRefreshToken()
        deleteRefreshToken()
        guard let refresh = refresh else { call.resolve(); return }
        post(revokeURL, ["token": refresh]) { _, _ in call.resolve() }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }

    // MARK: - אסימונים

    private func token(_ call: CAPPluginCall, _ form: [String: String]) {
        let isRefresh = form["grant_type"] == "refresh_token"
        post(tokenURL, form) { [weak self] status, json in
            guard let self = self else { return }
            guard status == 200, let json = json, let access = json["access_token"] as? String else {
                if isRefresh && (json?["error"] as? String) == "invalid_grant" {
                    self.deleteRefreshToken() // ההרשאה בוטלה או פגה: בלחיצה הבאה נפתח שוב חלון ההתחברות
                    call.reject("ההתחברות לגוגל פגה.", "no_refresh")
                } else if status == nil {
                    call.reject("אין חיבור לרשת.", "failed")
                } else {
                    call.reject("ההתחברות לגוגל נכשלה.", "failed")
                }
                return
            }
            if let refresh = json["refresh_token"] as? String { self.saveRefreshToken(refresh) }
            call.resolve([
                "accessToken": access,
                "expiresIn": (json["expires_in"] as? NSNumber)?.intValue ?? 3600,
                "scope": json["scope"] as? String ?? "",
            ])
        }
    }

    private func post(_ url: String, _ form: [String: String], done: @escaping (Int?, [String: Any]?) -> Void) {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        var req = URLRequest(url: URL(string: url)!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = form.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&").data(using: .utf8)
        URLSession.shared.dataTask(with: req) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            done(status, json)
        }.resume()
    }

    // MARK: - Keychain

    private var keychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: keychainService,
         kSecAttrAccount as String: keychainAccount]
    }

    private func saveRefreshToken(_ token: String) {
        deleteRefreshToken()
        var q = keychainQuery
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    private func readRefreshToken() -> String? {
        var q = keychainQuery
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteRefreshToken() {
        SecItemDelete(keychainQuery as CFDictionary)
    }

    // MARK: - עזר

    private static func randomString() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64url(Data(bytes))
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
