import type { ProjectAnalysis, SerializableProjectAnalysis } from "./types.js";

export function serializeProjectAnalysis(analysis: ProjectAnalysis): SerializableProjectAnalysis {
  return {
    ...analysis,
    indexes: Object.fromEntries(
      Object.entries(analysis.indexes).map(([name, value]) => [name, serializeMap(value)]),
    ) as SerializableProjectAnalysis["indexes"],
  };
}

function serializeMap(map: Map<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    [...map.entries()]
      .map(([key, value]) => [key, serializeValue(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Map) {
    return serializeMap(value);
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, serializeValue(childValue)]),
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
