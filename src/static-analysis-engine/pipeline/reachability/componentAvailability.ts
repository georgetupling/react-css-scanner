import type { ReachabilityStylesheetInput } from "./types.js";
import type {
  ComponentAvailabilityRecord,
  BatchedComponentAvailability,
  ReachabilityGraphContext,
} from "./internalTypes.js";
import type { RenderGraphProjectionEdge } from "../render-structure/index.js";
import { normalizeProjectPath } from "./pathUtils.js";

export function computeBatchedComponentAvailability(input: {
  stylesheets: ReachabilityStylesheetInput[];
  directCssImportersByStylesheetPath: Map<string, string[]>;
  reachabilityGraphContext: ReachabilityGraphContext;
  includeTraces: boolean;
}): BatchedComponentAvailability {
  const stylesheetPaths = [
    ...new Set(
      input.stylesheets
        .map((stylesheet) => normalizeProjectPath(stylesheet.filePath))
        .filter((filePath): filePath is string => Boolean(filePath)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const stylesheetIndexByPath = new Map(
    stylesheetPaths.map((stylesheetPath, index) => [stylesheetPath, index]),
  );
  const allStylesheetBits = createBitMask(stylesheetPaths.length);
  const directDefiniteBitsByComponentKey = new Map<string, bigint>();
  const definiteBitsByComponentKey = new Map<string, bigint>();
  const possibleBitsByComponentKey = new Map<string, bigint>();
  const sortedComponentKeys = input.reachabilityGraphContext.componentKeys;

  for (const [
    stylesheetPath,
    importingSourceFilePaths,
  ] of input.directCssImportersByStylesheetPath) {
    const stylesheetIndex = stylesheetIndexByPath.get(stylesheetPath);
    if (stylesheetIndex === undefined) {
      continue;
    }

    const stylesheetBit = 1n << BigInt(stylesheetIndex);
    for (const importingSourceFilePath of importingSourceFilePaths) {
      for (const componentKey of input.reachabilityGraphContext.componentKeysByFilePath.get(
        importingSourceFilePath,
      ) ?? []) {
        const currentBits = directDefiniteBitsByComponentKey.get(componentKey) ?? 0n;
        directDefiniteBitsByComponentKey.set(componentKey, currentBits | stylesheetBit);
      }
    }
  }

  for (const componentKey of sortedComponentKeys) {
    definiteBitsByComponentKey.set(
      componentKey,
      directDefiniteBitsByComponentKey.get(componentKey) ?? 0n,
    );
    possibleBitsByComponentKey.set(componentKey, 0n);
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const componentKey of sortedComponentKeys) {
      const directBits = directDefiniteBitsByComponentKey.get(componentKey) ?? 0n;
      const incomingEdges =
        input.reachabilityGraphContext.incomingEdgesByComponentKey.get(componentKey) ?? [];
      const currentDefiniteBits = definiteBitsByComponentKey.get(componentKey) ?? 0n;
      const currentPossibleBits = possibleBitsByComponentKey.get(componentKey) ?? 0n;
      let nextDefiniteBits = directBits;
      let nextPossibleBits = 0n;

      if (incomingEdges.length > 0) {
        let allParentsDefiniteBits = allStylesheetBits;
        let allParentEdgesAreDefinite = true;
        let availableParentBits = 0n;

        for (const edge of incomingEdges) {
          const parentKey = edge.fromComponentKey;
          const parentDefiniteBits = definiteBitsByComponentKey.get(parentKey) ?? 0n;
          const parentPossibleBits = possibleBitsByComponentKey.get(parentKey) ?? 0n;
          const parentAvailableBits = parentDefiniteBits | parentPossibleBits;
          availableParentBits |= parentAvailableBits;
          allParentsDefiniteBits &= parentDefiniteBits;
          if (edge.renderPath !== "definite") {
            allParentEdgesAreDefinite = false;
          }
        }

        if (allParentEdgesAreDefinite) {
          nextDefiniteBits |= allParentsDefiniteBits;
        }
        nextPossibleBits = availableParentBits & ~nextDefiniteBits;
      }

      if (nextDefiniteBits !== currentDefiniteBits || nextPossibleBits !== currentPossibleBits) {
        definiteBitsByComponentKey.set(componentKey, nextDefiniteBits);
        possibleBitsByComponentKey.set(componentKey, nextPossibleBits);
        changed = true;
      }
    }
  }

  const componentAvailabilityByStylesheetPath = new Map<
    string,
    Map<string, ComponentAvailabilityRecord>
  >();
  for (const stylesheetPath of stylesheetPaths) {
    const stylesheetIndex = stylesheetIndexByPath.get(stylesheetPath);
    if (stylesheetIndex === undefined) {
      continue;
    }

    const stylesheetBit = 1n << BigInt(stylesheetIndex);
    const componentAvailabilityByKey = new Map<string, ComponentAvailabilityRecord>();
    for (const componentKey of sortedComponentKeys) {
      const availabilityRecord = buildComponentAvailabilityRecordForStylesheet({
        componentKey,
        stylesheetBit,
        directDefiniteBitsByComponentKey,
        definiteBitsByComponentKey,
        possibleBitsByComponentKey,
        incomingEdges:
          input.reachabilityGraphContext.incomingEdgesByComponentKey.get(componentKey) ?? [],
        includeTraces: input.includeTraces,
      });
      if (availabilityRecord) {
        componentAvailabilityByKey.set(componentKey, availabilityRecord);
      }
    }
    componentAvailabilityByStylesheetPath.set(stylesheetPath, componentAvailabilityByKey);
  }

  return { componentAvailabilityByStylesheetPath };
}

function createBitMask(bitCount: number): bigint {
  return bitCount === 0 ? 0n : (1n << BigInt(bitCount)) - 1n;
}

function buildComponentAvailabilityRecordForStylesheet(input: {
  componentKey: string;
  stylesheetBit: bigint;
  directDefiniteBitsByComponentKey: Map<string, bigint>;
  definiteBitsByComponentKey: Map<string, bigint>;
  possibleBitsByComponentKey: Map<string, bigint>;
  incomingEdges: RenderGraphProjectionEdge[];
  includeTraces: boolean;
}): ComponentAvailabilityRecord | undefined {
  const directBits = input.directDefiniteBitsByComponentKey.get(input.componentKey) ?? 0n;
  if ((directBits & input.stylesheetBit) !== 0n) {
    return {
      availability: "definite",
      reasons: ["component is declared in a source file that directly imports this stylesheet"],
      derivations: [{ kind: "whole-component-direct-import" }],
      traces: [],
    };
  }

  const definiteBits = input.definiteBitsByComponentKey.get(input.componentKey) ?? 0n;
  if ((definiteBits & input.stylesheetBit) !== 0n) {
    return {
      availability: "definite",
      reasons: ["all known renderers of this component have definite stylesheet availability"],
      derivations: [{ kind: "whole-component-all-known-renderers-definite" }],
      traces: input.includeTraces ? input.incomingEdges.flatMap((edge) => edge.traces) : [],
    };
  }

  const possibleBits = input.possibleBitsByComponentKey.get(input.componentKey) ?? 0n;
  if ((possibleBits & input.stylesheetBit) === 0n) {
    return undefined;
  }

  const availableParentEdges = input.incomingEdges.filter((edge) => {
    const parentKey = edge.fromComponentKey;
    const parentDefiniteBits = input.definiteBitsByComponentKey.get(parentKey) ?? 0n;
    const parentPossibleBits = input.possibleBitsByComponentKey.get(parentKey) ?? 0n;
    return ((parentDefiniteBits | parentPossibleBits) & input.stylesheetBit) !== 0n;
  });
  const definitePathParentEdges = availableParentEdges.filter(
    (edge) => edge.renderPath === "definite",
  );
  if (definitePathParentEdges.length > 0) {
    return {
      availability: "possible",
      reasons: ["at least one known renderer of this component has stylesheet availability"],
      derivations: [{ kind: "whole-component-at-least-one-renderer" }],
      traces: input.includeTraces ? definitePathParentEdges.flatMap((edge) => edge.traces) : [],
    };
  }

  return {
    availability: "possible",
    reasons: [
      "this component is only rendered on possible paths beneath a renderer with stylesheet availability",
    ],
    derivations: [{ kind: "whole-component-only-possible-renderers" }],
    traces: input.includeTraces ? availableParentEdges.flatMap((edge) => edge.traces) : [],
  };
}
