import { createSettingsRepository, type SettingsRepository } from "./settings";
import { createChromeValueStorageArea } from "./value-storage";

export function createChromeSettingsRepository(): SettingsRepository {
  return createSettingsRepository({
    sync: createChromeValueStorageArea(chrome.storage.sync),
    local: createChromeValueStorageArea(chrome.storage.local),
    createWriteId: () => crypto.randomUUID(),
    syncQuotaBytes: chrome.storage.sync.QUOTA_BYTES_PER_ITEM,
  });
}
