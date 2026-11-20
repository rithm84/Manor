import ManorKit
import SwiftUI

/// Sign in with Apple. An Apple ID with no Manor account yet comes back asking for the invitation password, then
/// signs in again to create the account.
struct AccessView: View {
  let session: ManorSession
  let initialError: String?
  @State private var password = ""
  @State private var busy = false
  @State private var error: String?

  private var inviting: Bool { session.pendingInvitation != nil }

  var body: some View {
    VStack(spacing: 0) {
      ManorLogo(width: 44).padding(.bottom, Space.s8)
      Text("A little more room for your day")
        .font(.ui(Typography.Size.sm, weight: .medium))
        .foregroundStyle(Palette.primary)
        .padding(.bottom, Space.s2)
      Text(inviting ? "Make yourself at home." : "Welcome to Manor.")
        .font(.display(Typography.Size.displayLG))
        .foregroundStyle(Palette.ink)
        .contentTransition(.opacity)
      Text(inviting
        ? "This Apple ID is new to Manor. Enter your invitation password to create your account."
        : "Your plans, notes, and daily perspective. Together in one place.")
        .font(.ui(Typography.Size.md))
        .foregroundStyle(Palette.inkMuted)
        .multilineTextAlignment(.center)
        .padding(.top, Space.s2)
        .padding(.bottom, Space.s8)

      VStack(alignment: .leading, spacing: Space.s2) {
        if inviting {
          Text("Invitation password").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody)
          SecureField("", text: $password).textFieldStyle(.manor)
            .padding(.bottom, Space.s2)
        }
        Button(action: submit) {
          HStack(spacing: Space.s2) {
            if busy || session.isAuthenticating {
              ProgressView().controlSize(.small).tint(Palette.surfaceCanvas)
            } else {
              Image(systemName: "apple.logo").accessibilityHidden(true)
            }
            Text(busy || session.isAuthenticating ? "Connecting…" : "Continue with Apple")
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(.manor(.apple))
        .keyboardShortcut(.defaultAction)
        .disabled(busy || (inviting && password.isEmpty))
        if let error {
          Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError).fixedSize(horizontal: false, vertical: true)
            .transition(.opacity)
        }
      }
      .frame(width: 320)
      .animation(Motion.base, value: inviting)

      if inviting {
        Button("Use a different Apple ID") {
          session.cancelInvitation()
          password = ""
          error = nil
        }
        .buttonStyle(.plain)
        .font(.ui(Typography.Size.sm, weight: .medium))
        .foregroundStyle(Palette.link)
        .padding(.top, Space.s5)
        .disabled(busy)
      }
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
        if inviting { try await session.redeemInvitation(password: password) }
        else { try await session.signInWithApple() }
        password = ""
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
