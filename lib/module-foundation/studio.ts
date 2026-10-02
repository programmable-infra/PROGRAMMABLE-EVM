import type { FoundationConfiguration, FoundationLaunchDraft, FoundationModuleDescriptor, FoundationModuleSelection } from "./ui-types";

export const FOUNDATION_STUDIO_EXTENSION = "programmable.module-studio@1";
export const FOUNDATION_STUDIO_CATEGORIES = ["trading", "fees", "supply", "liquidity", "other"] as const;
export type FoundationStudioCategory = typeof FOUNDATION_STUDIO_CATEGORIES[number];
export interface FoundationStudioPresentation { category: FoundationStudioCategory }
export type FoundationStudioDraft = Omit<FoundationLaunchDraft, "image" | "quoteAsset" | "creatorFeeBps" | "creatorBuyFeeBps" | "creatorSellFeeBps"> & {
  creatorFeeBps: number; quoteAsset: string; image: FoundationLaunchDraft["image"] | null;
};

/** Signed display metadata only. It never grants a capability or changes execution. */
export function foundationStudioPresentation(extensions: unknown, capabilities: readonly string[]): FoundationStudioPresentation {
  const raw = extensions && typeof extensions === "object" && FOUNDATION_STUDIO_EXTENSION in extensions
    ? (extensions as Record<string, unknown>)[FOUNDATION_STUDIO_EXTENSION] : null;
  const category = raw && typeof raw === "object" && "category" in raw ? raw.category : undefined;
  if (FOUNDATION_STUDIO_CATEGORIES.some(value => value === category)) return { category: category as FoundationStudioCategory };
  return { category: capabilities.some(value => value.endsWith(".before-swap@1") || value.endsWith(".after-swap@1")) ? "trading" : "other" };
}

export function foundationStudioSelection(descriptor: FoundationModuleDescriptor, configuration?: FoundationConfiguration): FoundationModuleSelection {
  return { id: descriptor.id, version: descriptor.version, digest: descriptor.digest,
    configuration: configuration ?? Object.fromEntries(descriptor.fields.map(field => [field.key, field.defaultValue ?? (field.kind === "boolean" ? false : "")])) };
}

export function foundationStudioModules(catalog: readonly FoundationModuleDescriptor[], category: "all" | FoundationStudioCategory) {
  return catalog.filter(item => category === "all" || (item.studio?.category ?? "other") === category)
    .toSorted((a, b) => FOUNDATION_STUDIO_CATEGORIES.indexOf(a.studio?.category ?? "other") - FOUNDATION_STUDIO_CATEGORIES.indexOf(b.studio?.category ?? "other")
      || a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
}
