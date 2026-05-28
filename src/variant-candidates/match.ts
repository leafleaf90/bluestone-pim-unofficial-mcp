export interface AttributeDefinitionRef {
  id: string;
  name: string;
}

export interface MatchingProfile {
  brandDefinitionId?: string;
  productTypeDefinitionId?: string;
  specDefinitionIds: string[];
  minTitleSimilarity: number;
  minSpecOverlap: number;
}

export interface ProductSnapshot {
  id: string;
  name: string;
  number?: string;
  type: string;
  categories: string[];
  attributes: Map<string, string>;
  variantIds: string[];
}

export type MatchConfidence = "high" | "medium" | "low";

export interface VariantGroupCandidate {
  singleProductId: string;
  singleName: string;
  singleNumber?: string;
  groupProductId: string;
  groupName: string;
  groupNumber?: string;
  existingVariantCount: number;
  confidence: MatchConfidence;
  titleSimilarity: number;
  specOverlap: number | null;
  reasons: string[];
  cautions: string[];
}

const BRAND_NAME_PATTERNS = [/^brand$/i, /^manufacturer$/i, /^make$/i];
const PRODUCT_TYPE_NAME_PATTERNS = [
  /^product type$/i,
  /^item type$/i,
  /^product family$/i,
];
const SPEC_NAME_PATTERNS = [
  /dimension/i,
  /^width$/i,
  /^height$/i,
  /^depth$/i,
  /^length$/i,
  /^weight$/i,
  /^volume$/i,
  /^diameter$/i,
  /^spec/i,
  /technical/i,
  /material$/i,
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

export function titleSimilarity(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const tokensA = tokenSet(a);
  const tokensB = tokenSet(b);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  const containsScore = longer.includes(shorter) ? 0.95 : 0;

  return Math.max(jaccard, containsScore);
}

export function categoriesOverlap(
  left: string[],
  right: string[]
): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((categoryId) => rightSet.has(categoryId));
}

function attributeValue(values?: string[], dictionary?: string[]): string | undefined {
  const parts = [...(values ?? []), ...(dictionary ?? [])]
    .map((value) => value.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  return normalizeText(parts.join(" "));
}

export function snapshotFromProduct(input: {
  id: string;
  name?: string;
  number?: string;
  type?: string;
  categories?: string[];
  attributes?: Array<{
    definitionId: string;
    values?: string[];
    dictionary?: string[];
  }>;
  productVariants?: unknown[];
}): ProductSnapshot {
  const attributes = new Map<string, string>();
  for (const attribute of input.attributes ?? []) {
    const value = attributeValue(attribute.values, attribute.dictionary);
    if (value) {
      attributes.set(attribute.definitionId, value);
    }
  }

  const variantIds = (input.productVariants ?? []).flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }
    if (entry && typeof entry === "object" && "id" in entry) {
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    }
    return [];
  });

  return {
    id: input.id,
    name: input.name ?? input.id,
    ...(input.number && { number: input.number }),
    type: input.type ?? "SINGLE",
    categories: input.categories ?? [],
    attributes,
    variantIds,
  };
}

export function resolveMatchingProfile(
  definitions: AttributeDefinitionRef[],
  overrides: Partial<MatchingProfile> = {}
): MatchingProfile {
  const byName = (patterns: RegExp[]) =>
    definitions.find((definition) =>
      patterns.some((pattern) => pattern.test(definition.name.trim()))
    )?.id;

  const autoBrand = byName(BRAND_NAME_PATTERNS);
  const autoProductType = byName(PRODUCT_TYPE_NAME_PATTERNS);
  const autoSpecIds = definitions
    .filter((definition) =>
      SPEC_NAME_PATTERNS.some((pattern) => pattern.test(definition.name.trim()))
    )
    .map((definition) => definition.id)
    .slice(0, 12);

  return {
    brandDefinitionId: overrides.brandDefinitionId ?? autoBrand,
    productTypeDefinitionId:
      overrides.productTypeDefinitionId ?? autoProductType,
    specDefinitionIds:
      overrides.specDefinitionIds && overrides.specDefinitionIds.length > 0
        ? overrides.specDefinitionIds
        : autoSpecIds,
    minTitleSimilarity: overrides.minTitleSimilarity ?? 0.9,
    minSpecOverlap: overrides.minSpecOverlap ?? 0.6,
  };
}

