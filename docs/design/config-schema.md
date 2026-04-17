# JSON Config Schema Design

## Purpose

This document proposes the JSON configuration model for `react-css-scanner`.

The design goal is:

- sensible defaults for the majority of React projects
- low-friction setup for common cases
- enough flexibility to support different project structures
- minimal per-rule fiddling unless a project genuinely needs it

## Design principles

- Prefer a small number of top-level concepts over many tiny switches.
- Make common React project conventions work without much configuration.
- Default to useful behavior for `src`-based apps.
- Let projects override structure and policy without redefining every rule.
- Separate project structure configuration from rule tuning.

## Configuration philosophy

Most projects should only need to configure:

- where the app source lives if it is not `src`
- which CSS should be treated as global
- policy thresholds

Everything else should have idiomatic defaults.

## Proposed config file

Default filename:

- `react-css-scanner.json`

JSON should be the default and documented path.

## Config discovery

The scanner should support predictable config lookup without requiring every project to pass a config path manually.

### Default behavior

- Look for `react-css-scanner.json` in the project root.
- If no project-local config is found, and `REACT_CSS_SCANNER_CONFIG_DIR` is set, look for `react-css-scanner.json` there next.

### Alternate/global location

- Support a global config directory via `REACT_CSS_SCANNER_CONFIG_DIR`.
- Support an explicit CLI/API override such as `--config path/to/file.json`.
- If neither of those produces a config, search the OS `PATH` for the first file named `react-css-scanner.json`.

Example:

- if `REACT_CSS_SCANNER_CONFIG_DIR=/Users/alice/.config/react-css-scanner`
- and there is no `react-css-scanner.json` in the project root
- then the scanner should look for `/Users/alice/.config/react-css-scanner/react-css-scanner.json`

### Why this matters

- Some users may want one shared config across multiple local projects.
- Some teams may want to standardize scanner behavior in CI or on managed machines.
- This should complement local project config, not replace it as the normal default.

### Proposed precedence

1. explicit config path from CLI or API
2. project-root `react-css-scanner.json`
3. `REACT_CSS_SCANNER_CONFIG_DIR/react-css-scanner.json`
4. first matching `react-css-scanner.json` found on the OS `PATH`
5. built-in defaults

### Resolution model

- The scanner should read from exactly one config file.
- It should not merge values from multiple discovered config files in MVP.
- If no config file is found, it should use built-in defaults and emit a terminal warning recommending that the user create a config file.

## Proposed top-level shape

```json
{
  "$schema": "./node_modules/react-css-scanner/schema.json",
  "rootDir": ".",
  "source": {
    "include": ["src"],
    "exclude": ["dist", "build", "coverage", "node_modules"]
  },
  "css": {
    "global": [],
    "utilities": ["**/utilities.css", "**/utilities/**/*.css"],
    "modules": {
      "enabled": true,
      "patterns": ["**/*.module.css"]
    }
  },
  "ownership": {
    "pagePatterns": ["src/pages/**/*", "src/routes/**/*"],
    "componentCssPatterns": [],
    "namingConvention": "off"
  },
  "externalCss": {
    "enabled": true,
    "mode": "imported-only"
  },
  "classComposition": {
    "helpers": ["classnames", "clsx"]
  },
  "policy": {
    "failOnSeverity": "error"
  },
  "rules": {
    "missing-css-class": "error",
    "unreachable-css": "error",
    "unused-css-class": "warning",
    "global-css-not-global": "warning",
    "component-css-should-be-global": {
      "severity": "info",
      "threshold": 8
    },
    "utility-class-replacement": {
      "severity": "info",
      "minDeclarationOverlap": 2
    },
    "repeated-style-pattern": {
      "severity": "info",
      "minOccurrences": 3,
      "minDeclarations": 3
    }
  }
}
```

## Recommended top-level sections

### `rootDir`

Purpose:

- defines the project root used for path resolution

Default:

- `"."`

### `source`

Purpose:

- controls which source tree is scanned

Proposed shape:

