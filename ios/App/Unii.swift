// UniiChat for iOS
// ================
// The site (Site.swift) in a web view, and what only an app does there:
//
// - Notifications: once signed in, the app asks to notify, and gives the
//   server its phone's push token (/api/push); the server pushes each
//   turn's last message (Cloud.ts). iOS shows none while the app is open.
// - Sign-in links open the app (universal links: the server's
//   apple-app-site-association names /auth), signing in its web view.
// - The mic dictates (the site's own recorder; iOS asks once).
// - Export Memory's download goes to the share sheet; the site's prompt()
//   (Delete account asks the name) is an alert.
// - Credit is bought through the App Store, the only payment it allows in
//   an app: the page asks the bridge (`unii`, web/src/main.ts) for
//   `credits.<dollars>`, StoreKit sells it for the account signed in
//   (appAccountToken: its id), and its signed transaction goes to the
//   server (/api/apple), which grants it once; it is finished only once
//   taken, so one left (the app closed, another account signed in) goes
//   again at the next start.
//
// Any page off the site opens in Safari. The share extension is Share/.

import StoreKit
import SwiftUI
import UserNotifications
import WebKit

@main
struct Unii: App {

  @UIApplicationDelegateAdaptor private var phone: Phone

  var body: some Scene {
    WindowGroup {
      ZStack {
        Color.white.ignoresSafeArea()
        Web().ignoresSafeArea(.container, edges: .bottom)
      }
      .onOpenURL { url in Page.shared.web.load(URLRequest(url: url)) }
    }
  }

}

struct Web: UIViewRepresentable {

  func makeUIView(context: Context) -> WKWebView {
    Page.shared.web
  }

  func updateUIView(_ web: WKWebView, context: Context) {}

}

// the phone's push token, given to the server
@MainActor
final class Phone: NSObject, UIApplicationDelegate {

  func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    let hex = token.map { String(format: "%02x", $0) }.joined()
    Task { _ = await Site.call("/api/push", Data(hex.utf8)) }
  }

}

// Page
// ====

@MainActor
final class Page: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {

  static let shared = Page()

  let web: WKWebView

  // where the download being written goes
  var saved: URL? = nil

  override init() {
    let conf = WKWebViewConfiguration()
    conf.allowsInlineMediaPlayback = true
    web = WKWebView(frame: .zero, configuration: conf)
    super.init()
    web.configuration.userContentController.add(self, name: "unii")
    // the sign-in once kept in the app group (a plist, in backups) is gone;
    // it is in the Keychain now (Site.session)
    Site.group.removeObject(forKey: "session")
    web.navigationDelegate = self
    web.uiDelegate = self
    web.load(URLRequest(url: Site.url))
    Task { await Store.resume() }
  }

