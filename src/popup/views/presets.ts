import {
  isPresetInstalled,
  PRESET_FILTERS,
  type PresetFilter,
  RULE_PRESETS,
  type RulePreset,
} from "../../domain/presets";
import type { RegexRule } from "../../domain/rules";
import { actionButton, element } from "../dom";

export interface PresetsViewInput {
  readonly rules: readonly RegexRule[];
  readonly filter: PresetFilter;
  readonly saving: boolean;
  readonly onFilter: (filter: PresetFilter) => void;
  readonly onApply: (preset: RulePreset) => void;
}

export function presetsView(input: PresetsViewInput): HTMLElement {
  const section = element("section", "page presets-page");
  const heading = element("div", "page-heading preset-heading");
  const titleBlock = element("div", "page-title");
  const title = document.createElement("h2");
  title.textContent = "Presets";
  const copy = document.createElement("p");
  copy.textContent = "Apply a preset to add it to your rules right away.";
  titleBlock.append(title, copy);
  heading.append(titleBlock);

  const filters = element("div", "preset-filters");
  const filterLabel = document.createElement("span");
  filterLabel.textContent = "Filter presets";
  const filterButtons = element("div", "filter-buttons");
  filterButtons.setAttribute("role", "group");
  filterButtons.setAttribute("aria-label", "Filter presets by category");
  for (const filter of PRESET_FILTERS) {
    const filterButton = actionButton(filter, () => input.onFilter(filter), {
      className: "filter-button",
    });
    filterButton.setAttribute("aria-pressed", String(input.filter === filter));
    filterButtons.append(filterButton);
  }
  filters.append(filterLabel, filterButtons);

  const grid = element("div", "preset-list");
  const filteredPresets = RULE_PRESETS.filter(
    (preset) => input.filter === "All" || preset.category === input.filter,
  );
  const visiblePresets = [
    ...filteredPresets.filter(
      (preset) => !isPresetInstalled(input.rules, preset),
    ),
    ...filteredPresets.filter((preset) =>
      isPresetInstalled(input.rules, preset),
    ),
  ];
  for (const preset of visiblePresets) {
    grid.append(presetCard(preset, input));
  }
  section.append(heading, filters, grid);
  return section;
}

function presetCard(preset: RulePreset, input: PresetsViewInput): HTMLElement {
  const installed = isPresetInstalled(input.rules, preset);
  const card = element(
    "article",
    installed ? "preset-card installed" : "preset-card",
  );
  const top = element("div", "preset-card-top");
  const category = element(
    "span",
    `category-badge category-${preset.category.toLowerCase()}`,
  );
  category.textContent = preset.category;
  const name = document.createElement("h3");
  name.textContent = preset.name;
  top.append(category, name);
  const description = document.createElement("p");
  description.textContent = preset.description;
  const pattern = document.createElement("code");
  pattern.textContent = `/${preset.pattern}/${preset.flags}`;
  const applyButton = actionButton(
    installed ? "Added" : "Apply preset",
    () => input.onApply(preset),
    {
      ariaLabel: installed
        ? `${preset.name} preset already added`
        : `Apply ${preset.name} preset`,
      className: "use-preset",
      disabled: input.saving || installed,
    },
  );
  card.append(top, description, pattern, applyButton);
  return card;
}
