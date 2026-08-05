import { describe, expect, it } from "vitest";
import { createCoordinator, type BrowserPort } from "../../src/background/coordinator";
import { createSessionRepository } from "../../src/background/session";
import type { TabSnapshot } from "../../src/domain/reconcile";
import {
  createRuleId,
  type RuleDocument,
} from "../../src/domain/rules";
import type { LoadedSettings, SettingsRepository } from "../../src/storage/settings";
import type { ValueStorageArea } from "../../src/storage/value-storage";

class MemoryStorage implements ValueStorageArea {
  readonly values = new Map<string, unknown>();

  async getValue(key: string): Promise<unknown> {
    return this.values.get(key);
  }

  async setValue(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class FakeBrowser implements BrowserPort {
  readonly tabs = new Map<number, TabSnapshot>();
  readonly actions: string[] = [];
  failFocus = false;
  failClose = false;
  getTabOverride:
    | ((tabId: number, tab: TabSnapshot | undefined) => TabSnapshot | undefined)
    | undefined;

  async getTab(tabId: number): Promise<TabSnapshot | undefined> {
    const tab = this.tabs.get(tabId);
    return this.getTabOverride?.(tabId, tab) ?? tab;
  }

  async listNormalTabs(): Promise<readonly TabSnapshot[]> {
    return [...this.tabs.values()];
  }

  async focusTab(tab: TabSnapshot): Promise<void> {
    this.actions.push(`focus:${tab.id}`);
    if (this.failFocus) {
      throw new Error("focus failed");
    }
  }

  async closeTab(tabId: number): Promise<void> {
    this.actions.push(`close:${tabId}`);
    if (this.failClose) {
      throw new Error("close failed");
    }
    this.tabs.delete(tabId);
  }
}

class FakeRetryScheduler {
  scheduled = 0;
  cleared = 0;

  async schedule(): Promise<void> {
    this.scheduled += 1;
  }

  async clear(): Promise<void> {
    this.cleared += 1;
  }
}

const document: RuleDocument = {
  schemaVersion: 1,
  writeId: "rules",
  rules: [
    {
      id: createRuleId("page"),
      name: "Page",
      pattern: String.raw`^(https://example\.com/[^?#]+)`,
      flags: "",
      enabled: true,
      closePolicy: { kind: "close-new" },
    },
  ],
};

const loadedSettings: LoadedSettings = {
  document,
  source: "sync",
  diagnostics: [],
};

const settings: Pick<SettingsRepository, "load"> = {
  async load() {
    return loadedSettings;
  },
};

function tab(
  id: number,
  url: string | undefined,
  status: "loading" | "complete",
): TabSnapshot {
  return {
    id,
    windowId: 1,
    incognito: false,
    status,
    ...(url === undefined ? {} : { url }),
  };
}

function setup(
  settingsOverride: Pick<SettingsRepository, "load"> = settings,
) {
  const browser = new FakeBrowser();
  const retry = new FakeRetryScheduler();
  const session = createSessionRepository({ storage: new MemoryStorage() });
  const coordinator = createCoordinator({
    browser,
    retry,
    session,
    settings: settingsOverride,
  });
  return { browser, coordinator, retry, session };
}

describe("new-tab coordinator", () => {
  it("uses pendingUrl during creation and closes before loading completes", async () => {
    const { browser, coordinator } = setup();
    browser.tabs.set(10, tab(10, "https://example.com/docs?old=1", "complete"));
    browser.tabs.set(20, tab(20, undefined, "loading"));

    await coordinator.onCreated({
      tab: browser.tabs.get(20),
      pendingUrl: "https://example.com/docs?new=1",
    });

    expect(browser.actions).toEqual(["focus:10", "close:20"]);
  });

  it("uses an onUpdated URL before the tab finishes loading", async () => {
    const { browser, coordinator } = setup();
    browser.tabs.set(10, tab(10, "https://example.com/docs?old=1", "complete"));
    browser.tabs.set(20, tab(20, undefined, "loading"));
    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    await coordinator.onUpdated({
      tabId: 20,
      url: "https://example.com/docs?new=1",
    });

    expect(browser.actions).toEqual(["focus:10", "close:20"]);
  });

  it("keeps listening through redirects when an early URL is not a duplicate", async () => {
    const { browser, coordinator } = setup();
    browser.tabs.set(10, tab(10, "https://example.com/docs?old=1", "complete"));
    browser.tabs.set(20, tab(20, undefined, "loading"));
    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    await coordinator.onUpdated({
      tabId: 20,
      url: "https://redirect.test/outbound",
    });
    expect(browser.actions).toEqual([]);

    await coordinator.onUpdated({
      tabId: 20,
      url: "https://example.com/docs?new=1",
    });
    expect(browser.actions).toEqual(["focus:10", "close:20"]);
  });

  it("recovers an observed update URL after a worker restart", async () => {
    const unavailableSettings: Pick<SettingsRepository, "load"> = {
      async load() {
        throw new Error("settings unavailable");
      },
    };
    const { browser, coordinator, retry, session } = setup(unavailableSettings);
    browser.tabs.set(10, tab(10, "https://example.com/docs?old=1", "complete"));
    browser.tabs.set(20, tab(20, undefined, "loading"));
    await coordinator.onCreated({ tab: browser.tabs.get(20) });
    await coordinator.onUpdated({
      tabId: 20,
      url: "https://example.com/docs?new=1",
    });

    const restarted = createCoordinator({ browser, retry, session, settings });
    await restarted.recover();

    expect(browser.actions).toEqual(["focus:10", "close:20"]);
  });

  it("waits for a completed URL, focuses the oldest tab, then closes the new one", async () => {
    const { browser, coordinator } = setup();
    browser.tabs.set(10, tab(10, "https://example.com/docs?old=1", "complete"));
    browser.tabs.set(20, tab(20, undefined, "loading"));

    await coordinator.onCreated({ tab: browser.tabs.get(20) });
    expect(browser.actions).toEqual([]);

    browser.tabs.set(20, tab(20, "https://example.com/docs?new=1", "complete"));
    await coordinator.onUpdated({ tabId: 20 });

    expect(browser.actions).toEqual(["focus:10", "close:20"]);
    expect(browser.tabs.has(20)).toBe(false);
  });

  it("focuses the new tab and closes old duplicates when the rule requests it", async () => {
    const replaceOldSettings: Pick<SettingsRepository, "load"> = {
      async load() {
        return {
          ...loadedSettings,
          document: {
            ...document,
            rules: document.rules.map((rule) => ({
              ...rule,
              closePolicy: { kind: "close-old" },
            })),
          },
        };
      },
    };
    const { browser, coordinator } = setup(replaceOldSettings);
    browser.tabs.set(10, tab(10, "https://example.com/docs?old=1", "complete"));
    browser.tabs.set(20, tab(20, "https://example.com/docs?new=1", "complete"));

    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    expect(browser.actions).toEqual(["focus:20", "close:10"]);
    expect(browser.tabs.has(10)).toBe(false);
    expect(browser.tabs.has(20)).toBe(true);
  });

  it("replaces a broad old match when the new URL satisfies its condition", async () => {
    const conditionalSettings: Pick<SettingsRepository, "load"> = {
      async load() {
        return {
          ...loadedSettings,
          document: {
            ...document,
            rules: [
              {
                id: createRuleId("github-comment"),
                name: "GitHub comment",
                pattern: String.raw`^https://github\.com/([^/?#]+/[^/?#]+/pull/\d+)(?:[/?#]|$)`,
                flags: "i",
                enabled: true,
                closePolicy: {
                  kind: "close-old-when-new-tab-matches",
                  pattern: String.raw`#discussion_r\d+$`,
                  flags: "i",
                },
              },
            ],
          },
        };
      },
    };
    const { browser, coordinator } = setup(conditionalSettings);
    browser.tabs.set(
      10,
      tab(10, "https://github.com/acme/widgets/pull/42/files", "complete"),
    );
    browser.tabs.set(
      20,
      tab(
        20,
        "https://github.com/acme/widgets/pull/42#discussion_r123",
        "complete",
      ),
    );

    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    expect(browser.actions).toEqual(["focus:20", "close:10"]);
    expect(browser.tabs.has(10)).toBe(false);
    expect(browser.tabs.has(20)).toBe(true);
  });

  it("does not close the old tab when the candidate stops matching its condition", async () => {
    const baseRule = document.rules[0];
    if (baseRule === undefined) {
      throw new Error("Missing base rule");
    }
    const conditionalSettings: Pick<SettingsRepository, "load"> = {
      async load() {
        return {
          ...loadedSettings,
          document: {
            ...document,
            rules: [
              {
                ...baseRule,
                closePolicy: {
                  kind: "close-old-when-new-tab-matches",
                  pattern: "#comment-\\d+$",
                  flags: "",
                },
              },
            ],
          },
        };
      },
    };
    const { browser, coordinator, retry, session } = setup(conditionalSettings);
    browser.tabs.set(10, tab(10, "https://example.com/docs", "complete"));
    browser.tabs.set(
      20,
      tab(20, "https://example.com/docs#comment-12", "complete"),
    );
    browser.getTabOverride = (tabId, current) =>
      tabId === 20
        ? tab(20, "https://example.com/docs", "complete")
        : current;

    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    expect(browser.actions).toEqual([]);
    expect(retry.scheduled).toBe(1);
    expect((await session.load()).candidates).toContainEqual(
      expect.objectContaining({ tabId: 20 }),
    );
  });

  it("recovers a persisted candidate after a worker restart", async () => {
    const { browser, coordinator, retry, session } = setup();
    browser.tabs.set(10, tab(10, "https://example.com/docs", "complete"));
    browser.tabs.set(20, tab(20, undefined, "loading"));
    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    browser.tabs.set(20, tab(20, "https://example.com/docs?new=1", "complete"));
    const restarted = createCoordinator({ browser, retry, session, settings });
    await restarted.recover();

    expect(browser.actions).toEqual(["focus:10", "close:20"]);
  });

  it("settles the oldest concurrent candidate and closes the newer one", async () => {
    const { browser, coordinator } = setup();
    browser.tabs.set(10, tab(10, undefined, "loading"));
    browser.tabs.set(20, tab(20, undefined, "loading"));
    await Promise.all([
      coordinator.onCreated({ tab: browser.tabs.get(10) }),
      coordinator.onCreated({ tab: browser.tabs.get(20) }),
    ]);

    browser.tabs.set(10, tab(10, "https://example.com/docs", "complete"));
    browser.tabs.set(20, tab(20, "https://example.com/docs", "complete"));
    await coordinator.onUpdated({ tabId: 20 });

    expect(browser.actions).toEqual(["focus:10", "close:20"]);
  });

  it("keeps the candidate and schedules a retry when focus fails", async () => {
    const { browser, coordinator, retry, session } = setup();
    browser.tabs.set(10, tab(10, "https://example.com/docs", "complete"));
    browser.tabs.set(20, tab(20, "https://example.com/docs", "complete"));
    browser.failFocus = true;

    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    expect(browser.actions).toEqual(["focus:10"]);
    expect(browser.tabs.has(20)).toBe(true);
    expect(retry.scheduled).toBe(1);
    expect((await session.load()).candidates).toContainEqual({
      kind: "observed-url",
      tabId: 20,
      creationOrdinal: 1,
      url: "https://example.com/docs",
    });
  });

  it("keeps the candidate when settings fail before focus", async () => {
    const unavailableSettings: Pick<SettingsRepository, "load"> = {
      async load() {
        throw new Error("settings unavailable");
      },
    };
    const { browser, coordinator, retry, session } = setup(unavailableSettings);
    browser.tabs.set(10, tab(10, "https://example.com/docs", "complete"));
    browser.tabs.set(20, tab(20, "https://example.com/docs", "complete"));

    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    expect(browser.actions).toEqual([]);
    expect(retry.scheduled).toBe(1);
    expect((await session.load()).candidates).toContainEqual({
      kind: "observed-url",
      tabId: 20,
      creationOrdinal: 1,
      url: "https://example.com/docs",
    });
  });

  it("retries instead of losing the candidate when close fails after focus", async () => {
    const { browser, coordinator, retry, session } = setup();
    browser.tabs.set(10, tab(10, "https://example.com/docs", "complete"));
    browser.tabs.set(20, tab(20, "https://example.com/docs", "complete"));
    browser.failClose = true;

    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    expect(browser.actions).toEqual(["focus:10", "close:20"]);
    expect(browser.tabs.has(20)).toBe(true);
    expect(retry.scheduled).toBe(1);
    expect((await session.load()).candidates[0]?.tabId).toBe(20);
  });

  it("cleans a candidate closed before session cleanup after restart", async () => {
    const { browser, coordinator, retry, session } = setup();
    browser.tabs.set(20, tab(20, undefined, "loading"));
    await coordinator.onCreated({ tab: browser.tabs.get(20) });
    browser.tabs.delete(20);

    const restarted = createCoordinator({ browser, retry, session, settings });
    await restarted.recover();

    expect((await session.load()).candidates).toEqual([]);
    expect((await session.load()).births).toEqual([]);
  });

  it("removes session records when Chrome removes or replaces a tab", async () => {
    const { browser, coordinator, session } = setup();
    browser.tabs.set(20, tab(20, undefined, "loading"));
    await coordinator.onCreated({ tab: browser.tabs.get(20) });

    browser.tabs.delete(20);
    browser.tabs.set(21, tab(21, undefined, "loading"));
    await coordinator.onReplaced(21, 20);
    expect((await session.load()).candidates[0]?.tabId).toBe(21);

    await coordinator.onRemoved(21);
    expect((await session.load()).candidates).toEqual([]);
    expect((await session.load()).births).toEqual([]);
  });
});
