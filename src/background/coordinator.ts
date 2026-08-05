import {
  decideCandidate,
  decideDuplicatePair,
  type TabSnapshot,
} from "../domain/reconcile";
import { type CloseAction, isEligibleUrl } from "../domain/rules";
import type { SettingsRepository } from "../storage/settings";
import type { SessionRepository, SessionState } from "./session";

export interface BrowserPort {
  getTab(tabId: number): Promise<TabSnapshot | undefined>;
  listNormalTabs(): Promise<readonly TabSnapshot[]>;
  focusTab(tab: TabSnapshot): Promise<void>;
  closeTab(tabId: number): Promise<void>;
}

export interface RetryScheduler {
  schedule(): Promise<void>;
  clear(): Promise<void>;
}

export interface Coordinator {
  onCreated(input: {
    readonly tab: TabSnapshot | undefined;
    readonly pendingUrl?: string;
  }): Promise<void>;
  onUpdated(input: {
    readonly tabId: number;
    readonly url?: string;
  }): Promise<void>;
  onRemoved(tabId: number): Promise<void>;
  onReplaced(addedTabId: number, removedTabId: number): Promise<void>;
  recover(): Promise<void>;
}

export function createCoordinator(input: {
  readonly browser: BrowserPort;
  readonly retry: RetryScheduler;
  readonly session: SessionRepository;
  readonly settings: Pick<SettingsRepository, "load">;
}): Coordinator {
  let queue: Promise<void> = Promise.resolve();

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function safely(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch {
      await input.retry.schedule();
    }
  }

  return {
    onCreated(created) {
      return enqueue(() =>
        safely(async () => {
          if (created.tab === undefined) {
            return;
          }
          await input.session.register({
            tabId: created.tab.id,
            url: firstEligibleUrl(created.pendingUrl, created.tab.url),
          });
          await reconcile(input);
        }),
      );
    },

    onUpdated(updated) {
      return enqueue(() =>
        safely(async () => {
          let isCandidate: boolean;
          if (updated.url !== undefined) {
            isCandidate = await input.session.updateUrl({
              tabId: updated.tabId,
              url: isEligibleUrl(updated.url) ? updated.url : null,
            });
          } else {
            const state = await input.session.load();
            isCandidate = state.candidates.some(
              (candidate) => candidate.tabId === updated.tabId,
            );
          }
          if (!isCandidate) {
            return;
          }
          await reconcile(input);
        }),
      );
    },

    onRemoved(tabId) {
      return enqueue(() => safely(() => input.session.remove(tabId)));
    },

    onReplaced(addedTabId, removedTabId) {
      return enqueue(() =>
        safely(async () => {
          await input.session.replace(addedTabId, removedTabId);
          await reconcile(input);
        }),
      );
    },

    recover() {
      return enqueue(() => safely(() => reconcile(input)));
    },
  };
}

