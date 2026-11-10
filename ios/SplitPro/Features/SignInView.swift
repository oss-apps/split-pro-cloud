import SwiftUI
import AuthenticationServices

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.colorScheme) private var colorScheme
  @State private var email = ""
  @State private var code = ""
  @State private var codeSent = false
  @State private var working = false
  @State private var failure: String?
  @FocusState private var focused: Bool
  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 28) {
        Spacer().frame(height: 48)
        Image(systemName: "arrow.triangle.branch")
          .font(.system(size: 38, weight: .medium)).foregroundStyle(Brand.accent)
          .frame(width: 76, height: 76).background(Brand.accent.opacity(0.1), in: .rect(cornerRadius: 23))
        VStack(alignment: .leading, spacing: 12) {
          Text(codeSent ? "Check your inbox" : "Less settling up.\nMore living.")
            .font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
          Text(codeSent ? "Enter the sign-in code sent to \(email)." : "Split expenses with the people you share life with.")
            .font(.title3).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        VStack(spacing: 18) {
          if !codeSent {
            SignInWithAppleButton(.continue) { request in
              request.requestedScopes = [.fullName, .email]
              focused = false
              failure = nil
              working = true
            } onCompletion: { result in
              Task { @MainActor in
                defer { working = false }
                do {
                  let authorization = try result.get()
                  guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                        let data = credential.identityToken,
                        let token = String(data: data, encoding: .utf8), !token.isEmpty else {
                    throw APIError(message: "Sign in with Apple returned no identity token. Please try again.")
                  }
                  let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
                  try await model.signInWithApple(identityToken: token, fullName: name)
                } catch {
                  if (error as NSError).domain != ASAuthorizationError.errorDomain ||
                     (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                    failure = error.localizedDescription
                  }
                }
              }
            }
            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
            .frame(height: 52).clipShape(.rect(cornerRadius: 26))
            .disabled(working).accessibilityIdentifier("auth.apple")
            Text("or continue with email").font(.footnote).foregroundStyle(.secondary)
          }
          TextField(codeSent ? "Sign-in code" : "Email address", text: codeSent ? $code : $email)
            .keyboardType(codeSent ? .asciiCapable : .emailAddress)
            .textContentType(codeSent ? .oneTimeCode : .emailAddress)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(18).background(.quaternary.opacity(0.45), in: .rect(cornerRadius: 16))
            .focused($focused).submitLabel(.go).onSubmit(submit)
            .accessibilityIdentifier(codeSent ? "auth.code" : "auth.email")
            .disabled(working)
          if let failure { Text(failure).font(.callout).foregroundStyle(Brand.owing) }
          Button(action: submit) {
            HStack { if working { ProgressView() }; Text(codeSent ? "Sign In" : "Continue with Email").fontWeight(.semibold) }
              .frame(maxWidth: .infinity, minHeight: 36)
          }.buttonStyle(.glassProminent).controlSize(.large)
            .disabled(working || (codeSent ? code.isEmpty : !email.contains("@")))
            .accessibilityIdentifier("auth.continue")
          if codeSent { Button("Use a different email") { codeSent = false; code = "" } }
        }
        Spacer()
        Label("Simple. Private. Fair.", systemImage: "lock.shield")
          .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity)
      }.padding(28).navigationTitle("SplitPro").navigationBarTitleDisplayMode(.inline)
    }
  }
  private func submit() {
    guard !working else { return }
    focused = false
    working = true
    failure = nil
    Task {
      defer { working = false }
      do {
        if codeSent { try await model.signIn(email: email, code: code) }
        else {
          struct Sent: Decodable { let ok: Bool }
          _ = try await model.api.auth("email", body: ["email": email], as: Sent.self)
          codeSent = true
        }
      } catch { failure = error.localizedDescription }
    }
  }
}
