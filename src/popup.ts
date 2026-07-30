import {
  createRuleId,
  validateRuleSet,
  type RegexRule,
  type RuleId,
  type RuleValidationIssue,
} from "./domain/rules";
import { AI_RULE_PROMPT } from "./ai-rule-prompt";
import { createPopupLinks, type PopupLinks } from "./popup-links";
import {
  PRESET_FILTERS,
  RULE_PRESETS,
  type PresetFilter,
  type RulePreset,
} from "./presets";
import {
  createSettingsRepository,
  LOCAL_RULES_KEY,
  SYNC_RULES_KEY,
  type LoadedSettings,
  type SettingsRepository,
} from "./storage/settings";
import { createChromeValueStorageArea } from "./storage/value-storage";

interface RuleDraft {
  readonly id: RuleId;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly enabled: boolean;
}

type EditorState =
  | { readonly kind: "adding"; readonly draft: RuleDraft }
  | { readonly kind: "editing"; readonly draft: RuleDraft }
  | { readonly kind: "none" };

type PopupView = "presets" | "rules";
type NoticeState =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "none" }
  | { readonly kind: "warning"; readonly message: string };

const FALLBACK_LINKS = createPopupLinks("unpublished");

export async function mountPopup(input: {
  readonly root: Element | null;
  readonly settings: SettingsRepository;
  readonly createId: () => string;
  readonly subscribe: (listener: () => void) => () => void;
  readonly copyText?: (text: string) => Promise<void>;
  readonly links?: PopupLinks;
}): Promise<() => void> {
  const root = requireRoot(input.root);
  const links = input.links ?? FALLBACK_LINKS;
  const copyText = input.copyText ?? writeClipboard;

  let loaded = await input.settings.load();
  let editor: EditorState = { kind: "none" };
  let issues: readonly RuleValidationIssue[] = [];
  let notice = noticeFor(loaded);
  let saving = false;
  let confirmDeleteId: RuleId | undefined;
  let presetFilter: PresetFilter = "All";
  let view: PopupView = "rules";

  if (loaded.source === "local-pending") {
    try {
      const retry = await input.settings.retryPendingSync();
      if (retry.kind === "synced") {
        loaded = { document: retry.document, source: "sync", diagnostics: [] };
        notice = { kind: "none" };
      } else if (retry.kind === "local-only") {
        notice = {
          kind: "warning",
          message: `Saved locally. Sync pending: ${retry.reason}`,
        };
      } else if (retry.kind === "conflict") {
        loaded = { document: retry.current, source: "sync", diagnostics: [] };
        notice = {
          kind: "warning",
          message: "Rules changed elsewhere. Reload before saving.",
        };
      } else {
        notice = { kind: "error", message: retry.reasons.join(" ") };
      }
    } catch (error) {
      notice = { kind: "error", message: errorText(error) };
    }
  }

  function render(): void {
    const shell = element("div", "popup-shell");
    const content = element("main", "popup-content");
    content.id = "active-view";
    content.setAttribute("role", "tabpanel");
    content.setAttribute(
      "aria-labelledby",
      view === "rules" ? "rules-tab" : "presets-tab",
    );

    const notice = attentionNotice();
    if (notice !== null) {
      content.append(notice);
    }
    content.append(view === "rules" ? rulesView() : presetsView());

    shell.append(appHeader(), viewTabs(), content, supportFooter());
    root.replaceChildren(shell);
  }

  function appHeader(): HTMLElement {
    const header = element("header", "app-header");
    const brand = element("div", "brand");
    const logo = document.createElement("img");
    logo.className = "brand-logo";
    logo.src = "logo.png";
    logo.alt = "";
    logo.width = 38;
    logo.height = 38;

    const words = element("div", "brand-copy");
    const heading = document.createElement("h1");
    heading.textContent = "Regex Tab Dedupe";
    const tagline = document.createElement("p");
    tagline.textContent = "One tab per identity.";
    words.append(heading, tagline);
    brand.append(logo, words);

    header.append(brand);
    return header;
  }

  function viewTabs(): HTMLElement {
    const navigation = element("nav", "view-tabs");
    navigation.setAttribute("role", "tablist");
    navigation.setAttribute("aria-label", "Extension pages");
    navigation.append(
      viewTab("RULES", "rules", "rules-tab"),
      viewTab("PRESETS", "presets", "presets-tab"),
    );
    return navigation;
  }

  function viewTab(
    label: string,
    target: PopupView,
    id: string,
  ): HTMLButtonElement {
    const tab = actionButton(label, () => selectView(target, true), {
      className: view === target ? "view-tab active" : "view-tab",
    });
    tab.id = id;
    tab.tabIndex = view === target ? 0 : -1;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "active-view");
    tab.setAttribute("aria-selected", String(view === target));
    tab.addEventListener("keydown", (event) => {
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      event.preventDefault();
      let nextView: PopupView;
      if (event.key === "Home") {
        nextView = "rules";
      } else if (event.key === "End") {
        nextView = "presets";
      } else {
        nextView = target === "rules" ? "presets" : "rules";
      }
      selectView(nextView, true);
    });
    return tab;
  }

  function attentionNotice(): HTMLElement | null {
    if (notice.kind === "none") {
      return null;
    }
    const banner = element("aside", `notice notice-${notice.kind}`);
    banner.setAttribute("role", notice.kind === "error" ? "alert" : "note");
    const copy = document.createElement("p");
    copy.textContent = notice.message;
    banner.append(copy);
    if (loaded.source === "local-pending") {
      banner.append(
        actionButton("Retry sync", () => void retrySync(), {
          className: "compact-button",
          disabled: saving || editor.kind !== "none",
        }),
      );
    }
    return banner;
  }

  function rulesView(): HTMLElement {
    const section = element("section", "page rules-page");
    const heading = element("div", "page-heading");
    const titleBlock = element("div", "page-title");
    const titleLine = element("div", "title-line");
    const title = document.createElement("h2");
    title.textContent = "Your rules";
    const count = element("span", "count-badge");
    count.textContent = String(loaded.document.rules.length);
    const copy = document.createElement("p");
    copy.textContent = "Rules run from top to bottom. The first match wins.";
    titleLine.append(title, count);
    titleBlock.append(titleLine, copy);
    heading.append(
      titleBlock,
      actionButton("Add rule", beginAdd, {
        className: "primary add-button",
        disabled: saving || editor.kind !== "none",
      }),
    );
    section.append(heading);

    if (editor.kind !== "none") {
      section.append(editorForm(editor.draft));
    }
    section.append(ruleList());
    return section;
  }

  function ruleList(): HTMLElement {
    const list = element("div", "rule-list");
    if (loaded.document.rules.length === 0) {
      const empty = element("div", "empty-state");
      const icon = element("div", "empty-icon");
      icon.textContent = ".*";
      icon.setAttribute("aria-hidden", "true");
      const emptyTitle = document.createElement("strong");
      emptyTitle.textContent = "No rules yet";
      const emptyCopy = document.createElement("p");
      emptyCopy.textContent =
        "Start with a ready-made preset or write your own regex rule.";
      const actions = element("div", "empty-actions");
      actions.append(
        actionButton("Choose a preset", () => selectView("presets"), {
          className: "primary",
        }),
        actionButton("Write your own", beginAdd),
      );
      empty.append(icon, emptyTitle, emptyCopy, actions);
      list.append(empty);
      return list;
    }

    loaded.document.rules.forEach((rule, index) => {
      list.append(ruleCard(rule, index));
    });
    return list;
  }

  function ruleCard(rule: RegexRule, index: number): HTMLElement {
    const stateClass = rule.enabled ? "" : " disabled";
    const card = element("article", `rule-card${stateClass}`);
    const top = element("div", "rule-card-top");
    const identity = element("div", "rule-identity");
    const priority = element("span", "priority-badge");
    priority.textContent = `#${index + 1}`;
    priority.title = `Priority ${index + 1}`;
    const name = document.createElement("h3");
    name.textContent = rule.name;
    identity.append(priority, name);

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = rule.enabled;
    toggle.disabled = saving || editor.kind !== "none";
    toggle.setAttribute(
      "aria-label",
      `${rule.enabled ? "Disable" : "Enable"} ${rule.name}`,
    );
    toggle.addEventListener("change", () => {
      void commitRules(
        loaded.document.rules.map((current) =>
          current.id === rule.id
            ? { ...current, enabled: toggle.checked }
            : current,
        ),
      );
    });
    const track = element("span", "toggle-track");
    track.setAttribute("aria-hidden", "true");
    toggleLabel.append(toggle, track);
    top.append(identity, toggleLabel);

    const expression = element("div", "expression");
    const expressionLabel = document.createElement("span");
    expressionLabel.textContent = "REGEX";
    const pattern = document.createElement("code");
    pattern.textContent = `/${rule.pattern}/${rule.flags}`;
    expression.append(expressionLabel, pattern);

    const actions = element("div", "rule-actions");
    actions.append(
      actionButton("↑", () => void moveRule(index, -1), {
        ariaLabel: `Move ${rule.name} up`,
        className: "icon-button",
        disabled: saving || editor.kind !== "none" || index === 0,
      }),
      actionButton("↓", () => void moveRule(index, 1), {
        ariaLabel: `Move ${rule.name} down`,
        className: "icon-button",
        disabled:
          saving ||
          editor.kind !== "none" ||
          index === loaded.document.rules.length - 1,
      }),
      actionButton("Edit", () => beginEdit(rule), {
        ariaLabel: `Edit ${rule.name}`,
        disabled: saving || editor.kind !== "none",
      }),
    );
    if (confirmDeleteId === rule.id) {
      const prompt = element("span", "delete-prompt");
      prompt.textContent = "Delete this rule?";
      actions.append(
        prompt,
        actionButton("Delete", () => void deleteRule(rule.id), {
          ariaLabel: `Confirm delete ${rule.name}`,
          className: "danger",
          disabled: saving || editor.kind !== "none",
        }),
        actionButton(
          "Keep",
          () => {
            confirmDeleteId = undefined;
            render();
          },
          {
            ariaLabel: "Cancel delete",
            disabled: saving || editor.kind !== "none",
          },
        ),
      );
    } else {
      actions.append(
        actionButton("Delete", () => {
          confirmDeleteId = rule.id;
          render();
        }, {
          ariaLabel: `Delete ${rule.name}`,
          className: "quiet-danger",
          disabled: saving || editor.kind !== "none",
        }),
      );
    }
    card.append(top, expression, actions);
    return card;
  }

  function presetsView(): HTMLElement {
    const section = element("section", "page presets-page");
    const heading = element("div", "page-heading preset-heading");
    const titleBlock = element("div", "page-title");
    const title = document.createElement("h2");
    title.textContent = "Presets";
    const copy = document.createElement("p");
    copy.textContent =
      "Useful starting points. Choosing one opens an editable draft. It never saves automatically.";
    titleBlock.append(title, copy);
    heading.append(titleBlock);

    const filters = element("div", "preset-filters");
    const filterLabel = document.createElement("span");
    filterLabel.textContent = "Filter presets";
    const filterButtons = element("div", "filter-buttons");
    filterButtons.setAttribute("role", "group");
    filterButtons.setAttribute("aria-label", "Filter presets by category");
    for (const filter of PRESET_FILTERS) {
      const filterButton = actionButton(filter, () => {
        presetFilter = filter;
        render();
      }, { className: "filter-button" });
      filterButton.setAttribute("aria-pressed", String(presetFilter === filter));
      filterButtons.append(filterButton);
    }
    filters.append(filterLabel, filterButtons);

    const grid = element("div", "preset-list");
    const visiblePresets = RULE_PRESETS.filter(
      (preset) => presetFilter === "All" || preset.category === presetFilter,
    );
    for (const preset of visiblePresets) {
      grid.append(presetCard(preset));
    }
    section.append(heading, filters, grid);
    return section;
  }

  function presetCard(preset: RulePreset): HTMLElement {
    const card = element("article", "preset-card");
    const top = element("div", "preset-card-top");
    const category = element(
      "span",
      `category-badge category-${preset.category.toLowerCase()}`,
    );
    category.textContent = preset.category;
    const name = document.createElement("h3");
    name.textContent = preset.name;
    top.append(category, name);
    const description = document.createElement("p");
    description.textContent = preset.description;
    const pattern = document.createElement("code");
    pattern.textContent = `/${preset.pattern}/${preset.flags}`;
    card.append(
      top,
      description,
      pattern,
      actionButton("Use preset", () => beginPreset(preset), {
        ariaLabel: `Use ${preset.name} preset`,
        className: "use-preset",
        disabled: saving || editor.kind !== "none",
      }),
    );
    return card;
  }

  function supportFooter(): HTMLElement {
    const footer = element("footer", "support-footer");
    const navigation = document.createElement("nav");
    navigation.setAttribute("aria-label", "Support links");
    const contributeLink = externalLink(
      "PR your feature",
      links.contributeFeature,
    );
    contributeLink.classList.add("support-link-contribute");
    navigation.append(
      externalLink("Report bug", links.reportBug),
      externalLink("Rate extension", links.rateExtension),
      externalLink("Request feature", links.requestFeature),
      contributeLink,
    );
    footer.append(navigation);
    return footer;
  }

  function editorForm(draft: RuleDraft): HTMLElement {
    const form = document.createElement("form");
    form.className = "rule-editor";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void saveEditor();
    });
    const titleRow = element("div", "editor-title");
    const heading = document.createElement("h2");
    heading.textContent = editor.kind === "adding" ? "Add rule" : "Edit rule";
    const helper = document.createElement("span");
    helper.textContent = "HTTP(S) URLs only";
    titleRow.append(heading, helper);
    if (editor.kind === "adding") {
      form.append(aiPromptBanner());
    }
    form.append(
      titleRow,
      textField({ label: "Name", name: "name", value: draft.name }),
      textField({
        label: "Regular expression",
        name: "pattern",
        value: draft.pattern,
        multiline: true,
        hint: "Capture group 1 is the identity. With no captures, the full match is used.",
      }),
      textField({
        label: "Flags",
        name: "flags",
        value: draft.flags,
        hint: "Use flags supported by Chrome's JavaScript engine, such as i to ignore letter case.",
      }),
    );

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "checkbox-field";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.name = "enabled";
    enabled.checked = draft.enabled;
    enabledLabel.append(enabled, document.createTextNode(" Enable this rule"));
    form.append(enabledLabel);

    const formIssues = element("div", "form-errors");
    formIssues.setAttribute("aria-live", "polite");
    for (const issue of issues) {
      const line = document.createElement("p");
      line.textContent = issue.message;
      formIssues.append(line);
    }
    form.append(formIssues);

    const actions = element("div", "editor-actions");
    actions.append(
      actionButton("Save rule", () => undefined, {
        className: "primary",
        disabled: saving,
        type: "submit",
      }),
      actionButton("Cancel", () => {
        editor = { kind: "none" };
        issues = [];
        render();
      }, { disabled: saving }),
    );
    form.append(actions);
    return form;
  }

  function aiPromptBanner(): HTMLElement {
    const banner = element("aside", "ai-prompt-banner");
    const copy = element("div", "ai-prompt-copy");
    const heading = document.createElement("strong");
    heading.textContent = "Want help writing the regex?";
    const description = document.createElement("p");
    description.textContent =
      "Copy a ready-to-paste AI prompt, then finish it with what you want to deduplicate.";
    copy.append(heading, description);

    const feedback = element("span", "copy-feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    const copyButton = actionButton(
      "Copy AI Prompt to help generate rules",
      () => void copyAiPrompt({ button: copyButton, feedback }),
      { className: "copy-prompt-button" },
    );
    banner.append(copy, copyButton, feedback);
    return banner;
  }

  async function copyAiPrompt(input: {
    readonly button: HTMLButtonElement;
    readonly feedback: HTMLElement;
  }): Promise<void> {
    input.button.disabled = true;
    input.feedback.textContent = "Copying prompt";
    try {
      await copyText(AI_RULE_PROMPT);
      input.feedback.textContent = "Prompt copied";
    } catch {
      input.feedback.textContent = "Could not copy the prompt. Try again.";
    } finally {
      input.button.disabled = false;
    }
  }

  function selectView(nextView: PopupView, focusTab = false): void {
    if (view === nextView) {
      return;
    }
    // Opening Presets discards an in-progress draft. Carrying it over would
    // leave every "Use preset" button disabled with nothing on screen to
    // explain why.
    if (nextView === "presets" && editor.kind !== "none") {
      editor = { kind: "none" };
      issues = [];
    }
    view = nextView;
    render();
    if (focusTab) {
      const id = nextView === "rules" ? "#rules-tab" : "#presets-tab";
      root.querySelector<HTMLButtonElement>(id)?.focus();
    }
  }

  function beginAdd(): void {
    editor = {
      kind: "adding",
      draft: {
        id: createRuleId(input.createId()),
        name: "",
        pattern: "",
        flags: "",
        enabled: true,
      },
    };
    issues = [];
    view = "rules";
    render();
  }

  function beginEdit(rule: RegexRule): void {
    editor = { kind: "editing", draft: { ...rule } };
    issues = [];
    view = "rules";
    render();
  }

  function beginPreset(preset: RulePreset): void {
    editor = {
      kind: "adding",
      draft: {
        id: createRuleId(input.createId()),
        name: preset.name,
        pattern: preset.pattern,
        flags: preset.flags,
        enabled: true,
      },
    };
    issues = [];
    view = "rules";
    render();
  }

  async function saveEditor(): Promise<void> {
    if (editor.kind === "none") {
      return;
    }
    const draft = readDraft(editor.draft.id);
    if (draft === null) {
      return;
    }
    editor = { ...editor, draft };
    const validation = validateRuleSet([draft]);
    if (!validation.ok) {
      issues = validation.issues;
      render();
      return;
    }
    const nextRules =
      editor.kind === "adding"
        ? [...loaded.document.rules, draft]
        : loaded.document.rules.map((rule) =>
            rule.id === draft.id ? draft : rule,
          );
    await commitRules(nextRules, true);
  }

  function readDraft(id: RuleId): RuleDraft | null {
    const name = root.querySelector('[name="name"]');
    const pattern = root.querySelector('[name="pattern"]');
    const flags = root.querySelector('[name="flags"]');
    const enabled = root.querySelector('[name="enabled"]');
    if (
      !(name instanceof HTMLInputElement) ||
      !(
        pattern instanceof HTMLInputElement ||
        pattern instanceof HTMLTextAreaElement
      ) ||
      !(flags instanceof HTMLInputElement) ||
      !(enabled instanceof HTMLInputElement)
    ) {
      notice = {
        kind: "error",
        message: "The editor could not read its fields.",
      };
      render();
      return null;
    }
    return {
      id,
      name: name.value.trim(),
      pattern: pattern.value,
      flags: flags.value.trim(),
      enabled: enabled.checked,
    };
  }

  async function commitRules(
    rules: readonly RegexRule[],
    closeEditor = false,
  ): Promise<void> {
    saving = true;
    notice = { kind: "none" };
    render();
    try {
      const result = await input.settings.save({
        rules,
        expectedWriteId: loaded.document.writeId,
      });
      if (result.kind === "synced" || result.kind === "local-only") {
        loaded = {
          document: result.document,
          source: result.kind === "synced" ? "sync" : "local-pending",
          diagnostics: [],
        };
        notice =
          result.kind === "synced"
            ? { kind: "none" }
            : {
                kind: "warning",
                message: `Saved locally. Sync pending: ${result.reason}`,
              };
        if (closeEditor) {
          editor = { kind: "none" };
          issues = [];
        }
      } else if (result.kind === "conflict") {
        loaded = {
          document: result.current,
          source: "sync",
          diagnostics: [],
        };
        notice = {
          kind: "warning",
          message:
            "Rules changed elsewhere. Reload the latest rules before saving this draft.",
        };
      } else {
        notice = { kind: "error", message: result.reasons.join(" ") };
      }
    } catch (error) {
      notice = {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      saving = false;
      render();
    }
  }

  async function moveRule(index: number, offset: -1 | 1): Promise<void> {
    const destination = index + offset;
    if (destination < 0 || destination >= loaded.document.rules.length) {
      return;
    }
    const rules = [...loaded.document.rules];
    const moving = rules[index];
    const displaced = rules[destination];
    if (moving === undefined || displaced === undefined) {
      return;
    }
    rules[index] = displaced;
    rules[destination] = moving;
    await commitRules(rules);
  }

  async function deleteRule(id: RuleId): Promise<void> {
    confirmDeleteId = undefined;
    await commitRules(loaded.document.rules.filter((rule) => rule.id !== id));
  }

  async function retrySync(): Promise<void> {
    saving = true;
    notice = { kind: "none" };
    render();
    try {
      const result = await input.settings.retryPendingSync();
      if (result.kind === "synced") {
        loaded = { document: result.document, source: "sync", diagnostics: [] };
        notice = { kind: "none" };
      } else if (result.kind === "local-only") {
        notice = {
          kind: "warning",
          message: `Saved locally. Sync pending: ${result.reason}`,
        };
      } else if (result.kind === "failed") {
        notice = { kind: "error", message: result.reasons.join(" ") };
      } else {
        loaded = { document: result.current, source: "sync", diagnostics: [] };
        notice = { kind: "warning", message: "Rules changed elsewhere." };
      }
    } catch (error) {
      notice = { kind: "error", message: errorText(error) };
    } finally {
      saving = false;
      render();
    }
  }

  const unsubscribe = input.subscribe(() => {
    if (editor.kind !== "none") {
      if (view === "rules") {
        const draft = readDraft(editor.draft.id);
        if (draft !== null) {
          editor = { ...editor, draft };
        }
      }
      notice = {
        kind: "warning",
        message: "Rules changed elsewhere. Your unsaved draft is still here.",
      };
      render();
      return;
    }
    void input.settings
      .load()
      .then((next) => {
        loaded = next;
        notice = noticeFor(next);
        render();
      })
      .catch((error: unknown) => {
        notice = {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        render();
      });
  });

  render();
  return unsubscribe;
}

function textField(input: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly multiline?: boolean;
  readonly hint?: string;
}): HTMLElement {
  const label = document.createElement("label");
  label.className = "field";
  const text = document.createElement("span");
  text.textContent = input.label;
  const control = input.multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  control.name = input.name;
  control.value = input.value;
  control.spellcheck = false;
  if (control instanceof HTMLTextAreaElement) {
    const resize = (): void => {
      control.style.height = "auto";
      control.style.height = `${Math.max(control.scrollHeight, 74)}px`;
    };
    control.addEventListener("input", resize);
    queueMicrotask(resize);
  }
  label.append(text, control);
  if (input.hint !== undefined) {
    const hint = document.createElement("small");
    hint.textContent = input.hint;
    label.append(hint);
  }
  return label;
}

