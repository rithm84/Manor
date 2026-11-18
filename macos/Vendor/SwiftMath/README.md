# SwiftMath (vendored)

_Last updated: 2026-11-17_

[SwiftMath](https://github.com/mgriebling/SwiftMath) 1.7.3, MIT License (see `LICENSE`), renders LaTeX
equations in Notes. It is vendored with one change: the math fonts load from the app's `Resources/MathFonts`
folder (`SwiftMath/MathFontsLocation.swift`) instead of a SwiftPM resource bundle, which a signed app cannot
carry beside itself. Only Latin Modern Math, the default font, ships; it is under the GUST Font License
(`macos/Resources/MathFonts/GUST-FONT-LICENSE.txt`).
