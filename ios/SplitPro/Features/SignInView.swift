import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
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
            .font(.title3).foregroundStyle(.secondary)
        }
        VStack(spacing: 18) {
          TextField(codeSent ? "Sign-in code" : "Email address", text: codeSent ? $code : $email)
            .keyboardType(codeSent ? .asciiCapable : .emailAddress)
            .textContentType(codeSent ? .oneTimeCode : .emailAddress)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(18).background(.quaternary.opacity(0.45), in: .rect(cornerRadius: 16))
            .focused($focused).submitLabel(.go).onSubmit(submit)
            .accessibilityIdentifier(codeSent ? "auth.code" : "auth.email")
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
