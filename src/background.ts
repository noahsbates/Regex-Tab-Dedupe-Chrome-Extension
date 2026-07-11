import {
  createChromeBrowserPort,
  createChromeRetryScheduler,
  RETRY_ALARM_NAME,
  snapshot,
} from "./background/chrome-port";
import { createCoordinator } from "./background/coordinator";
import { createSessionRepository } from "./background/session";
import { createSettingsRepository } from "./storage/settings";
import { createChromeValueStorageArea } from "./storage/value-storage";

const retry = createChromeRetryScheduler();
const session = createSessionRepository({
  storage: createChromeValueStorageArea(chrome.storage.session),
});
const settings = createSettingsRepository({
  sync: createChromeValueStorageArea(chrome.storage.sync),
  local: createChromeValueStorageArea(chrome.storage.local),
  createWriteId: () => crypto.randomUUID(),
  syncQuotaBytes: chrome.storage.sync.QUOTA_BYTES_PER_ITEM,
});
const coordinator = createCoordinator({
  browser: createChromeBrowserPort(),
  retry,
  session,
  settings,
});

chrome.tabs.onCreated.addListener((tab) => {
  const tabSnapshot = snapshot(tab);
  void coordinator.onCreated({
    tab: tabSnapshot,
    ...(tab.pendingUrl === undefined ? {} : { pendingUrl: tab.pendingUrl }),
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const observedUrl = changeInfo.url ?? tab.pendingUrl;
  if (observedUrl !== undefined || changeInfo.status === "complete") {
    void coordinator.onUpdated({
      tabId,
      ...(observedUrl === undefined ? {} : { url: observedUrl }),
    });
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    void coordinator.onUpdated({ tabId: details.tabId, url: details.url });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void coordinator.onRemoved(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void coordinator.onReplaced(addedTabId, removedTabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM_NAME) {
    void coordinator.recover();
  }
});

void coordinator.recover();
