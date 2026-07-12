import { describe, expect, it } from "vitest";
import { createRuleId, validateRuleSet } from "../../src/domain/rules";
import { RULE_PRESETS } from "../../src/presets";

const cases = [
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
    }));

    expect(validateRuleSet(rules)).toEqual({ ok: true, rules });
  });

  it.each(cases)("identifies $name URLs consistently", (example) => {
    const preset = RULE_PRESETS.find(({ name }) => name === example.name);
    expect(preset).toBeDefined();

    const identities = example.urls.map((url) =>
      new RegExp(preset?.pattern ?? "", preset?.flags).exec(url)?.[1],
    );
    expect(identities).toEqual([example.identity, example.identity]);
  });
});
