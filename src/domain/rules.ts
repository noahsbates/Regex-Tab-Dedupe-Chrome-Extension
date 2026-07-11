declare const ruleIdBrand: unique symbol;

export type RuleId = string & { readonly [ruleIdBrand]: "RuleId" };

export interface RegexRule {
  readonly id: RuleId;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly enabled: boolean;
}

export interface RuleDocument {
  readonly schemaVersion: 1;
  readonly writeId: string;
  readonly rules: readonly RegexRule[];
}

export interface DuplicateKey {
  readonly ruleId: RuleId;
  readonly identity: string;
}

export type UrlClassification =
  | { readonly kind: "unmatched" }
  | {
      readonly kind: "matched-without-identity";
      readonly ruleId: RuleId;
    }
  | { readonly kind: "identified"; readonly key: DuplicateKey };

export type RuleIssueField =
  | "document"
  | "enabled"
  | "flags"
  | "id"
  | "name"
  | "pattern";

export interface RuleValidationIssue {
  readonly field: RuleIssueField;
  readonly message: string;
  readonly ruleId?: string;
}

export type RuleValidationResult =
  | { readonly ok: true; readonly rules: readonly RegexRule[] }
  | { readonly ok: false; readonly issues: readonly RuleValidationIssue[] };

export type RuleDocumentParseResult =
  | { readonly ok: true; readonly document: RuleDocument }
  | { readonly ok: false; readonly issues: readonly RuleValidationIssue[] };

const MAX_NAME_LENGTH = 80;
const MAX_PATTERN_LENGTH = 4_096;
const MAX_FLAGS_LENGTH = 16;

export function createRuleId(value: string): RuleId {
  if (value.trim().length === 0) {
    throw new Error("Rule IDs cannot be empty.");
  }
  return value as RuleId;
}

export function isEligibleUrl(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function classifyUrl(input: {
  readonly url: string;
  readonly rules: readonly RegexRule[];
}): UrlClassification {
  for (const rule of input.rules) {
    if (!rule.enabled) {
      continue;
    }

    const expression = new RegExp(rule.pattern, rule.flags);
    const match = expression.exec(input.url);
    if (match === null) {
      continue;
    }

    const identity = match.length === 1 ? match[0] : match[1];
    if (identity === undefined || identity.length === 0) {
      return { kind: "matched-without-identity", ruleId: rule.id };
    }

    return {
      kind: "identified",
      key: { ruleId: rule.id, identity },
    };
  }

  return { kind: "unmatched" };
}

export function duplicateKeysEqual(
  left: DuplicateKey,
  right: DuplicateKey,
): boolean {
  return left.ruleId === right.ruleId && left.identity === right.identity;
}

export function validateRuleSet(
  rules: readonly RegexRule[],
): RuleValidationResult {
  const issues: RuleValidationIssue[] = [];
  const ids = new Set<string>();

  for (const rule of rules) {
    if (ids.has(rule.id)) {
      issues.push({
        field: "id",
        ruleId: rule.id,
        message: "Rule IDs must be unique.",
      });
    } else {
      ids.add(rule.id);
    }

    if (rule.name.trim().length === 0) {
      issues.push({
        field: "name",
        ruleId: rule.id,
        message: "Enter a rule name.",
      });
    } else if (rule.name.length > MAX_NAME_LENGTH) {
      issues.push({
        field: "name",
        ruleId: rule.id,
        message: `Rule names cannot exceed ${MAX_NAME_LENGTH} characters.`,
      });
    }

    if (rule.pattern.length === 0) {
      issues.push({
        field: "pattern",
        ruleId: rule.id,
        message: "Enter a regular expression.",
      });
    } else if (rule.pattern.length > MAX_PATTERN_LENGTH) {
      issues.push({
        field: "pattern",
        ruleId: rule.id,
        message: `Patterns cannot exceed ${MAX_PATTERN_LENGTH} characters.`,
      });
    } else {
      try {
        new RegExp(rule.pattern, rule.flags);
      } catch (error) {
        issues.push({
          field: isFlagError(error) ? "flags" : "pattern",
          ruleId: rule.id,
          message: error instanceof Error ? error.message : "Invalid expression.",
        });
      }
    }

    if (rule.flags.length > MAX_FLAGS_LENGTH) {
      issues.push({
        field: "flags",
        ruleId: rule.id,
        message: `Flags cannot exceed ${MAX_FLAGS_LENGTH} characters.`,
      });
    }
  }

  return issues.length === 0 ? { ok: true, rules } : { ok: false, issues };
}

export function parseRuleDocument(value: unknown): RuleDocumentParseResult {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return invalidDocument("Unknown or invalid rule document version.");
  }
  if (typeof value.writeId !== "string" || value.writeId.length === 0) {
    return invalidDocument("The rule document has no valid write ID.");
  }
  if (!Array.isArray(value.rules)) {
    return invalidDocument("The rule document has no rule list.");
  }

  const parsedRules: RegexRule[] = [];
  for (const rawRule of value.rules) {
    const parsed = parseRule(rawRule);
    if (parsed === null) {
      return invalidDocument("The rule document contains an invalid rule.");
    }
    parsedRules.push(parsed);
  }

  const validated = validateRuleSet(parsedRules);
  if (!validated.ok) {
    return { ok: false, issues: validated.issues };
  }

  return {
    ok: true,
    document: {
      schemaVersion: 1,
      writeId: value.writeId,
      rules: validated.rules,
    },
  };
}

export function createEmptyRuleDocument(): RuleDocument {
  return { schemaVersion: 1, writeId: "empty", rules: [] };
}

function parseRule(value: unknown): RegexRule | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.pattern !== "string" ||
    typeof value.flags !== "string" ||
    typeof value.enabled !== "boolean"
  ) {
    return null;
  }

  try {
    return {
      id: createRuleId(value.id),
      name: value.name,
      pattern: value.pattern,
      flags: value.flags,
      enabled: value.enabled,
    };
  } catch {
    return null;
  }
}

function invalidDocument(message: string): RuleDocumentParseResult {
  return {
    ok: false,
    issues: [{ field: "document", message }],
  };
}

function isFlagError(error: unknown): boolean {
  return error instanceof SyntaxError && /flag/i.test(error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