function actionButton(
  label: string,
  action: () => void,
  options: {
    readonly ariaLabel?: string;
    readonly className?: string;
    readonly disabled?: boolean;
    readonly type?: "button" | "submit";
  } = {},
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = options.type ?? "button";
  button.textContent = label;
  button.disabled = options.disabled ?? false;
  if (options.ariaLabel !== undefined) {
    button.setAttribute("aria-label", options.ariaLabel);
    button.title = options.ariaLabel;
  }
  if (options.className !== undefined) {
    button.className = options.className;
  }
  if (button.type !== "submit") {
    button.addEventListener("click", action);
  }
  return button;
}

function externalLink(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "support-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function noticeFor(loaded: LoadedSettings): NoticeState {
  if (loaded.diagnostics.length > 0) {
    return { kind: "error", message: loaded.diagnostics.join(" ") };
  }
  if (loaded.source === "local-pending") {
    return { kind: "warning", message: "Saved locally. Sync pending." };
  }
  return { kind: "none" };
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard === undefined) {
    throw new Error("Clipboard access is unavailable.");
  }
  await navigator.clipboard.writeText(text);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireRoot(value: Element | null): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new Error("Popup root element is missing.");
  }
  return value;
}

const root = document.querySelector("#app");
if (
  root instanceof HTMLElement &&
  typeof chrome !== "undefined" &&
  chrome.storage !== undefined
) {
  const settings = createSettingsRepository({
    sync: createChromeValueStorageArea(chrome.storage.sync),
    local: createChromeValueStorageArea(chrome.storage.local),
    createWriteId: () => crypto.randomUUID(),
    syncQuotaBytes: chrome.storage.sync.QUOTA_BYTES_PER_ITEM,
  });
  void mountPopup({
    root,
    settings,
    createId: () => crypto.randomUUID(),
    links: createPopupLinks(chrome.runtime.id),
    subscribe: (listener) => {
      const callback = (
        changes: Record<string, chrome.storage.StorageChange>,
      ): void => {
        if (changes[SYNC_RULES_KEY] !== undefined || changes[LOCAL_RULES_KEY]) {
          listener();
        }
      };
      chrome.storage.onChanged.addListener(callback);
      return () => chrome.storage.onChanged.removeListener(callback);
    },
  });
}
