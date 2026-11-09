<div align="center">

# opencode-group-chat

**Multi-agent group chat rooms for [OpenCode](https://opencode.ai)**

Hermes-style turn-taking between AI personas — Architect, Implementer, Reviewer, Tester —
working on **one shared project** inside a single OpenCode session.

[![License: MIT](https://img.shields.io/badge/License-MIT-059669.svg?style=flat-square)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-V2%20plugin%20API-d97706.svg?style=flat-square)](https://opencode.ai/docs)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-3f3f46.svg?style=flat-square)](#install)
[![Live demo](https://img.shields.io/badge/%F0%9F%9A%80-Live%20demo-e11d48.svg?style=flat-square)](https://farazjz.github.io/opencode-groupchat/)

</div>

---

Open a **room** in any OpenCode session and several agent personas take turns on a shared
goal: each one sees the transcript, does real tool work on its turn (edits files, runs
tests), hands the floor to a specific member with `[NEXT: member]`, and calls `DONE` when
the group's goal is reached. A bounded scheduler keeps the conversation converging — no
infinite loops, and you can interject at any time by typing.

```text
 you ─▶ /group start refactor the auth module
        ┌──────────────────────────────────────────────┐
        │  [GROUP CHAT] turn 1/16                      │
        │  Architect:  split into 3 tasks… [NEXT:      │
        │              implementer]                    │
        │  Implementer: edits src/auth/*.ts …          │
        │  Reviewer:   the token TTL is unchecked…     │
        │  Tester:     tests fail on expiry…           │
        │  Implementer: fixes, tests pass … DONE       │
        └──────────────────────────────────────────────┘
 you ◀─  [GROUP CHAT] room closed, control restored
```

## Features

- **🎭 Persona agents** — Architect, Implementer, Reviewer and Tester out of the box;
  define your own cast in `opencode.json` (id, name, color, description, system prompt).
- **🗣️ Real turn-taking** — explicit hand-offs (`[NEXT: reviewer]`, `@reviewer`), a
  round-robin fallback, and a `DONE` marker to finish the room.
- **🛑 Bounded by design** — `maxTurns` (default 16) hard-stops the scheduler, as the
  OpenCode plugin API requires.
- **📝 Transcripts** — every room is written to `.opencode/group-chat/<sessionID>.md`.
- **💾 Restart-safe** — rooms persist in OpenCode storage and restore after a restart
  (`/group resume`).
- **🧩 Pure plugin** — built on public V2 plugin APIs only. No forks, no patches.

## How it works

| Group-chat need | Plugin primitive |
| --- | --- |
| Distinct participants | `ctx.agent.transform` — registers each persona as an agent |
| Open & manage rooms | `ctx.command.transform` — the `/group` slash command |
| Capture what was said | `ctx.event.subscribe()` — `session.step.started` / `session.text.ended` |
| Turn-taking engine | `ctx.session.hook("experimental.idle")` |
| Give the floor | `ctx.session.switchAgent(...)` |
| Prompt the next turn | `ctx.session.synthetic(...)` |
| Room persistence | `ctx.storage` |

Scheduling rules, in order:

1. A persona whose message ends with **`DONE`** finishes the room.
2. **`[NEXT: member]`** (or starting a message with `@member`) hands the floor to that
   member explicitly.
3. Otherwise the floor **rotates** through the roster (round-robin).
4. The room always stops after **`maxTurns`** turns.

## Install

> Requires [OpenCode V2](https://opencode.ai). No build step is needed — OpenCode loads
> TypeScript plugins directly.

### Option A — Local plugin on macOS & Linux

From your **project root**:

```bash
git clone https://github.com/Farazjz/opencode-groupchat.git
cp -r opencode-groupchat .opencode/plugins/group-chat
```

The folder keeps its `package.json`; OpenCode resolves the `./server` export and hot-reloads
the plugin while you work.

### Option B — Local plugin on Windows 🪟

Works natively in **PowerShell** or **CMD** — no WSL required. From your **project root**:

**PowerShell**

```powershell
# 1. Get the plugin
git clone https://github.com/Farazjz/opencode-groupchat.git

# 2. Create the project plugin directory (if missing) and copy the plugin in
New-Item -ItemType Directory -Force -Path ".opencode\plugins" | Out-Null
Copy-Item -Recurse -Force ".\opencode-groupchat" ".\.opencode\plugins\group-chat"

# 3. Start OpenCode in this project
opencode
```

**CMD**

```cmd
git clone https://github.com/Farazjz/opencode-groupchat.git
mkdir .opencode\plugins 2>nul
xcopy /E /I /Y opencode-groupchat .opencode\plugins\group-chat
```

**Where plugins live (all platforms)**

| Scope | Path |
| --- | --- |
| This project only | `<project>\.opencode\plugins\group-chat` |
| All your projects (global) | `%USERPROFILE%\.config\opencode\plugins\group-chat` (Windows) · `~/.config/opencode/plugins/group-chat` (macOS/Linux) |

To install **globally** on Windows, copy into the global folder instead:

```powershell
$dst = "$env:USERPROFILE\.config\opencode\plugins\group-chat"
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item -Recurse -Force ".\opencode-groupchat" $dst
```

> **WSL users:** if you run OpenCode *inside* WSL, follow the macOS/Linux steps and keep
> the plugin inside the WSL filesystem (e.g. `~/myproject/.opencode/plugins/group-chat`).
> WSL cannot reliably load plugins from Windows paths like `C:\…`.

> **Tip:** your terminal's current directory *is* the project — `.opencode\plugins` is
> always relative to where you launch `opencode`.

### Option C — From npm

```bash
npm i -g opencode-group-chat      # or bun / pnpm / yarn
```

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-group-chat"]
}
```

Then start `opencode` in your project — you should see the `/group` command.

> 🚀 **New here?** Follow the [step-by-step tutorial](#step-by-step-tutorial) below —
> from a clean machine to your first multi-agent group chat in about five minutes.

## Step-by-step tutorial

From zero to your first group chat in ~5 minutes. Everything happens in the project you
want the agents to work on; macOS/Linux and Windows commands are both shown.

### Step 1 — Install OpenCode & connect a model

One-time setup. The personas are regular OpenCode agents, so they need a reachable model.

```bash
# macOS · Linux · WSL
curl -fsSL https://opencode.ai/install | bash
# or: npm i -g opencode-ai   ·   or: brew install sst/tap/opencode
```

```powershell
# Windows (PowerShell) — needs Node.js ≥ 18
npm i -g opencode-ai
```

Then connect any provider once and confirm the install:

```bash
opencode auth login   # pick a provider (Anthropic, OpenAI, …) and sign in
opencode --version
```

✓ Done when `opencode --version` prints a version.

### Step 2 — Drop the plugin into your project

Run this in your **project root** — the folder the agents will work on. OpenCode loads
every plugin it finds under `.opencode/plugins/`, no build step needed.

```bash
# macOS · Linux · WSL
cd my-project
git clone https://github.com/Farazjz/opencode-groupchat.git
mkdir -p .opencode/plugins
cp -r opencode-groupchat .opencode/plugins/group-chat
```

```powershell
# Windows (PowerShell)
cd my-project
git clone https://github.com/Farazjz/opencode-groupchat.git
New-Item -ItemType Directory -Force -Path ".opencode\plugins" | Out-Null
Copy-Item -Recurse -Force ".\opencode-groupchat" ".\.opencode\plugins\group-chat"
```

Your project should now contain:

```text
my-project/
└─ .opencode/
   └─ plugins/
      └─ group-chat/
         ├─ package.json      ← tells OpenCode how to load it
         ├─ README.md
         └─ src/
            └─ index.ts       ← the whole plugin
```

> 💡 Install once for **all** projects: copy the folder to
> `%USERPROFILE%\.config\opencode\plugins\group-chat` (Windows) or
> `~/.config/opencode/plugins/group-chat` (macOS/Linux) instead.

### Step 3 — Start OpenCode and verify the plugin loaded

From the same project root:

```bash
opencode
```

Two ways to confirm it is alive:

1. Type `/` in the input — `group` appears in the command list.
2. The startup log prints the persona agents registering:

```text
[group-chat] persona agents ready: architect, implementer, reviewer, tester
```

> **Troubleshooting:** no `/group`? The plugin didn't load — check that
> `.opencode/plugins/group-chat/package.json` exists (it must not be nested one level
> deeper, like `group-chat/opencode-groupchat/`) and restart `opencode`. Seeing
> `Agent not found: "architect"`? You have an old **v0.1.0** copy — re-download;
> v0.1.1+ registers the agents at startup.

### Step 4 — Open your first room

Type the `/group` command with a real goal — the same kind of thing you'd ask OpenCode
directly:

```text
/group start add rate limiting to the API
```

You'll see the room open and the first persona take the floor:

```text
[GROUP CHAT] Room started — "add rate limiting to the API".
Members: Architect, Implementer, Reviewer, Tester.
They will take turns until the goal is DONE or 16 turns pass. You can interject any time.

Architect:  Plan: 1) token-bucket middleware… [NEXT: implementer]
```

✓ The room is now live on this session — turns advance automatically.

### Step 5 — Watch and steer the group

Each persona does **real tool work** on its turn — edits files, runs commands — then
hands the floor on with `[NEXT: member]`. You stay in control:

- **Interject any time:** just type — your message goes to the member holding the floor,
  e.g. *"focus on the login endpoint first"*.
- **Check state:** `/group status` — roster, turns used, current speaker.
- **Change the cast:** `/group add tester` or `/group remove tester` (any registered
  persona id).

```text
/group status
```

```text
[GROUP CHAT] Room "add rate limiting to the API" — active
Turns: 3/16 · Speaker: Implementer
Members: Architect, Implementer, Reviewer, Tester
```

### Step 6 — Close the room and read the transcript

The group ends itself when a message ends with `DONE` (or after `maxTurns`). You can
close early at any moment:

```text
/group stop
```

Closing restores your previous agent (e.g. `build`) so you keep working normally. Every
room is written to disk — dump or find it here:

```text
/group transcript
```

```text
[GROUP CHAT] Transcript (6 turns) saved to
  my-project/.opencode/group-chat/ses_5f3a….md
```

### Step 7 — Make it yours (optional)

Add your own personas, trim the roster, or bound the room length — all from
`opencode.json` (see [Configuration](#configuration)):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": { "opencode-group-chat": { "options": {
    "maxTurns": 12,
    "roster": ["architect", "implementer", "tester"],
    "personas": [{ "id": "security", "name": "Security",
      "color": "#dc2626",
      "description": "security engineer who audits for vulnerabilities",
      "system": "You are Security… end turns with [NEXT: member] or DONE." }]
  }}}
}
```

> **After a restart** rooms restore *inactive* on purpose — run `/group resume` to
> continue where the group left off.

## Usage

| Command | Effect |
| --- | --- |
| `/group start <topic>` | Open a room on the current session |
| `/group status` | Roster, turns used, current speaker |
| `/group transcript` | Save/dump the conversation |
| `/group add <agent>` | Add a persona to the roster |
| `/group remove <agent>` | Drop a persona |
| `/group resume` | Continue a room restored after a restart |
| `/group stop` | Close the room and restore your previous agent |

Example:

```text
> /group start add rate limiting to the API
[GROUP CHAT] Room started — "add rate limiting to the API".
Members: Architect, Implementer, Reviewer, Tester.
...
```

While a room is active you can type normally — your message goes to the member holding
the floor, and scheduling resumes when they finish.

## Configuration

Tune everything from `opencode.json`:

```jsonc
{
  "plugin": {
    "opencode-group-chat": {
      "options": {
        "maxTurns": 16,
        "roster": ["architect", "implementer", "reviewer", "tester"],
        "startAgent": "architect",
        "personas": [
          {
            "id": "security",
            "name": "Security",
            "color": "#dc2626",
            "description": "security engineer who audits for vulnerabilities",
            "system": "You are Security, a member of an OpenCode group chat. ..."
          }
        ]
      }
    }
  }
}
```

- **`personas`** — replaces the default cast. Give each persona a narrow job and an
  explicit hand-off rule; that is what makes the group converge.
- **`roster`** — which persona ids join new rooms by default.
- **`maxTurns`** — hard stop for the scheduler.
- **`startAgent`** — who opens the discussion.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Agent not found: "architect"` right after `Switched agent from Plan to Architect` | You are on plugin **v0.1.0**, which never registered the persona agents (`ctx.agent.transform` was missing from `setup()`). Update to **v0.1.1+** (`git pull` or re-download), then **restart `opencode`** — agents register at startup. |
| `/group` is unknown | The plugin didn't load — check that `.opencode/plugins/group-chat/package.json` exists (project install) and restart `opencode`. |
| Room never ends | Lower `maxTurns`, or end messages with `DONE` / run `/group stop`. |
| A turn repeats forever | A persona isn't handing off — remind it via chat; its reply must end with `[NEXT: member]` or `DONE`. |
| Room vanished after restart | Rooms restore **inactive** on purpose — run `/group resume`. |
| Persona does nothing on its turn | The persona agent is registered with `mode: "all"`, but it needs a reachable model; check your provider config. |

## Comparison with the Hermes agent

| | Hermes rooms | opencode-group-chat |
| --- | --- | --- |
| Runtime | Gateway owns the room and drives turns | The OpenCode server plugin drives turns |
| Members | Bots, possibly across machines | Persona agents in one session/project |
| Shared context | Room log | Full session history + shared filesystem |
| Hand-offs | Mentions / approvals | `[NEXT: member]`, `@member`, round-robin |
| Endings | Disband / stop | `DONE` marker, `maxTurns`, `/group stop` |

## Roadmap

- [ ] Model-driven moderator (score "who should speak next" with a small model via `ctx.experimental.generate`)
- [ ] Cross-session rooms — several OpenCode instances chatting via `ctx.rpc` / `ctx.integration`
- [ ] TUI panel (`@opencode/plugin/tui`) showing the roster and current speaker

## Credits

- [OpenCode](https://opencode.ai) ([anomalyco/opencode](https://github.com/anomalyco/opencode)) — the open source coding agent and its excellent plugin API.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — inspiration for the group-chat/rooms model.

## License

[MIT](LICENSE) © Farazjz
