import type { CompiledAuthDescriptor, CompiledAuthOperation, ValueExtractor } from "../lib";
import type {
  ActionDefinition,
  PathSpaceDefinition,
  ResourceTypeDefinition,
  ServiceVocabulary,
  TargetKind,
} from "../control-plane/domain";

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathParameters(path: string): Array<{ name: string; greedy: boolean }> {
  return [...path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)(\+)?\}/g)].map((match) => ({
    name: match[1]!,
    greedy: match[2] === "+",
  }));
}

function pathRegex(path: string): string {
  let result = "";
  let cursor = 0;
  for (const match of path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)(\+)?\}/g)) {
    result += escapeRegex(path.slice(cursor, match.index));
    result += `(?<${match[1]}>${match[2] ? ".+" : "[^/]+"})`;
    cursor = (match.index ?? 0) + match[0].length;
  }
  return `^${result}${escapeRegex(path.slice(cursor))}$`;
}

function operationId(method: string, path: string, operation: Record<string, unknown>): string {
  return string(operation.operationId) ?? `${method}_${path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function upsertById<T extends { id: string }>(values: T[], value: T): void {
  const index = values.findIndex((candidate) => candidate.id === value.id);
  if (index >= 0) values[index] = value;
  else values.push(value);
}

export interface OpenApiImportResult {
  vocabulary: ServiceVocabulary;
  authDescriptor: CompiledAuthDescriptor;
  warnings: string[];
}

export function importOpenApiVocabulary(
  document: unknown,
  current: ServiceVocabulary,
  at = new Date().toISOString(),
): OpenApiImportResult {
  const root = record(document);
  if (!root || typeof root.openapi !== "string" || !record(root.paths)) {
    throw new Error("document must be an OpenAPI document with a paths object");
  }
  const vocabulary = structuredClone(current);
  const resources: ResourceTypeDefinition[] = vocabulary.resourceTypes;
  const pathSpaces: PathSpaceDefinition[] = vocabulary.pathSpaces;
  const actions: ActionDefinition[] = vocabulary.actions;
  const operations: CompiledAuthOperation[] = [];
  const warnings: string[] = [];

  for (const [path, rawPathItem] of Object.entries(record(root.paths)!)) {
    const pathItem = record(rawPathItem);
    if (!pathItem) continue;
    for (const method of HTTP_METHODS) {
      const operation = record(pathItem[method]);
      if (!operation) continue;
      const id = operationId(method, path, operation);
      const parameters = pathParameters(path);
      const targetKind = (string(operation["x-authz-target-kind"]) ?? "resource") as TargetKind;
      if (!(["scope", "resource", "path"] as string[]).includes(targetKind)) {
        throw new Error(`${method.toUpperCase()} ${path} has invalid x-authz-target-kind`);
      }
      const resourceType = string(operation["x-authz-resource-type"]) ??
        (targetKind === "path" ? "PathObject" : "HttpResource");
      const permissionProfile = string(operation["x-authz-permission-profile"]) ??
        (targetKind === "path" ? "path" : "object");
      const permissionId = string(operation["x-authz-permission-id"]) ??
        (method === "get" || method === "head" ? "read" : "write");
      const actionId = string(operation["x-authz-action-id"]) ?? id;
      const resourceIdParameter = string(operation["x-authz-resource-id-param"]) ?? parameters[0]?.name;
      const resourceId: ValueExtractor = resourceIdParameter
        ? { source: "path_group", name: resourceIdParameter }
        : { source: "literal", value: id };
      let pathSpace: string | undefined;
      let pathDescriptor: CompiledAuthOperation["pathSpace"];
      if (targetKind === "path") {
        pathSpace = string(operation["x-authz-path-space"]) ?? path.split("/").filter(Boolean)[0] ?? "default";
        const pathParameter = string(operation["x-authz-path-param"]) ?? parameters.find((value) => value.greedy)?.name;
        if (!pathParameter) warnings.push(`${method.toUpperCase()} ${path}: path target has no greedy path parameter`);
        const anchorKind = string(operation["x-authz-path-anchor-kind"]) === "resource" ? "resource" : "service";
        upsertById(pathSpaces, {
          id: pathSpace,
          anchorKind,
          routePattern: path,
          ...(anchorKind === "resource" ? { resourceType } : {}),
        });
        pathDescriptor = {
          anchorKind,
          namespace: { source: "literal", value: pathSpace },
          path: pathParameter ? { source: "path_group", name: pathParameter } : resourceId,
          ...(anchorKind === "resource" ? { anchorResourceType: resourceType, anchorResourceId: resourceId } : {}),
        };
      }
      upsertById(resources, { id: resourceType });
      upsertById(actions, {
        id: actionId,
        targetKind,
        resourceType,
        ...(pathSpace ? { pathSpace } : {}),
        permissionProfile,
        permissionId,
        operations: [{ method: method.toUpperCase(), path, operationId: id }],
      });
      operations.push({
        operationId: id,
        method: method.toUpperCase(),
        pathPattern: pathRegex(path),
        actionId,
        permissionProfile,
        permissionId,
        targetKind,
        resourceType,
        resourceId,
        ...(pathDescriptor ? { pathSpace: pathDescriptor } : {}),
      });
    }
  }
  if (!operations.length) throw new Error("OpenAPI document contains no supported operations");
  vocabulary.version += 1;
  vocabulary.updatedAt = at;
  return {
    vocabulary,
    authDescriptor: { version: `openapi-${vocabulary.version}`, operations },
    warnings,
  };
}
