# App shell and navigation

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

The app shell is the `Manor` executable target in `macos/Sources/Manor/`. It owns the window, the sidebar, page lifetime, deep-link routing, the theme, toasts, and the updater. Business rules live in `ManorKit` and on the server.

## Process and window

`ManorApp` declares one SwiftUI `Window` scene with a hidden title bar, a default size of 1360 by 860 points, and a minimum of 980 by 640. `WindowChrome` gives the window a 52-point unified toolbar with no title, so the close, minimize, and zoom buttons sit inside the sidebar's rounded corner while content runs to the top edge.

`AppDelegate` registers the bundled fonts before launch and returns `false` from `applicationShouldTerminateAfterLastWindowClosed`, so closing the window keeps Manor running and the Dock icon reopens it at once with the account loaded. Termination, reopen, and launch callbacks pass through `AlfredBridge`, which implements the Prep-mode quit rule described in the [Alfred](alfred.md#quitting-and-reopening) slice.

## State objects

| Object | Lifetime | Owns |
|---|---|---|
| `AppModel` | The process | Configuration, the `ManorSession`, the theme controller, toasts, the updater, the sidebar preference, full-screen state, and a deep link that arrived before sign-in finished |
| `ManorSession` (`ManorKit`) | The process | Auth state, the account-bound `Gateway`, sign-out guards and cleanups, and the mirror factory |
| `AppContext` | One signed-in account | The gateway, the account, the current route, deep-link targets, Command-N requests, a pending agent consent request, and the Pomodoro badge |

`RootView` switches on the session state: a logo while starting, `AccessView` when signed out, and `MainView` when signed in. `MainView` is keyed by the account ID, so switching accounts discards every page's state.

`ModuleBootstrap.install` runs once at launch and registers each module's hooks on the session: the local mirror factory and its sign-out wipe, the Notes and Problems sign-out guards for unsynced drafts, and a guard that refuses sign-out while files are still uploading.

## Pages and navigation

`Route` lists the pages in sidebar order: Home, Tracking, Pomodoro, Problems, Jobs, Notes, Bookmarks, and Settings. Command-1 through Command-7 follow that order, Command-comma opens Settings, Command-backslash toggles the sidebar, and Command-N sends a create request to the current page when it supports one (`Route.supportsCreate`).

`MainView` keeps every page you visit alive for the session. Hidden pages stay in the view tree with zero opacity, no hit testing, hidden accessibility, and an offset far outside the window, because AppKit-backed controls such as text views and tables ignore SwiftUI's hit-testing flag. Returning to a page restores its scroll position, selection, open dialog, and unfinished controls. When the route changes, the shell clears first responder if it sits in a page that just moved out of view, so keystrokes never land in a hidden field.

## Sidebar

The sidebar is 224 points wide. On macOS 26 it floats as a Liquid Glass panel inset from the window edge; on earlier systems it is a solid column with a hairline border. Collapsed, an 8-point hover strip on the left edge reveals it as a floating overlay that hides when the pointer leaves. The preference is stored in `UserDefaults` (`manor.sidebar.docked`). The sidebar shows an **Update ready** row when the updater holds a verified release, and the account menu at the bottom holds Settings and Sign out.

## Deep links

Links on the build's scheme (`manor://` or `manor-staging://`) arrive through `onOpenURL` and `AppModel.handle(url:)`:

| Link | Effect |
|---|---|
| `<scheme>://auth/callback?code=…` or a fragment with tokens | Completes sign-in |
| `<scheme>://oauth/consent?authorization_id=…` | Opens the agent consent dialog over the current page |
| `<scheme>://<route>/<path>?<query>` | Navigates to the route and hands the path and query to the page (`manor://notes/<id>`, `manor://leetcode/<id>`, `manor://settings/connections`) |

The Problems route's path is `leetcode`, and the retired `habits` and `mood-focus` paths open Tracking. A page link that arrives before the account is ready waits in `pendingLink` and opens once it is. The [auth and deep links](auth-and-deep-links.md) slice covers the sign-in and consent flows.

## Theme and toasts

`ThemeController` applies system, light, dark, or day and night by setting `NSApp.appearance`; day and night sets light from 6 AM to 6 PM local time and schedules the next switch. The choice is stored per Mac (`manor.theme`). `ToastCenter` shows transient messages and errors above every page.

## Settings

Settings is a page with its own section list: Account, Appearance, Connections, Alfred, Shortcuts, and About. A link can name a section, and the Connections section completes integration callbacks that return as `manor://settings?…`. The Shortcuts section lists every in-app shortcut; Alfred's shortcuts are listed in its own section.