```json
{
  "source": {
    "include": ["src"],
    "exclude": ["dist", "build", "coverage", "node_modules"]
  }
}
```

Defaults:

- `include`: `["src"]`
- `exclude`: `["dist", "build", "coverage", "node_modules"]`

Meaning:

- include and exclude values should be repo-relative globs

Why:

- Most React projects use `src`.
- Most projects want standard build output directories excluded.

### `css`

Purpose:

- defines how project CSS should be categorized

Proposed shape:

```json
{
  "css": {
    "global": [],
    "utilities": ["**/utilities.css", "**/utilities/**/*.css"],
    "modules": {
      "enabled": true,
      "patterns": ["**/*.module.css"]
    }
  }
}
```

#### `css.global`

Purpose:

- directories or file globs treated as globally reachable CSS

Examples:

- `"src/styles/global"`
- `"src/app.css"`

Default:

- `[]`

#### `css.modules`

Purpose:

- controls CSS Module recognition

Defaults:

- `enabled`: `true`
- `patterns`: `["**/*.module.css"]`

Why:

- This is a strong convention and should work out of the box for most projects.

#### `css.utilities`

Purpose:

- directories or file globs treated as utility-class sources for utility/advisory rules

Examples:

- `"src/styles/utilities.css"`
- `"src/styles/utilities/**/*.css"`

Defaults:

- `["**/utilities.css", "**/utilities/**/*.css"]`

Why:

- Some projects maintain a dedicated utility stylesheet or utility directory.
- A file literally named `utilities.css` is a sensible convention-based default.
- This should support advisory rules such as `utility-class-replacement` without forcing every project to configure it manually.

Important distinction:

- `css.global` affects reachability and ownership behavior
- `css.utilities` identifies a source of reusable utility styles for advisory/replacement rules

### `externalCss`

Purpose:

- controls treatment of dependency CSS

Proposed shape:

```json
{
  "externalCss": {
    "enabled": true,
    "mode": "imported-only"
  }
}
```

Defaults:

- `enabled`: `true`
- `mode`: `"imported-only"`

Meaning:

- only external CSS files that are actually imported by the project are resolved and parsed

Why:

- This matches the architecture decision for MVP.
- It avoids scanning all of `node_modules`.

### `ownership`

Purpose:

- controls ownership classification needed by ownership-oriented MVP rules

Proposed shape:

```json
{
  "ownership": {
    "pagePatterns": ["src/pages/**/*", "src/routes/**/*"],
    "componentCssPatterns": [],
    "namingConvention": "off"
  }
}
```

#### `ownership.pagePatterns`

Purpose:

- repo-relative globs that identify page-level source or CSS areas

Defaults:

- `["src/pages/**/*", "src/routes/**/*"]`

Why:

- This supports rules such as `page-style-used-by-single-component`.

#### `ownership.componentCssPatterns`

Purpose:

- repo-relative globs that identify directories or files that should be treated as component-local CSS

Examples:

- `"src/ui/**/*.css"`
- `"src/components/**/*.module.css"`

Defaults:

- `[]`

Why:

- This supports rules such as `component-style-cross-component`.
- Projects can use it to declare patterns like "everything under `client/ui` is component CSS."

#### `ownership.namingConvention`

Purpose:

- enables additional ownership inference based on component/CSS sibling naming conventions

Allowed values:

- `"off"`
- `"sibling"`

Default:

- `"off"`

Meaning:

- `"sibling"` means that if a component file and a CSS file are sibling files with matching base names such as `Button.tsx` and `Button.css`, the CSS can additionally be treated as component-local CSS

Why:

- This is opinionated, so it should be opt-in.
- It also creates a foundation for future convention modes without forcing them into MVP now.

### `classComposition`

Purpose:

- controls native understanding of class-composition helpers

Proposed shape:

```json
{
  "classComposition": {
    "helpers": ["classnames", "clsx"]
  }
}
```

Defaults:

- `helpers`: `["classnames", "clsx"]`

Why:

- These are common enough to support natively.
- Most projects should not have to configure them manually.

