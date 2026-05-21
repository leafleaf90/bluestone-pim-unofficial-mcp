export interface QueryBuilderSearchRequest {
  query: QueryGroup;
  paging: {
    page: number;
    pageSize: number;
  };
}

export interface QueryGroup {
  matchRule: "all" | "any";
  children: QueryTerm[];
  not?: boolean;
  contextFallback?: boolean;
}

export interface QueryTerm {
  termType: string;
  filterType: string;
  not?: boolean;
  context?: string;
  from?: number;
  to?: number;
  value?: string[];
}

export type CategoryScope =
  | "catalog_with_subcategories"
  | "exact_category"
  | "uncategorized";

export interface ProductSearchFilters {
  categoryId?: string;
  categoryScope?: CategoryScope;
  completenessScore?: {
    context: string;
    min?: number;
    max?: number;
  };
  failingRequirements?: {
    context: string;
    requirementIds: string[];
  };
}

export interface QueryBuilderSearchRequest {
  query: QueryGroup;
  paging: {
    page: number;
    pageSize: number;
  };
}

function compileCategoryTerm(
  categoryId: string | undefined,
  categoryScope: CategoryScope | undefined
): QueryTerm {
  const scope = categoryScope ?? "catalog_with_subcategories";

  if (scope === "uncategorized") {
    return {
      termType: "category",
      filterType: "have_none",
    };
  }

  if (!categoryId) {
    throw new Error(
      "categoryId is required when categoryScope is catalog_with_subcategories or exact_category."
    );
  }

  if (scope === "exact_category") {
    return {
      termType: "category",
      filterType: "have_some",
      value: [categoryId],
    };
  }

  return {
    termType: "category",
    filterType: "have_some_with_children",
    value: [categoryId],
  };
}

function compileCompletenessScoreTerm(score: {
  context: string;
  min?: number;
  max?: number;
}): QueryTerm {
  const min = score.min ?? 0;
  const max = score.max ?? 100;

  if (min < 0 || max > 100 || min > max) {
    throw new Error(
      "completenessScoreMin and completenessScoreMax must be between 0 and 100, with min less than or equal to max."
    );
  }

  return {
    termType: "completeness_score",
    filterType: "between",
    context: score.context,
    from: min,
    to: max,
  };
}

function compileFailingRequirementsTerm(requirements: {
  context: string;
  requirementIds: string[];
}): QueryTerm {
  if (requirements.requirementIds.length === 0) {
    throw new Error("failingRequirementIds must contain at least one requirement ID.");
  }

  return {
    termType: "completeness_requirements",
    filterType: "not_meet_all",
    context: requirements.context,
    value: requirements.requirementIds,
  };
}

export function compileProductSearchQuery(filters: ProductSearchFilters): QueryGroup {
  const children: QueryTerm[] = [];

  if (filters.categoryId || filters.categoryScope === "uncategorized") {
    children.push(compileCategoryTerm(filters.categoryId, filters.categoryScope));
  }

  if (filters.completenessScore) {
    children.push(compileCompletenessScoreTerm(filters.completenessScore));
  }

  if (filters.failingRequirements) {
    children.push(compileFailingRequirementsTerm(filters.failingRequirements));
  }

  if (children.length === 0) {
    throw new Error(
      "At least one search filter is required: a category filter, completeness score range, or failing requirement IDs."
    );
  }

  return {
    matchRule: "all",
    children,
    contextFallback: true,
  };
}

export function describeSearchFilters(filters: ProductSearchFilters): string {
  const parts: string[] = [];

  if (filters.categoryScope === "uncategorized") {
    parts.push("without category");
  } else if (filters.categoryId) {
    parts.push(
      filters.categoryScope === "exact_category"
        ? "in exact category"
        : "in catalog including sub-categories"
    );
  }

  if (filters.completenessScore) {
    const min = filters.completenessScore.min ?? 0;
    const max = filters.completenessScore.max ?? 100;
    parts.push(
      `completeness score ${min}-${max} in context ${filters.completenessScore.context}`
    );
  }

  if (filters.failingRequirements) {
    parts.push(
      `failing ${filters.failingRequirements.requirementIds.length} requirement${filters.failingRequirements.requirementIds.length === 1 ? "" : "s"} in context ${filters.failingRequirements.context}`
    );
  }

  return parts.join(", ");
}
