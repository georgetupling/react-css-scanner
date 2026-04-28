import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import ts from "typescript";

import {
  buildModuleFacts,
  collectAvailableExportedNames,
  getResolvedModuleFacts,
  resolveModuleFactExport,
  resolveSourceSpecifier,
} from "../../dist/static-analysis-engine.js";

test("module facts expose resolved imports and exports for workspace barrels", () => {
  const moduleFacts = buildModuleFacts({
    parsedFiles: [
      sourceFile(
        "packages/domain/src/index.ts",
        `
          export * from "./worlds.enums.js";
          export type { WorldRole as DomainWorldRole } from "./worlds.enums.js";
        `,
      ),
      sourceFile(
        "src/MemberRoleBadge.tsx",
        `
          import type { WorldRole } from "@loremaster/domain";
          import styles from "./MemberRoleBadge.module.css";
          import "./MemberRoleBadge.css";

          export function MemberRoleBadge(props: { role: WorldRole }) {
            return <span className={styles.badge}>{props.role}</span>;
          }
        `,
      ),
      sourceFile(
        "packages/domain/src/worlds.enums.ts",
        `
          export const WORLD_ROLES = ["owner", "editor", "viewer"] as const;
          export type WorldRole = (typeof WORLD_ROLES)[number];
          export interface WorldSummary {
            id: string;
          }
        `,
      ),
    ],
  });

  const componentFacts = getResolvedModuleFacts({
    moduleFacts,
    filePath: "src/MemberRoleBadge.tsx",
  });
  assert.ok(componentFacts);
  assert.deepEqual(
    componentFacts.imports.map((importFact) => ({
      specifier: importFact.specifier,
      importKind: importFact.importKind,
      resolution: importFact.resolution,
    })),
    [
      {
        specifier: "./MemberRoleBadge.css",
        importKind: "css",
        resolution: {
          status: "resolved",
          resolvedFilePath: "src/MemberRoleBadge.css",
          resolvedModuleId: "module:src/MemberRoleBadge.css",
          confidence: "exact",
        },
      },
      {
        specifier: "./MemberRoleBadge.module.css",
        importKind: "css",
        resolution: {
          status: "resolved",
          resolvedFilePath: "src/MemberRoleBadge.module.css",
          resolvedModuleId: "module:src/MemberRoleBadge.module.css",
          confidence: "exact",
        },
      },
      {
        specifier: "@loremaster/domain",
        importKind: "type-only",
        resolution: {
          status: "resolved",
          resolvedFilePath: "packages/domain/src/index.ts",
          resolvedModuleId: "module:packages/domain/src/index.ts",
          confidence: "heuristic",
        },
      },
    ],
  );

  const barrelFacts = getResolvedModuleFacts({
    moduleFacts,
    filePath: "packages/domain/src/index.ts",
  });
  assert.ok(barrelFacts);
  assert.deepEqual(
    barrelFacts.exports.map((exportFact) => ({
      exportedName: exportFact.exportedName,
      sourceExportedName: exportFact.sourceExportedName,
      exportKind: exportFact.exportKind,
      reexportKind: exportFact.reexportKind,
      typeOnly: exportFact.typeOnly,
      declarationKind: exportFact.declarationKind,
      reexport: exportFact.reexport,
    })),
    [
      {
        exportedName: "*",
        sourceExportedName: undefined,
        exportKind: "export-all",
        reexportKind: "star",
        typeOnly: false,
        declarationKind: "unknown",
        reexport: {
          status: "resolved",
          specifier: "./worlds.enums.js",
          resolvedFilePath: "packages/domain/src/worlds.enums.ts",
          resolvedModuleId: "module:packages/domain/src/worlds.enums.ts",
          confidence: "exact",
        },
      },
      {
        exportedName: "DomainWorldRole",
        sourceExportedName: "WorldRole",
        exportKind: "re-export",
        reexportKind: "named",
        typeOnly: true,
        declarationKind: "type",
        reexport: {
          status: "resolved",
          specifier: "./worlds.enums.js",
          resolvedFilePath: "packages/domain/src/worlds.enums.ts",
          resolvedModuleId: "module:packages/domain/src/worlds.enums.ts",
          confidence: "exact",
        },
      },
    ],
  );
});

test("module facts resolve direct and named re-exports", () => {
  const moduleFacts = buildModuleFacts({
    parsedFiles: [
      sourceFile("src/index.ts", 'export { primaryButton as button } from "./tokens.ts";'),
      sourceFile("src/tokens.ts", 'export const primaryButton = "btn--primary";'),
    ],
  });

  assert.deepEqual(resolveExportForTest(moduleFacts, "button"), {
    resolvedExport: {
      targetFilePath: "src/tokens.ts",
      targetExportName: "primaryButton",
      targetLocalName: "primaryButton",
    },
    traces: [],
  });
});

