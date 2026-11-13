// Site
// ====
// The server the app is a view of (Info.plist UniiSite), and a request to
// it as the user signed in: the app keeps the site's sign-in cookie in
// the Keychain, in an access group the share extension reads too. The
// answer is the server's JSON, or {error}, as the site's own post() reads it.

import Foundation
import Security

enum Site {

  static let url = URL(string: Bundle.main.object(forInfoDictionaryKey: "UniiSite") as! String)!

  // where the sign-in was kept before the Keychain; only emptied now
  static let group = UserDefaults(suiteName: "group.com.higherorderco.uniichat")!

  // The sign-in cookie, a generic password in the Keychain, this device
  // only (not in backups), readable once the phone was first unlocked.
  // No access group is named: an item goes to the first of
  // keychain-access-groups (project.yml), which the app and the extension
  // both list first, and a read looks in them all.
  // RED ZONE (security review SE, DRAFT awaiting the user's sign-off)
  static let item: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: "com.higherorderco.uniichat",
    kSecAttrAccount: "session",
  ]

  // the cookie kept, or nil (signed out)
  static var session: String? {
    get {
      var query = item
      query[kSecReturnData] = true
      query[kSecMatchLimit] = kSecMatchLimitOne
      var out: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else {
        return nil
      }
      return String(data: data, encoding: .utf8)
    }
    set {
      SecItemDelete(item as CFDictionary)
      guard let value = newValue else {
        return
      }
      var add = item
      add[kSecValueData] = Data(value.utf8)
      add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      SecItemAdd(add as CFDictionary, nil)
    }
  }

  // a GET (body nil) or POST of `body`
  static func call(_ path: String, _ body: Data?) async -> [String: Any] {
    var req = URLRequest(url: URL(string: path, relativeTo: url)!)
    req.httpMethod = body == nil ? "GET" : "POST"
    req.httpBody = body
    req.setValue("Bearer " + (session ?? ""), forHTTPHeaderField: "Authorization")
    guard let (data, res) = try? await URLSession.shared.data(for: req) else {
      return ["error": "Can't reach UniiChat. Try again."]
    }
    if (res as? HTTPURLResponse)?.statusCode == 401 {
      return ["error": "Open UniiChat and sign in first."]
    }
    let out = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    return out ?? ["error": "UniiChat gave no answer. Try again."]
  }

}
