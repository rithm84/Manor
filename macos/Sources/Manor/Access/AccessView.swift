import ManorKit
import SwiftUI

/// Sign in with Google, or pass the invitation gate first to create an account.
struct AccessView: View {
  let session: ManorSession
  let initialError: String?
  @State private var creating = false
  @State private var email = ""
  @State private var password = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    VStack(spacing: 0) {
      ManorLogo(width: 44).padding(.bottom, Space.s8)
      Text("A little more room for your day")
        .font(.ui(Typography.Size.sm, weight: .medium))
        .foregroundStyle(Palette.primary)
        .padding(.bottom, Space.s2)
      Text(creating ? "Make yourself at home." : "Welcome to Manor.")
        .font(.display(Typography.Size.displayLG))
        .foregroundStyle(Palette.ink)
        .contentTransition(.opacity)
      Text("Your plans, notes, and daily perspective. Together in one place.")
        .font(.ui(Typography.Size.md))
        .foregroundStyle(Palette.inkMuted)
        .padding(.top, Space.s2)
        .padding(.bottom, Space.s8)

      VStack(alignment: .leading, spacing: Space.s2) {
        if creating {
          Text("Google email address").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody)
          TextField("", text: $email).textFieldStyle(.manor).textContentType(.emailAddress)
          Text("Invitation password").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody).padding(.top, Space.s2)
          SecureField("", text: $password).textFieldStyle(.manor)
          Text("Use the same Google account in the next step.").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
            .padding(.bottom, Space.s2)
        }
        Button(action: submit) {
          HStack(spacing: Space.s2) {
            if busy || session.isAuthenticating { ProgressView().controlSize(.small).tint(Palette.onPrimary) }
            Text(busy || session.isAuthenticating ? "Connecting…" : "Continue with Google")
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(.primary)
        .keyboardShortcut(.defaultAction)
        .disabled(busy || (creating && (email.isEmpty || password.isEmpty)))
        if let error {
          Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError).fixedSize(horizontal: false, vertical: true)
            .transition(.opacity)
        }
      }
      .frame(width: 320)
      .animation(Motion.base, value: creating)

      Button(creating ? "Already have an account? Sign in" : "New here? Create an account") {
        creating.toggle()
        password = ""
        error = nil
      }
      .buttonStyle(.plain)
      .font(.ui(Typography.Size.sm, weight: .medium))
      .foregroundStyle(Palette.link)
      .padding(.top, Space.s5)
      .disabled(busy)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .onAppear { error = initialError }
  }

  private func submit() {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        if creating { try await session.requestSignup(email: email, password: password) }
        else { try await session.signInWithGoogle() }
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
