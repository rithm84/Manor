// Prints the client secret Supabase's Apple provider needs: a JWT signed with the Sign in with Apple key.
//
//   swift scripts/apple-client-secret.swift <key.p8> <key id> <team id> <services id>
//
// Apple accepts a secret for at most six months, so this one lasts 180 days; apple-sign-in.sh sets it on a project
// and records when it runs out. Run by apple-sign-in.sh, which keeps the output off the screen.
import CryptoKit
import Foundation

let args = CommandLine.arguments
guard args.count == 5 else {
    FileHandle.standardError.write("usage: apple-client-secret.swift <key.p8> <key id> <team id> <services id>\n".data(using: .utf8)!)
    exit(2)
}
let pem = try String(contentsOfFile: args[1], encoding: .utf8)
let key = try P256.Signing.PrivateKey(pemRepresentation: pem)

func base64url(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}
func segment(_ object: [String: Any]) throws -> String {
    base64url(try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
}

let now = Int(Date().timeIntervalSince1970)
let header = try segment(["alg": "ES256", "kid": args[2]])
let claims = try segment([
    "iss": args[3], "iat": now, "exp": now + 180 * 24 * 3600,
    "aud": "https://appleid.apple.com", "sub": args[4],
])
let input = "\(header).\(claims)"
// JWS ES256 signatures are the raw 64-byte r || s form, which is CryptoKit's rawRepresentation.
let signature = try key.signature(for: Data(input.utf8)).rawRepresentation
print("\(input).\(base64url(signature))")
