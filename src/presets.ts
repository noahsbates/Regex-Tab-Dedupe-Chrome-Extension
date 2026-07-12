export type PresetCategory = "Developer" | "Everyday" | "Productivity";
export type PresetFilter = "All" | PresetCategory;

export const PRESET_FILTERS: readonly PresetFilter[] = [
  "All",
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
}

export const RULE_PRESETS: readonly RulePreset[] = [
  {
    category: "Developer",
    name: "Same GitHub pull request",
    description: "Treat every view of one pull request as the same tab.",
    pattern: String.raw`^https://github\.com/([^/?#]+/[^/?#]+/pull/\d+)(?:[/?#]|$)`,
    flags: "i",
  },
  {
    category: "Everyday",
    name: "Same URL without query or fragment",
    description: "Ignore tracking parameters, searches, and page anchors.",
    pattern: String.raw`^(https?://[^?#]+)`,
    flags: "i",
  },
  {
    category: "Developer",
    name: "Same GitHub issue",
    description: "Keep one tab for each issue, regardless of its sub-view.",
    pattern: String.raw`^https://github\.com/([^/?#]+/[^/?#]+/issues/\d+)(?:[/?#]|$)`,
    flags: "i",
  },
  {
    category: "Everyday",
    name: "Same YouTube video",
    description: "Ignore playlist, timestamp, and sharing parameters.",
    pattern: String.raw`^https?://(?:www\.)?youtube\.com/watch\?(?=[^#]*\bv=([^&#]+))`,
    flags: "i",
  },
  {
    category: "Productivity",
    name: "Same Google document",
    description: "Keep one tab for each Google Docs document.",
    pattern: String.raw`^https://docs\.google\.com/document/d/([^/?#]+)`,
    flags: "i",
  },
  {
    category: "Developer",
    name: "Same Jira issue",
    description: "Keep one tab for each Jira issue key on any Jira host.",
    pattern: String.raw`^https?://[^/]+/browse/([A-Z][A-Z0-9]+-\d+)(?:[/?#]|$)`,
    flags: "",
  },
];