test("module facts resolve star re-exports with TypeScript extension alternates", () => {
  const moduleFacts = buildModuleFacts({
    parsedFiles: [
      sourceFile("src/index.ts", 'export * from "./roles.js";'),
      sourceFile("src/roles.ts", 'export const memberRole = "owner";'),
    ],
  });

  assert.deepEqual(resolveExportForTest(moduleFacts, "memberRole"), {
    resolvedExport: {
      targetFilePath: "src/roles.ts",
      targetExportName: "memberRole",
      targetLocalName: "memberRole",
    },
    traces: [],
  });
});

test("module facts index namespace re-exports as available exported names", () => {
  const moduleFacts = buildModuleFacts({
    parsedFiles: [
      sourceFile("src/index.ts", 'export * as tokens from "./tokens.ts";'),
      sourceFile("src/tokens.ts", 'export const primary = "btn";'),
    ],
  });

  assert.deepEqual(
    [
      ...collectAvailableExportedNames({
        moduleFacts,
        filePath: "src/index.ts",
        visitedFilePaths: new Set(["src/index.ts"]),
        currentDepth: 0,
      }),
    ],
    ["tokens"],
  );
});

test("module facts pin supported ESM re-export forms", () => {
  const moduleFacts = buildModuleFacts({
    parsedFiles: [
      sourceFile(
        "src/index.ts",
        `
          export { default as Button } from "./Button.tsx";
          export { Button as default } from "./namedButton.tsx";
          export type { ButtonProps } from "./types.ts";
          export { type ButtonVariant } from "./variants.ts";
          export * as ButtonTokens from "./tokens.ts";
        `,
      ),
      sourceFile("src/Button.tsx", "export default function Button() { return null; }"),
      sourceFile("src/namedButton.tsx", "export function Button() { return null; }"),
      sourceFile("src/types.ts", 'export type ButtonProps = { variant?: "primary" };'),
      sourceFile("src/variants.ts", 'export type ButtonVariant = "primary" | "secondary";'),
      sourceFile("src/tokens.ts", 'export const root = "button";'),
    ],
  });

  const indexFacts = getResolvedModuleFacts({
    moduleFacts,
    filePath: "src/index.ts",
  });
  assert.ok(indexFacts);
  assert.deepEqual(
    indexFacts.exports.map((exportFact) => ({
      exportedName: exportFact.exportedName,
      sourceExportedName: exportFact.sourceExportedName,
      reexportKind: exportFact.reexportKind,
      typeOnly: exportFact.typeOnly,
      declarationKind: exportFact.declarationKind,
    })),
    [
      {
        exportedName: "Button",
        sourceExportedName: "default",
        reexportKind: "named",
        typeOnly: false,
        declarationKind: "unknown",
      },
      {
        exportedName: "ButtonProps",
        sourceExportedName: "ButtonProps",
        reexportKind: "named",
        typeOnly: true,
        declarationKind: "type",
      },
      {
        exportedName: "ButtonTokens",
        sourceExportedName: undefined,
        reexportKind: "namespace",
        typeOnly: false,
        declarationKind: "unknown",
      },
      {
        exportedName: "ButtonVariant",
        sourceExportedName: "ButtonVariant",
        reexportKind: "named",
        typeOnly: true,
        declarationKind: "type",
      },
      {
        exportedName: "default",
        sourceExportedName: "Button",
        reexportKind: "named",
        typeOnly: false,
        declarationKind: "unknown",
      },
    ],
  );

  assert.deepEqual(resolveExportForTest(moduleFacts, "Button"), {
    resolvedExport: {
      targetFilePath: "src/Button.tsx",
      targetExportName: "default",
      targetLocalName: "Button",
    },
    traces: [],
  });
  assert.deepEqual(resolveExportForTest(moduleFacts, "default"), {
    resolvedExport: {
      targetFilePath: "src/namedButton.tsx",
      targetExportName: "Button",
      targetLocalName: "Button",
    },
    traces: [],
  });
  assert.deepEqual(resolveExportForTest(moduleFacts, "ButtonProps"), {
    resolvedExport: {
      targetFilePath: "src/types.ts",
      targetExportName: "ButtonProps",
      targetLocalName: "ButtonProps",
    },
    traces: [],
  });
  assert.deepEqual(resolveExportForTest(moduleFacts, "ButtonVariant"), {
    resolvedExport: {
      targetFilePath: "src/variants.ts",
      targetExportName: "ButtonVariant",
      targetLocalName: "ButtonVariant",
    },
    traces: [],
  });
  assert.deepEqual(resolveExportForTest(moduleFacts, "ButtonTokens"), {
    reason: "export-not-found",
    traces: [],
  });
});

