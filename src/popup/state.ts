import type { ClosePolicy, RuleId } from "../domain/rules";
import type { LoadedSettings } from "../storage/settings";

export interface RuleDraft {
  readonly id: RuleId;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly enabled: boolean;
  readonly closePolicy: ClosePolicy;
}

export type EditorState =
  | { readonly kind: "adding"; readonly draft: RuleDraft }
  | { readonly kind: "editing"; readonly draft: RuleDraft }
  | { readonly kind: "none" };

export type PopupView = "presets" | "rules";

export type NoticeState =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "none" }
  | { readonly kind: "warning"; readonly message: string };

export function noticeFor(loaded: LoadedSettings): NoticeState {
  if (loaded.diagnostics.length > 0) {
    return { kind: "error", message: loaded.diagnostics.join(" ") };
  }
  if (loaded.source === "local-pending") {
    return { kind: "warning", message: "Saved locally. Sync pending." };
  }
  return { kind: "none" };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