async function reconcile(input: {
  readonly browser: BrowserPort;
  readonly retry: RetryScheduler;
  readonly session: SessionRepository;
  readonly settings: Pick<SettingsRepository, "load">;
}): Promise<void> {
  let state = await input.session.load();
  const loaded = await input.settings.load();
  const browserTabs = [...(await input.browser.listNormalTabs())];
  const openTabIds = new Set(browserTabs.map((tab) => tab.id));
  state = {
    ...state,
    candidates: state.candidates.filter((record) =>
      openTabIds.has(record.tabId),
    ),
    births: state.births.filter((record) => openTabIds.has(record.tabId)),
  };
  let tabs = browserTabs.map((tab) => {
    const candidate = state.candidates.find(
      (record) => record.tabId === tab.id,
    );
    return candidate === undefined ? tab : candidateSnapshot(candidate, tab);
  });

  let retryNeeded = false;
  const orderedCandidates = [...state.candidates].sort(
    (left, right) =>
      left.creationOrdinal - right.creationOrdinal || left.tabId - right.tabId,
  );

  for (const candidate of orderedCandidates) {
    if (!state.candidates.some((record) => record.tabId === candidate.tabId)) {
      continue;
    }
    const candidateTab = tabs.find((tab) => tab.id === candidate.tabId);
    if (candidateTab === undefined) {
      state = removeRecord(state, candidate.tabId, true);
      continue;
    }

    const decision = decideCandidate({
      candidateTab,
      tabs,
      candidates: state.candidates,
      births: state.births,
      rules: loaded.document.rules,
    });
    if (decision.kind === "wait") {
      continue;
    }
    if (decision.kind === "settle") {
      state = removeRecord(state, candidate.tabId, false);
      continue;
    }

    if (decision.kind === "close-new") {
      let closed = false;
      for (const keeper of decision.keepers) {
        try {
          const [freshCandidate, freshKeeper] = await Promise.all([
            input.browser.getTab(candidate.tabId),
            input.browser.getTab(keeper.id),
          ]);
          if (freshCandidate === undefined) {
            closed = true;
            break;
          }
          if (
            freshKeeper === undefined ||
            !pairStillSupportsAction({
              candidate: candidateSnapshot(candidate, freshCandidate),
              existing: freshKeeper,
              rules: loaded.document.rules,
              expected: "close-new",
            })
          ) {
            continue;
          }
          await input.browser.focusTab(freshKeeper);
          await input.browser.closeTab(freshCandidate.id);
          closed = true;
          break;
        } catch {}
      }

      if (closed) {
        state = removeRecord(state, candidate.tabId, true);
        tabs = tabs.filter((tab) => tab.id !== candidate.tabId);
      } else {
        retryNeeded = true;
      }
      continue;
    }

    const freshCandidate = await input.browser.getTab(candidate.tabId);
    if (freshCandidate === undefined) {
      state = removeRecord(state, candidate.tabId, true);
      tabs = tabs.filter((tab) => tab.id !== candidate.tabId);
      continue;
    }

    let focusedCandidate = false;
    let matchedDuplicate = false;
    let allClosed = true;
    let staleDecision = false;
    const closedTabIds = new Set<number>();
    for (const duplicate of decision.duplicates) {
      try {
        const freshDuplicate = await input.browser.getTab(duplicate.id);
        if (freshDuplicate === undefined) {
          continue;
        }
        if (
          !pairStillSupportsAction({
            candidate: candidateSnapshot(candidate, freshCandidate),
            existing: freshDuplicate,
            rules: loaded.document.rules,
            expected: "close-old",
          })
        ) {
          staleDecision = true;
          continue;
        }
        matchedDuplicate = true;
        if (!focusedCandidate) {
          await input.browser.focusTab(freshCandidate);
          focusedCandidate = true;
        }
        await input.browser.closeTab(freshDuplicate.id);
        closedTabIds.add(freshDuplicate.id);
      } catch {
        allClosed = false;
      }
    }
    tabs = tabs.filter((tab) => !closedTabIds.has(tab.id));
    for (const closedTabId of closedTabIds) {
      state = removeRecord(state, closedTabId, true);
    }

    if (staleDecision) {
      retryNeeded = true;
    } else if (matchedDuplicate && allClosed) {
      state = removeRecord(state, candidate.tabId, false);
    } else if (!matchedDuplicate && freshCandidate.status === "complete") {
      state = removeRecord(state, candidate.tabId, false);
    } else if (!allClosed) {
      retryNeeded = true;
    }
  }

  await input.session.save(state);
  if (retryNeeded) {
    await input.retry.schedule();
  } else {
    await input.retry.clear();
  }
}

function candidateSnapshot(
  candidate: SessionState["candidates"][number],
  tab: TabSnapshot,
): TabSnapshot {
  if (tab.status === "complete" || candidate.kind === "awaiting-url") {
    return tab;
  }
  return { ...tab, url: candidate.url };
}

function firstEligibleUrl(
  pendingUrl: string | undefined,
  committedUrl: string | undefined,
): string | null {
  if (isEligibleUrl(pendingUrl)) {
    return pendingUrl;
  }
  return isEligibleUrl(committedUrl) ? committedUrl : null;
}

function pairStillSupportsAction(input: {
  readonly candidate: TabSnapshot;
  readonly existing: TabSnapshot;
  readonly rules: Awaited<
    ReturnType<SettingsRepository["load"]>
  >["document"]["rules"];
  readonly expected: CloseAction;
}): boolean {
  if (input.candidate.incognito !== input.existing.incognito) {
    return false;
  }
  const decision = decideDuplicatePair({
    candidateUrl: input.candidate.url,
    existingUrl: input.existing.url,
    rules: input.rules,
  });
  return decision.kind === "duplicate" && decision.action === input.expected;
}

function removeRecord(
  state: SessionState,
  tabId: number,
  removeBirth: boolean,
): SessionState {
  return {
    ...state,
    candidates: state.candidates.filter((record) => record.tabId !== tabId),
    births: removeBirth
      ? state.births.filter((record) => record.tabId !== tabId)
      : state.births,
  };
}