test("module facts resolve package exports subpaths through TypeScript", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "scan-react-css-project-resolution-"));
  try {
    await mkdir(path.join(projectRoot, "node_modules/pkg"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "node_modules/pkg/package.json"),
      JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          "./button": "./src/button.ts",
        },
      }),
      "utf8",
    );

    const moduleFacts = buildModuleFacts({
      parsedFiles: [
        sourceFile("src/App.tsx", 'import { buttonClass } from "pkg/button";'),
        sourceFile("node_modules/pkg/src/button.ts", 'export const buttonClass = "btn";'),
      ],
      projectRoot,
      compilerOptions: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    });

    const appFacts = getResolvedModuleFacts({
      moduleFacts,
      filePath: "src/App.tsx",
    });
    assert.equal(
      appFacts?.imports.find((importFact) => importFact.specifier === "pkg/button")?.resolution
        .resolvedFilePath,
      "node_modules/pkg/src/button.ts",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("module facts resolve tsconfig path aliases with fallback targets", () => {
  const moduleFacts = buildModuleFacts({
    parsedFiles: [
      sourceFile("src/App.tsx", 'import { buttonClass } from "@app/tokens";'),
      sourceFile("src/generated/tokens.ts", 'export const buttonClass = "btn";'),
    ],
    projectRoot: "/virtual-project",
    compilerOptions: {
      baseUrl: ".",
      paths: {
        "@app/*": ["src/missing/*", "src/generated/*"],
      },
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
  });

  const appFacts = getResolvedModuleFacts({
    moduleFacts,
    filePath: "src/App.tsx",
  });
  assert.equal(
    appFacts?.imports.find((importFact) => importFact.specifier === "@app/tokens")?.resolution
      .resolvedFilePath,
    "src/generated/tokens.ts",
  );
});

test("module facts reject TypeScript-resolved modules that were not parsed", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "scan-react-css-project-resolution-"));
  try {
    await mkdir(path.join(projectRoot, "node_modules/unparsed-lib/src"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "node_modules/unparsed-lib/package.json"),
      JSON.stringify({
        name: "unparsed-lib",
        type: "module",
        exports: {
          ".": "./src/index.ts",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "node_modules/unparsed-lib/src/index.ts"),
      'export const buttonClass = "btn";',
      "utf8",
    );

    const moduleFacts = buildModuleFacts({
      parsedFiles: [sourceFile("src/App.tsx", 'import { buttonClass } from "unparsed-lib";')],
      projectRoot,
      compilerOptions: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    });

    const appFacts = getResolvedModuleFacts({
      moduleFacts,
      filePath: "src/App.tsx",
    });
    assert.deepEqual(
      appFacts?.imports.find((importFact) => importFact.specifier === "unparsed-lib")?.resolution,
      {
        status: "unresolved",
        reason: "source-specifier-not-found",
      },
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("source specifier resolver preserves explicit TypeScript alternate opt-in", () => {
  const knownFilePaths = new Set(["src/worlds.enums.ts"]);

  assert.equal(
    resolveSourceSpecifier({
      fromFilePath: "src/index.ts",
      specifier: "./worlds.enums.js",
      knownFilePaths,
    }),
    undefined,
  );

  assert.equal(
    resolveSourceSpecifier({
      fromFilePath: "src/index.ts",
      specifier: "./worlds.enums.js",
      knownFilePaths,
      includeTypeScriptExtensionAlternates: true,
    }),
    "src/worlds.enums.ts",
  );
});

test("source specifier resolver can use unique workspace package entrypoint evidence", () => {
  assert.equal(
    resolveSourceSpecifier({
      fromFilePath: "src/MemberRoleBadge.tsx",
      specifier: "@loremaster/domain",
      knownFilePaths: new Set(["packages/domain/src/index.ts"]),
      workspacePackageEntryPointsByPackageName: new Map([
        ["domain", ["packages/domain/src/index.ts"]],
      ]),
    }),
    "packages/domain/src/index.ts",
  );

  assert.equal(
    resolveSourceSpecifier({
      fromFilePath: "src/MemberRoleBadge.tsx",
      specifier: "@loremaster/domain",
      knownFilePaths: new Set(["packages/domain/src/index.ts", "libs/domain/src/index.ts"]),
      workspacePackageEntryPointsByPackageName: new Map([
        ["domain", ["packages/domain/src/index.ts", "libs/domain/src/index.ts"]],
      ]),
    }),
    undefined,
  );
});

function sourceFile(filePath, sourceText) {
  return {
    filePath,
    parsedSourceFile: ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  };
}

function resolveExportForTest(moduleFacts, exportedName) {
  return resolveModuleFactExport({
    moduleFacts,
    filePath: "src/index.ts",
    exportedName,
    visitedExports: new Set([`src/index.ts:${exportedName}`]),
    currentDepth: 0,
    includeTraces: false,
  });
}
