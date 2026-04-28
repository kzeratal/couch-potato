const ZSH = `#compdef couch-potato

_couch_potato() {
  local -a subcmds
  subcmds=(
    'init:Mirror a real repo as _MAP.md placeholders'
    'scan:Walk shadow and LLM-summarize each dir'
    'status:Diff shadow against real repo'
    'sync:Refresh stale/new/orphan dirs in shadow'
    'work:Spawn claude in real repo with shadow injected'
    'completion:Print shell completion script'
    'version:Print version'
  )

  _arguments -C \\
    '1: :->subcmd' \\
    '*::arg:->args'

  case $state in
    subcmd)
      _describe 'subcommand' subcmds
      ;;
    args)
      case $line[1] in
        init)
          _arguments \\
            '--shadow[shadow directory]:dir:_directories' \\
            '*:real repo path:_directories'
          ;;
        scan)
          _arguments \\
            '--shadow[shadow directory]:dir:_directories' \\
            '--scope[limit to subtree]:path:' \\
            '--concurrency[parallel workers]:N:' \\
            '--force[force rescan]'
          ;;
        status)
          _arguments \\
            '--shadow[shadow directory]:dir:_directories' \\
            '--scope[limit to subtree]:path:'
          ;;
        sync)
          _arguments \\
            '--shadow[shadow directory]:dir:_directories' \\
            '--scope[limit to subtree]:path:' \\
            '--concurrency[parallel workers]:N:'
          ;;
        work)
          _arguments \\
            '--real[real repo path]:dir:_directories' \\
            '--shadow[shadow directory]:dir:_directories' \\
            '--skip-sync[do not auto-sync after claude exits]' \\
            '--print-prompt[print system prompt and exit]'
          ;;
        completion)
          _values 'shell' bash zsh fish
          ;;
      esac
      ;;
  esac
}

_couch_potato "$@"
`;

const BASH = `# bash completion for couch-potato
_couch_potato_complete() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    words=("\${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  }

  local subcmds="init scan status sync work completion version"

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$subcmds" -- "$cur") )
    return
  fi

  case "$prev" in
    --shadow|--real)
      compopt -o dirnames 2>/dev/null
      COMPREPLY=( $(compgen -d -- "$cur") )
      return
      ;;
    --scope|--concurrency)
      return
      ;;
  esac

  local subcmd="\${words[1]}"
  case "$subcmd" in
    init)
      if [[ "$cur" == --* ]]; then
        COMPREPLY=( $(compgen -W "--shadow" -- "$cur") )
      else
        COMPREPLY=( $(compgen -d -- "$cur") )
      fi
      ;;
    scan)
      COMPREPLY=( $(compgen -W "--shadow --scope --concurrency --force" -- "$cur") )
      ;;
    status)
      COMPREPLY=( $(compgen -W "--shadow --scope" -- "$cur") )
      ;;
    sync)
      COMPREPLY=( $(compgen -W "--shadow --scope --concurrency" -- "$cur") )
      ;;
    work)
      COMPREPLY=( $(compgen -W "--real --shadow --skip-sync --print-prompt" -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
      ;;
  esac
}
complete -F _couch_potato_complete couch-potato
`;

const FISH = `# fish completion for couch-potato
complete -c couch-potato -n '__fish_use_subcommand' -a init       -d 'Mirror a real repo as _MAP.md placeholders'
complete -c couch-potato -n '__fish_use_subcommand' -a scan       -d 'Walk shadow and LLM-summarize each dir'
complete -c couch-potato -n '__fish_use_subcommand' -a status     -d 'Diff shadow against real repo'
complete -c couch-potato -n '__fish_use_subcommand' -a sync       -d 'Refresh stale/new/orphan dirs in shadow'
complete -c couch-potato -n '__fish_use_subcommand' -a work       -d 'Spawn claude in real repo with shadow injected'
complete -c couch-potato -n '__fish_use_subcommand' -a completion -d 'Print shell completion script'
complete -c couch-potato -n '__fish_use_subcommand' -a version    -d 'Print version'

# init: positional dir
complete -c couch-potato -n '__fish_seen_subcommand_from init' -a '(__fish_complete_directories)'
complete -c couch-potato -n '__fish_seen_subcommand_from init' -l shadow -r -F -d 'Shadow directory'

# scan
complete -c couch-potato -n '__fish_seen_subcommand_from scan' -l shadow      -r -F -d 'Shadow directory'
complete -c couch-potato -n '__fish_seen_subcommand_from scan' -l scope       -r    -d 'Limit to subtree'
complete -c couch-potato -n '__fish_seen_subcommand_from scan' -l concurrency -r    -d 'Parallel workers'
complete -c couch-potato -n '__fish_seen_subcommand_from scan' -l force            -d 'Force rescan'

# status
complete -c couch-potato -n '__fish_seen_subcommand_from status' -l shadow -r -F -d 'Shadow directory'
complete -c couch-potato -n '__fish_seen_subcommand_from status' -l scope  -r    -d 'Limit to subtree'

# sync
complete -c couch-potato -n '__fish_seen_subcommand_from sync' -l shadow      -r -F -d 'Shadow directory'
complete -c couch-potato -n '__fish_seen_subcommand_from sync' -l scope       -r    -d 'Limit to subtree'
complete -c couch-potato -n '__fish_seen_subcommand_from sync' -l concurrency -r    -d 'Parallel workers'

# work
complete -c couch-potato -n '__fish_seen_subcommand_from work' -l real         -r -F -d 'Real repo path'
complete -c couch-potato -n '__fish_seen_subcommand_from work' -l shadow       -r -F -d 'Shadow directory'
complete -c couch-potato -n '__fish_seen_subcommand_from work' -l skip-sync          -d 'Skip auto-sync'
complete -c couch-potato -n '__fish_seen_subcommand_from work' -l print-prompt       -d 'Print prompt'

# completion
complete -c couch-potato -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
`;

// NOTE on duplication: each new flag added to scan/sync/status/work needs to
// be reflected in three places below (zsh, bash, fish). At ~5 commands and
// ~12 flags this is tolerable. If the surface keeps growing, define commands
// and flags once as data and generate the three scripts from it.
const SCRIPTS: Record<string, string> = {
  zsh: ZSH,
  bash: BASH,
  fish: FISH,
};

const HELP = `usage: couch-potato completion <shell>
shells: ${Object.keys(SCRIPTS).join(", ")}

Install (zsh):
  mkdir -p ~/.zfunc
  couch-potato completion zsh > ~/.zfunc/_couch-potato
  echo 'fpath=(~/.zfunc $fpath); autoload -U compinit && compinit' >> ~/.zshrc

Install (bash):
  couch-potato completion bash > ~/.local/share/bash-completion/completions/couch-potato

Install (fish):
  couch-potato completion fish > ~/.config/fish/completions/couch-potato.fish
`;

export function completion(argv: string[]): void {
  const arg = argv[0];

  if (arg === "-h" || arg === "--help") {
    process.stdout.write(HELP);
    return;
  }
  if (!arg) {
    throw new Error(`missing shell argument (supported: ${Object.keys(SCRIPTS).join(", ")})`);
  }

  const script = SCRIPTS[arg];
  if (!script) {
    throw new Error(`unsupported shell: ${arg} (supported: ${Object.keys(SCRIPTS).join(", ")})`);
  }
  process.stdout.write(script);
}
