export interface ValueStorageArea {
  getValue(key: string): Promise<unknown>;
  setValue(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createChromeValueStorageArea(
  area: chrome.storage.StorageArea,
): ValueStorageArea {
  return {
    async getValue(key) {
      const values = await area.get(key);
      const value: unknown = values[key];
      return value;
    },
    async setValue(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}
