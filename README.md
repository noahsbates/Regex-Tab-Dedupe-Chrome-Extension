# Regex Tab Dedupe

The only stylish Chrome extension that lets you write your own regex rules for deduplicating tabs.

You give it an ordered list of regular expressions. When a tab opens, the first enabled rule whose pattern matches the URL takes ownership, and capture group 1 becomes that tab's identity. If an older tab already carries the same identity, the rule either closes the new tab and focuses the original or closes the old tab and keeps the new one.

Regex Tab Dedupe is a Manifest V3 Chrome extension. It runs when a new tab opens and never performs a background sweep of tabs that already existed.

## Install locally

1. Install Node.js 22 or newer.
2. Run `npm install` and `npm run build`.
3. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
4. Select this repository's `dist` directory.
5. Pin the extension from Chrome's extensions menu if you want its rule editor visible in the toolbar.

The extension starts with no active rules. Click its toolbar icon to open the popup. Build and order rules under **Rules**, or apply a ready-made rule under **Presets**. The preset library includes GitHub pull requests, issues, and code comments, plus query-free URLs, YouTube videos, Google Docs, and Jira issues.

## Rule behavior

Rules run from top to bottom. The first enabled regular expression that matches a URL owns that URL.

- Capture group 1 becomes the duplicate identity.
- A rule without captures uses its full match.
- A missing or empty identity never closes a tab.
- The rule ID is part of the identity, so results from different rules do not collide.
- By default, a duplicate closes the new tab and focuses the old one. Under **Advanced rules**, a rule can keep the new tab instead, either always or only when the new URL matches an additional regex.
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

The optional new-tab condition does not define duplicate identity. The main regex must still match both the old and new URLs. The condition only decides whether a matching new tab may replace its older duplicate.

JavaScript regular expressions can backtrack heavily. Keep patterns specific, especially when using nested repetitions.

## Storage and permissions

Rules are stored as one ordered document in `chrome.storage.sync` and mirrored locally. If sync fails, the local copy remains active and the popup shows a retry warning. The document must fit Chrome's 8 KB per-item sync limit.

The extension requests:

- `tabs` to compare URLs, focus the tab a rule keeps, and close its duplicate.
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