function getAttribute(snapshot: ProductSnapshot, definitionId?: string): string | undefined {
  if (!definitionId) {
    return undefined;
  }
  return snapshot.attributes.get(definitionId);
}

export function specOverlapRatio(
  single: ProductSnapshot,
  group: ProductSnapshot,
  specDefinitionIds: string[]
): number | null {
  if (specDefinitionIds.length === 0) {
    return null;
  }

  let comparable = 0;
  let matches = 0;
  for (const definitionId of specDefinitionIds) {
    const singleValue = single.attributes.get(definitionId);
    const groupValue = group.attributes.get(definitionId);
    if (!singleValue || !groupValue) {
      continue;
    }
    comparable += 1;
    if (singleValue === groupValue) {
      matches += 1;
    }
  }

  if (comparable === 0) {
    return null;
  }
  return matches / comparable;
}

function rejectReason(
  single: ProductSnapshot,
  group: ProductSnapshot,
  profile: MatchingProfile,
  titleSim: number
): string | null {
  if (single.type !== "SINGLE") {
    return "Product is not a SINGLE.";
  }
  if (group.type !== "GROUP") {
    return "Target is not a GROUP.";
  }
  if (!categoriesOverlap(single.categories, group.categories)) {
    return "No shared category.";
  }

  const singleBrand = getAttribute(single, profile.brandDefinitionId);
  const groupBrand = getAttribute(group, profile.brandDefinitionId);
  if (singleBrand && groupBrand && singleBrand !== groupBrand) {
    return "Brand differs.";
  }

  const singleProductType = getAttribute(single, profile.productTypeDefinitionId);
  const groupProductType = getAttribute(group, profile.productTypeDefinitionId);
  if (
    singleProductType &&
    groupProductType &&
    singleProductType !== groupProductType
  ) {
    return "Product type differs.";
  }

  const overlap = specOverlapRatio(single, group, profile.specDefinitionIds);
  if (overlap !== null && overlap < profile.minSpecOverlap) {
    let comparable = 0;
    for (const definitionId of profile.specDefinitionIds) {
      if (
        single.attributes.has(definitionId) &&
        group.attributes.has(definitionId)
      ) {
        comparable += 1;
      }
    }
    if (comparable >= 2) {
      return "Key specs differ significantly.";
    }
  }

  if (titleSim < profile.minTitleSimilarity * 0.75) {
    return "Title similarity too low.";
  }

  return null;
}

function buildReasons(
  single: ProductSnapshot,
  group: ProductSnapshot,
  profile: MatchingProfile,
  titleSim: number,
  specOverlap: number | null
): string[] {
  const reasons: string[] = [];

  if (categoriesOverlap(single.categories, group.categories)) {
    reasons.push("Shared category");
  }
  if (titleSim >= profile.minTitleSimilarity) {
    reasons.push(`Title similarity ${Math.round(titleSim * 100)}%`);
  } else if (titleSim >= profile.minTitleSimilarity * 0.9) {
    reasons.push(`Title similarity ${Math.round(titleSim * 100)}% (borderline)`);
  }

  const singleBrand = getAttribute(single, profile.brandDefinitionId);
  const groupBrand = getAttribute(group, profile.brandDefinitionId);
  if (singleBrand && groupBrand && singleBrand === groupBrand) {
    reasons.push("Brand matches");
  }

  const singleProductType = getAttribute(single, profile.productTypeDefinitionId);
  const groupProductType = getAttribute(group, profile.productTypeDefinitionId);
  if (
    singleProductType &&
    groupProductType &&
    singleProductType === groupProductType
  ) {
    reasons.push("Product type matches");
  }

  if (specOverlap !== null && specOverlap >= profile.minSpecOverlap) {
    reasons.push(`Spec overlap ${Math.round(specOverlap * 100)}%`);
  }

  return reasons;
}

