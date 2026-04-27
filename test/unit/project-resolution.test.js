import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import ts from "typescript";

import { buildProjectResolution } from "../../dist/static-analysis-engine/pipeline/project-resolution/buildProjectResolution.js";
import {
  collectAvailableExportedNames,
  resolveProjectExport,
} from "../../dist/static-analysis-engine/pipeline/project-resolution/resolveExportedName.js";
import { resolveProjectSourceSpecifier } from "../../dist/static-analysis-engine/pipeline/project-resolution/resolveProjectSourceSpecifier.js";
import { resolveSourceSpecifier } from "../../dist/static-analysis-engine/pipeline/project-resolution/resolveSourceSpecifier.js";

test("project resolution indexes imports, exports, declarations, and workspace entrypoints", () => {
  const resolution = buildProjectResolution({
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

  assert.deepEqual(
    [...resolution.parsedSourceFilesByFilePath.keys()],
    [
      "packages/domain/src/index.ts",
      "packages/domain/src/worlds.enums.ts",
      "src/MemberRoleBadge.tsx",
    ],
  );

  const componentImports = resolution.importsByFilePath.get("src/MemberRoleBadge.tsx") ?? [];
  assert.deepEqual(
    componentImports.map((importRecord) => ({
      specifier: importRecord.specifier,
      importKind: importRecord.importKind,
      importNames: importRecord.importNames.map((importName) => ({
        kind: importName.kind,
        importedName: importName.importedName,
        localName: importName.localName,
        typeOnly: importName.typeOnly,
      })),
    })),
    [
      {
        specifier: "./MemberRoleBadge.css",
        importKind: "css",
        importNames: [],
      },
      {
        specifier: "./MemberRoleBadge.module.css",
        importKind: "css",
        importNames: [
          {
            kind: "default",
            importedName: "default",
            localName: "styles",
            typeOnly: false,
          },
        ],
      },
      {
        specifier: "@loremaster/domain",
        importKind: "type-only",
        importNames: [
          {
            kind: "named",
            importedName: "WorldRole",
            localName: "WorldRole",
            typeOnly: true,
          },
        ],
      },
    ],
  );

  const barrelExports = resolution.exportsByFilePath.get("packages/domain/src/index.ts") ?? [];
  assert.deepEqual(
    barrelExports.map((exportRecord) => ({
      exportedName: exportRecord.exportedName,
      sourceExportedName: exportRecord.sourceExportedName,
      specifier: exportRecord.specifier,
      reexportKind: exportRecord.reexportKind,
      typeOnly: exportRecord.typeOnly,
      declarationKind: exportRecord.declarationKind,
    })),
    [
      {
        exportedName: "*",
        sourceExportedName: undefined,
        specifier: "./worlds.enums.js",
        reexportKind: "star",
        typeOnly: false,
        declarationKind: "unknown",
      },
      {
        exportedName: "DomainWorldRole",
        sourceExportedName: "WorldRole",
        specifier: "./worlds.enums.js",
        reexportKind: "named",
        typeOnly: true,
        declarationKind: "type",
      },
    ],
  );

  const enumDeclarations = resolution.declarationsByFilePath.get(
    "packages/domain/src/worlds.enums.ts",
  );
  assert.ok(enumDeclarations);
  assert.ok(enumDeclarations.typeAliases.has("WorldRole"));
  assert.ok(enumDeclarations.interfaces.has("WorldSummary"));
  assert.equal(enumDeclarations.valueDeclarations.get("WORLD_ROLES")?.kind, "const");

  assert.deepEqual(
    resolution.workspacePackageEntryPointsByPackageName.get("domain")?.map((entryPoint) => ({
      packageName: entryPoint.packageName,
      filePath: entryPoint.filePath,
      confidence: entryPoint.confidence,
      reason: entryPoint.reason,
    })),
    [
      {
        packageName: "domain",
        filePath: "packages/domain/src/index.ts",
        confidence: "heuristic",
        reason: "discovered-workspace-entrypoint",
      },
    ],
  );
});

test("project resolution initializes shared caches without doing expensive resolution work", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [sourceFile("src/App.tsx", "export const App = () => null;")],
  });

  assert.equal(resolution.caches.moduleSpecifiers.size, 0);
  assert.equal(resolution.caches.importedBindings.size, 0);
  assert.equal(resolution.caches.finiteTypeEvidence.size, 0);
});

