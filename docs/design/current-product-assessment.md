# Current Product Assessment

## Purpose

This document assesses the product shell around the engine.

It focuses on:

- package and build state
- Node API and CLI state
- deleted functionality that now needs rebuilding around the engine
- product-level scope trims that are safe during the reboot
- ambiguities in intended product behavior

This document is intentionally separate from the engine assessment.

## Current State Summary

The product shell has been rebooted into a small working slice.

Implemented areas include:

- a root package entrypoint
- a project scanning shell around the static-analysis-engine
- file discovery for source and CSS inputs
- JSON config loading and validation
- config discovery for `scan-react-css.json`
- rule registry and rule severity defaults
- rule execution against `ProjectAnalysis`
- initial findings with severity, confidence, traces, subjects, and evidence
- a basic CLI entrypoint
- focused unit coverage for project scanning, config behavior, and initial rules

The shell is no longer trying to preserve the deleted scanner architecture. It now wraps the engine,
runs rules outside the engine, and returns rule findings as product-layer output.

The main remaining issue is that the shell is still thin. The current implementation is enough to
validate the reboot direction, but it is not yet a polished publishable CLI contract.

## Functionality That Still Needs To Be Built Around The Engine

These capabilities either have only first-slice implementations or still need real replacements.

### 1. Stable package entrypoint

Current status:

- a package entrypoint exists
- the public contract is still settling

Need to finish:

- root exports
- public Node API
- publishable types
- stable JSON contract

Target shape:

- `scanProject()` for real project scanning
- engine-facing analysis APIs stay internal rather than becoming stable package exports

### 2. CLI

Current status:

- a basic CLI entrypoint exists

Need to finish:

- argument parsing
- help text
- terminal output
- JSON output mode
- exit code behavior
- output file writing

The old CLI behavior should be treated as historical input, not as a strict implementation template.

### 3. Config

Current status:

- JSON config loading exists
- default rule severities are centralized in the rule catalogue
- config discovery currently supports `scan-react-css.json`

Need to finish:

- config file shape
- config validation
- default values
- config discovery
- config-source reporting

This is product logic, not engine logic.

### 4. Project discovery and file loading

Current status:

- root-based source and CSS discovery exists
- explicit source/CSS file paths can be used for deterministic scans and tests

Need to finish:

- scan root normalization
- source file discovery
- CSS file discovery
- HTML file discovery
- file reading
- ignore and exclude behavior

This should produce normalized inputs for the internal engine analysis entry point.

### 5. HTML stylesheet-link extraction

If external CSS support survives, the product shell needs to provide:

- HTML file parsing or extraction
- stylesheet link normalization
- feed into engine external CSS input

### 6. Reporting and summary building

Need to rebuild:

- finding collation
- summary counts
- severity filtering semantics
- human-readable report formatting
- deterministic JSON formatting

### 7. Policy and exit-code behavior

Need to rebuild:

- fail-on-severity policy
- distinction between findings and diagnostics
- JSON versus text output semantics

### 8. Tests

Need to rebuild:

- engine-level tests around normalized analysis contracts
- product integration tests around filesystem scanning
- CLI tests
- selected golden-output tests

### 9. Docs

Need to rebuild:

- API docs
- CLI docs
- config docs
- rule docs
- current project status docs

## Product Functionality That Is Safe To Trim During The Reboot

The reboot should intentionally keep scope small until the new contract settles.

### Safe trims

- shadow-mode comparison against the deleted scanner
- advanced config discovery beyond project-local `scan-react-css.json`
- `print-config`
- multiple verbosity tiers
- advanced output file collision behavior
- remote external CSS fetching
- ownership and organization rules
- migration-style rules and historical parity modes
- globally installed CLI polish beyond standard npm `bin`

### Candidate trims for v1

These depend on your appetite for scope, but they are reasonable to postpone:

- `focusPath`
- project-wide output filtering beyond simple severity filtering
- rich config override layering
- configurable rule families beyond on or off

## Product Ambiguities

These are the main unresolved product questions.

### 1. What is the minimum viable config?

Current decision:

- support `scan-react-css.json`
- centralize default rule severities in the rule catalogue
- allow rule severity overrides and disabled rules
- support a fail-threshold setting
- keep the first stable config minimal

Still open:

- whether advanced discovery should return later
- how much old config compatibility is worth preserving

### 2. How much of the analysis should be exposed publicly?

Current decision:

- raw `ProjectAnalysis` should not be exposed in CLI JSON
- `scanProject()` is the only stable public Node API
- engine analysis APIs can exist internally for product code and tests

### 3. What counts as stable output?

Current decision:

- CLI JSON should be deterministic and human-readable
- unsupported-analysis detail should normally surface at debug level
- raw analysis snapshots are not part of stable JSON output

Still open:

- whether finding ids are stable across versions
- whether JSON receives an explicit contract version field

### 4. What is the first supported project shape?

Questions still open:

- single-package React app only
- monorepo with multiple source roots
- path aliases and tsconfig paths
- HTML entrypoints required or optional

### 5. What external CSS story do we really want?

Questions still open:

- imported external CSS only
- declared global providers
- remote fetching
- HTML-linked remote stylesheets

The reboot should choose a minimal v1 instead of carrying all historical possibilities.

### 6. Do we preserve old rule names?

Current decision:

- prefer the reboot catalogue names
- keep semantics documented in `docs/design/rules-catalogue.md`
- do not treat old scanner parity as the main contract
- do not preserve old rule ids as migration aliases in the clean reboot contract

Still open:

- how rule ids are versioned once the package contract stabilizes

## Recommended Product Direction

The product shell should be rebuilt as a thin wrapper around the engine.

### Recommended next slice

1. Stabilize the `scanProject()` result contract.
2. Add summary building and deterministic JSON/text output.
3. Finish CLI argument parsing and exit-code behavior.
4. Add tests for the CLI and result contract.
5. Then move to CSS Module analysis and rules.

### Recommended principle

The product should not try to simulate the deleted scanner architecture.

Instead it should:

- load projects
- invoke normalized engine analysis
- run thin rules
- format stable results

That keeps the shell replaceable and lets the engine stay focused.
