import SwiftUI

enum Brand {
  static let accent = Color("AccentColor")
  static let owed = Color("BalancePositive")
  static let owing = Color("BalanceNegative")
}

@MainActor @Observable final class AppModel {
  var api = APIClient(token: Keychain.read())
  var user: Person?
  var balances: BalancesResponse?
  var friends: [Person] = []
  var loading = false
  var error: String?
  var authenticated: Bool { api.token != nil }
  func refresh() async {
    guard !loading else { return }
    loading = true
    defer { loading = false }
    do {
      async let me = api.call("user.me", as: Person.self)
      async let rows = api.call("user.getBalances", as: BalancesResponse.self)
      async let people = api.call("user.getFriends", as: [Person].self)
      (user, balances, friends) = try await (me, rows, people)
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  func signIn(email: String, code: String) async throws {
    let result = try await api.auth("email/verify", body: ["email": email, "code": code], as: SignInResponse.self)
    try await completeSignIn(result)
  }
  func signInWithApple(identityToken: String, fullName: String?) async throws {
    // Matches Expo's existing endpoint: identityToken + optional fullName, not authorizationCode.
    var body = ["identityToken": identityToken]
    if let fullName, !fullName.isEmpty { body["fullName"] = fullName }
    let result = try await api.auth("apple", body: body, as: SignInResponse.self)
    try await completeSignIn(result)
  }
  private func completeSignIn(_ result: SignInResponse) async throws {
    try Keychain.save(result.token)
    api.token = result.token
    user = result.user
    await refresh()
  }
}

@main struct SplitProApp: App {
  @State private var model = AppModel()
  var body: some Scene {
    WindowGroup {
      Group {
        if model.authenticated { MainTabs() } else { SignInView() }
      }
      .environment(model)
      .tint(Brand.accent)
    }
  }
}

struct MainTabs: View {
  var body: some View {
    TabView {
      Tab("Balances", systemImage: "arrow.left.arrow.right") { BalancesView() }
      Tab("Groups", systemImage: "person.3") { placeholder("Groups", "Your shared spaces", "person.3") }
      Tab("Activity", systemImage: "clock") { placeholder("Activity", "You're all caught up", "clock") }
      Tab("Account", systemImage: "person.crop.circle") { AccountView() }
    }
  }
  private func placeholder(_ title: String, _ message: String, _ icon: String) -> some View {
    NavigationStack {
      ContentUnavailableView(message, systemImage: icon, description: Text("This tab is outside the two-screen prototype."))
        .navigationTitle(title)
    }
  }
}

struct AccountView: View {
  @Environment(AppModel.self) private var model
  var body: some View {
    NavigationStack {
      Form {
        Section { Text(model.user?.displayName ?? "Account"); Text(model.user?.email ?? "") }
        Button("Sign Out", role: .destructive) {
          Task {
            _ = try? await model.api.request(path: "api/mobile/auth/signout", body: Data("{}".utf8))
            try? Keychain.save(nil)
            model.api.token = nil
            model.balances = nil
          }
        }
      }.navigationTitle("Account")
    }
  }
}
