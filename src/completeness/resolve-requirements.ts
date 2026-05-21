interface Credentials {
  papiKey: string;
  mapiClientId: string;
  mapiClientSecret: string;
}

interface MapiAttributeDefinitionName {
  id: string;
  name: string;
  number?: string;
  dataType?: string;
  group?: string;
}

interface MapiAttributeDefinitionResponse {
  id: string;
  name: string;
  number?: string;
  dataType?: string;
  group?: string;
}

interface MapiCompletenessRequirement {
  id: string;
  requirementType: string;
  params: Record<string, unknown>;
  weight: number;
}

interface MapiCompletenessRequirementsListResponse {
  data: MapiCompletenessRequirement[];
}

export interface RequirementResultInput {
  requirementId: string;
  weight: number;
  status: string;
}

export interface ResolvedRequirementResult {
  requirementId: string;
  name: string;
  requirementType: string;
  status: string;
  weight: number;
  unresolved: boolean;
  definitionId?: string;
}

type MapiGetFn = <T>(
  url: string,
  creds: Credentials,
  options?: { context?: string }
) => Promise<T>;

type MapiPostBodyFn = <T>(
  url: string,
  body: unknown,
  creds: Credentials,
  options?: { context?: string }
) => Promise<T>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function fetchAttributeDefinitionNames(
  definitionIds: string[],
  creds: Credentials,
  mapiGet: MapiGetFn,
  pimBase: string
): Promise<Map<string, MapiAttributeDefinitionName>> {
  const uniqueIds = [...new Set(definitionIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const definitions = await Promise.all(
    uniqueIds.map(async (definitionId) => {
      try {
        const definition = await mapiGet<MapiAttributeDefinitionResponse>(
          `${pimBase}/definitions/${definitionId}`,
          creds
        );
        return {
          id: definition.id,
          name: definition.name,
          ...(definition.number && { number: definition.number }),
          ...(definition.dataType && { dataType: definition.dataType }),
          ...(definition.group && { group: definition.group }),
        };
      } catch {
        return null;
      }
    })
  );

  return new Map(
    definitions
      .filter((definition): definition is MapiAttributeDefinitionName => definition !== null)
      .map((definition) => [definition.id, definition])
  );
}

function collectDefinitionIds(requirements: MapiCompletenessRequirement[]): string[] {
  const definitionIds: string[] = [];

  for (const requirement of requirements) {
    const params = asRecord(requirement.params);
    if (typeof params.definitionId === "string") {
      definitionIds.push(params.definitionId);
    }
  }

  return definitionIds;
}

function buildRequirementLabel(
  requirement: MapiCompletenessRequirement,
  attributeNames: Map<string, MapiAttributeDefinitionName>
): { name: string; definitionId?: string; unresolved: boolean } {
  const params = asRecord(requirement.params);

  switch (requirement.requirementType) {
    case "ATTRIBUTE_HAS_VALUE": {
      const definitionId =
        typeof params.definitionId === "string" ? params.definitionId : undefined;
      const attribute = definitionId ? attributeNames.get(definitionId) : undefined;
      if (attribute) {
        return {
          name: `Attribute "${attribute.name}" must have a value`,
          definitionId,
          unresolved: false,
        };
      }
      return {
        name: "Attribute must have a value",
        ...(definitionId && { definitionId }),
        unresolved: true,
      };
    }
    case "PERCENTAGE_OF_ATTRIBUTES_HAVE_VALUE": {
      const percentage = typeof params.percentage === "number" ? params.percentage : undefined;
      return {
        name:
          percentage !== undefined
            ? `${percentage}% of attributes must have values`
            : "Percentage of attributes must have values",
        unresolved: false,
      };
    }
    case "PERCENTAGE_OF_ATTRIBUTES_IN_GROUP_HAVE_VALUE": {
      const percentage = typeof params.percentage === "number" ? params.percentage : undefined;
      const groupId = typeof params.groupId === "string" ? params.groupId : undefined;
      const suffix = groupId ? ` in group ${groupId}` : "";
      return {
        name:
          percentage !== undefined
            ? `${percentage}% of attributes${suffix} must have values`
            : `Percentage of attributes${suffix} must have values`,
        unresolved: Boolean(groupId),
      };
    }
    case "MINIMUM_MEDIA_WITH_LABEL": {
      const mediaCount = typeof params.mediaCount === "number" ? params.mediaCount : undefined;
      const mediaLabelId =
        typeof params.mediaLabelId === "string" ? params.mediaLabelId : undefined;
      const labelSuffix = mediaLabelId ? ` with label ${mediaLabelId}` : "";
      return {
        name:
          mediaCount !== undefined
            ? `At least ${mediaCount} media asset${mediaCount === 1 ? "" : "s"}${labelSuffix}`
            : `Minimum media assets${labelSuffix}`,
        unresolved: Boolean(mediaLabelId),
      };
    }
    case "IMAGE_WITH_LABEL_HAS_MINIMUM_RESOLUTION": {
      const width = typeof params.width === "number" ? params.width : undefined;
      const height = typeof params.height === "number" ? params.height : undefined;
      const mediaLabelId =
        typeof params.mediaLabelId === "string" ? params.mediaLabelId : undefined;
      const size =
        width !== undefined && height !== undefined ? `${width}x${height}px` : "minimum resolution";
      const labelSuffix = mediaLabelId ? ` for label ${mediaLabelId}` : "";
      return {
        name: `Image${labelSuffix} must meet ${size}`,
        unresolved: Boolean(mediaLabelId),
      };
    }
    case "IMAGE_WITH_LABEL_HAS_MINIMUM_DENSITY": {
      const dpi = typeof params.dpi === "number" ? params.dpi : undefined;
      const mediaLabelId =
        typeof params.mediaLabelId === "string" ? params.mediaLabelId : undefined;
      const labelSuffix = mediaLabelId ? ` for label ${mediaLabelId}` : "";
      return {
        name:
          dpi !== undefined
            ? `Image${labelSuffix} must be at least ${dpi} DPI`
            : `Image${labelSuffix} must meet minimum density`,
        unresolved: Boolean(mediaLabelId),
      };
    }
    case "IMAGE_WITH_LABEL_HAS_DEEP_ETCH": {
      const mediaLabelId =
        typeof params.mediaLabelId === "string" ? params.mediaLabelId : undefined;
      return {
        name: mediaLabelId
          ? `Image with label ${mediaLabelId} must have deep etch`
          : "Image must have deep etch",
        unresolved: Boolean(mediaLabelId),
      };
    }
    case "MINIMUM_RELATION_CONNECTIONS": {
      const connectionCount =
        typeof params.connectionCount === "number" ? params.connectionCount : undefined;
      const relationId = typeof params.relationId === "string" ? params.relationId : undefined;
      const suffix = relationId ? ` for relation ${relationId}` : "";
      return {
        name:
          connectionCount !== undefined
            ? `At least ${connectionCount} relation connection${connectionCount === 1 ? "" : "s"}${suffix}`
            : `Minimum relation connections${suffix}`,
        unresolved: Boolean(relationId),
      };
    }
    case "PRODUCT_ADDED_TO_CATEGORY": {
      const categoryId = typeof params.categoryId === "string" ? params.categoryId : undefined;
      return {
        name: categoryId
          ? `Product must be added to category ${categoryId}`
          : "Product must be added to category",
        unresolved: Boolean(categoryId),
      };
    }
    default:
      return {
        name: requirement.requirementType.replaceAll("_", " ").toLowerCase(),
        unresolved: true,
      };
  }
}

export async function resolveRequirementResults(
  results: RequirementResultInput[],
  creds: Credentials,
  deps: {
    completenessScoreBase: string;
    pimBase: string;
    mapiGet: MapiGetFn;
    mapiPostBody: MapiPostBodyFn;
  }
): Promise<ResolvedRequirementResult[]> {
  if (results.length === 0) {
    return [];
  }

  const requirementIds = [...new Set(results.map((result) => result.requirementId))];
  const listResponse = await deps.mapiPostBody<MapiCompletenessRequirementsListResponse>(
    `${deps.completenessScoreBase}/requirements/list`,
    {
      ids: requirementIds,
      page: 0,
      pageSize: Math.min(requirementIds.length, 100),
    },
    creds
  );

  const requirementsById = new Map(
    (listResponse.data ?? []).map((requirement) => [requirement.id, requirement])
  );
  const attributeNames = await fetchAttributeDefinitionNames(
    collectDefinitionIds([...requirementsById.values()]),
    creds,
    deps.mapiGet,
    deps.pimBase
  );

  return results.map((result) => {
    const requirement = requirementsById.get(result.requirementId);
    if (!requirement) {
      return {
        requirementId: result.requirementId,
        name: "Unknown completeness requirement",
        requirementType: "UNKNOWN",
        status: result.status,
        weight: result.weight,
        unresolved: true,
      };
    }

    const label = buildRequirementLabel(requirement, attributeNames);
    return {
      requirementId: result.requirementId,
      name: label.name,
      requirementType: requirement.requirementType,
      status: result.status,
      weight: result.weight,
      unresolved: label.unresolved,
      ...(label.definitionId && { definitionId: label.definitionId }),
    };
  });
}
