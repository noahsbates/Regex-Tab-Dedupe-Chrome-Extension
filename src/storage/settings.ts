import {
  createEmptyRuleDocument,
  parseRuleDocument,
  type RegexRule,
  type RuleDocument,
  serializeRuleDocument,
  validateRuleSet,
} from "../domain/rules";
import type { ValueStorageArea } from "./value-storage";

export const SYNC_RULES_KEY = "rules-v1";
export const LOCAL_RULES_KEY = "rules-local-v1";

interface LocalRuleEnvelope {
  readonly schemaVersion: 1;
  readonly pendingSync: boolean;
  readonly document: RuleDocument;
}

export type LoadedSettingsSource =
  | "empty"
  | "local-mirror"
  | "local-pending"
  | "sync";

export interface LoadedSettings {
  readonly document: RuleDocument;
  readonly source: LoadedSettingsSource;
  readonly diagnostics: readonly string[];
}

export type SaveResult =
  | { readonly kind: "synced"; readonly document: RuleDocument }
  | {
      readonly kind: "local-only";
      readonly document: RuleDocument;
      readonly reason: string;
    }
  | { readonly kind: "conflict"; readonly current: RuleDocument }
  | { readonly kind: "failed"; readonly reasons: readonly string[] };

export interface SettingsRepository {
  load(): Promise<LoadedSettings>;
  save(input: {
    readonly rules: readonly RegexRule[];
    readonly expectedWriteId: string;
  }): Promise<SaveResult>;
  retryPendingSync(): Promise<SaveResult>;
}

export function createSettingsRepository(input: {
  readonly sync: ValueStorageArea;
  readonly local: ValueStorageArea;
  readonly createWriteId: () => string;
  readonly syncQuotaBytes: number;
}): SettingsRepository {
  return {
    async load() {
      const [syncRead, localRead] = await Promise.allSettled([
        input.sync.getValue(SYNC_RULES_KEY),
        input.local.getValue(LOCAL_RULES_KEY),
      ]);
      if (syncRead.status === "rejected" && localRead.status === "rejected") {
        throw new Error("Unable to read rules from sync or local storage.");
      }

      const diagnostics: string[] = [];
      const syncDocument =
        syncRead.status === "fulfilled"
          ? parseOptionalDocument(syncRead.value, "sync", diagnostics)
          : noteReadFailure("sync", syncRead.reason, diagnostics);
      const localEnvelope =
        localRead.status === "fulfilled"
          ? parseOptionalEnvelope(localRead.value, diagnostics)
          : noteReadFailure("local", localRead.reason, diagnostics);

      if (localEnvelope?.pendingSync === true) {
        return {
          document: localEnvelope.document,
          source: "local-pending",
          diagnostics,
        };
      }
      if (syncDocument !== null) {
        return { document: syncDocument, source: "sync", diagnostics };
      }
      if (localEnvelope !== null) {
        return {
          document: localEnvelope.document,
          source: "local-mirror",
          diagnostics,
        };
      }
      return {
        document: createEmptyRuleDocument(),
        source: "empty",
        diagnostics,
      };
    },

    async save(saveInput) {
      const current = await this.load();
      if (current.document.writeId !== saveInput.expectedWriteId) {
        return { kind: "conflict", current: current.document };
      }

      const validation = validateRuleSet(saveInput.rules);
      if (!validation.ok) {
        return {
          kind: "failed",
          reasons: validation.issues.map((issue) => issue.message),
        };
      }

      const document: RuleDocument = {
        schemaVersion: 1,
        writeId: input.createWriteId(),
        rules: validation.rules,
      };
      const serializedDocument = serializeRuleDocument(document);
      if (
        storedBytes(SYNC_RULES_KEY, serializedDocument) > input.syncQuotaBytes
      ) {
        return {
          kind: "failed",
          reasons: [
            `The rule document exceeds Chrome's per-item sync quota of ${input.syncQuotaBytes} bytes.`,
          ],
        };
      }

      const pendingEnvelope = serializeEnvelope(document, true);
      try {
        await input.local.setValue(LOCAL_RULES_KEY, pendingEnvelope);
      } catch (error) {
        return {
          kind: "failed",
          reasons: [`Local save failed: ${errorMessage(error)}`],
        };
      }

      try {
        await input.sync.setValue(SYNC_RULES_KEY, serializedDocument);
        try {
          await input.local.setValue(
            LOCAL_RULES_KEY,
            serializeEnvelope(document, false),
          );
        } catch {
          // Sync is authoritative. A later load recognizes the same document.
        }
        return { kind: "synced", document };
      } catch (syncError) {
        return {
          kind: "local-only",
          document,
          reason: errorMessage(syncError),
        };
      }
    },

    async retryPendingSync() {
      const rawEnvelope = await input.local.getValue(LOCAL_RULES_KEY);
      const diagnostics: string[] = [];
      const localEnvelope = parseOptionalEnvelope(rawEnvelope, diagnostics);
      if (localEnvelope === null || !localEnvelope.pendingSync) {
        const loaded = await this.load();
        return { kind: "synced", document: loaded.document };
      }
      if (
        storedBytes(
          SYNC_RULES_KEY,
          serializeRuleDocument(localEnvelope.document),
        ) > input.syncQuotaBytes
      ) {
        return {
          kind: "failed",
          reasons: [
            `The rule document exceeds Chrome's per-item sync quota of ${input.syncQuotaBytes} bytes.`,
          ],
        };
      }

      try {
        await input.sync.setValue(
          SYNC_RULES_KEY,
          serializeRuleDocument(localEnvelope.document),
        );
        await input.local.setValue(
          LOCAL_RULES_KEY,
          serializeEnvelope(localEnvelope.document, false),
        );
        return { kind: "synced", document: localEnvelope.document };
      } catch (error) {
        return {
          kind: "local-only",
          document: localEnvelope.document,
          reason: errorMessage(error),
        };
      }
    },
  };
}

export function storedBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(JSON.stringify({ [key]: value })).byteLength;
}

function serializeEnvelope(
  document: RuleDocument,
  pendingSync: boolean,
): unknown {
  return {
    schemaVersion: 1,
    pendingSync,
    document: serializeRuleDocument(document),
  };
}

function parseOptionalDocument(
  value: unknown,
  source: string,
  diagnostics: string[],
): RuleDocument | null {
  if (value === undefined) {
    return null;
  }
  const parsed = parseRuleDocument(value);
  if (parsed.ok) {
    return parsed.document;
  }
  diagnostics.push(`The ${source} rule document is invalid.`);
  return null;
}

function parseOptionalEnvelope(
  value: unknown,
  diagnostics: string[],
): LocalRuleEnvelope | null {
  if (value === undefined) {
    return null;
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.pendingSync !== "boolean"
  ) {
    diagnostics.push("The local rule backup is invalid.");
    return null;
  }
  const parsed = parseRuleDocument(value.document);
  if (!parsed.ok) {
    diagnostics.push("The local rule backup contains invalid rules.");
    return null;
  }
  return {
    schemaVersion: 1,
    pendingSync: value.pendingSync,
    document: parsed.document,
  };
}

function noteReadFailure(
  source: string,
  reason: unknown,
  diagnostics: string[],
): null {
  diagnostics.push(`Unable to read ${source} rules: ${errorMessage(reason)}`);
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
