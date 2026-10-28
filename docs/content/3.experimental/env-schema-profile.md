---
title: Environment schema profile
description: The experimental env-spec-v1 contract for committed environment declarations.
---

The experimental `env-spec-v1` profile treats a committed `.env.example` as a shared schema. Enabling the feature is explicit. Existing example files keep their usual meaning until the feature is enabled.

The file owns names, descriptions, types, requiredness, sensitivity and defaults. Framework adapters own loading, public prefixes and runtime validation. The profile does not read `.env`, fetch secrets or evaluate expressions.

```dotenv
# @defaultRequired=true @defaultSensitive=true
# ---

# Database connection supplied by the deployment environment.
# @type=url @example="https://database.example.test"
DATABASE_URL=

# @type=number(min=1, max=65535, isInt=true) @public
PORT=3000

# @type=boolean @public
ENABLE_SEARCH=false

# @type=enum(debug, info, warn, error) @public
LOG_LEVEL=info

# @optional @public
OPTIONAL_LABEL=
```

This reuses [@env-spec syntax](https://varlock.dev/env-spec/reference/) and a restricted set of [Varlock decorators](https://varlock.dev/reference/item-decorators/). It defines its own named semantic profile. The syntax specification alone does not define decorator meanings, and this profile does not implement the full Varlock runtime.

## Declarations and metadata

Names follow `[A-Za-z_][A-Za-z0-9_]*`. Duplicate names, names longer than 256 characters and the names `__proto__`, `prototype` and `constructor`, ignoring case, are rejected. Definitions preserve source filename and declaration line.

Comments directly before a declaration become its description. Blank lines and dividers end attachment. Comments that look like disabled assignments are excluded from descriptions. Inline comments and single or double quoted values follow the upstream parser. Decorators may share a comment line. Duplicate decorators, unsupported decorators and conflicting aliases are errors.

Root decorators must be in a header ending with `# ---`. Only `@defaultRequired` and `@defaultSensitive` are supported there, both with static boolean values. Both default to `true`. An item can override those defaults.

| Item decorator | Meaning |
| --- | --- |
| `@type=string` | String output. This is always the default type. |
| `@type=string(minLength=1, maxLength=80)` | Inclusive string length constraints. |
| `@type=number(min=0, max=100, isInt=true)` | Finite numeric output with optional bounds and integer constraint. |
| `@type=boolean` | Boolean output. |
| `@type=enum(debug, info, error)` | One of the listed strings. Quote numeric or boolean-looking choices. |
| `@type=url` | An absolute URL accepted by the platform `URL` constructor. Output remains a string. |
| `@required` / `@required=false` | Whether a resolved value must be present and nonempty. |
| `@optional` / `@optional=false` | Inverse of `@required`. Do not combine both decorators. |
| `@sensitive` / `@sensitive=false` | Whether the field must remain private. |
| `@public` / `@public=false` | Inverse of `@sensitive`. Do not combine both decorators. |
| `@example="sample"` | Documentation only. Never supplies a runtime default. |

No type is inferred from assignment values or developer environment files. For example, `TOKEN=00123` and `FLAG=true` both declare strings unless `@type` says otherwise. String defaults preserve their lexical contents, including leading zeroes.

## Defaults, missing values and empty strings

A nonempty assignment is a real default. `KEY=` declares no default. `KEY=""` explicitly declares an empty string. This differs from [dotenv-safe](https://www.npmjs.com/package/dotenv-safe), which uses example values only as documentation, and from ordinary dotenv loaders, which parse `KEY=` as an empty string.

Use `@example` for a placeholder. Copying an existing `.env.example` into this feature without reviewing its assignment values can turn placeholders into defaults.

Defaults are checked against the declared type and constraints. Invalid defaults fail with the filename, line and key. A present invalid runtime override must fail rather than silently falling back to a default.

Required strings reject an explicit empty default. Optional strings preserve an explicit empty default. For optional number, boolean, enum and URL fields, an explicit empty default means no default. Framework adapters must normalize an empty runtime input for those optional types to `undefined` before applying a default or validating. They must preserve `""` for optional strings. Required runtime empty inputs fail validation.

Numeric defaults accept finite decimal notation, including exponents, and reject hexadecimal, `NaN` and `Infinity`. Boolean defaults accept `true`, `false`, `1` and `0`. Whitespace inside quoted values is preserved for strings; typed numeric and boolean conversion trims it.

## Boundaries and unsupported syntax

The parser returns serializable metadata. It does not modify `process.env`, generate declarations or publish values to the browser. `process.env.PORT` remains `string | undefined`. A validated output may be `number` only after the framework adapter converts and checks the actual input.

Public metadata does not replace a framework's exposure rules. A Nuxt adapter must still enforce `NUXT_PUBLIC_` and prevent sensitive values from entering public runtime config. The same metadata can inform a Vite adapter without sharing Nuxt's environment reader.

Expansions, shell commands, secret-provider functions, dynamic decorators, arrays, objects, custom types and unknown type arguments are rejected. Only static type constraint calls and enum declarations are accepted. Unsupported syntax fails instead of producing declarations that promise unchecked runtime values.

Errors contain locations and rule names, never assignment values or the upstream parser's source excerpt.
