import { describe, expect, it } from "vitest";
import {
  decideCandidate,
  type BirthRecord,
  type CandidateRecord,
  type TabSnapshot,
} from "../../src/domain/reconcile";
import { createRuleId, type RegexRule } from "../../src/domain/rules";

const rules: readonly RegexRule[] = [
  {
    id: createRuleId("page"),
    name: "Page",
    pattern: String.raw`^(https://example\.com/[^?#]+)`,
    flags: "",
    enabled: true,
  },
];

function tab(
  id: number,
  url: string,
  options: {
    incognito?: boolean;
    status?: "loading" | "complete";
    windowId?: number;
  } = {},
): TabSnapshot {
  return {
    id,
    windowId: options.windowId ?? 1,
    incognito: options.incognito ?? false,
    status: options.status ?? "complete",
    url,
  };
}

function candidate(tabId: number, creationOrdinal: number): CandidateRecord {
  return { kind: "awaiting-url", tabId, creationOrdinal };
}

function birth(tabId: number, creationOrdinal: number): BirthRecord {
  return { tabId, creationOrdinal };
}

describe("decideCandidate", () => {
  it("closes a loading candidate as soon as its URL identifies a duplicate", () => {
    const decision = decideCandidate({
      candidateTab: tab(20, "https://example.com/docs?new=1", {
        status: "loading",
      }),
      tabs: [
        tab(10, "https://example.com/docs?old=1"),
        tab(20, "https://example.com/docs?new=1", { status: "loading" }),
      ],
      candidates: [candidate(20, 2)],
      births: [birth(10, 1), birth(20, 2)],
      rules,
    });

    expect(decision.kind).toBe("close");
    if (decision.kind === "close") {
      expect(decision.keepers.map((keeper) => keeper.id)).toEqual([10]);
    }
  });

  it("closes a complete new duplicate against the oldest existing tab", () => {
    const decision = decideCandidate({
      candidateTab: tab(30, "https://example.com/docs?new=1", { windowId: 3 }),
      tabs: [
        tab(20, "https://example.com/docs?second=1", { windowId: 2 }),
        tab(10, "https://example.com/docs?first=1", { windowId: 1 }),
        tab(30, "https://example.com/docs?new=1", { windowId: 3 }),
      ],
      candidates: [candidate(30, 3)],
      births: [birth(10, 1), birth(20, 2), birth(30, 3)],
      rules,
    });

    expect(decision.kind).toBe("close");
    if (decision.kind === "close") {
      expect(decision.keepers.map((keeper) => keeper.id)).toEqual([10, 20]);
    }
  });

  it("waits for an older matching candidate instead of keeping the newer tab", () => {
    const decision = decideCandidate({
      candidateTab: tab(20, "https://example.com/docs"),
      tabs: [
        tab(10, "https://example.com/docs", { status: "loading" }),
        tab(20, "https://example.com/docs"),
      ],
      candidates: [candidate(10, 1), candidate(20, 2)],
      births: [birth(10, 1), birth(20, 2)],
      rules,
    });

    expect(decision).toEqual({ kind: "wait" });
  });

  it("settles the oldest completed candidate so newer candidates can use it", () => {
    const decision = decideCandidate({
      candidateTab: tab(10, "https://example.com/docs"),
      tabs: [
        tab(10, "https://example.com/docs"),
        tab(20, "https://example.com/docs"),
      ],
      candidates: [candidate(10, 1), candidate(20, 2)],
      births: [birth(10, 1), birth(20, 2)],
      rules,
    });

    expect(decision).toEqual({ kind: "settle" });
  });

  it("treats untracked tabs as older and falls back to lower tab id", () => {
    const decision = decideCandidate({
      candidateTab: tab(30, "https://example.com/docs"),
      tabs: [
        tab(15, "https://example.com/docs"),
        tab(5, "https://example.com/docs"),
        tab(30, "https://example.com/docs"),
      ],
      candidates: [candidate(30, 1)],
      births: [birth(30, 1)],
      rules,
    });

    expect(decision.kind).toBe("close");
    if (decision.kind === "close") {
      expect(decision.keepers.map((keeper) => keeper.id)).toEqual([5, 15]);
    }
  });

  it("does not cross regular and incognito contexts", () => {
    const decision = decideCandidate({
      candidateTab: tab(20, "https://example.com/docs", { incognito: true }),
      tabs: [
        tab(10, "https://example.com/docs"),
        tab(20, "https://example.com/docs", { incognito: true }),
      ],
      candidates: [candidate(20, 2)],
      births: [birth(10, 1), birth(20, 2)],
      rules,
    });

    expect(decision).toEqual({ kind: "settle" });
  });

  it("waits for loading and non-web candidate URLs", () => {
    expect(
      decideCandidate({
        candidateTab: tab(10, "https://example.com/docs", {
          status: "loading",
        }),
        tabs: [],
        candidates: [candidate(10, 1)],
        births: [birth(10, 1)],
        rules,
      }),
    ).toEqual({ kind: "wait" });

    expect(
      decideCandidate({
        candidateTab: tab(11, "chrome://newtab"),
        tabs: [],
        candidates: [candidate(11, 2)],
        births: [birth(11, 2)],
        rules,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("settles a completed URL that no rule identifies", () => {
    const decision = decideCandidate({
      candidateTab: tab(10, "https://other.test/docs"),
      tabs: [tab(10, "https://other.test/docs")],
      candidates: [candidate(10, 1)],
      births: [birth(10, 1)],
      rules,
    });

    expect(decision).toEqual({ kind: "settle" });
  });
});
