import type { BirthRecord, CandidateRecord } from "../domain/reconcile";
import { isEligibleUrl } from "../domain/rules";
import type { ValueStorageArea } from "../storage/value-storage";

export const SESSION_KEY = "dedupe-session-v2";

export interface SessionState {
  readonly schemaVersion: 2;
  readonly nextOrdinal: number;
  readonly candidates: readonly CandidateRecord[];
  readonly births: readonly BirthRecord[];
}

export interface SessionRepository {
  load(): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
  register(input: {
    readonly tabId: number;
    readonly url: string | null;
  }): Promise<CandidateRecord>;
  updateUrl(input: {
    readonly tabId: number;
    readonly url: string | null;
  }): Promise<boolean>;
  remove(tabId: number): Promise<void>;
  replace(addedTabId: number, removedTabId: number): Promise<void>;
}

export function createSessionRepository(input: {
  readonly storage: ValueStorageArea;
}): SessionRepository {
  return {
    async load() {
      const raw = await input.storage.getValue(SESSION_KEY);
      return parseSessionState(raw) ?? emptySession();
    },

    async save(state) {
      await input.storage.setValue(SESSION_KEY, state);
    },

    async register(registerInput) {
      const state = await this.load();
      const current = state.candidates.find(
        (candidate) => candidate.tabId === registerInput.tabId,
      );
      if (current !== undefined) {
        if (registerInput.url !== null) {
          await this.updateUrl(registerInput);
          return { ...current, kind: "observed-url", url: registerInput.url };
        }
        return current;
      }

      const base = {
        tabId: registerInput.tabId,
        creationOrdinal: state.nextOrdinal,
      };
      const record: CandidateRecord =
        registerInput.url === null
          ? { ...base, kind: "awaiting-url" }
          : { ...base, kind: "observed-url", url: registerInput.url };
      await this.save({
        schemaVersion: 2,
        nextOrdinal: state.nextOrdinal + 1,
        candidates: [...state.candidates, record],
        births: [
          ...state.births.filter(
            (birth) => birth.tabId !== registerInput.tabId,
          ),
          base,
        ],
      });
      return record;
    },

    async updateUrl(updateInput) {
      const state = await this.load();
      if (
        !state.candidates.some(
          (candidate) => candidate.tabId === updateInput.tabId,
        )
      ) {
        return false;
      }
      await this.save({
        ...state,
        candidates: state.candidates.map((candidate) => {
          if (candidate.tabId !== updateInput.tabId) {
            return candidate;
          }
          const base = {
            tabId: candidate.tabId,
            creationOrdinal: candidate.creationOrdinal,
          };
          return updateInput.url === null
            ? { ...base, kind: "awaiting-url" }
            : { ...base, kind: "observed-url", url: updateInput.url };
        }),
      });
      return true;
    },

    async remove(tabId) {
      const state = await this.load();
      await this.save({
        ...state,
        candidates: state.candidates.filter(
          (candidate) => candidate.tabId !== tabId,
        ),
        births: state.births.filter((birth) => birth.tabId !== tabId),
      });
    },

    async replace(addedTabId, removedTabId) {
      const state = await this.load();
      const candidate = state.candidates.find(
        (record) => record.tabId === removedTabId,
      );
      const birth = state.births.find(
        (record) => record.tabId === removedTabId,
      );
      await this.save({
        ...state,
        candidates: [
          ...state.candidates.filter(
            (record) =>
              record.tabId !== removedTabId && record.tabId !== addedTabId,
          ),
          ...(candidate === undefined
            ? []
            : [{ ...candidate, tabId: addedTabId }]),
        ],
        births: [
          ...state.births.filter(
            (record) =>
              record.tabId !== removedTabId && record.tabId !== addedTabId,
          ),
          ...(birth === undefined ? [] : [{ ...birth, tabId: addedTabId }]),
        ],
      });
    },
  };
}

export function parseSessionState(value: unknown): SessionState | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    !Number.isSafeInteger(value.nextOrdinal) ||
    Number(value.nextOrdinal) < 1 ||
    !Array.isArray(value.candidates) ||
    !Array.isArray(value.births)
  ) {
    return null;
  }
  const candidates = parseCandidates(value.candidates);
  const births = parseBirths(value.births);
  if (candidates === null || births === null) {
    return null;
  }
  return {
    schemaVersion: 2,
    nextOrdinal: Number(value.nextOrdinal),
    candidates,
    births,
  };
}

function emptySession(): SessionState {
  return { schemaVersion: 2, nextOrdinal: 1, candidates: [], births: [] };
}

function parseCandidates(value: readonly unknown[]): CandidateRecord[] | null {
  const records: CandidateRecord[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !Number.isSafeInteger(item.tabId) ||
      !Number.isSafeInteger(item.creationOrdinal) ||
      (item.kind !== "awaiting-url" && item.kind !== "observed-url") ||
      (item.kind === "observed-url" &&
        (typeof item.url !== "string" || !isEligibleUrl(item.url)))
    ) {
      return null;
    }
    const base = {
      tabId: Number(item.tabId),
      creationOrdinal: Number(item.creationOrdinal),
    };
    records.push(
      item.kind === "observed-url"
        ? { ...base, kind: "observed-url", url: String(item.url) }
        : { ...base, kind: "awaiting-url" },
    );
  }
  return records;
}

function parseBirths(value: readonly unknown[]): BirthRecord[] | null {
  const records: BirthRecord[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !Number.isSafeInteger(item.tabId) ||
      !Number.isSafeInteger(item.creationOrdinal)
    ) {
      return null;
    }
    records.push({
      tabId: Number(item.tabId),
      creationOrdinal: Number(item.creationOrdinal),
    });
  }
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
