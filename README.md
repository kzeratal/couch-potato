# couch-potato

A **code virtual map** generator for Claude Code. Pre-summarize a repository's
directories into compact, hash-pinned `_MAP.md` files that live in a separate
shadow location (out of the way of the product repo) so Claude can navigate
big codebases fast — without polluting the real repo with AI metadata.

## Why

Plain `claude` in a large repo spends real time `grep`-ing and `Read`-ing
files just to build a mental model. couch-potato pre-builds that model:

- Per-directory summary: `purpose`, `entries`, `deps`, `gotchas`.
- Hash-pinned to git blob hashes — staleness is mathematically detectable.
- Shadow lives at `~/.couch-potato/projects/<repo-name>/`, never in the product repo.
- A wrapper command spawns `claude` with the root map injected into the
  system prompt; auto-syncs changed maps when the session ends.

## Install

Requires **Node.js ≥ 18** and the **`claude` CLI** (Claude Code) on your PATH.

```bash
# one-shot
npx @skzeratal/couch-potato init /path/to/repo

# or install globally
npm install -g @skzeratal/couch-potato
couch-potato init /path/to/repo
```

> **Upgrading:** the default shadow root moved from `~/couch-potato` to `~/.couch-potato`. If you have existing shadows, run `mv ~/couch-potato ~/.couch-potato`.

## Quick start

```bash
# 1. Mirror the repo's directory tree into a shadow (cheap, no LLM)
couch-potato init /path/to/your-repo

# 2. Fill the map (or just a subtree) with LLM-generated summaries.
#    From inside the real repo, sync auto-resolves the matching shadow.
cd /path/to/your-repo
couch-potato sync
# or incrementally:
couch-potato sync --scope src/feature

# 3. Work with Claude — wrapper auto-injects the map and auto-syncs on exit
couch-potato work
```

## Commands

| | |
|---|---|
| `couch-potato init <repo>` | Mirror full repo as `_MAP.md` placeholders. |
| `couch-potato scan` | Walk shadow bottom-up and LLM-summarize each dir. `--scope <subpath>` to filter. |
| `couch-potato sync` | Detect stale/new/orphan dirs from real repo, refresh affected. `--scope` to limit. |
| `couch-potato status` | Diff shadow against real repo. `--scope` to limit. |
| `couch-potato work` | Spawn `claude` in the real repo with the shadow's root map injected as system prompt. |
| `couch-potato completion <shell>` | Print zsh / bash / fish completion script. |

`scan`, `sync`, `status`, and `work` auto-resolve the shadow when run from inside the real repo (or from the shadow itself). Pass `--shadow <dir>` to override; `--concurrency N` (scan/sync) sets parallel workers; `--scope <path>` limits the operation to a subtree.

## Shell completion

```bash
# zsh
mkdir -p ~/.zfunc
couch-potato completion zsh > ~/.zfunc/_couch-potato
echo 'fpath=(~/.zfunc $fpath); autoload -U compinit && compinit' >> ~/.zshrc

# bash
couch-potato completion bash > ~/.local/share/bash-completion/completions/couch-potato

# fish
couch-potato completion fish > ~/.config/fish/completions/couch-potato.fish
```

## How it stays fresh

Each `_MAP.md` records a git blob hash for every file it summarizes plus a
git tree hash for the directory. `couch-potato sync` compares those against
`git ls-tree HEAD` of the real repo and re-summarizes only what changed.
Children change → ancestors get re-rolled-up too.

## License

MIT
