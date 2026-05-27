interface Credentials {
  papiKey: string;
  mapiClientId: string;
  mapiClientSecret: string;
}

type MapiGetFn = <T>(
  url: string,
  creds: Credentials,
  options?: { context?: string }
) => Promise<T>;

export type ValidationType =
  | "INVALID_ATTRIBUTE_VALUE"
  | "MISSING_CATEGORY_ATTRIBUTE"
  | "MISSING_CATEGORY_VALUE"
  | "INVALID_CATEGORY_VALUE"
  | "MISSING_COMPOUND_ATTRIBUTE"
  | "MISSING_VARIANT_ATTRIBUTE"
  | "MISSING_VARIANT_VALUE"
  | "INVALID_VARIANT_VALUE"
  | "DICTIONARY_VALUE_NOT_EXIST_IN_FILTER";

export type ValidationIssueKind = "CLA" | "VLA" | "Attribute" | "Compound" | "Dictionary";

export interface RawValidationIssue {
  validationType: ValidationType;
  validationDetails: Record<string, unknown>;
}

export interface ShapedValidationIssue {
  validationType: ValidationType;
  kind: ValidationIssueKind;
  attributeName: string;
  definitionId: string;
  summary: string;
  categoryId?: string;
  variantParentId?: string;
  compoundParentId?: string;
  invalidDictionaryValueIds?: string[];
  restrictionTypes?: string[];
}

const RESTRICTION_LABELS: Record<string, string> = {
  MIN_VALUE_OUT_OF_RANGE: "Value below minimum",
  MAX_VALUE_OUT_OF_RANGE: "Value above maximum",
  EXCEEDED_CHARACTER_LIMIT: "Text exceeds character limit",
  WHITE_SPACES_NOT_ALLOWED: "Leading or trailing spaces not allowed",
  INVALID_FORMAT: "Invalid format",
  PATTERN_NOT_MATCHED: "Value does not match required pattern",
  INVALID_STEP: "Value does not match allowed step",
};

export function validationIssueKind(validationType: ValidationType): ValidationIssueKind {
  switch (validationType) {
    case "MISSING_CATEGORY_ATTRIBUTE":
    case "MISSING_CATEGORY_VALUE":
    case "INVALID_CATEGORY_VALUE":
      return "CLA";
    case "MISSING_VARIANT_ATTRIBUTE":
    case "MISSING_VARIANT_VALUE":
    case "INVALID_VARIANT_VALUE":
      return "VLA";
    case "MISSING_COMPOUND_ATTRIBUTE":
      return "Compound";
    case "DICTIONARY_VALUE_NOT_EXIST_IN_FILTER":
      return "Dictionary";
    default:
      return "Attribute";
  }
}

function validationIssueSummary(
  validationType: ValidationType,
  attributeName: string
): string {
  switch (validationType) {
    case "MISSING_CATEGORY_ATTRIBUTE":
      return `Attribute ${attributeName} is required by a category level attribute rule but is not on the product`;
    case "MISSING_CATEGORY_VALUE":
      return `Mandatory category level attribute ${attributeName} has no value on the product`;
    case "INVALID_CATEGORY_VALUE":
      return `Product value for ${attributeName} does not match the locked category level attribute`;
    case "MISSING_VARIANT_ATTRIBUTE":
      return `Attribute ${attributeName} is required on the variant by a variant level attribute rule`;
    case "MISSING_VARIANT_VALUE":
      return `Mandatory variant level attribute ${attributeName} has no value on the variant`;
    case "INVALID_VARIANT_VALUE":
      return `Variant value for ${attributeName} does not match the locked variant group value`;
    case "INVALID_ATTRIBUTE_VALUE":
      return `Value for ${attributeName} fails attribute definition restrictions`;
    case "MISSING_COMPOUND_ATTRIBUTE":
      return `Compound attribute ${attributeName} is missing a required sub-attribute`;
    case "DICTIONARY_VALUE_NOT_EXIST_IN_FILTER":
      return `Dictionary value for ${attributeName} is not allowed by the parent filter`;
    default:
      return `Validation issue for ${attributeName}`;
  }
}

export async function fetchAttributeDefinitionNames(
  definitionIds: string[],
  creds: Credentials,
  mapiGet: MapiGetFn,
  pimBase: string
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(definitionIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const entries = await Promise.all(
    uniqueIds.map(async (definitionId) => {
      try {
        const definition = await mapiGet<{ id: string; name: string }>(
          `${pimBase}/definitions/${definitionId}`,
          creds
        );
        return [definitionId, definition.name ?? definitionId] as const;
      } catch {
        return [definitionId, definitionId] as const;
      }
    })
  );

  return new Map(entries);
}

export function shapeValidationIssue(
  issue: RawValidationIssue,
  nameByDefinitionId: Map<string, string>
): ShapedValidationIssue {
  const details = issue.validationDetails ?? {};
  const definitionId =
    typeof details.definitionId === "string" ? details.definitionId : "unknown";
  const attributeName = nameByDefinitionId.get(definitionId) ?? definitionId;
  const restrictionIssues = Array.isArray(details.issues)
    ? details.issues
        .map((entry) =>
          entry && typeof entry === "object" && typeof (entry as { restrictionType?: string }).restrictionType === "string"
            ? (entry as { restrictionType: string }).restrictionType
            : null
        )
        .filter((value): value is string => value !== null)
    : [];

  return {
    validationType: issue.validationType,
    kind: validationIssueKind(issue.validationType),
    attributeName,
    definitionId,
    summary: validationIssueSummary(issue.validationType, attributeName),
    ...(typeof details.categoryId === "string" && { categoryId: details.categoryId }),
    ...(typeof details.variantParentId === "string" && {
      variantParentId: details.variantParentId,
    }),
    ...(typeof details.parentId === "string" && { compoundParentId: details.parentId }),
    ...(Array.isArray(details.invalidIds) && {
      invalidDictionaryValueIds: details.invalidIds.filter(
        (value): value is string => typeof value === "string"
      ),
    }),
    ...(restrictionIssues.length > 0 && {
      restrictionTypes: restrictionIssues.map(
        (type) => RESTRICTION_LABELS[type] ?? type
      ),
    }),
  };
}

export function countValidationIssuesByKind(
  issues: ShapedValidationIssue[]
): Record<ValidationIssueKind, number> {
  const counts: Record<ValidationIssueKind, number> = {
    CLA: 0,
    VLA: 0,
    Attribute: 0,
    Compound: 0,
    Dictionary: 0,
  };
  for (const issue of issues) {
    counts[issue.kind] += 1;
  }
  return counts;
}

export function buildValidationPresentationHint(options: {
  issueCount: number;
  productCount?: number;
}): Record<string, unknown> | undefined {
  const { issueCount, productCount = 1 } = options;
  const preferCanvas =
    issueCount > 5 || (productCount > 1 && productCount > 3);
  if (!preferCanvas) {
    return undefined;
  }
  return {
    preferCanvas: true,
    layout: "validation-issues",
    summaryCards: ["issueCount", "claCount", "vlaCount", "otherCount"],
    groupByKind: ["CLA", "VLA", "Attribute", "Compound", "Dictionary"],
    referenceCanvas: "canvases/bluestone-validation-issues.canvas.tsx",
  };
}
