import { describe, expect, it } from "vitest";
import { RULE_PRESETS } from "../../src/domain/presets";
import { createRuleId, validateRuleSet } from "../../src/domain/rules";

const cases = [
  {
    name: "Switch to new GitHub comment",
    urls: [
      "https://github.com/Contour-AI/contour/pull/416/files#diff-2292a13f56079d182f3cf5ef5ed978cf8df5e65188bc30dd698ba7adc7aad6beR55",
      "https://github.com/Contour-AI/contour/pull/416/files#diff-773b358b7231a4c9151bd7f02151402a336b7d5fa4e1393d3480d2e529387305R91",
    ],
    identity: "Contour-AI/contour/pull/416",
  },
  {
    name: "Same GitHub pull request",
    urls: [
      "https://github.com/acme/widgets/pull/42/files",
      "https://github.com/acme/widgets/pull/42?diff=split",
    ],
    identity: "acme/widgets/pull/42",
  },
  {
    name: "Same URL without query or fragment",
    urls: [
      "https://example.com/docs/page?source=email",
      "https://example.com/docs/page#install",
    ],
    identity: "https://example.com/docs/page",
  },
  {
    name: "Same GitHub issue",
    urls: [
      "https://github.com/acme/widgets/issues/19#issuecomment-1",
      "https://github.com/acme/widgets/issues/19?notification_referrer_id=1",
    ],
    identity: "acme/widgets/issues/19",
  },
  {
    name: "Same YouTube video",
    urls: [
      "https://www.youtube.com/watch?v=abc123&t=90",
      "https://youtube.com/watch?list=favorites&v=abc123",
    ],
    identity: "abc123",
  },
  {
    name: "Same Google document",
    urls: [
      "https://docs.google.com/document/d/document-id/edit",
      "https://docs.google.com/document/d/document-id/preview",
    ],
    identity: "document-id",
  },
  {
    name: "Same Jira issue",
    urls: [
      "https://issues.example.com/browse/WEB-123?focusedCommentId=1",
      "https://issues.example.com/browse/WEB-123#comment-2",
    ],
    identity: "WEB-123",
  },
] as const;

describe("rule presets", () => {
  it("contains valid regular expressions", () => {
    const rules = RULE_PRESETS.map((preset, index) => ({
      id: createRuleId(`preset-${index}`),
      name: preset.name,
      pattern: preset.pattern,
      flags: preset.flags,
      enabled: true,
      closePolicy: preset.closePolicy,
    }));

    expect(validateRuleSet(rules)).toEqual({ ok: true, rules });
  });

  it.each(cases)("identifies $name URLs consistently", (example) => {
    const preset = RULE_PRESETS.find(({ name }) => name === example.name);
    expect(preset).toBeDefined();

    const identities = example.urls.map(
      (url) => new RegExp(preset?.pattern ?? "", preset?.flags).exec(url)?.[1],
    );
    expect(identities).toEqual([example.identity, example.identity]);
  });

  it("orders likely choices first and keeps the specific GitHub rule last in its group", () => {
    expect(RULE_PRESETS.map((preset) => preset.name)).toEqual([
      "Same YouTube video",
      "Same GitHub pull request",
      "Same GitHub issue",
      "Switch to new GitHub comment",
      "Same URL without query or fragment",
      "Same Google document",
      "Same Jira issue",
    ]);
    expect(
      RULE_PRESETS.find(
        (preset) => preset.name === "Switch to new GitHub comment",
      ),
    ).toMatchObject({
      category: "GitHub",
      closePolicy: {
        kind: "close-old-when-new-tab-matches",
      },
      description: expect.stringContaining(
        "PLACE ABOVE ANY GENERAL GITHUB RULE",
      ),
    });
  });

  it("uses a broad GitHub identity with a new-comment-only condition", () => {
    const preset = RULE_PRESETS.find(
      ({ name }) => name === "Switch to new GitHub comment",
    );
    expect(preset).toBeDefined();
    if (
      preset === undefined ||
      preset.closePolicy.kind !== "close-old-when-new-tab-matches"
    ) {
      return;
    }

    const identity = new RegExp(preset.pattern, preset.flags);
    const condition = new RegExp(
      preset.closePolicy.pattern,
      preset.closePolicy.flags,
    );
    const ordinary = "https://github.com/acme/widgets/pull/42/files";
    const diffComment =
      "https://github.com/acme/widgets/pull/42/files#diff-abc123R55";
    const reviewComment =
      "https://github.com/acme/widgets/pull/42#discussion_r3717711453";

    expect(identity.exec(ordinary)?.[1]).toBe("acme/widgets/pull/42");
    expect(identity.exec(diffComment)?.[1]).toBe("acme/widgets/pull/42");
    expect(condition.test(ordinary)).toBe(false);
    expect(condition.test(diffComment)).toBe(true);
    expect(condition.test(reviewComment)).toBe(true);
  });
});
