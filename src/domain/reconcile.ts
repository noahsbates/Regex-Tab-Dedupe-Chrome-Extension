import {
  type CloseAction,
  classifyUrl,
  type DuplicateKey,
  duplicateKeysEqual,
  isEligibleUrl,
  type RegexRule,
  resolveCloseAction,
} from "./rules";

interface CandidateBase {
  readonly tabId: number;
  readonly creationOrdinal: number;
}

export type CandidateRecord =
  | (CandidateBase & { readonly kind: "awaiting-url" })
  | (CandidateBase & {
      readonly kind: "observed-url";
      readonly url: string;
    });

export interface BirthRecord {
  readonly tabId: number;
  readonly creationOrdinal: number;
}

export interface TabSnapshot {
  readonly id: number;
  readonly windowId: number;
  readonly incognito: boolean;
  readonly status: "loading" | "complete";
  readonly url?: string;
}

export type CandidateDecision =
  | { readonly kind: "wait" }
  | { readonly kind: "settle" }
  | { readonly kind: "close-new"; readonly keepers: readonly TabSnapshot[] }
  | {
      readonly kind: "close-old";
      readonly duplicates: readonly TabSnapshot[];
    };

export type DuplicatePairDecision =
  | { readonly kind: "not-duplicate" }
  | { readonly kind: "duplicate"; readonly action: CloseAction };

export function decideCandidate(input: {
  readonly candidateTab: TabSnapshot;
  readonly tabs: readonly TabSnapshot[];
  readonly candidates: readonly CandidateRecord[];
  readonly births: readonly BirthRecord[];
  readonly rules: readonly RegexRule[];
}): CandidateDecision {
  const candidateUrl = input.candidateTab.url;
  if (!isEligibleUrl(candidateUrl)) {
    return { kind: "wait" };
  }

  const classification = classifyUrl({
    url: candidateUrl,
    rules: input.rules,
  });
  if (classification.kind !== "identified") {
    return input.candidateTab.status === "complete"
      ? { kind: "settle" }
      : { kind: "wait" };
  }

  const candidateIds = new Set(
    input.candidates.map((candidate) => candidate.tabId),
  );
  const olderMatches = input.tabs
    .filter(
      (tab) =>
        tab.id !== input.candidateTab.id &&
        tab.incognito === input.candidateTab.incognito &&
        isSameOlderDuplicate({
          tab,
          candidate: input.candidateTab,
          candidateKey: classification.key,
          births: input.births,
          candidates: input.candidates,
          rules: input.rules,
        }),
    )
    .sort((left, right) =>
      compareTabAge({
        left,
        right,
        births: input.births,
        candidates: input.candidates,
      }),
    );

  const existingKeepers = olderMatches.filter(
    (tab) => !candidateIds.has(tab.id),
  );
  if (existingKeepers.length > 0) {
    const matchedRule = input.rules.find(
      (rule) => rule.id === classification.key.ruleId,
    );
    const action =
      matchedRule === undefined
        ? "close-new"
        : resolveCloseAction({
            policy: matchedRule.closePolicy,
            candidateUrl,
          });
    return action === "close-old"
      ? { kind: "close-old", duplicates: existingKeepers }
      : { kind: "close-new", keepers: existingKeepers };
  }

  if (olderMatches.some((tab) => candidateIds.has(tab.id))) {
    return { kind: "wait" };
  }
  return input.candidateTab.status === "complete"
    ? { kind: "settle" }
    : { kind: "wait" };
}

export function decideDuplicatePair(input: {
  readonly candidateUrl: string | undefined;
  readonly existingUrl: string | undefined;
  readonly rules: readonly RegexRule[];
}): DuplicatePairDecision {
  if (!isEligibleUrl(input.candidateUrl) || !isEligibleUrl(input.existingUrl)) {
    return { kind: "not-duplicate" };
  }
  const candidate = classifyUrl({
    url: input.candidateUrl,
    rules: input.rules,
  });
  const existing = classifyUrl({
    url: input.existingUrl,
    rules: input.rules,
  });
  if (
    candidate.kind !== "identified" ||
    existing.kind !== "identified" ||
    !duplicateKeysEqual(candidate.key, existing.key)
  ) {
    return { kind: "not-duplicate" };
  }
  const matchedRule = input.rules.find(
    (rule) => rule.id === candidate.key.ruleId,
  );
  if (matchedRule === undefined) {
    return { kind: "not-duplicate" };
  }
  return {
    kind: "duplicate",
    action: resolveCloseAction({
      policy: matchedRule.closePolicy,
      candidateUrl: input.candidateUrl,
    }),
  };
}

export function compareTabAge(input: {
  readonly left: Pick<TabSnapshot, "id">;
  readonly right: Pick<TabSnapshot, "id">;
  readonly births: readonly BirthRecord[];
  readonly candidates?: readonly CandidateRecord[];
}): number {
  const leftOrdinal = findOrdinal({
    tabId: input.left.id,
    births: input.births,
    candidates: input.candidates ?? [],
  });
  const rightOrdinal = findOrdinal({
    tabId: input.right.id,
    births: input.births,
    candidates: input.candidates ?? [],
  });

  if (leftOrdinal === undefined && rightOrdinal !== undefined) {
    return -1;
  }
  if (leftOrdinal !== undefined && rightOrdinal === undefined) {
    return 1;
  }
  if (
    leftOrdinal !== undefined &&
    rightOrdinal !== undefined &&
    leftOrdinal !== rightOrdinal
  ) {
    return leftOrdinal - rightOrdinal;
  }
  return input.left.id - input.right.id;
}

function isSameOlderDuplicate(input: {
  readonly tab: TabSnapshot;
  readonly candidate: TabSnapshot;
  readonly candidateKey: DuplicateKey;
  readonly births: readonly BirthRecord[];
  readonly candidates: readonly CandidateRecord[];
  readonly rules: readonly RegexRule[];
}): boolean {
  if (!isEligibleUrl(input.tab.url)) {
    return false;
  }

  const classification = classifyUrl({
    url: input.tab.url,
    rules: input.rules,
  });
  if (classification.kind !== "identified") {
    return false;
  }

  return (
    duplicateKeysEqual(classification.key, input.candidateKey) &&
    compareTabAge({
      left: input.tab,
      right: input.candidate,
      births: input.births,
      candidates: input.candidates,
    }) < 0
  );
}

function findOrdinal(input: {
  readonly tabId: number;
  readonly births: readonly BirthRecord[];
  readonly candidates: readonly CandidateRecord[];
}): number | undefined {
  return (
    input.births.find((birth) => birth.tabId === input.tabId)
      ?.creationOrdinal ??
    input.candidates.find((candidate) => candidate.tabId === input.tabId)
      ?.creationOrdinal
  );
}
