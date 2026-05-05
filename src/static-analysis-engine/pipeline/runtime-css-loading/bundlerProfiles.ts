import type { FactGraphResult } from "../fact-graph/index.js";
import {
  hasAstroPackageDependency,
  hasNextPackageDependency,
  hasRemixPackageDependency,
  hasVitePackageDependency,
  hasWebpackPackageDependency,
} from "./packageMetadata.js";
import { normalizeProjectPath } from "./pathUtils.js";
import type { RuntimeCssBundlerProfile } from "./types.js";

export function detectRuntimeCssBundlerProfiles(input: {
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  packageJsonFiles: FactGraphResult["snapshot"]["files"]["packageJsonFiles"];
}): RuntimeCssBundlerProfile[] {
  const profiles: RuntimeCssBundlerProfile[] = [];
  for (const configFile of input.bundlerConfigFiles) {
    const normalizedConfigPath = normalizeProjectPath(configFile.filePath);
    if (configFile.bundler === "vite") {
      const cssCodeSplitFalse = /\bcssCodeSplit\s*:\s*false\b/.test(configFile.sourceText);
      profiles.push({
        id: `runtime-css-bundler:vite:${normalizedConfigPath}`,
        bundler: "vite",
        cssLoading: cssCodeSplitFalse ? "single-initial-stylesheet" : "split-by-runtime-chunk",
        confidence: cssCodeSplitFalse ? "high" : "medium",
        evidence: [normalizedConfigPath],
        reason: cssCodeSplitFalse
          ? "Vite config sets build.cssCodeSplit to false"
          : "Vite config detected; assuming Vite default CSS code splitting",
      });
      continue;
    }
    if (configFile.bundler === "webpack") {
      const hasCssExtraction = /MiniCssExtractPlugin|mini-css-extract-plugin/.test(
        configFile.sourceText,
      );
      profiles.push({
        id: `runtime-css-bundler:webpack:${normalizedConfigPath}`,
        bundler: "webpack",
        cssLoading: "split-by-runtime-chunk",
        confidence: hasCssExtraction ? "high" : "medium",
        evidence: [normalizedConfigPath],
        reason: hasCssExtraction
          ? "Webpack config uses MiniCssExtractPlugin; modeling CSS by runtime chunk"
          : "Webpack config detected; modeling CSS with runtime chunk semantics",
      });
      continue;
    }
    if (configFile.bundler === "next") {
      profiles.push({
        id: `runtime-css-bundler:next:${normalizedConfigPath}`,
        bundler: "next",
        cssLoading: "split-by-runtime-chunk",
        confidence: "medium",
        evidence: [normalizedConfigPath],
        reason: "Next config detected; modeling route-aware framework CSS chunks",
      });
      continue;
    }
    if (configFile.bundler === "remix" || configFile.bundler === "astro") {
      profiles.push({
        id: `runtime-css-bundler:${configFile.bundler}:${normalizedConfigPath}`,
        bundler: configFile.bundler,
        cssLoading: "generic-esm-chunks",
        confidence: "medium",
        evidence: [normalizedConfigPath],
        reason: `${formatBundlerName(configFile.bundler)} config detected; using conservative generic runtime chunk semantics`,
      });
    }
  }

  if (profiles.length > 0) {
    return profiles.sort(compareRuntimeCssBundlerProfiles);
  }

  const vitePackageFile = input.packageJsonFiles.find(hasVitePackageDependency);
  if (vitePackageFile) {
    return [
      {
        id: `runtime-css-bundler:vite-package:${normalizeProjectPath(vitePackageFile.filePath)}`,
        bundler: "vite",
        cssLoading: "split-by-runtime-chunk",
        confidence: "medium",
        evidence: [normalizeProjectPath(vitePackageFile.filePath)],
        reason:
          "Vite dependency detected in package metadata; assuming Vite default CSS code splitting",
      },
    ];
  }
  const webpackPackageFile = input.packageJsonFiles.find(hasWebpackPackageDependency);
  if (webpackPackageFile) {
    return [
      {
        id: `runtime-css-bundler:webpack-package:${normalizeProjectPath(webpackPackageFile.filePath)}`,
        bundler: "webpack",
        cssLoading: "split-by-runtime-chunk",
        confidence: "medium",
        evidence: [normalizeProjectPath(webpackPackageFile.filePath)],
        reason:
          "Webpack dependency detected in package metadata; modeling CSS with runtime chunk semantics",
      },
    ];
  }
  const nextPackageFile = input.packageJsonFiles.find(hasNextPackageDependency);
  if (nextPackageFile) {
    return [
      {
        id: `runtime-css-bundler:next-package:${normalizeProjectPath(nextPackageFile.filePath)}`,
        bundler: "next",
        cssLoading: "split-by-runtime-chunk",
        confidence: "medium",
        evidence: [normalizeProjectPath(nextPackageFile.filePath)],
        reason:
          "Next dependency detected in package metadata; modeling route-aware framework CSS chunks",
      },
    ];
  }
  const remixPackageFile = input.packageJsonFiles.find(hasRemixPackageDependency);
  if (remixPackageFile) {
    return [
      {
        id: `runtime-css-bundler:remix-package:${normalizeProjectPath(remixPackageFile.filePath)}`,
        bundler: "remix",
        cssLoading: "generic-esm-chunks",
        confidence: "medium",
        evidence: [normalizeProjectPath(remixPackageFile.filePath)],
        reason:
          "Remix dependency detected in package metadata; using conservative generic runtime chunk semantics",
      },
    ];
  }
  const astroPackageFile = input.packageJsonFiles.find(hasAstroPackageDependency);
  if (astroPackageFile) {
    return [
      {
        id: `runtime-css-bundler:astro-package:${normalizeProjectPath(astroPackageFile.filePath)}`,
        bundler: "astro",
        cssLoading: "generic-esm-chunks",
        confidence: "medium",
        evidence: [normalizeProjectPath(astroPackageFile.filePath)],
        reason:
          "Astro dependency detected in package metadata; using conservative generic runtime chunk semantics",
      },
    ];
  }

  return [
    {
      id: "runtime-css-bundler:unknown",
      bundler: "unknown",
      cssLoading: "generic-esm-chunks",
      confidence: "medium",
      evidence: [],
      reason: "No supported bundler config detected; using generic ESM runtime chunk semantics",
    },
  ];
}

export function selectRuntimeCssBundlerProfile(
  profiles: RuntimeCssBundlerProfile[],
): RuntimeCssBundlerProfile {
  const singleInitialProfile = profiles.find(
    (profile) => profile.cssLoading === "single-initial-stylesheet",
  );
  if (singleInitialProfile) {
    return singleInitialProfile;
  }
  const splitProfile = profiles.find((profile) => profile.cssLoading === "split-by-runtime-chunk");
  if (splitProfile) {
    return splitProfile;
  }
  return profiles[0];
}

function compareRuntimeCssBundlerProfiles(
  left: RuntimeCssBundlerProfile,
  right: RuntimeCssBundlerProfile,
): number {
  return left.id.localeCompare(right.id);
}

function formatBundlerName(bundler: RuntimeCssBundlerProfile["bundler"]): string {
  return bundler.slice(0, 1).toUpperCase() + bundler.slice(1);
}
