import {
  isPresetInstalled,
  type PresetFilter,
  type RulePreset,
} from "../domain/presets";
import {
  createRuleId,
  type RegexRule,
  type RuleId,
  type RuleValidationIssue,
  validateRuleSet,
} from "../domain/rules";
import type { SettingsRepository } from "../storage/settings";
import { element, writeClipboard } from "./dom";
import { createPopupLinks, type PopupLinks } from "./links";
import {
  type EditorState,
  errorText,
  noticeFor,
  type PopupView,
} from "./state";
import { editorForm, readEditorDraft } from "./views/editor";
import {
  appHeader,
  attentionNotice,
  supportFooter,
  viewTabs,
} from "./views/layout";
import { presetsView } from "./views/presets";
import { rulesView } from "./views/rules";

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
    if (editor.kind !== "none") {
      const shell = element("div", "popup-shell editor-shell");
      const content = element("main", "editor-content");
      const banner = noticeBanner();
      if (banner !== null) {
        content.append(banner);
      }
      content.append(
        editorForm({
          mode: editor.kind,
          draft: editor.draft,
          issues,
          saving,
          copyText,
          onSave: () => void saveEditor(),
          onClose: closeEditor,
        }),
      );
      shell.append(content);
      root.replaceChildren(shell);
      return;
    }

    const shell = element("div", "popup-shell");
    const content = element("main", "popup-content");
    content.id = "active-view";
    content.setAttribute("role", "tabpanel");
    content.setAttribute(
      "aria-labelledby",
      view === "rules" ? "rules-tab" : "presets-tab",
    );

    const banner = noticeBanner();
    if (banner !== null) {
      content.append(banner);
    }
    content.append(
      view === "rules" ? currentRulesView() : currentPresetsView(),
    );

    shell.append(
      appHeader(),
      viewTabs({ active: view, onSelect: (next) => selectView(next, true) }),
      content,
      supportFooter(links),
    );
    root.replaceChildren(shell);
  }

  function noticeBanner(): HTMLElement | null {
    return attentionNotice({
      notice,
      showRetry: loaded.source === "local-pending",
      retryDisabled: saving || editor.kind !== "none",
      onRetry: () => void retrySync(),
    });
  }

  function currentRulesView(): HTMLElement {
    return rulesView({
      rules: loaded.document.rules,
      locked: saving || editor.kind !== "none",
      confirmDeleteId,
      onAdd: beginAdd,
      onBrowsePresets: () => selectView("presets"),
      onEdit: beginEdit,
      onToggle: (rule, enabled) =>
        void commitRules(
          loaded.document.rules.map((current) =>
            current.id === rule.id ? { ...current, enabled } : current,
          ),
        ),
      onMove: (index, offset) => void moveRule(index, offset),
      onDelete: (id) => void deleteRule(id),
      onRequestDelete: (id) => {
        confirmDeleteId = id;
        render();
      },
      onCancelDelete: () => {
        confirmDeleteId = undefined;
        render();
      },
    });
  }

  function currentPresetsView(): HTMLElement {
    return presetsView({
      rules: loaded.document.rules,
      filter: presetFilter,
      saving,
      onFilter: (filter) => {
        presetFilter = filter;
        render();
      },
      onApply: (preset) => void applyPreset(preset),
    });
  }

  function selectView(nextView: PopupView, focusTab = false): void {
    if (view === nextView) {
      return;
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
        closePolicy: { kind: "close-new" },
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

  async function applyPreset(preset: RulePreset): Promise<void> {
    if (isPresetInstalled(loaded.document.rules, preset)) {
      return;
    }
    await commitRules([
      ...loaded.document.rules,
      {
        id: createRuleId(input.createId()),
        name: preset.name,
        pattern: preset.pattern,
        flags: preset.flags,
        enabled: true,
        closePolicy: preset.closePolicy,
      },
    ]);
  }

  async function saveEditor(): Promise<void> {
    if (editor.kind === "none") {
      return;
    }
    const draft = readEditorDraft(root, editor.draft);
    if (draft === null) {
      notice = {
        kind: "error",
        message: "The editor could not read its fields.",
      };
      render();
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

  function closeEditor(): void {
    editor = { kind: "none" };
    issues = [];
    render();
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
      notice = { kind: "error", message: errorText(error) };
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
        const draft = readEditorDraft(root, editor.draft);
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
        notice = { kind: "error", message: errorText(error) };
        render();
      });
  });

  render();
  return unsubscribe;
}

function requireRoot(value: Element | null): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new Error("Popup root element is missing.");
  }
  return value;
}
