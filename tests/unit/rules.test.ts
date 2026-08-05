import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  createRuleId,
  isEligibleUrl,
  parseRuleDocument,
  resolveCloseAction,
  serializeRuleDocument,
  validateRuleSet,
  type ClosePolicy,
  type RegexRule,
} from "../../src/domain/rules";

function rule(
  id: string,
  pattern: string,
  options: {
    closePolicy?: ClosePolicy;
    enabled?: boolean;
    flags?: string;
  } = {},
): RegexRule {
  return {
    id: createRuleId(id),
    name: id,
    pattern,
    flags: options.flags ?? "",
    enabled: options.enabled ?? true,
    closePolicy: options.closePolicy ?? { kind: "close-new" },
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
  it("defaults old stored rules to deleting the new tab", () => {
    const parsed = parseRuleDocument({
      schemaVersion: 1,
      writeId: "legacy",
      rules: [
        {
          id: "legacy-rule",
          name: "Legacy",
          pattern: "example",
          flags: "",
          enabled: true,
        },
      ],
    });

    expect(parsed).toMatchObject({
      ok: true,
      document: { rules: [{ closePolicy: { kind: "close-new" } }] },
    });
  });

  it("parses legacy and conditional close-old policies", () => {
    const parsed = parseRuleDocument({
      schemaVersion: 1,
      writeId: "policies",
      rules: [
        {
          id: "always",
          name: "Always",
          pattern: "example",
          flags: "",
          enabled: true,
          deleteOldTab: true,
        },
        {
          id: "conditional",
          name: "Conditional",
          pattern: "example",
          flags: "",
          enabled: true,
          deleteOldTab: false,
          deleteOldTabWhenNewTabMatches: {
            pattern: "#comment-\\d+$",
            flags: "i",
          },
        },
      ],
    });

    expect(parsed).toMatchObject({
      ok: true,
      document: {
        rules: [
          { closePolicy: { kind: "close-old" } },
          {
            closePolicy: {
              kind: "close-old-when-new-tab-matches",
              pattern: "#comment-\\d+$",
              flags: "i",
            },
          },
        ],
      },
    });
  });

  it("serializes conditional close-old as close-new for older builds", () => {
    const conditional = rule("conditional", "example", {
      closePolicy: {
        kind: "close-old-when-new-tab-matches",
        pattern: "#comment-\\d+$",
        flags: "i",
      },
    });

    expect(
      serializeRuleDocument({
        schemaVersion: 1,
        writeId: "write",
        rules: [conditional],
      }),
    ).toMatchObject({
      rules: [
        {
          deleteOldTab: false,
          deleteOldTabWhenNewTabMatches: {
            pattern: "#comment-\\d+$",
            flags: "i",
          },
        },
      ],
    });
  });

  it("uses a candidate-only regex to resolve the close direction", () => {
    const policy: ClosePolicy = {
      kind: "close-old-when-new-tab-matches",
      pattern: "#comment-\\d+$",
      flags: "",
    };

    expect(
      resolveCloseAction({
        policy,
        candidateUrl: "https://example.com/docs#comment-12",
      }),
    ).toBe("close-old");
    expect(
      resolveCloseAction({
        policy,
        candidateUrl: "https://example.com/docs",
      }),
    ).toBe("close-new");
  });

  it("rejects malformed new-tab conditions", () => {
    const result = validateRuleSet([
      rule("broken-condition", "example", {
        closePolicy: {
          kind: "close-old-when-new-tab-matches",
          pattern: "[",
          flags: "",
        },
      }),
    ]);

    expect(result).toMatchObject({
      ok: false,
      issues: [{ field: "newTabPattern" }],
    });
  });

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
