export function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function actionButton(
  label: string,
  action: () => void,
  options: {
    readonly ariaLabel?: string;
    readonly className?: string;
    readonly disabled?: boolean;
    readonly type?: "button" | "submit";
  } = {},
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = options.type ?? "button";
  button.textContent = label;
  button.disabled = options.disabled ?? false;
  if (options.ariaLabel !== undefined) {
    button.setAttribute("aria-label", options.ariaLabel);
    button.title = options.ariaLabel;
  }
  if (options.className !== undefined) {
    button.className = options.className;
  }
  if (button.type !== "submit") {
    button.addEventListener("click", action);
  }
  return button;
}

export function textField(input: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly multiline?: boolean;
  readonly hint?: string;
}): HTMLElement {
  const label = document.createElement("label");
  label.className = "field";
  const text = document.createElement("span");
  text.textContent = input.label;
  const control = input.multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  control.name = input.name;
  control.value = input.value;
  control.spellcheck = false;
  if (control instanceof HTMLTextAreaElement) {
    const resize = (): void => {
      control.style.height = "auto";
      control.style.height = `${Math.max(control.scrollHeight, 74)}px`;
    };
    control.addEventListener("input", resize);
    queueMicrotask(resize);
  }
  label.append(text, control);
  if (input.hint !== undefined) {
    const hint = document.createElement("small");
    hint.textContent = input.hint;
    label.append(hint);
  }
  return label;
}

export function externalLink(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "support-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard === undefined) {
    throw new Error("Clipboard access is unavailable.");
  }
  await navigator.clipboard.writeText(text);
}
