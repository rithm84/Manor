import AppKit
import CryptoKit
import Foundation
import ManorKit
import Supabase

/// The profile picture: where it is shown from and how a new one is stored. A picture is an ordinary Manor
/// file with the `avatar` purpose; finalizing it records it on the profile.
@MainActor
struct AvatarService {
  let gateway: Gateway

  /// A signed address for the saved picture, else the Google account's picture, else nil.
  func currentURL(settings: JSONValue?) async throws -> URL? {
    if let fileId = settings?["avatar_file_id"]?.string { return try await signedURL(fileId) }
    let picture = gateway.client.auth.currentSession?.user.userMetadata["avatar_url"]?.stringValue
    guard let picture, picture.hasPrefix("https://") else { return nil }
    return URL(string: picture)
  }

  private func signedURL(_ fileId: String) async throws -> URL? {
    let rows = try await gateway.rowsFromServer("file_objects", where: [RowFilter("id", .string(fileId))], columns: "id,storage_path,status")
    guard let row = rows.first, row["status"]?.string == "ready", let path = row["storage_path"]?.string else { return nil }
    return try await gateway.perform("Profile picture") {
      try await gateway.client.storage.from("manor-files").createSignedURL(path: path, expiresIn: 900)
    }
  }

  /// Uploads a JPEG as the new profile picture and returns its signed address.
  func upload(jpeg data: Data) async throws -> URL? {
    guard data.count <= 5 * 1024 * 1024 else {
      throw ManorRequestError(operation: "allocate_file", code: "size", detail: "Profile pictures must be 5 MB or smaller.")
    }
    let id = UUID()
    let fileId = id.uuidString.lowercased()
    let sha256 = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let receipt = try await gateway.command("allocate_file", [
      "id": .string(fileId), "purpose": "avatar", "parent_id": .null, "name": "Profile picture", "label": .null,
      "mime_type": "image/jpeg", "size": .number(Double(data.count)), "sha256": .string(sha256)
    ], id: id)
    guard let path = receipt.record?["storage_path"]?.string else { throw SettingsDomain.SettingsError.unexpected("file") }
    _ = try await gateway.perform("Upload profile picture") {
      try await gateway.client.storage.from("manor-files").upload(path, data: data, options: FileOptions(contentType: "image/jpeg", upsert: false))
    }
    try await finalize(fileId, size: data.count)
    await gateway.afterServerWrite(tables: ["profiles"])
    return try await signedURL(fileId)
  }

  /// Asks the verifier to check the stored bytes against the allocation until the file is ready.
  private func finalize(_ id: String, size: Int) async throws {
    for attempt in 0..<12 {
      let result = try await gateway.function("file-finalize", ["id": .string(id)])
      switch result["status"]?.string {
      case "ready": return
      case "verifying": continue
      default:
        if attempt >= 2 { throw ManorRequestError(operation: "file-finalize", code: "verify", detail: "The picture could not be verified. Try again.") }
        try await Task.sleep(for: .seconds(attempt + 1))
      }
    }
    throw ManorRequestError(operation: "file-finalize", code: "verify", detail: "The picture could not be verified. Try again.")
  }
}

/// The square crop the picture dialog produces: the visible region rendered to a 512 point JPEG.
enum AvatarCrop {
  static let viewport: CGFloat = 240
  static let exportSize: CGFloat = 512

  /// Cover-fit scale so the image always fills the square viewport.
  static func baseScale(_ size: CGSize) -> CGFloat {
    max(viewport / max(size.width, 1), viewport / max(size.height, 1))
  }

  static func clamp(_ offset: CGSize, image size: CGSize, zoom: CGFloat) -> CGSize {
    let scale = baseScale(size) * zoom
    let maxX = max(0, (size.width * scale - viewport) / 2)
    let maxY = max(0, (size.height * scale - viewport) / 2)
    return CGSize(width: min(maxX, max(-maxX, offset.width)), height: min(maxY, max(-maxY, offset.height)))
  }

  static func jpeg(_ image: NSImage, zoom: CGFloat, offset: CGSize) -> Data? {
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    let size = CGSize(width: cgImage.width, height: cgImage.height)
    let scale = baseScale(size) * zoom
    let ratio = exportSize / viewport
    guard let context = CGContext(data: nil, width: Int(exportSize), height: Int(exportSize), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    context.interpolationQuality = .high
    context.setFillColor(.white)
    context.fill(CGRect(x: 0, y: 0, width: exportSize, height: exportSize))
    let width = size.width * scale * ratio, height = size.height * scale * ratio
    // The viewport's center plus the drag offset; Core Graphics counts y upward.
    let x = (exportSize - width) / 2 + offset.width * ratio
    let y = (exportSize - height) / 2 - offset.height * ratio
    context.draw(cgImage, in: CGRect(x: x, y: y, width: width, height: height))
    guard let output = context.makeImage() else { return nil }
    return NSBitmapImageRep(cgImage: output).representation(using: .jpeg, properties: [.compressionFactor: 0.88])
  }
}
