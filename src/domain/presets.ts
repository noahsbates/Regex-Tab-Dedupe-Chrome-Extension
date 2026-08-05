import { type ClosePolicy, closePoliciesEqual, type RegexRule } from "./rules";

export type PresetCategory =
  | "Developer"
  | "Everyday"
  | "GitHub"
  | "Productivity";
export type PresetFilter = "All" | PresetCategory;

export const PRESET_FILTERS: readonly PresetFilter[] = [
  "All",
  "GitHub",
  "Developer",
  "Everyday",
  "Productivity",
];

export interface RulePreset {
  readonly category: PresetCategory;
  readonly description: string;
  readonly flags: string;
  readonly name: string;
  readonly pattern: string;
  readonly closePolicy: ClosePolicy;
}

export function isPresetInstalled(
  rules: readonly RegexRule[],
  preset: RulePreset,
): boolean {
  return rules.some(
    (rule) =>
      rule.pattern === preset.pattern &&
      rule.flags === preset.flags &&
      closePoliciesEqual(rule.closePolicy, preset.closePolicy),
  );
}

export const RULE_PRESETS: readonly RulePreset[] = [
  {
    category: "Everyday",
    name: "Same YouTube video",
    description: "Ignore playlist, timestamp, and sharing parameters.",
    pattern: String.raw`^https?://(?:www\.)?youtube\.com/watch\?(?=[^#]*\bv=([^&#]+))`,
    flags: "i",
    closePolicy: { kind: "close-new" },
  },
  {
    category: "GitHub",
    name: "Same GitHub pull request",
    description: "Treat every view of one pull request as the same tab.",
    pattern: String.raw`^https://github\.com/([^/?#]+/[^/?#]+/pull/\d+)(?:[/?#]|$)`,
    flags: "i",
    closePolicy: { kind: "close-new" },
  },
  {
    category: "GitHub",
    name: "Same GitHub issue",
    description: "Keep one tab for each issue, regardless of its sub-view.",
    pattern: String.raw`^https://github\.com/([^/?#]+/[^/?#]+/issues/\d+)(?:[/?#]|$)`,
    flags: "i",
    closePolicy: { kind: "close-new" },
  },
  {
    category: "GitHub",
    name: "Switch to new GitHub comment",
    description:
      "PLACE ABOVE ANY GENERAL GITHUB RULE. Keep a newly opened comment and close the older tab for that pull request.",
    pattern: String.raw`^https://github\.com/([^/?#]+/[^/?#]+/pull/\d+)(?:[/?#]|$)`,
    flags: "i",
    closePolicy: {
      kind: "close-old-when-new-tab-matches",
      pattern: String.raw`^https://github\.com/[^/?#]+/[^/?#]+/pull/\d+(?:/files(?:\?[^#]*)?#diff-[a-f0-9]+[LR]\d+(?:-[LR]\d+)?|(?:\?[^#]*)?#(?:discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+))$`,
      flags: "i",
    },
  },
  {
    category: "Everyday",
    name: "Same URL without query or fragment",
    description: "Ignore tracking parameters, searches, and page anchors.",
    pattern: "^(https?://[^?#]+)",
    flags: "i",
    closePolicy: { kind: "close-new" },
  },
  {
    category: "Productivity",
    name: "Same Google document",
    description: "Keep one tab for each Google Docs document.",
    pattern: String.raw`^https://docs\.google\.com/document/d/([^/?#]+)`,
    flags: "i",
    closePolicy: { kind: "close-new" },
  },
  {
    category: "Developer",
    name: "Same Jira issue",
    description: "Keep one tab for each Jira issue key on any Jira host.",
    pattern: String.raw`^https?://[^/]+/browse/([A-Z][A-Z0-9]+-\d+)(?:[/?#]|$)`,
    flags: "",
    closePolicy: { kind: "close-new" },
  },
];
