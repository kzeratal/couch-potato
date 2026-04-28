# couch-potato

## No backward compatibility

When changing on-disk formats, CLI flags, config schemas, or internal APIs:

- Don't add migration shims, format-version probes, or `if (legacy) ...` branches.
- Don't keep deprecated fields, flags, or exports "just in case".
- Existing shadows are disposable — `couch-potato init` rebuilds them.

The only exception is when a graceful re-sync naturally regenerates the new
format (e.g. missing sidecar → treated as stale → next sync rewrites both files).
