# couch-potato

## Plain markdown for LLM-facing text

For any markdown that ships to an LLM — system prompts in `src/commands/work.ts`,
the LLM prompt in `src/core/summarize.ts`, the shadow `CLAUDE.md` template
written by `src/commands/init.ts`, and any generated `_MAP.md` content — do not
use `**bold**` decoration. The model treats it as marginal statistical signal
at best while costing tokens; emphasis comes from sentence structure, position,
section headers, and numbered lists. Reserve markdown decoration for
human-targeted docs only (README and similar).

This file is itself loaded into Claude's context via Claude Code's CLAUDE.md
mechanism, so the rule applies here too.

## No backward compatibility

When changing on-disk formats, CLI flags, config schemas, or internal APIs:

- Don't add migration shims, format-version probes, or `if (legacy) ...` branches.
- Don't keep deprecated fields, flags, or exports "just in case".
- Existing shadows are disposable — `couch-potato init` rebuilds them.

The only exception is when a graceful re-sync naturally regenerates the new
format (e.g. missing sidecar → treated as stale → next sync rewrites both files).
