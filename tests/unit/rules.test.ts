import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  createRuleId,
  isEligibleUrl,
  validateRuleSet,
  type RegexRule,
} from "../../src/domain/rules";

function rule(
  id: string,
  pattern: string,
  options: { enabled?: boolean; flags?: string } = {},
): RegexRule {
  return {
    id: createRuleId(id),
    name: id,
    pattern,
    flags: options.flags ?? "",
    enabled: options.enabled ?? true,
  };
}

describe("classifyUrl", () => {
  it("uses the first capture group as the identity", () => {
    const result = classifyUrl({
      url: "https://github.com/acme/app/pull/42/files?diff=split",
      rules: [
        rule(
          "github-pr",
          String.raw`^https://github\.com/([^/?#]+/[^/?#]+/pull/\d+)`,
          { flags: "i" },
        ),
      ],
    });

    expect(result).toEqual({
      kind: "identified",
      key: {
        ruleId: "github-pr",
        identity: "acme/app/pull/42",
      },
    });
  });

  it("uses the full match when the rule has no captures", () => {
    const result = classifyUrl({
      url: "https://example.com/docs?from=mail",
      rules: [rule("docs", String.raw`^https://example\.com/docs`)],
    });

    expect(result).toEqual({
      kind: "identified",
      key: {
        ruleId: "docs",
        identity: "https://example.com/docs",
      },
    });
  });

  it("stops at the first matching rule when capture one is absent", () => {
    const result = classifyUrl({
      url: "https://example.com/docs",
      rules: [
        rule("optional", String.raw`^https://example\.com/(missing)?docs`),
        rule("fallback", String.raw`^(https://example\.com/docs)`),
      ],
    });

    expect(result).toEqual({
      kind: "matched-without-identity",
      ruleId: "optional",
    });
  });

  it("does not identify an empty capture", () => {
    const result = classifyUrl({
      url: "https://example.com/docs",
      rules: [rule("empty", String.raw`^https://example\.com/()docs`)],
    });

    expect(result).toEqual({
      kind: "matched-without-identity",
      ruleId: "empty",
    });
  });

  it("skips disabled rules and scopes identities by rule id", () => {
    const disabled = classifyUrl({
      url: "https://example.com/42",
      rules: [
        rule("disabled", String.raw`/(\d+)`, { enabled: false }),
        rule("enabled", String.raw`/(\d+)`),
      ],
    });
    const otherRule = classifyUrl({
      url: "https://other.test/42",
      rules: [rule("other", String.raw`/(\d+)`)],
    });

    expect(disabled).toMatchObject({
      kind: "identified",
      key: { ruleId: "enabled", identity: "42" },
    });
    expect(otherRule).toMatchObject({
      kind: "identified",
      key: { ruleId: "other", identity: "42" },
    });
  });

  it("keeps global and sticky rules deterministic across calls", () => {
    const global = rule("global", String.raw`https://example\.com/(\w+)`, {
      flags: "g",
    });

    expect(
      classifyUrl({ url: "https://example.com/alpha", rules: [global] }),
    ).toEqual(
      classifyUrl({ url: "https://example.com/alpha", rules: [global] }),
    );
  });
});

describe("rule boundaries", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com/path", true],
    ["chrome://newtab", false],
    ["file:///tmp/example", false],
    ["data:text/plain,hello", false],
    ["not a url", false],
  ])("classifies %s eligibility", (url, expected) => {
    expect(isEligibleUrl(url)).toBe(expected);
  });

  it("rejects malformed regex rules", () => {
    const result = validateRuleSet([
      rule("broken", "["),
      rule("duplicate", "ok"),
      rule("duplicate", "still-ok"),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.field)).toEqual([
        "pattern",
        "id",
      ]);
    }
  });
});
