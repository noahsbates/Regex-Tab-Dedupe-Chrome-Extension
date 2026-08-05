import { describe, expect, it } from "vitest";
import {
  type BirthRecord,
  type CandidateRecord,
  decideCandidate,
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
    closePolicy: { kind: "close-new" },
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

    expect(decision.kind).toBe("close-new");
    if (decision.kind === "close-new") {
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

    expect(decision.kind).toBe("close-new");
    if (decision.kind === "close-new") {
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

    expect(decision.kind).toBe("close-new");
    if (decision.kind === "close-new") {
      expect(decision.keepers.map((keeper) => keeper.id)).toEqual([5, 15]);
    }
  });

  it("returns old duplicates when the matching rule keeps the new tab", () => {
    const decision = decideCandidate({
      candidateTab: tab(20, "https://example.com/docs?new=1"),
      tabs: [
        tab(10, "https://example.com/docs?old=1"),
        tab(20, "https://example.com/docs?new=1"),
      ],
      candidates: [candidate(20, 2)],
      births: [birth(10, 1), birth(20, 2)],
      rules: rules.map((rule) => ({
        ...rule,
        closePolicy: { kind: "close-old" },
      })),
    });

    expect(decision.kind).toBe("close-old");
    if (decision.kind === "close-old") {
      expect(decision.duplicates.map((duplicate) => duplicate.id)).toEqual([
        10,
      ]);
    }
  });

  it("closes an old broad match only when the new tab matches its condition", () => {
    const githubRules: readonly RegexRule[] = [
      {
        id: createRuleId("github-comment"),
        name: "Switch to new GitHub comment",
        pattern: String.raw`^https://github\.com/([^/?#]+/[^/?#]+/pull/\d+)(?:[/?#]|$)`,
        flags: "i",
        enabled: true,
        closePolicy: {
          kind: "close-old-when-new-tab-matches",
          pattern: String.raw`^https://github\.com/[^/?#]+/[^/?#]+/pull/\d+/files#diff-[a-f0-9]+R\d+$`,
          flags: "i",
        },
      },
    ];
    const oldUrl = "https://github.com/acme/widgets/pull/42/files";
    const commentUrl =
      "https://github.com/acme/widgets/pull/42/files#diff-abc123R55";

    const decision = decideCandidate({
      candidateTab: tab(20, commentUrl),
      tabs: [tab(10, oldUrl), tab(20, commentUrl)],
      candidates: [candidate(20, 2)],
      births: [birth(10, 1), birth(20, 2)],
      rules: githubRules,
    });

    expect(decision.kind).toBe("close-old");
  });

  it("keeps the old duplicate when the new tab misses its condition", () => {
    const conditionalRules: readonly RegexRule[] = [
      {
        id: createRuleId("conditional"),
        name: "Conditional",
        pattern: String.raw`^(https://example\.com/docs)`,
        flags: "",
        enabled: true,
        closePolicy: {
          kind: "close-old-when-new-tab-matches",
          pattern: String.raw`#comment-\d+$`,
          flags: "",
        },
      },
    ];

    const decision = decideCandidate({
      candidateTab: tab(20, "https://example.com/docs?plain=1"),
      tabs: [
        tab(10, "https://example.com/docs?old=1"),
        tab(20, "https://example.com/docs?plain=1"),
      ],
      candidates: [candidate(20, 2)],
      births: [birth(10, 1), birth(20, 2)],
      rules: conditionalRules,
    });

    expect(decision.kind).toBe("close-new");
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
