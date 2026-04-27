import assert from "node:assert/strict";
import test from "node:test";

import ts from "typescript";

import { buildProjectResolution } from "../../dist/static-analysis-engine/pipeline/project-resolution/buildProjectResolution.js";
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
