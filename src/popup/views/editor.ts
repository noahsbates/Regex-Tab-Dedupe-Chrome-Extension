import type { ClosePolicy, RuleValidationIssue } from "../../domain/rules";
import { AI_RULE_PROMPT, createAiRuleEditPrompt } from "../ai-prompt";
import { actionButton, element, textField } from "../dom";
import type { RuleDraft } from "../state";

export interface EditorFormInput {
  readonly mode: "adding" | "editing";
  readonly draft: RuleDraft;
  readonly issues: readonly RuleValidationIssue[];
  readonly saving: boolean;
  readonly copyText: (text: string) => Promise<void>;
  readonly onSave: () => void;
  readonly onClose: () => void;
}

export function editorForm(input: EditorFormInput): HTMLElement {
  const draft = input.draft;
  const form = document.createElement("form");
  form.className = "rule-editor";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    input.onSave();
  });
  const titleRow = element("div", "editor-title");
  const titleCopy = element("div", "editor-title-copy");
  const heading = document.createElement("h2");
  heading.textContent = input.mode === "adding" ? "Add rule" : "Edit rule";
  const helper = document.createElement("span");
  helper.textContent = "HTTP(S) URLs only";
  titleCopy.append(heading, helper);
  titleRow.append(
    titleCopy,
    actionButton("×", input.onClose, {
      ariaLabel: "Close rule editor",
      className: "editor-close",
      disabled: input.saving,
    }),
  );
  form.append(
    titleRow,
    aiPromptBanner(form, input),
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

  form.append(advancedRulesSection(draft, input.issues));

  const formIssues = element("div", "form-errors");
  formIssues.setAttribute("aria-live", "polite");
  for (const issue of input.issues) {
    const line = document.createElement("p");
    line.textContent = issue.message;
    formIssues.append(line);
  }
  form.append(formIssues);

  const actions = element("div", "editor-actions");
  actions.append(
    actionButton("Save rule", () => undefined, {
      className: "primary",
      disabled: input.saving,
      type: "submit",
    }),
  );
  form.append(actions);
  return form;
}

function advancedRulesSection(
  draft: RuleDraft,
  issues: readonly RuleValidationIssue[],
): HTMLElement {
  const advancedRules = element("section", "advanced-rules");
  const advancedContent = element("div", "advanced-rules-content");
  advancedContent.id = "advanced-rules-content";
  let advancedOpen =
    draft.closePolicy.kind !== "close-new" ||
    issues.some(
      (issue) =>
        issue.field === "newTabPattern" || issue.field === "newTabFlags",
    );
  const advancedToggle = actionButton(
    "",
    () => {
      setAdvancedVisibility(!advancedOpen);
    },
    { className: "advanced-rules-toggle" },
  );
  advancedToggle.setAttribute("aria-controls", advancedContent.id);
  const setAdvancedVisibility = (open: boolean): void => {
    advancedOpen = open;
    advancedContent.hidden = !open;
    advancedContent.setAttribute("aria-hidden", String(!open));
    advancedToggle.setAttribute("aria-expanded", String(open));
    advancedToggle.textContent = `${open ? "−" : "+"} Advanced rules`;
  };

  const deleteOldLabel = document.createElement("label");
  deleteOldLabel.className = "checkbox-field close-old-option";
  const deleteOldTab = document.createElement("input");
  deleteOldTab.type = "checkbox";
  deleteOldTab.name = "deleteOldTab";
  deleteOldTab.checked = draft.closePolicy.kind !== "close-new";
  deleteOldTab.setAttribute("aria-controls", "new-tab-condition");
  deleteOldLabel.append(
    deleteOldTab,
    document.createTextNode(" Close old tab instead"),
  );

  const conditionalPolicy =
    draft.closePolicy.kind === "close-old-when-new-tab-matches"
      ? draft.closePolicy
      : undefined;
  const condition = element("div", "new-tab-condition");
  condition.id = "new-tab-condition";
  const conditionIntro = document.createElement("p");
  conditionIntro.textContent =
    "Optional: require the newly opened tab to match a stricter regex before it can replace the old tab.";
  const conditionPattern = textField({
    label: "New-tab condition",
    name: "newTabPattern",
    value: conditionalPolicy?.pattern ?? "",
    multiline: true,
    hint: "The main regex identifies both tabs. Leave this blank to always keep the new tab.",
  });
  const conditionFlags = textField({
    label: "Condition flags",
    name: "newTabFlags",
    value: conditionalPolicy?.flags ?? draft.flags,
    hint: "These flags apply only to the new-tab condition.",
  });
  condition.append(conditionIntro, conditionPattern, conditionFlags);

  const setConditionState = (): void => {
    condition.classList.toggle("disabled", !deleteOldTab.checked);
    condition.setAttribute("aria-disabled", String(!deleteOldTab.checked));
    for (const control of condition.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input, textarea")) {
      control.disabled = !deleteOldTab.checked;
    }
  };
  deleteOldTab.addEventListener("change", setConditionState);
  setConditionState();
  advancedContent.append(deleteOldLabel, condition);
  setAdvancedVisibility(advancedOpen);
  advancedRules.append(advancedToggle, advancedContent);
  return advancedRules;
}