### `policy`

Purpose:

- controls pass/fail behavior

Proposed shape:

```json
{
  "policy": {
    "failOnSeverity": "error"
  }
}
```

Default:

- `"error"`

Meaning:

- findings at severity `error` fail the scan
- warnings and info do not fail the scan by default

### `rules`

Purpose:

- allows lightweight rule overrides without forcing verbose config for every rule

Proposed ergonomic shape:

```json
{
  "rules": {
    "missing-css-class": "error",
    "unreachable-css": "error",
    "unused-css-class": "warning",
    "global-css-not-global": "off"
  }
}
```

Meaning:

- string shorthand should be the common path
- if a project only wants severity control, it should not need object syntax
- object syntax should be available for rules that need additional config

Proposed allowed values:

- `"off"`
- `"info"`
- `"warning"`
- `"error"`

Expanded object form:

```json
{
  "rules": {
    "component-css-should-be-global": {
      "severity": "info",
      "threshold": 8
    },
    "utility-class-replacement": {
      "severity": "info",
      "minDeclarationOverlap": 2
    },
    "repeated-style-pattern": {
      "severity": "info",
      "minOccurrences": 3,
      "minDeclarations": 3
    }
  }
}
```

Why:

- Rule-specific tuning belongs with the rule rather than in unrelated top-level sections.
- This keeps ownership config focused on ownership classification, not advisory thresholds.

## Recommended default behavior

If no config file is present, the scanner should behave roughly like this:

```json
{
  "rootDir": ".",
  "source": {
    "include": ["src"],
    "exclude": ["dist", "build", "coverage", "node_modules"]
  },
  "css": {
    "global": [],
    "utilities": ["**/utilities.css", "**/utilities/**/*.css"],
    "modules": {
      "enabled": true,
      "patterns": ["**/*.module.css"]
    }
  },
  "externalCss": {
    "enabled": true,
    "mode": "imported-only"
  },
  "ownership": {
    "pagePatterns": ["src/pages/**/*", "src/routes/**/*"],
    "componentCssPatterns": [],
    "namingConvention": "off"
  },
  "classComposition": {
    "helpers": ["classnames", "clsx"]
  },
  "policy": {
    "failOnSeverity": "error"
  },
  "rules": {
    "component-css-should-be-global": {
      "severity": "info",
      "threshold": 8
    },
    "repeated-style-pattern": {
      "severity": "info",
      "minOccurrences": 3,
      "minDeclarations": 3
    },
    "utility-class-replacement": {
      "severity": "info",
      "minDeclarationOverlap": 2
    }
  }
}
```

This should work for many React projects without any setup beyond installation.

If this built-in default is used because no config file was discovered, the scanner should emit a warning in terminal output recommending creation of a config file.

## Why not make everything a rule option

Project structure concerns such as:

- what counts as global CSS
- what counts as page CSS
- what counts as component-local CSS
- where source files live

should not be configured separately inside every rule.

That would create repetitive, fiddly config and make rule behavior harder to reason about.

Instead:

- structure belongs in top-level config
- rules consume the normalized project model produced from that structure

## Suggested validation rules

- reject unknown top-level keys in strict mode
- validate severity strings
- validate helper list as an array of strings
- validate include/exclude/global/utilities as arrays of strings
- validate ownership page/component patterns as arrays of strings
- validate `ownership.namingConvention` against an enum
- validate `externalCss.mode` against an enum
- validate supported rule object fields
- validate numeric rule thresholds as positive integers

## Design summary

The proposed JSON schema should:

- assume `src` by default
- treat CSS Modules as enabled by convention
- detect common utility CSS via filenames such as `utilities.css`
- support explicit ownership classification for page and component CSS
- treat external CSS as `imported-only`
- support `classnames` and `clsx` natively
- load exactly one config source based on a predictable precedence order
- use top-level structure config instead of per-rule duplication
- keep rule overrides lightweight and ergonomic

That balance should make the scanner adaptable without turning configuration into a chore.

