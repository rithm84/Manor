// Creates the Ed25519 update signing key once: swift scripts/make-update-key.swift
// The private key stays at ~/.config/manor/update_ed25519.key (never in the repository); the public key is
// printed and belongs in config/update-public-key.txt, which the build script embeds in Info.plist.
import CryptoKit
import Foundation
let path = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/manor/update_ed25519.key")
if FileManager.default.fileExists(atPath: path.path) { print("A key already exists at \(path.path)"); exit(1) }
let key = Curve25519.Signing.PrivateKey()
try key.rawRepresentation.base64EncodedString().write(to: path, atomically: true, encoding: .utf8)
try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
print(key.publicKey.rawRepresentation.base64EncodedString())
