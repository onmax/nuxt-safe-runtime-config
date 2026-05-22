# Safe Runtime Config

This context defines the project language for validating Nuxt and Nitro runtime configuration.

## Language

**Runtime validation**:
Validation of the resolved server runtime config when Nitro starts.
_Avoid_: startup validation, server validation

**Build validation**:
Validation of configured runtime config during Nuxt or Nitro build hooks.
_Avoid_: compile-time validation, static validation

## Relationships

- **Runtime validation** happens after runtime environment values have been resolved.
- **Build validation** happens before the server starts.

## Example dialogue

> **Dev:** "Should this failure be handled by **Build validation**?"
> **Domain expert:** "No, it depends on the server's resolved environment, so it belongs to **Runtime validation**."

## Flagged ambiguities

- "runtime validation" means validation when Nitro starts, not validation inside the Vue app runtime.
