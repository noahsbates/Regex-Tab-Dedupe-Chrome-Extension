import type { RegexRule, RuleId } from "../../domain/rules";
import { actionButton, element } from "../dom";

export interface RulesViewInput {
  readonly rules: readonly RegexRule[];
  readonly locked: boolean;
  readonly confirmDeleteId: RuleId | undefined;
  readonly onAdd: () => void;
  readonly onBrowsePresets: () => void;
  readonly onEdit: (rule: RegexRule) => void;
  readonly onToggle: (rule: RegexRule, enabled: boolean) => void;
  readonly onMove: (index: number, offset: -1 | 1) => void;
  readonly onDelete: (id: RuleId) => void;
  readonly onRequestDelete: (id: RuleId) => void;
  readonly onCancelDelete: () => void;
}

export function rulesView(input: RulesViewInput): HTMLElement {
  const section = element("section", "page rules-page");
  const heading = element("div", "page-heading");
  const titleBlock = element("div", "page-title");
  const titleLine = element("div", "title-line");
  const title = document.createElement("h2");
  title.textContent = "Your rules";
  const count = element("span", "count-badge");
  count.textContent = String(input.rules.length);
  const copy = document.createElement("p");
  copy.textContent = "Rules run from top to bottom. The first match wins.";
  titleLine.append(title, count);
  titleBlock.append(titleLine, copy);
  heading.append(
    titleBlock,
    actionButton("Add rule", input.onAdd, {
      className: "primary add-button",
      disabled: input.locked,
    }),
  );
  section.append(heading);

  section.append(ruleList(input));
  return section;
}

function ruleList(input: RulesViewInput): HTMLElement {
  const list = element("div", "rule-list");
  if (input.rules.length === 0) {
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
      actionButton("Choose a preset", input.onBrowsePresets, {
        className: "primary",
      }),
      actionButton("Write your own", input.onAdd),
    );
    empty.append(icon, emptyTitle, emptyCopy, actions);
    list.append(empty);
    return list;
  }

  input.rules.forEach((rule, index) => {
    list.append(ruleCard(rule, index, input));
  });
  return list;
}

function ruleCard(
  rule: RegexRule,
  index: number,
  input: RulesViewInput,
): HTMLElement {
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
  if (rule.closePolicy.kind !== "close-new") {
    const advanced = element("span", "advanced-rule-badge");
    advanced.textContent = "+ Advanced rules";
    advanced.title =
      rule.closePolicy.kind === "close-old-when-new-tab-matches"
        ? "This rule has an additional new-tab condition."
        : "This rule has advanced close behavior.";
    identity.append(advanced);
  }

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = rule.enabled;
  toggle.disabled = input.locked;
  toggle.setAttribute(
    "aria-label",
    `${rule.enabled ? "Disable" : "Enable"} ${rule.name}`,
  );
  toggle.addEventListener("change", () => {
    input.onToggle(rule, toggle.checked);
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
    actionButton("↑", () => input.onMove(index, -1), {
      ariaLabel: `Move ${rule.name} up`,
      className: "icon-button",
      disabled: input.locked || index === 0,
    }),
    actionButton("↓", () => input.onMove(index, 1), {
      ariaLabel: `Move ${rule.name} down`,
      className: "icon-button",
      disabled: input.locked || index === input.rules.length - 1,
    }),
    actionButton("Edit", () => input.onEdit(rule), {
      ariaLabel: `Edit ${rule.name}`,
      disabled: input.locked,
    }),
  );
  if (input.confirmDeleteId === rule.id) {
    const prompt = element("span", "delete-prompt");
    prompt.textContent = "Delete this rule?";
    actions.append(
      prompt,
      actionButton("Delete", () => input.onDelete(rule.id), {
        ariaLabel: `Confirm delete ${rule.name}`,
        className: "danger",
        disabled: input.locked,
      }),
      actionButton("Keep", input.onCancelDelete, {
        ariaLabel: "Cancel delete",
        disabled: input.locked,
      }),
    );
  } else {
    actions.append(
      actionButton("Delete", () => input.onRequestDelete(rule.id), {
        ariaLabel: `Delete ${rule.name}`,
        className: "quiet-danger",
        disabled: input.locked,
      }),
    );
  }
  card.append(top, expression, actions);
  return card;
}