test("project resolution indexes exported expression bindings", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [
      sourceFile(
        "src/tokens.ts",
        `
          const privateToken = "private-token";
          export const publicToken = "public-token";
          export const buttonTokens = ["btn", "btn--primary"] as const;
        `,
      ),
      sourceFile(
        "src/defaultIdentifier.ts",
        `
          const defaultToken = "default-token";
          export default defaultToken;
        `,
      ),
      sourceFile("src/defaultExpression.ts", 'export default "literal-default";'),
    ],
  });

  assert.deepEqual(
    [...(resolution.exportedExpressionBindingsByFilePath.get("src/tokens.ts") ?? []).keys()],
    ["publicToken", "buttonTokens"],
  );
  assert.equal(
    expressionText(
      resolution.exportedExpressionBindingsByFilePath
        .get("src/defaultIdentifier.ts")
        ?.get("default"),
    ),
    '"default-token"',
  );
  assert.equal(
    expressionText(
      resolution.exportedExpressionBindingsByFilePath
        .get("src/defaultExpression.ts")
        ?.get("default"),
    ),
    '"literal-default"',
  );
});

test("project resolution resolves direct and named re-exports", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [
      sourceFile("src/index.ts", 'export { primaryButton as button } from "./tokens.ts";'),
      sourceFile("src/tokens.ts", 'export const primaryButton = "btn--primary";'),
    ],
  });

  const result = resolveProjectExport({
    projectResolution: resolution,
    filePath: "src/index.ts",
    exportedName: "button",
    visitedExports: new Set(["src/index.ts:button"]),
    currentDepth: 0,
    includeTraces: false,
  });

  assert.deepEqual(result, {
    resolvedExport: {
      targetFilePath: "src/tokens.ts",
      targetExportName: "primaryButton",
      targetLocalName: "primaryButton",
    },
    traces: [],
  });
});

test("project resolution resolves star re-exports with TypeScript extension alternates", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [
      sourceFile("src/index.ts", 'export * from "./roles.js";'),
      sourceFile("src/roles.ts", 'export const memberRole = "owner";'),
    ],
  });

  const result = resolveProjectExport({
    projectResolution: resolution,
    filePath: "src/index.ts",
    exportedName: "memberRole",
    visitedExports: new Set(["src/index.ts:memberRole"]),
    currentDepth: 0,
    includeTraces: false,
  });

  assert.deepEqual(result, {
    resolvedExport: {
      targetFilePath: "src/roles.ts",
      targetExportName: "memberRole",
      targetLocalName: "memberRole",
    },
    traces: [],
  });
});

test("project resolution indexes namespace re-exports as available exported names", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [
      sourceFile("src/index.ts", 'export * as tokens from "./tokens.ts";'),
      sourceFile("src/tokens.ts", 'export const primary = "btn";'),
    ],
  });

  const exports = resolution.exportsByFilePath.get("src/index.ts") ?? [];
  assert.deepEqual(
    exports.map((exportRecord) => ({
      exportedName: exportRecord.exportedName,
      specifier: exportRecord.specifier,
      reexportKind: exportRecord.reexportKind,
      declarationKind: exportRecord.declarationKind,
    })),
    [
      {
        exportedName: "tokens",
        specifier: "./tokens.ts",
        reexportKind: "namespace",
        declarationKind: "unknown",
      },
    ],
  );

  assert.deepEqual(
    [
      ...collectAvailableExportedNames({
        projectResolution: resolution,
        filePath: "src/index.ts",
        visitedFilePaths: new Set(["src/index.ts"]),
        currentDepth: 0,
      }),
    ],
    ["tokens"],
  );
});

test("project resolution resolves default re-exports", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [
      sourceFile("src/index.ts", 'export { default as Button } from "./Button.tsx";'),
      sourceFile("src/Button.tsx", "export default function Button() { return null; }"),
    ],
  });

  const result = resolveProjectExport({
    projectResolution: resolution,
    filePath: "src/index.ts",
    exportedName: "Button",
    visitedExports: new Set(["src/index.ts:Button"]),
    currentDepth: 0,
    includeTraces: false,
  });

  assert.deepEqual(result, {
    resolvedExport: {
      targetFilePath: "src/Button.tsx",
      targetExportName: "default",
      targetLocalName: "Button",
    },
    traces: [],
  });
});

