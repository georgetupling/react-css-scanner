import path from "node:path";

import type { DiscoveryConfig } from "../../../../config/index.js";
import { normalizeProjectPath } from "../../../../project/pathUtils.js";

export type WorkspaceSpecifierResolution =
  | { status: "resolved"; kind: "project"; filePath: string; attempted: string[] }
  | { status: "resolved"; kind: "package"; filePath: string; attempted: string[] }
  | { status: "external"; attempted: string[] }
  | { status: "unresolved"; attempted: string[] };

export function resolveWorkspaceSpecifier(input: {
  importerFilePath: string;
  specifier: string;
  targetKind: "source" | "stylesheet";
  knownSourceFilePaths?: ReadonlySet<string>;
  knownStylesheetFilePaths?: ReadonlySet<string>;
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
}): WorkspaceSpecifierResolution {
  const normalizedSpecifier = normalizeProjectPath(stripUrlSuffix(input.specifier));
  if (isExternalSpecifier(normalizedSpecifier)) {
    return { status: "external", attempted: [] };
  }

  const knownFilePaths =
    input.targetKind === "source" ? input.knownSourceFilePaths : input.knownStylesheetFilePaths;
  const candidates = getProjectCandidatePaths({
    importerFilePath: input.importerFilePath,
    specifier: normalizedSpecifier,
    targetKind: input.targetKind,
    discovery: input.discovery,
  });

  for (const candidate of candidates) {
    if (knownFilePaths?.has(candidate)) {
      return {
        status: "resolved",
        kind: "project",
        filePath: candidate,
        attempted: candidates,
      };
    }
  }

  if (!isProjectLikeSpecifier(normalizedSpecifier)) {
    return {
      status: "resolved",
      kind: "package",
      filePath: normalizedSpecifier,
      attempted: candidates,
    };
  }

  return {
    status: "unresolved",
    attempted: candidates,
  };
}

export function getProjectCandidatePaths(input: {
  importerFilePath: string;
  specifier: string;
  targetKind: "source" | "stylesheet";
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
}): string[] {
  const normalizedSpecifier = normalizeProjectPath(stripUrlSuffix(input.specifier));
  const candidates: string[] = [];
  const bases: string[] = [];

  if (normalizedSpecifier.startsWith("/")) {
    bases.push(normalizedSpecifier.replace(/^\/+/, ""));
  } else if (normalizedSpecifier.startsWith(".")) {
    const importerDirectory = path.posix.dirname(normalizeProjectPath(input.importerFilePath));
    bases.push(
      normalizeSegments([...splitPath(importerDirectory), ...splitPath(normalizedSpecifier)]),
    );
  } else {
    bases.push(...resolveAliasBases(normalizedSpecifier, input.discovery?.aliases ?? {}));
  }

  for (const base of bases) {
    candidates.push(...expandCandidateBase(base, input.targetKind, input.discovery));
  }

  return uniqueSorted(candidates);
}

function expandCandidateBase(
  base: string,
  targetKind: "source" | "stylesheet",
  discovery: Pick<DiscoveryConfig, "stylesheetExtensions"> | undefined,
): string[] {
  if (targetKind === "stylesheet") {
    const stylesheetExtensions = discovery?.stylesheetExtensions ?? [".css"];
    if (stylesheetExtensions.includes(path.posix.extname(base).toLowerCase())) {
      return [base];
    }

    return stylesheetExtensions.map((extension) => `${base}${extension}`);
  }

  return [
    base,
    ...getTypeScriptSourceAlternatesForSpecifier(base),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    ...getDirectoryBasenameSourceCandidates(base),
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
}

function getDirectoryBasenameSourceCandidates(base: string): string[] {
  const basename = path.posix.basename(base);
  if (!basename || basename === "." || basename === "..") {
    return [];
  }

  return [
    `${base}/${basename}.ts`,
    `${base}/${basename}.tsx`,
    `${base}/${basename}.js`,
    `${base}/${basename}.jsx`,
  ];
}

function resolveAliasBases(specifier: string, aliases: Record<string, string[]>): string[] {
  const bases: string[] = [];
  for (const [pattern, targets] of Object.entries(aliases).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const wildcardIndex = pattern.indexOf("*");
    if (wildcardIndex === -1) {
      if (specifier !== pattern) {
        continue;
      }

      bases.push(...targets.map((target) => normalizeProjectPath(target)));
      continue;
    }

    const prefix = pattern.slice(0, wildcardIndex);
    const suffix = pattern.slice(wildcardIndex + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
      continue;
    }

    const wildcardValue = specifier.slice(prefix.length, specifier.length - suffix.length);
    bases.push(
      ...targets.map((target) => normalizeProjectPath(target).replace("*", wildcardValue)),
    );
  }

  return bases;
}

function getTypeScriptSourceAlternatesForSpecifier(candidateBasePath: string): string[] {
  if (candidateBasePath.endsWith(".js")) {
    return [
      `${candidateBasePath.slice(0, -".js".length)}.ts`,
      `${candidateBasePath.slice(0, -".js".length)}.tsx`,
    ];
  }

  if (candidateBasePath.endsWith(".jsx")) {
    return [`${candidateBasePath.slice(0, -".jsx".length)}.tsx`];
  }

  if (candidateBasePath.endsWith(".mjs") || candidateBasePath.endsWith(".cjs")) {
    return [
      `${candidateBasePath.slice(0, -".mjs".length)}.mts`,
      `${candidateBasePath.slice(0, -".mjs".length)}.cts`,
    ];
  }

  return [];
}

function isProjectLikeSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function isExternalSpecifier(specifier: string): boolean {
  return specifier.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(specifier);
}

function stripUrlSuffix(href: string): string {
  return href.split(/[?#]/, 1)[0] ?? href;
}

function splitPath(value: string): string[] {
  return value.split("/").filter((segment) => segment.length > 0);
}

function normalizeSegments(segments: string[]): string {
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  return normalized.join("/");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
