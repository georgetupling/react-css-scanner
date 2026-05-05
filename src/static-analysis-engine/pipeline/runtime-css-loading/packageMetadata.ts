import type { FactGraphResult } from "../fact-graph/index.js";

type PackageJsonFile = FactGraphResult["snapshot"]["files"]["packageJsonFiles"][number];

export function hasVitePackageDependency(packageJsonFile: PackageJsonFile): boolean {
  return hasPackageDependency(packageJsonFile, "vite");
}

export function hasWebpackPackageDependency(packageJsonFile: PackageJsonFile): boolean {
  return hasPackageDependency(packageJsonFile, "webpack");
}

export function hasNextPackageDependency(packageJsonFile: PackageJsonFile): boolean {
  return hasPackageDependency(packageJsonFile, "next");
}

export function hasRemixPackageDependency(packageJsonFile: PackageJsonFile): boolean {
  return Object.keys({
    ...packageJsonFile.dependencies,
    ...packageJsonFile.devDependencies,
    ...packageJsonFile.peerDependencies,
  }).some(
    (packageName) => packageName === "@remix-run/react" || packageName.startsWith("@remix-run/"),
  );
}

export function hasAstroPackageDependency(packageJsonFile: PackageJsonFile): boolean {
  return hasPackageDependency(packageJsonFile, "astro");
}

function hasPackageDependency(packageJsonFile: PackageJsonFile, packageName: string): boolean {
  return Boolean(
    packageJsonFile.dependencies[packageName] ??
    packageJsonFile.devDependencies[packageName] ??
    packageJsonFile.peerDependencies[packageName],
  );
}