  // the page loaded: its sign-in kept for requests and the extension;
  // signed in, the push token asked for (iOS asks the user once)
  func webView(_ web: WKWebView, didFinish nav: WKNavigation!) {
    Task {
      let cookies = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
      let session = cookies.first { $0.name == "unii" && $0.domain == Site.url.host }?.value
      // RED ZONE (security review SE, DRAFT awaiting the user's sign-off):
      // kept in the Keychain; no cookie (signed out) deletes it
      if Site.session != session {
        Site.session = session
      }
      let center = UNUserNotificationCenter.current()
      if session != nil, (try? await center.requestAuthorization(options: [.alert, .sound])) == true {
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }

  // the site's own https pages stay (and its blobs, and about:blank); any
  // other opens outside
  func webView(_ web: WKWebView, decidePolicyFor act: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let url = act.request.url else {
      return .cancel
    }
    if Page.own(url) || url.scheme == "blob" || url.absoluteString == "about:blank" {
      return .allow
    }
    if url.scheme == "about" || url.scheme == "data" {
      return .cancel
    }
    _ = await UIApplication.shared.open(url)
    return .cancel
  }

  func webView(_ web: WKWebView, createWebViewWith conf: WKWebViewConfiguration, for act: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = act.request.url {
      UIApplication.shared.open(url)
    }
    return nil
  }

  func webView(_ web: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
    await withCheckedContinuation { done in
      let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
      alert.addTextField { field in field.text = defaultText }
      alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done.resume(returning: nil) })
      alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done.resume(returning: alert.textFields?.first?.text) })
      self.show(alert)
    }
  }

  func webView(_ web: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType) async -> WKPermissionDecision {
    type == .microphone && Page.own(origin) ? .grant : .deny
  }

  // the bridge: {buy: dollars}, heard only from the site's own top page
  func userContentController(_ ucc: WKUserContentController, didReceive msg: WKScriptMessage) {
    guard msg.frameInfo.isMainFrame, Page.own(msg.frameInfo.securityOrigin) else {
      return
    }
    if let usd = (msg.body as? [String: Any])?["buy"] as? Int {
      Task { await Store.buy(usd) }
    }
  }

  // the site's own origin: https, its host (and port)
  static func own(_ url: URL) -> Bool {
    url.scheme == "https" && url.host == Site.url.host && url.port == Site.url.port
  }

  static func own(_ origin: WKSecurityOrigin) -> Bool {
    origin.protocol == "https" && origin.host == Site.url.host && origin.port == (Site.url.port ?? 0)
  }

  // Download
  // --------

  func webView(_ web: WKWebView, decidePolicyFor res: WKNavigationResponse) async -> WKNavigationResponsePolicy {
    let disposition = (res.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    return disposition.hasPrefix("attachment") ? .download : .allow
  }

  func webView(_ web: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(_ download: WKDownload, decideDestinationUsing res: URLResponse, suggestedFilename name: String) async -> URL? {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    try? FileManager.default.removeItem(at: file)
    saved = file
    return file
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let file = saved else {
      return
    }
    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    sheet.popoverPresentationController?.sourceView = web
    sheet.popoverPresentationController?.sourceRect = CGRect(x: web.bounds.midX, y: web.bounds.midY, width: 0, height: 0)
    show(sheet)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    say("The download failed: " + error.localizedDescription)
  }

  // Alerts
  // ------

  func say(_ text: String) {
    let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    show(alert)
  }

  // over whatever is shown
  func show(_ vc: UIViewController) {
    var top = web.window?.rootViewController
    while let next = top?.presentedViewController {
      top = next
    }
    top?.present(vc, animated: true)
  }

}

// Store
// =====

@MainActor
enum Store {

  // `credits.<usd>`, sold for the account signed in, then taken
  static func buy(_ usd: Int) async {
    let me = await Site.call("/api/me", nil)
    guard let id = (me["id"] as? String).flatMap({ Int($0) }) else {
      return Page.shared.say(me["error"] as? String ?? "Sign in first.")
    }
    guard let product = try? await Product.products(for: ["credits.\(usd)"]).first else {
      return Page.shared.say("The App Store can't sell this credit right now. Try again later.")
    }
    let account = UUID(uuidString: String(format: "00000000-0000-4000-8000-%012lx", id))!
    let result = try? await product.purchase(options: [.appAccountToken(account)])
    guard case .success(let sold)? = result else {
      return
    }
    await take(sold)
  }

  // a purchase posted; finished once the server took it
  static func take(_ sold: VerificationResult<StoreKit.Transaction>) async {
    let out = await Site.call("/api/apple", Data(sold.jwsRepresentation.utf8))
    if let error = out["error"] as? String {
      return Page.shared.say(error)
    }
    if case .verified(let done) = sold {
      await done.finish()
    }
  }

  // purchases not taken yet, then any made outside the app's ask (an
  // approval, an interrupted purchase), as they come
  static func resume() async {
    for await sold in StoreKit.Transaction.unfinished {
      await take(sold)
    }
    for await sold in StoreKit.Transaction.updates {
      await take(sold)
    }
  }

}
