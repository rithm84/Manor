// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Manor",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "Manor", targets: ["Manor"]),
    .library(name: "ManorKit", targets: ["ManorKit"])
  ],
  dependencies: [
    .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.24.0"),
    .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    .package(url: "https://github.com/swiftlang/swift-markdown.git", from: "0.7.0")
  ],
  targets: [
    .target(
      name: "ManorKit",
      dependencies: [
        .product(name: "Supabase", package: "supabase-swift"),
        .product(name: "GRDB", package: "GRDB.swift")
      ],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .executableTarget(
      name: "Manor",
      dependencies: ["ManorKit", "Alfred", .product(name: "Markdown", package: "swift-markdown"), "SwiftMath"],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // Alfred, Manor's assistant: the notch overlay, menu bar item, hotkeys, and live listening. No package dependencies.
    .target(
      name: "Alfred",
      swiftSettings: [.swiftLanguageMode(.v5)],
      linkerSettings: [.linkedFramework("AVFoundation"), .linkedFramework("Carbon"), .linkedFramework("ScreenCaptureKit")]
    ),
    // SwiftMath 1.7.3, vendored so its fonts load from the app's Resources (see Vendor/SwiftMath/README.md).
    .target(
      name: "SwiftMath",
      path: "Vendor/SwiftMath/SwiftMath",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "ManorKitTests",
      dependencies: ["ManorKit"],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "AlfredTests",
      dependencies: ["Alfred"],
      swiftSettings: [.swiftLanguageMode(.v5)]
    )
  ]
)
