import { describe, expect, it } from "vitest";
import { createRuleId, type RegexRule } from "../../src/domain/rules";
import {
  createSettingsRepository,
  LOCAL_RULES_KEY,
  SYNC_RULES_KEY,
} from "../../src/storage/settings";
import type { ValueStorageArea } from "../../src/storage/value-storage";

class MemoryStorage implements ValueStorageArea {
  readonly values = new Map<string, unknown>();
  failGet = false;
  failSet = false;

  async getValue(key: string): Promise<unknown> {
    if (this.failGet) {
      throw new Error("read unavailable");
    }
    return this.values.get(key);
  }

  async setValue(key: string, value: unknown): Promise<void> {
    if (this.failSet) {
      throw new Error("write unavailable");
    }
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const rules: readonly RegexRule[] = [
  {
    id: createRuleId("page"),
    name: "Page",
    pattern: String.raw`^(https://example\.com/[^?#]+)`,
    flags: "i",
    enabled: true,
  },
];

function repository(input: {
  sync?: MemoryStorage;
  local?: MemoryStorage;
  writeIds?: readonly string[];
  quotaBytes?: number;
} = {}) {
  const sync = input.sync ?? new MemoryStorage();
  const local = input.local ?? new MemoryStorage();
  const ids = [...(input.writeIds ?? ["write-1", "write-2"])];
  const settings = createSettingsRepository({
    sync,
    local,
    createWriteId: () => ids.shift() ?? "write-fallback",
    syncQuotaBytes: input.quotaBytes ?? 8_192,
  });
  return { settings, sync, local };
}

describe("settings repository", () => {
  it("loads an empty document when storage has no rules", async () => {
    const { settings } = repository();

    await expect(settings.load()).resolves.toMatchObject({
      source: "empty",
      document: { writeId: "empty", rules: [] },
    });
  });

  it("writes a local pending copy before sync and leaves a synced mirror", async () => {
    const { settings, sync, local } = repository();

    const result = await settings.save({
      rules,
      expectedWriteId: "empty",
    });

    expect(result).toMatchObject({
      kind: "synced",
      document: { writeId: "write-1", rules },
    });
    expect(sync.values.get(SYNC_RULES_KEY)).toMatchObject({
      writeId: "write-1",
    });
    expect(local.values.get(LOCAL_RULES_KEY)).toMatchObject({
      pendingSync: false,
      document: { writeId: "write-1" },
    });
  });

  it("keeps local edits authoritative when sync fails", async () => {
    const sync = new MemoryStorage();
    sync.failSet = true;
    const { settings, local } = repository({ sync });

    const result = await settings.save({
      rules,
      expectedWriteId: "empty",
    });

    expect(result).toMatchObject({
      kind: "local-only",
      document: { writeId: "write-1" },
    });
    await expect(settings.load()).resolves.toMatchObject({
      source: "local-pending",
      document: { writeId: "write-1" },
    });
    expect(local.values.get(LOCAL_RULES_KEY)).toMatchObject({
      pendingSync: true,
    });
  });

  it("does not write sync when the pending local save fails", async () => {
    const local = new MemoryStorage();
    local.failSet = true;
    const { settings, sync } = repository({ local });

    const result = await settings.save({
      rules,
      expectedWriteId: "empty",
    });

    expect(result).toMatchObject({
      kind: "failed",
      reasons: [expect.stringContaining("Local save failed")],
    });
    expect(sync.values.size).toBe(0);
  });

  it("promotes pending local rules when sync recovers", async () => {
    const sync = new MemoryStorage();
    sync.failSet = true;
    const { settings, local } = repository({ sync });
    await settings.save({ rules, expectedWriteId: "empty" });
    sync.failSet = false;

    const result = await settings.retryPendingSync();

    expect(result).toMatchObject({
      kind: "synced",
      document: { writeId: "write-1" },
    });
    expect(sync.values.get(SYNC_RULES_KEY)).toMatchObject({
      writeId: "write-1",
    });
    expect(local.values.get(LOCAL_RULES_KEY)).toMatchObject({
      pendingSync: false,
    });
  });

  it("rejects stale saves without overwriting newer rules", async () => {
    const { settings } = repository();
    await settings.save({ rules, expectedWriteId: "empty" });

    const result = await settings.save({
      rules: [],
      expectedWriteId: "empty",
    });

    expect(result).toMatchObject({
      kind: "conflict",
      current: { writeId: "write-1" },
    });
  });

  it("uses a valid local mirror when sync data is corrupt", async () => {
    const { settings, sync, local } = repository();
    sync.values.set(SYNC_RULES_KEY, { schemaVersion: 999 });
    local.values.set(LOCAL_RULES_KEY, {
      schemaVersion: 1,
      pendingSync: false,
      document: { schemaVersion: 1, writeId: "local", rules },
    });

    await expect(settings.load()).resolves.toMatchObject({
      source: "local-mirror",
      document: { writeId: "local" },
      diagnostics: [expect.stringContaining("sync")],
    });
  });

  it("rejects rule documents that exceed the sync item quota", async () => {
    const { settings, local, sync } = repository({ quotaBytes: 80 });

    const result = await settings.save({
      rules,
      expectedWriteId: "empty",
    });

    expect(result).toMatchObject({
      kind: "failed",
      reasons: [expect.stringContaining("quota")],
    });
    expect(local.values.size).toBe(0);
    expect(sync.values.size).toBe(0);
  });

  it("throws when neither storage area can be read", async () => {
    const sync = new MemoryStorage();
    const local = new MemoryStorage();
    sync.failGet = true;
    local.failGet = true;
    const { settings } = repository({ sync, local });

    await expect(settings.load()).rejects.toThrow("read rules");
  });
});
