import type { ClosePolicy } from "./domain/rules";

export const AI_RULE_PROMPT = `Create a JavaScript regex for Regex Tab Dedupe. Capture the stable duplicate identity from the original HTTP(S) URL in capture group 1. The identity must never be empty. Return only the regex pattern and flags.

Describe what you want here: `;

export function createAiRuleEditPrompt(input: {
  readonly pattern: string;
  readonly flags: string;
  readonly closePolicy: ClosePolicy;
}): string {
  return `Edit this JavaScript regex for Regex Tab Dedupe. Capture the stable duplicate identity from the original HTTP(S) URL in capture group 1. The identity must never be empty. Return only the revised regex pattern and flags.

Current regex: /${input.pattern}/${input.flags}
${closePolicyContext(input.closePolicy)}

Describe what you want to change here: `;
}

function closePolicyContext(policy: ClosePolicy): string {
  switch (policy.kind) {
    case "close-new":
      return "Duplicate action: keep the old tab and close the new tab.";
    case "close-old":
      return "Duplicate action: close the old tab and keep the new tab.";
    case "close-old-when-new-tab-matches":
      return `Duplicate action: close the old tab only when the new tab matches this condition: /${policy.pattern}/${policy.flags}`;
  }
}
