# Config Contract

## Purpose

This document points to the concrete TypeScript configuration contract for the implemented scanner.

The goal is to make the config model precise enough to implement against, rather than leaving it only as prose examples.

## Source of truth

The current TypeScript config contract lives in:

- [src/config/types.ts](../../src/config/types.ts)

## Main exported types

- `RawReactCssScannerConfig`
- `ResolvedReactCssScannerConfig`
- `RuleSeverity`
- `RuleConfigValue`
- `RuleConfigObject`
- `OwnershipNamingConvention`
- `ExternalCssMode`
- `DEFAULT_CONFIG`

## Contract model

The intended split is:

- `RawReactCssScannerConfig`: what can be read from JSON config files or passed into the API
- `ResolvedReactCssScannerConfig`: the normalized runtime shape after defaults and validation are applied

Config resolution should load exactly one discovered source.
It should not merge multiple config files.

## Current normalized defaults

The default normalized config is represented by `DEFAULT_CONFIG`.

That currently captures the default product assumptions:

- `rootDir: "."`
- source exclude defaults plus auto-discovery of React source roots when `source.include` is omitted
- CSS Modules enabled by convention
- utility CSS detection defaults
- ownership defaults for pages and component-convention behavior
- external CSS mode set to `declared-globals`
- built-in declared external global providers such as Font Awesome, Bootstrap Icons, Material Design Icons, Animate.css, UIkit, and Pure.css
- opt-in `fetch-remote` support for remote HTML-linked stylesheet URLs
- native helper support for `classnames` and `clsx`
- policy default of `failOnSeverity: "error"`
- per-rule object config for rules that need thresholds

If these built-in defaults are used because no config file was discovered, the CLI should emit a warning recommending that the user create a config file.

## Relationship to docs

The prose design still lives in:

- [config-schema.md](./config-schema.md)
- [architecture.md](./architecture.md)
- [rules.md](./rules.md)

When those docs and the TypeScript contract disagree, the mismatch should be treated as a design bug and resolved explicitly.
