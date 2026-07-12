# Regex Tab Dedupe

The only stylish Chrome extension that lets you write your own regex rules for deduplicating tabs.

You give it an ordered list of regular expressions. When a tab opens, the first enabled rule whose pattern matches the URL takes ownership, and capture group 1 becomes that tab's identity. If an older tab already carries the same identity, the new tab closes and the original gets focus.

Regex Tab Dedupe is a Manifest V3 Chrome extension. It only ever acts on newly opened tabs, focuses the oldest matching tab first, and never sweeps duplicates that already existed.

## Install locally

1. Install Node.js 22 or newer.
2. Run `npm install` and `npm run build`.
3. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
4. Select this repository's `dist` directory.
5. Pin the extension from Chrome's extensions menu if you want its rule editor visible in the toolbar.

The extension starts with no active rules. Click its toolbar icon to open the one-page popup. Build and order rules under **Rules**, or choose an editable starting point under **Presets**. The preset library includes GitHub pull requests and issues, query-free URLs, YouTube videos, Google Docs, and Jira issues.

## Rule behavior

Rules run from top to bottom. The first enabled regular expression that matches a URL owns that URL.

- Capture group 1 becomes the duplicate identity.
- A rule without captures uses its full match.
- A missing or empty identity never closes a tab.
- The rule ID is part of the identity, so results from different rules do not collide.
- Only HTTP and HTTPS URLs participate.
- Rules apply only to newly created tabs. The extension checks `pendingUrl` at creation, reacts to URL updates before loading completes, and uses the completed navigation as a fallback.

Example for the same GitHub pull request:

```regex
^https://github\.com/([^/?#]+/[^/?#]+/pull/\d+)(?:[/?#]|$)
```

Example for the same URL without query parameters or fragments:

```regex
^(https?://[^?#]+)
```

JavaScript regular expressions can backtrack heavily. Keep patterns specific, especially when using nested repetitions.

## Storage and permissions

Rules are stored as one ordered document in `chrome.storage.sync` and mirrored locally. If sync fails, the local copy remains active and the popup shows a retry warning. The document must fit Chrome's 8 KB per-item sync limit.

The extension requests:

- `tabs` to compare URLs, focus the old tab, and close the new tab.
- `webNavigation` to inspect a new tab's main-frame destination before the page finishes loading.
- `storage` to save rules and pending new-tab state.
- `alarms` to retry a failed focus or close operation once Chrome APIs recover.

It has no host permissions, content scripts, remote code, or access to page contents.

## Development

After `npm install`, install Chromium once before running the end-to-end test or
release package command:

```sh
npx playwright install chromium
```

```sh
npm test              # unit and integration tests
npm run typecheck     # strict TypeScript check
npm run build         # production build plus manifest validation
npm run test:e2e      # load dist/ in Playwright Chromium
npm run package       # full release checks plus deterministic Web Store ZIP
npm run logo          # regenerate the committed supersampled logo
```

The production build is in `dist/`. Packaging creates `regex-tab-dedupe-extension.zip` at the repository root.

## Privacy site

The project site and privacy policy live in `docs/`. To publish them with
GitHub Pages, choose **Deploy from a branch**, `main`, and `/docs` under the
repository's **Settings > Pages**.

- <https://noahsbates.github.io/Regex-Tab-Dedupe-Chrome-Extension/>
- <https://noahsbates.github.io/Regex-Tab-Dedupe-Chrome-Extension/privacy/>

GitHub must allow Pages for the private repository. Otherwise, publish `docs/`
on another public static host. Test the privacy-policy URL while signed out
before adding it to the Chrome Web Store.

The matching and survivor selection code is independent of Chrome APIs. The background coordinator owns browser events and session recovery; the popup owns rule editing and sync feedback.