test("project resolution resolves type-only re-exports through barrels", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [
      sourceFile("src/index.ts", 'export type { ButtonProps } from "./types.ts";'),
      sourceFile("src/types.ts", 'export type ButtonProps = { variant?: "primary" };'),
    ],
  });

  const result = resolveProjectExport({
    projectResolution: resolution,
    filePath: "src/index.ts",
    exportedName: "ButtonProps",
    visitedExports: new Set(["src/index.ts:ButtonProps"]),
    currentDepth: 0,
    includeTraces: false,
  });

  assert.deepEqual(result, {
    resolvedExport: {
      targetFilePath: "src/types.ts",
      targetExportName: "ButtonProps",
      targetLocalName: "ButtonProps",
    },
    traces: [],
  });
});

test("project resolution caches repeated source-specifier lookups", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [
      sourceFile("src/App.tsx", 'import { token } from "./tokens.ts";'),
      sourceFile("src/tokens.ts", 'export const token = "btn";'),
    ],
  });

  assert.equal(
    resolveProjectSourceSpecifier({
      projectResolution: resolution,
      fromFilePath: "src/App.tsx",
      specifier: "./tokens.ts",
    }),
    "src/tokens.ts",
  );
  assert.equal(
    resolveProjectSourceSpecifier({
      projectResolution: resolution,
      fromFilePath: "src/App.tsx",
      specifier: "./tokens.ts",
    }),
    "src/tokens.ts",
  );

  assert.deepEqual(
    [...resolution.caches.moduleSpecifiers.entries()],
    [
      [
        "src/App.tsx\0./tokens.ts\0source",
        {
          status: "resolved",
          confidence: "exact",
          value: "src/tokens.ts",
        },
      ],
    ],
  );
});

test("project resolution caches negative source-specifier lookups", () => {
  const resolution = buildProjectResolution({
    parsedFiles: [sourceFile("src/App.tsx", 'import { token } from "./missing";')],
  });

  assert.equal(
    resolveProjectSourceSpecifier({
      projectResolution: resolution,
      fromFilePath: "src/App.tsx",
      specifier: "./missing",
    }),
    undefined,
  );
  assert.equal(
    resolveProjectSourceSpecifier({
      projectResolution: resolution,
      fromFilePath: "src/App.tsx",
      specifier: "./missing",
    }),
    undefined,
  );

  assert.deepEqual(
    [...resolution.caches.moduleSpecifiers.entries()],
    [
      [
        "src/App.tsx\0./missing\0source",
        {
          status: "not-found",
          reason: "source-specifier-not-found",
        },
      ],
    ],
  );
});

test("project resolution resolves package exports subpaths through TypeScript", async () => {
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

    const resolution = buildProjectResolution({
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

    assert.equal(
      resolveProjectSourceSpecifier({
        projectResolution: resolution,
        fromFilePath: "src/App.tsx",
        specifier: "pkg/button",
      }),
      "node_modules/pkg/src/button.ts",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("project resolution resolves tsconfig path aliases with fallback targets", () => {
  const resolution = buildProjectResolution({
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

  assert.equal(
    resolveProjectSourceSpecifier({
      projectResolution: resolution,
      fromFilePath: "src/App.tsx",
      specifier: "@app/tokens",
    }),
    "src/generated/tokens.ts",
  );
});

test("project resolution rejects TypeScript-resolved modules that were not parsed", async () => {
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

    const resolution = buildProjectResolution({
      parsedFiles: [sourceFile("src/App.tsx", 'import { buttonClass } from "unparsed-lib";')],
      projectRoot,
      compilerOptions: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    });

    assert.equal(
      resolveProjectSourceSpecifier({
        projectResolution: resolution,
        fromFilePath: "src/App.tsx",
        specifier: "unparsed-lib",
      }),
      undefined,
    );
    assert.deepEqual(
      [...resolution.caches.moduleSpecifiers.entries()],
      [
        [
          "src/App.tsx\0unparsed-lib\0source",
          {
            status: "not-found",
            reason: "source-specifier-not-found",
          },
        ],
      ],
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

function expressionText(expression) {
  return expression?.getText();
}
