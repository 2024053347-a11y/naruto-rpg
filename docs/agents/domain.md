# Domain Docs

How the engineering skills should consume this repository's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- `docs/adr/` for decisions that touch the area being examined.

If these files do not exist, proceed silently. The producer skill creates them lazily when domain terms or decisions are resolved.

## File structure

This is a single-context repository. Domain terminology belongs in root `CONTEXT.md`; architectural decisions belong in `docs/adr/`.

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. If a required concept is absent, reconsider whether new language is being invented or note a genuine glossary gap.

## Flag ADR conflicts

Surface any contradiction with an existing ADR explicitly instead of silently overriding it.
