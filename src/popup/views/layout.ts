import { actionButton, element, externalLink } from "../dom";
import type { PopupLinks } from "../links";
import type { NoticeState, PopupView } from "../state";

export function appHeader(): HTMLElement {
  const header = element("header", "app-header");
  const brand = element("div", "brand");
  const logo = document.createElement("img");
  logo.className = "brand-logo";
  logo.src = "logo.png";
  logo.alt = "";
  logo.width = 38;
  logo.height = 38;

  const words = element("div", "brand-copy");
  const heading = document.createElement("h1");
  heading.textContent = "Regex Tab Dedupe";
  const tagline = document.createElement("p");
  tagline.textContent = "One tab per identity.";
  words.append(heading, tagline);
  brand.append(logo, words);

  header.append(brand);
  return header;
}

export function viewTabs(input: {
  readonly active: PopupView;
  readonly onSelect: (view: PopupView) => void;
}): HTMLElement {
  const navigation = element("nav", "view-tabs");
  navigation.setAttribute("role", "tablist");
  navigation.setAttribute("aria-label", "Extension pages");
  navigation.append(
    viewTab("RULES", "rules", "rules-tab", input),
    viewTab("PRESETS", "presets", "presets-tab", input),
  );
  return navigation;
}

function viewTab(
  label: string,
  target: PopupView,
  id: string,
  input: {
    readonly active: PopupView;
    readonly onSelect: (view: PopupView) => void;
  },
): HTMLButtonElement {
  const active = input.active === target;
  const tab = actionButton(label, () => input.onSelect(target), {
    className: active ? "view-tab active" : "view-tab",
  });
  tab.id = id;
  tab.tabIndex = active ? 0 : -1;
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", "active-view");
  tab.setAttribute("aria-selected", String(active));
  tab.addEventListener("keydown", (event) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    let nextView: PopupView;
    if (event.key === "Home") {
      nextView = "rules";
    } else if (event.key === "End") {
      nextView = "presets";
    } else {
      nextView = target === "rules" ? "presets" : "rules";
    }
    input.onSelect(nextView);
  });
  return tab;
}

export function attentionNotice(input: {
  readonly notice: NoticeState;
  readonly showRetry: boolean;
  readonly retryDisabled: boolean;
  readonly onRetry: () => void;
}): HTMLElement | null {
  const notice = input.notice;
  if (notice.kind === "none") {
    return null;
  }
  const banner = element("aside", `notice notice-${notice.kind}`);
  banner.setAttribute("role", notice.kind === "error" ? "alert" : "note");
  const copy = document.createElement("p");
  copy.textContent = notice.message;
  banner.append(copy);
  if (input.showRetry) {
    banner.append(
      actionButton("Retry sync", input.onRetry, {
        className: "compact-button",
        disabled: input.retryDisabled,
      }),
    );
  }
  return banner;
}

export function supportFooter(links: PopupLinks): HTMLElement {
  const footer = element("footer", "support-footer");
  const navigation = document.createElement("nav");
  navigation.setAttribute("aria-label", "Support links");
  const contributeLink = externalLink(
    "PR your feature",
    links.contributeFeature,
  );
  contributeLink.classList.add("support-link-contribute");
  navigation.append(
    externalLink("Report bug", links.reportBug),
    externalLink("Rate extension", links.rateExtension),
    externalLink("Request feature", links.requestFeature),
    contributeLink,
  );
  footer.append(navigation);
  return footer;
}
