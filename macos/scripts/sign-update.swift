// Prints the base64 Ed25519 signature of a file with the update key: swift scripts/sign-update.swift <file>
import CryptoKit
import Foundation
let keyURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/manor/update_ed25519.key")
let raw = try String(contentsOf: keyURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(base64Encoded: raw)!)
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
print(try key.signature(for: data).base64EncodedString())
