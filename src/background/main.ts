import { createChromeSettingsRepository } from "../storage/chrome";
import { createChromeValueStorageArea } from "../storage/value-storage";
import {
  createChromeBrowserPort,
  createChromeRetryScheduler,
  RETRY_ALARM_NAME,
  snapshot,
} from "./chrome-port";
import { createCoordinator } from "./coordinator";
import { createSessionRepository } from "./session";

const coordinator = createCoordinator({
  browser: createChromeBrowserPort(),
  retry: createChromeRetryScheduler(),
  session: createSessionRepository({
    storage: createChromeValueStorageArea(chrome.storage.session),
  }),
  settings: createChromeSettingsRepository(),
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
