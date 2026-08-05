import { createChromeSettingsRepository } from "../storage/chrome";
import { LOCAL_RULES_KEY, SYNC_RULES_KEY } from "../storage/settings";
import { mountPopup } from "./app";
import { createPopupLinks } from "./links";

const root = document.querySelector("#app");
if (
  root instanceof HTMLElement &&
  typeof chrome !== "undefined" &&
  chrome.storage !== undefined
) {
  void mountPopup({
    root,
    settings: createChromeSettingsRepository(),
    createId: () => crypto.randomUUID(),
    links: createPopupLinks(chrome.runtime.id),
    subscribe: (listener) => {
      const callback = (
        changes: Record<string, chrome.storage.StorageChange>,
      ): void => {
        if (
          changes[SYNC_RULES_KEY] !== undefined ||
          changes[LOCAL_RULES_KEY] !== undefined
        ) {
          listener();
        }
      };
      chrome.storage.onChanged.addListener(callback);
      return () => chrome.storage.onChanged.removeListener(callback);
    },
  });
}
