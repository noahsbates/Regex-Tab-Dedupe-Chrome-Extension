import type { TabSnapshot } from "../domain/reconcile";
import type { BrowserPort, RetryScheduler } from "./coordinator";

export const RETRY_ALARM_NAME = "retry-pending-dedupe";

export function createChromeBrowserPort(): BrowserPort {
  return {
    async getTab(tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const window = await chrome.windows.get(tab.windowId);
        return window.type === "normal" ? snapshot(tab) : undefined;
      } catch {
        return undefined;
      }
    },

    async listNormalTabs() {
      const windows = await chrome.windows.getAll({
        populate: true,
        windowTypes: ["normal"],
      });
      return windows.flatMap((window) =>
        (window.tabs ?? [])
          .map(snapshot)
          .filter((tab): tab is TabSnapshot => tab !== undefined),
      );
    },

    async focusTab(tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    },

    async closeTab(tabId) {
      await chrome.tabs.remove(tabId);
    },
  };
}

export function createChromeRetryScheduler(): RetryScheduler {
  return {
    async schedule() {
      await chrome.alarms.create(RETRY_ALARM_NAME, { delayInMinutes: 1 });
    },
    async clear() {
      await chrome.alarms.clear(RETRY_ALARM_NAME);
    },
  };
}

export function snapshot(tab: chrome.tabs.Tab): TabSnapshot | undefined {
  if (tab.id === undefined) {
    return undefined;
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    incognito: tab.incognito,
    status: tab.status === "complete" ? "complete" : "loading",
    ...(tab.url === undefined ? {} : { url: tab.url }),
  };
}