function buildCautions(
  single: ProductSnapshot,
  group: ProductSnapshot,
  profile: MatchingProfile,
  titleSim: number,
  specOverlap: number | null
): string[] {
  const cautions: string[] = [];

  if (titleSim < profile.minTitleSimilarity) {
    cautions.push(
      `Title similarity ${Math.round(titleSim * 100)}% is below the ${Math.round(profile.minTitleSimilarity * 100)}% threshold.`
    );
  }

  const singleBrand = getAttribute(single, profile.brandDefinitionId);
  const groupBrand = getAttribute(group, profile.brandDefinitionId);
  if (profile.brandDefinitionId && (!singleBrand || !groupBrand)) {
    cautions.push("Brand could not be compared on both products.");
  }

  if (
    profile.specDefinitionIds.length > 0 &&
    specOverlap === null
  ) {
    cautions.push("Not enough shared spec attributes to compare.");
  }

  if (group.variantIds.length === 0) {
    cautions.push("Variant group has no variants yet.");
  }

  return cautions;
}

function computeConfidence(
  profile: MatchingProfile,
  titleSim: number,
  specOverlap: number | null,
  reasons: string[],
  cautions: string[]
): MatchConfidence {
  const titlePass = titleSim >= profile.minTitleSimilarity;
  const specPass =
    specOverlap === null || specOverlap >= profile.minSpecOverlap;
  const brandReason = reasons.some((reason) => reason === "Brand matches");
  const typeReason = reasons.some((reason) => reason === "Product type matches");

  if (titlePass && specPass && brandReason && (typeReason || specOverlap !== null)) {
    return "high";
  }
  if (titlePass && specPass) {
    return "medium";
  }
  if (titleSim >= profile.minTitleSimilarity * 0.9 && cautions.length <= 2) {
    return "medium";
  }
  return "low";
}

export function evaluateVariantGroupCandidate(
  single: ProductSnapshot,
  group: ProductSnapshot,
  profile: MatchingProfile
): VariantGroupCandidate | null {
  const titleSim = titleSimilarity(single.name, group.name);
  const rejected = rejectReason(single, group, profile, titleSim);
  if (rejected) {
    return null;
  }

  const specOverlap = specOverlapRatio(single, group, profile.specDefinitionIds);
  const reasons = buildReasons(single, group, profile, titleSim, specOverlap);
  const cautions = buildCautions(single, group, profile, titleSim, specOverlap);
  const confidence = computeConfidence(
    profile,
    titleSim,
    specOverlap,
    reasons,
    cautions
  );

  if (reasons.length === 0) {
    return null;
  }

  return {
    singleProductId: single.id,
    singleName: single.name,
    ...(single.number && { singleNumber: single.number }),
    groupProductId: group.id,
    groupName: group.name,
    ...(group.number && { groupNumber: group.number }),
    existingVariantCount: group.variantIds.length,
    confidence,
    titleSimilarity: Math.round(titleSim * 1000) / 1000,
    specOverlap:
      specOverlap === null ? null : Math.round(specOverlap * 1000) / 1000,
    reasons,
    cautions,
  };
}

export function rankVariantGroupCandidates(
  single: ProductSnapshot,
  groups: ProductSnapshot[],
  profile: MatchingProfile,
  maxGroupsPerSingle: number
): VariantGroupCandidate[] {
  const candidates = groups
    .map((group) => evaluateVariantGroupCandidate(single, group, profile))
    .filter((candidate): candidate is VariantGroupCandidate => candidate !== null)
    .sort((left, right) => {
      const confidenceRank: Record<MatchConfidence, number> = {
        high: 3,
        medium: 2,
        low: 1,
      };
      const confidenceDiff =
        confidenceRank[right.confidence] - confidenceRank[left.confidence];
      if (confidenceDiff !== 0) {
        return confidenceDiff;
      }
      return right.titleSimilarity - left.titleSimilarity;
    });

  return candidates.slice(0, maxGroupsPerSingle);
}

export function confidenceMeetsMinimum(
  confidence: MatchConfidence,
  minimum: MatchConfidence
): boolean {
  const rank: Record<MatchConfidence, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };
  return rank[confidence] >= rank[minimum];
}

export function buildVariantCandidatePresentationHint(
  suggestionCount: number
): string | undefined {
  if (suggestionCount <= 3) {
    return undefined;
  }
  return (
    "Open a Cursor Canvas beside the chat for variant group candidate results: " +
    "summary stats (singles scanned, groups compared, suggestion count), confidence filter pills, " +
    "and cards showing each SINGLE → GROUP match with reasons and cautions. " +
    "Keep chat to a short intro and point the user to the canvas."
  );
}
