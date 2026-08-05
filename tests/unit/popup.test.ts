// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmptyRuleDocument,
  createRuleId,
  type RegexRule,
} from "../../src/domain/rules";
import { mountPopup } from "../../src/popup";
import { createPopupLinks } from "../../src/popup-links";
import { RULE_PRESETS } from "../../src/presets";
import type {
  LoadedSettings,
  SaveResult,
  SettingsRepository,
} from "../../src/storage/settings";

class FakeSettings implements SettingsRepository {
  loaded: LoadedSettings = {
    document: createEmptyRuleDocument(),
    source: "empty",
    diagnostics: [],
  };
  nextSave: SaveResult | undefined;
  nextRetry: SaveResult | Error | undefined;
  readonly saves: Array<{
    readonly rules: readonly RegexRule[];
    readonly expectedWriteId: string;
  }> = [];

  async load(): Promise<LoadedSettings> {
    return this.loaded;
  }

  async save(input: {
    readonly rules: readonly RegexRule[];
    readonly expectedWriteId: string;
  }): Promise<SaveResult> {
    this.saves.push(input);
    const result =
      this.nextSave ??
      ({
        kind: "synced",
        document: {
          schemaVersion: 1,
          writeId: `save-${this.saves.length}`,
          rules: input.rules,
        },
      } satisfies SaveResult);
    if (result.kind === "synced" || result.kind === "local-only") {
      this.loaded = {
        document: result.document,
        source: result.kind === "synced" ? "sync" : "local-pending",
        diagnostics: [],
      };
    }
    return result;
  }

  async retryPendingSync(): Promise<SaveResult> {
    if (this.nextRetry instanceof Error) {
      throw this.nextRetry;
    }
    if (this.nextRetry !== undefined) {
      return this.nextRetry;
    }
    return { kind: "synced", document: this.loaded.document };
  }
}

