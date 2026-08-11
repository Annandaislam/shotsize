# ShotSize Privacy Policy

_Last updated: 7 August 2026_

## Short version

ShotSize does not collect, transmit, or store any of your data. Everything happens
on your own computer.

## What the extension accesses

ShotSize only acts on the tab that is open when you click the toolbar button and
press **Capture**. To produce a screenshot at a size larger than your screen, it
temporarily tells Chrome's rendering engine to lay the page out at the dimensions
you typed, takes one picture, and then restores the page.

| Permission | Why it is needed |
| --- | --- |
| `debugger` | The only Chrome API that can render a page at a size other than the visible window. Used for the duration of a single capture, then released. Chrome shows a yellow "ShotSize is debugging this browser" bar while it is active; that is expected. |
| `activeTab` | Grants access to the current tab only, and only after you click the extension. |
| `scripting` | Injects a stylesheet that hides cookie/consent overlays, if you tick that box. |
| `downloads` | Saves the finished image to your Downloads folder. |
| `storage` | Remembers your last-used size and checkbox settings, locally. |

## What is not done

- No analytics, telemetry, crash reporting, or usage tracking.
- No remote servers. The extension makes no network requests of its own.
- No page content, URLs, cookies, form data, or screenshots are sent anywhere.
- Screenshots exist only in the popup preview and in the file you choose to save.
- Nothing is sold, shared, or transferred to third parties.

## Data retention

The only thing ShotSize stores is your chosen size and checkbox preferences, in
Chrome's local extension storage on your machine. Uninstalling the extension
removes it.

## Contact

Questions about this policy: seo@seoskit.com