function aiPromptBanner(
  form: HTMLElement,
  input: EditorFormInput,
): HTMLElement {
  const editing = input.mode === "editing";
  const banner = element("aside", "ai-prompt-banner");
  const copy = element("div", "ai-prompt-copy");
  const heading = document.createElement("strong");
  heading.textContent = editing
    ? "Want help editing this regex?"
    : "Want help writing the regex?";
  const description = document.createElement("p");
  description.textContent = editing
    ? "Copy a prompt that includes the current regex, then describe the change you want."
    : "Copy a ready-to-paste AI prompt, then finish it with what you want to deduplicate.";
  copy.append(heading, description);

  const feedback = element("span", "copy-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  const copyButton = actionButton(
    editing
      ? "Copy AI Prompt to help edit this rule"
      : "Copy AI Prompt to help generate rules",
    () =>
      void copyPrompt({
        button: copyButton,
        feedback,
        prompt: editing ? editPromptFor(form, input.draft) : AI_RULE_PROMPT,
        copyText: input.copyText,
      }),
    { className: "copy-prompt-button" },
  );
  banner.append(copy, copyButton, feedback);
  return banner;
}

async function copyPrompt(input: {
  readonly button: HTMLButtonElement;
  readonly feedback: HTMLElement;
  readonly prompt: string;
  readonly copyText: (text: string) => Promise<void>;
}): Promise<void> {
  input.button.disabled = true;
  input.feedback.textContent = "Copying prompt";
  try {
    await input.copyText(input.prompt);
    input.feedback.textContent = "Prompt copied";
  } catch {
    input.feedback.textContent = "Could not copy the prompt. Try again.";
  } finally {
    input.button.disabled = false;
  }
}

export function readEditorDraft(
  scope: ParentNode,
  current: RuleDraft,
): RuleDraft | null {
  const name = scope.querySelector('[name="name"]');
  const pattern = scope.querySelector('[name="pattern"]');
  const flags = scope.querySelector('[name="flags"]');
  const deleteOldTab = scope.querySelector('[name="deleteOldTab"]');
  const newTabPattern = scope.querySelector('[name="newTabPattern"]');
  const newTabFlags = scope.querySelector('[name="newTabFlags"]');
  if (
    !(name instanceof HTMLInputElement) ||
    !(
      pattern instanceof HTMLInputElement ||
      pattern instanceof HTMLTextAreaElement
    ) ||
    !(flags instanceof HTMLInputElement) ||
    !(deleteOldTab instanceof HTMLInputElement) ||
    !(
      newTabPattern instanceof HTMLInputElement ||
      newTabPattern instanceof HTMLTextAreaElement
    ) ||
    !(newTabFlags instanceof HTMLInputElement)
  ) {
    return null;
  }
  return {
    id: current.id,
    name: name.value.trim(),
    pattern: pattern.value,
    flags: flags.value.trim(),
    enabled: current.enabled,
    closePolicy: readClosePolicy({
      deleteOldTab: deleteOldTab.checked,
      newTabPattern: newTabPattern.value,
      newTabFlags: newTabFlags.value.trim(),
    }),
  };
}

function editPromptFor(scope: ParentNode, draft: RuleDraft): string {
  const pattern = scope.querySelector('[name="pattern"]');
  const flags = scope.querySelector('[name="flags"]');
  const deleteOldTab = scope.querySelector('[name="deleteOldTab"]');
  const newTabPattern = scope.querySelector('[name="newTabPattern"]');
  const newTabFlags = scope.querySelector('[name="newTabFlags"]');
  const closePolicy =
    deleteOldTab instanceof HTMLInputElement &&
    (newTabPattern instanceof HTMLInputElement ||
      newTabPattern instanceof HTMLTextAreaElement) &&
    newTabFlags instanceof HTMLInputElement
      ? readClosePolicy({
          deleteOldTab: deleteOldTab.checked,
          newTabPattern: newTabPattern.value,
          newTabFlags: newTabFlags.value.trim(),
        })
      : draft.closePolicy;
  return createAiRuleEditPrompt({
    pattern:
      pattern instanceof HTMLInputElement ||
      pattern instanceof HTMLTextAreaElement
        ? pattern.value
        : draft.pattern,
    flags: flags instanceof HTMLInputElement ? flags.value.trim() : draft.flags,
    closePolicy,
  });
}

function readClosePolicy(input: {
  readonly deleteOldTab: boolean;
  readonly newTabPattern: string;
  readonly newTabFlags: string;
}): ClosePolicy {
  if (!input.deleteOldTab) {
    return { kind: "close-new" };
  }
  if (input.newTabPattern.length === 0) {
    return { kind: "close-old" };
  }
  return {
    kind: "close-old-when-new-tab-matches",
    pattern: input.newTabPattern,
    flags: input.newTabFlags,
  };
}