function button(name: string): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === name ||
      candidate.getAttribute("aria-label") === name,
  );
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${name}`);
  }
  return element;
}

function input(name: string): HTMLInputElement | HTMLTextAreaElement {
  const element = document.querySelector(`[name="${name}"]`);
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  ) {
    throw new Error(`Missing input: ${name}`);
  }
  return element;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("popup", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
  });

  it("opens on Rules and keeps Presets in a separate popup view", async () => {
    await mountPopup({
      root: document.querySelector("#app"),
      settings: new FakeSettings(),
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    expect(document.body.textContent).toContain("No rules yet");
    expect(button("RULES").getAttribute("aria-selected")).toBe("true");
    expect(document.body.textContent).not.toContain("Same GitHub pull request");

    button("PRESETS").click();

    expect(button("PRESETS").getAttribute("aria-selected")).toBe("true");
    expect(document.body.textContent).toContain("Same GitHub pull request");
    expect(document.body.textContent).toContain(
      "Same URL without query or fragment",
    );
    expect(document.body.textContent).toContain("Same GitHub issue");
    expect(document.body.textContent).toContain("Same YouTube video");
    expect(document.body.textContent).toContain("Same Google document");
    expect(document.body.textContent).toContain("Same Jira issue");
    expect(document.body.textContent).toContain("Switch to new GitHub comment");
    expect(document.body.textContent).not.toContain("—");
  });

  it("filters presets by category", async () => {
    await mountPopup({
      root: document.querySelector("#app"),
      settings: new FakeSettings(),
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });
    button("PRESETS").click();

    button("GitHub").click();
    expect(button("GitHub").getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toContain("Same GitHub pull request");
    expect(document.body.textContent).toContain("Same GitHub issue");
    expect(document.body.textContent).toContain("Switch to new GitHub comment");
    expect(document.body.textContent).not.toContain("Same YouTube video");
    expect(document.body.textContent).not.toContain("Same Google document");

    button("All").click();
    expect(document.body.textContent).toContain("Same YouTube video");
    expect(document.body.textContent).toContain("Same Google document");
  });

  it("renders working support links in the fixed footer", async () => {
    const links = createPopupLinks("extension-id");
    await mountPopup({
      root: document.querySelector("#app"),
      settings: new FakeSettings(),
      createId: () => "new-rule",
      subscribe: () => () => undefined,
      links,
    });

    const expected = [
      ["Report bug", links.reportBug],
      ["Rate extension", links.rateExtension],
      ["Request feature", links.requestFeature],
      ["PR your feature", links.contributeFeature],
    ] as const;
    expect(document.body.textContent).not.toContain("Help shape the extension");
    expect(document.querySelectorAll(".support-footer > nav > .support-link"))
      .toHaveLength(4);
    expect(
      document.querySelector(".support-link-contribute")?.textContent,
    ).toBe("PR your feature");
    for (const [label, href] of expected) {
      const link = [...document.querySelectorAll("a")].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      expect(link?.href).toBe(href);
      expect(link?.target).toBe("_blank");
      expect(link?.rel).toBe("noopener noreferrer");
    }
  });

  it("supports keyboard navigation between Rules and Presets", async () => {
    await mountPopup({
      root: document.querySelector("#app"),
      settings: new FakeSettings(),
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    button("RULES").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(button("PRESETS").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(button("PRESETS"));
  });

  it("shows regex errors inline and does not save invalid drafts", async () => {
    const settings = new FakeSettings();
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    button("Add rule").click();
    input("name").value = "Broken";
    input("pattern").value = "[";
    button("Save rule").click();
    await settle();

    expect(document.body.textContent).toContain("regular expression");
    expect(settings.saves).toHaveLength(0);
  });

  it("copies an AI rule prompt without discarding the draft", async () => {
    let copiedText = "";
    await mountPopup({
      root: document.querySelector("#app"),
      settings: new FakeSettings(),
      createId: () => "new-rule",
      subscribe: () => () => undefined,
      copyText: async (text) => {
        copiedText = text;
      },
    });

    button("Add rule").click();
    input("name").value = "Keep this draft";
    expect(document.body.textContent).toContain(
      "Use flags supported by Chrome's JavaScript engine, such as i to ignore letter case.",
    );
    expect(document.body.textContent).not.toContain("such as i or u");

    button("Copy AI Prompt to help generate rules").click();
    await settle();

    expect(copiedText).toContain("Capture the stable duplicate identity");
    expect(copiedText).toContain("Describe what you want here:");
    expect(input("name").value).toBe("Keep this draft");
    expect(document.body.textContent).toContain("Prompt copied");
    expect(
      button("Copy AI Prompt to help generate rules").textContent,
    ).toBe("Copy AI Prompt to help generate rules");
  });

  it("copies an editing prompt with the regex currently in the form", async () => {
    let copiedText = "";
    const settings = new FakeSettings();
    settings.loaded = {
      source: "sync",
      diagnostics: [],
      document: {
        schemaVersion: 1,
        writeId: "loaded",
        rules: [
          {
            id: createRuleId("docs"),
            name: "Docs",
            pattern: String.raw`^https://example\.com/(docs)`,
            flags: "i",
            enabled: true,
            closePolicy: {
              kind: "close-old-when-new-tab-matches",
              pattern: String.raw`#comment-\d+$`,
              flags: "i",
            },
          },
        ],
      },
    };
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "new-rule",
      subscribe: () => () => undefined,
      copyText: async (text) => {
        copiedText = text;
      },
    });

    expect(
      document.querySelector(".advanced-rule-badge")?.textContent,
    ).toBe("+ Advanced rules");
    button("Edit Docs").click();
    expect(button("− Advanced rules").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(document.querySelector(".new-tab-condition")?.hasAttribute("hidden"))
      .toBe(false);
    input("pattern").value = String.raw`^https://example\.com/(guides)`;
    button("Copy AI Prompt to help edit this rule").click();
    await settle();

    expect(document.body.textContent).toContain("Want help editing this regex?");
    expect(copiedText).toContain(
      String.raw`Current regex: /^https://example\.com/(guides)/i`,
    );
    expect(copiedText).toContain(
      String.raw`new tab matches this condition: /#comment-\d+$/i`,
    );
    expect(copiedText).toContain("Describe what you want to change here:");
  });

  it("defaults to deleting the new tab and saves the checked old-tab option", async () => {
    const settings = new FakeSettings();
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "replace-old",
      subscribe: () => () => undefined,
    });

    button("Add rule").click();
    const deleteOldTab = input("deleteOldTab");
    if (!(deleteOldTab instanceof HTMLInputElement)) {
      throw new Error("Old-tab option is not a checkbox");
    }
    expect(deleteOldTab.checked).toBe(false);
    input("name").value = "Keep newest";
    input("pattern").value = String.raw`^(https://example\.com/docs)`;
    deleteOldTab.click();
    button("Save rule").click();
    await settle();

    expect(settings.saves[0]?.rules[0]?.closePolicy).toEqual({
      kind: "close-old",
    });
  });

  it("uses an inline Advanced rules divider for close-old", async () => {
    const settings = new FakeSettings();
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "conditional-rule",
      subscribe: () => () => undefined,
    });

    button("Add rule").click();
    expect(document.body.textContent).not.toContain("Enable this rule");
    expect(document.querySelector("details")).toBeNull();
    expect(button("+ Advanced rules").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(
      document.querySelector(".advanced-rules-content")?.hasAttribute("hidden"),
    ).toBe(true);
    button("+ Advanced rules").click();
    expect(button("− Advanced rules").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(document.querySelector(".new-tab-condition")?.hasAttribute("hidden"))
      .toBe(false);
    const deleteOldTab = input("deleteOldTab");
    if (!(deleteOldTab instanceof HTMLInputElement)) {
      throw new Error("Old-tab option is not a checkbox");
    }
    expect(input("newTabPattern").hasAttribute("disabled")).toBe(true);
    deleteOldTab.click();
    expect(input("newTabPattern").hasAttribute("disabled")).toBe(false);
    input("name").value = "Conditional";
    input("pattern").value = String.raw`^(https://example\.com/docs)`;
    input("newTabPattern").value = String.raw`#comment-\d+$`;
    input("newTabFlags").value = "i";
    button("Save rule").click();
    await settle();

    expect(settings.saves[0]?.rules[0]?.closePolicy).toEqual({
      kind: "close-old-when-new-tab-matches",
      pattern: String.raw`#comment-\d+$`,
      flags: "i",
    });
  });

  it("applies a preset immediately and keeps the preset list open", async () => {
    const settings = new FakeSettings();
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "github-rule",
      subscribe: () => () => undefined,
    });

    button("PRESETS").click();
    button("Apply Same GitHub pull request preset").click();
    await settle();

    expect(settings.saves).toHaveLength(1);
    expect(settings.saves[0]?.rules[0]).toMatchObject({
      id: "github-rule",
      name: "Same GitHub pull request",
      enabled: true,
      closePolicy: { kind: "close-new" },
    });
    expect(button("PRESETS").getAttribute("aria-selected")).toBe("true");
    expect(button("Same GitHub pull request preset already added").disabled).toBe(
      true,
    );
    button("RULES").click();
    expect(document.querySelector(".advanced-rule-badge")).toBeNull();
  });

  it("grays installed presets and moves them below available presets", async () => {
    const settings = new FakeSettings();
    const youtube = RULE_PRESETS.find(
      (preset) => preset.name === "Same YouTube video",
    );
    if (youtube === undefined) {
      throw new Error("Missing YouTube preset");
    }
    settings.loaded = {
      source: "sync",
      diagnostics: [],
      document: {
        schemaVersion: 1,
        writeId: "loaded",
        rules: [
          {
            id: createRuleId("youtube"),
            ...youtube,
            enabled: true,
          },
        ],
      },
    };
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    button("PRESETS").click();

    const cards = [
      ...document.querySelectorAll<HTMLElement>(".preset-card"),
    ];
    expect(cards.at(-1)?.querySelector("h3")?.textContent).toBe(
      "Same YouTube video",
    );
    expect(cards.at(-1)?.classList.contains("installed")).toBe(true);
    expect(button("Same YouTube video preset already added").disabled).toBe(
      true,
    );
  });

  it("leads the empty state with a dark preset action and a plain fallback", async () => {
    await mountPopup({
      root: document.querySelector("#app"),
      settings: new FakeSettings(),
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    expect(document.body.textContent).toContain("No rules yet");
    const actions = [
      ...document.querySelectorAll<HTMLButtonElement>(".empty-actions button"),
    ];
    expect(actions.map((action) => action.textContent)).toEqual([
      "Choose a preset",
      "Write your own",
    ]);
    // `primary` is the dark green treatment, so the preset action must own it.
    expect(actions[0]?.className).toContain("primary");
    expect(actions[1]?.className).not.toContain("primary");

    actions[0]?.click();
    expect(button("PRESETS").getAttribute("aria-selected")).toBe("true");
  });

  it("writes a first rule from the empty state fallback", async () => {
    await mountPopup({
      root: document.querySelector("#app"),
      settings: new FakeSettings(),
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    button("Write your own").click();

    expect(document.querySelector(".view-tabs")).toBeNull();
    expect(document.body.textContent).toContain("Add rule");
    expect(input("pattern").value).toBe("");
  });

  it("shows only the dashed editor until its top-right close button is used", async () => {
    await mountPopup({
      root: document.querySelector("#app"),
      settings: new FakeSettings(),
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    button("Write your own").click();
    expect(document.querySelector(".editor-shell")).not.toBeNull();
    expect(document.querySelector(".rule-editor")).not.toBeNull();
    expect(document.querySelector(".app-header")).toBeNull();
    expect(document.querySelector(".view-tabs")).toBeNull();
    expect(document.querySelector(".rule-list")).toBeNull();
    expect(document.querySelector(".support-footer")).toBeNull();

    button("Close rule editor").click();

    expect(document.querySelector(".editor-shell")).toBeNull();
    expect(document.querySelector(".app-header")).not.toBeNull();
    expect(document.body.textContent).toContain("No rules yet");
  });

  it("keeps the editor open when every save fails", async () => {
    const settings = new FakeSettings();
    settings.nextSave = {
      kind: "failed",
      reasons: ["storage unavailable"],
    };
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    button("Add rule").click();
    input("name").value = "Docs";
    input("pattern").value = String.raw`^(https://example\.com/docs)`;
    button("Save rule").click();
    await settle();

    expect(document.body.textContent).toContain("storage unavailable");
    expect(input("name").value).toBe("Docs");
  });

  it("keeps rule mutations out of the dedicated editor", async () => {
    const settings = new FakeSettings();
    settings.loaded = {
      source: "sync",
      diagnostics: [],
      document: {
        schemaVersion: 1,
        writeId: "loaded",
        rules: [
          {
            id: createRuleId("one"),
            name: "One",
            pattern: "one",
            flags: "",
            enabled: true,
            closePolicy: { kind: "close-new" },
          },
          {
            id: createRuleId("two"),
            name: "Two",
            pattern: "two",
            flags: "",
            enabled: true,
            closePolicy: { kind: "close-new" },
          },
        ],
      },
    };
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    button("Add rule").click();

    expect(document.querySelector('[aria-label="Disable One"]')).toBeNull();
    expect(document.body.textContent).not.toContain("One");
    expect(document.body.textContent).not.toContain("Two");
  });

  it("shows retry failures without leaving the popup disabled", async () => {
    const settings = new FakeSettings();
    settings.loaded = {
      document: createEmptyRuleDocument(),
      source: "local-pending",
      diagnostics: [],
    };
    settings.nextRetry = new Error("local read unavailable");

    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    expect(document.body.textContent).toContain("local read unavailable");
    expect(button("Retry sync").disabled).toBe(false);
    button("Retry sync").click();
    await settle();
    expect(button("Retry sync").disabled).toBe(false);
  });

  it("warns instead of discarding a dirty draft after an external change", async () => {
    const settings = new FakeSettings();
    let listener: () => void = () => undefined;
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "new-rule",
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    button("Add rule").click();
    input("name").value = "Unsaved";

    listener();
    await settle();

    expect(document.body.textContent).toContain("Rules changed elsewhere");
    expect(input("name").value).toBe("Unsaved");
  });

  it("supports enable, reorder, and confirmed delete actions", async () => {
    const settings = new FakeSettings();
    settings.loaded = {
      source: "sync",
      diagnostics: [],
      document: {
        schemaVersion: 1,
        writeId: "loaded",
        rules: [
          {
            id: createRuleId("one"),
            name: "One",
            pattern: "one",
            flags: "",
            enabled: true,
            closePolicy: { kind: "close-new" },
          },
          {
            id: createRuleId("two"),
            name: "Two",
            pattern: "two",
            flags: "",
            enabled: true,
            closePolicy: { kind: "close-new" },
          },
        ],
      },
    };
    await mountPopup({
      root: document.querySelector("#app"),
      settings,
      createId: () => "new-rule",
      subscribe: () => () => undefined,
    });

    const toggle = document.querySelector<HTMLInputElement>(
      '[aria-label="Disable One"]',
    );
    toggle?.click();
    await settle();
    expect(settings.saves.at(-1)?.rules[0]?.enabled).toBe(false);

    button("Move Two up").click();
    await settle();
    expect(settings.saves.at(-1)?.rules.map((rule) => rule.name)).toEqual([
      "Two",
      "One",
    ]);

    button("Delete Two").click();
    button("Confirm delete Two").click();
    await settle();
    expect(settings.saves.at(-1)?.rules.map((rule) => rule.name)).toEqual([
      "One",
    ]);
  });
});
