<div align="center">

# opencode-group-chat

**Multi-agent group chat rooms for [OpenCode](https://opencode.ai)**

Hermes-style turn-taking between AI personas — Architect, Implementer, Reviewer, Tester —
working on **one shared project** inside a single OpenCode session. Pure plugin, no forks.

[![Deploy site to GitHub Pages](https://github.com/Farazjz/opencode-groupchat/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Farazjz/opencode-groupchat/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-059669.svg?style=flat-square)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-V2%20plugin%20API-d97706.svg?style=flat-square)](https://opencode.ai/docs)
[![Live demo](https://img.shields.io/badge/%F0%9F%9A%80-Live%20demo%20site-e11d48.svg?style=flat-square)](https://farazjz.github.io/opencode-groupchat/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-3f3f46.svg?style=flat-square)](#install)

</div>

---

Open a **room** in any OpenCode session and several agent personas take turns on a shared
goal. Each persona sees the transcript, does real tool work on its turn (edits files, runs
tests), hands the floor to a specific member with `[NEXT: member]`, and calls `DONE` when
the group's goal is reached. A bounded scheduler keeps the conversation converging — and
you can interject at any time by typing.

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

## ✨ Highlights

- **🎭 Persona agents** — Architect, Implementer, Reviewer and Tester out of the box;
  define your own cast in `opencode.json` (id, name, color, description, system prompt).
- **🗣️ Real turn-taking** — explicit hand-offs (`[NEXT: reviewer]`, `@reviewer`), a
  round-robin fallback, and a `DONE` marker to finish the room.
- **🛑 Bounded by design** — `maxTurns` (default 16) hard-stops the scheduler, as the
  OpenCode plugin API requires.
- **📝 Transcripts** — every room is written to `.opencode/group-chat/<sessionID>.md`.
- **💾 Restart-safe** — rooms persist in OpenCode storage and restore after a restart
  (`/group resume`).
- **🪟 Windows-friendly** — native PowerShell/CMD install steps, no WSL required.
- **🧩 Pure plugin** — built on public V2 plugin APIs only: `ctx.agent.transform`,
  `ctx.command.transform`, `ctx.event.subscribe()`, `ctx.session.hook("experimental.idle")`,
  `ctx.session.switchAgent()`, `ctx.session.synthetic()`, `ctx.storage`.

## 📦 Install

> Requires [OpenCode](https://opencode.ai) with the V2 plugin API. No build step — OpenCode
> loads TypeScript plugins directly.

**macOS & Linux**

```bash
git clone https://github.com/Farazjz/opencode-groupchat.git
cp -r opencode-groupchat .opencode/plugins/group-chat
```

**Windows (PowerShell, from your project root)**

```powershell
git clone https://github.com/Farazjz/opencode-groupchat.git
New-Item -ItemType Directory -Force -Path ".opencode\plugins" | Out-Null
Copy-Item -Recurse -Force ".\opencode-groupchat" ".\.opencode\plugins\group-chat"
opencode   # that's it
```

**npm**

```bash
npm i -g opencode-group-chat
```

```jsonc
// opencode.json
{ "plugin": ["opencode-group-chat"] }
```

Full details — global paths, CMD, WSL notes, custom personas — in
[`opencode-group-chat/README.md`](opencode-group-chat/README.md).

## 🚀 Usage

| Command | Effect |
| --- | --- |
| `/group start <topic>` | Open a room on the current session |
| `/group status` | Roster, turns used, current speaker |
| `/group transcript` | Save/dump the conversation |
| `/group add <agent>` / `remove <agent>` | Manage membership |
| `/group resume` | Continue a room restored after a restart |
| `/group stop` | Close the room and restore your previous agent |

## ⚙️ How it works

| Group-chat need | Plugin primitive |
| --- | --- |
| Distinct participants | `ctx.agent.transform` — registers each persona as an agent (upsert) |
| Open & manage rooms | `ctx.command.transform` — the `/group` slash command |
| Capture what was said | `ctx.event.subscribe()` — `session.step.started` / `session.text.ended` |
| Turn-taking engine | `ctx.session.hook("experimental.idle")` |
| Give the floor | `ctx.session.switchAgent(...)` |
| Prompt the next turn | `ctx.session.synthetic(...)` |
| Room persistence | `ctx.storage` |

Scheduling rules, in order: **DONE** ends the room → **`[NEXT: member]` / `@member`**
hands the floor explicitly → otherwise the floor **rotates** → the room always stops at
**`maxTurns`**.

## 🌐 The live demo site

This repo also ships an interactive explainer site ([live here](https://farazjz.github.io/opencode-groupchat/)):
a scripted **room simulator** you can step through, a mapping table of every group-chat
need to its plugin primitive, copy-paste code tabs, per-platform install instructions, and
a troubleshooting guide.

It is a static Next.js export deployed by
[GitHub Actions](.github/workflows/deploy-pages.yml) on every push to `main`.

## 🗂️ Repository layout

```text
opencode-group-chat/      # the plugin (ship this to .opencode/plugins/group-chat)
  src/index.ts            #   the whole plugin — scheduler, /group command, event capture
  package.json            #   export map consumed by OpenCode
  README.md               #   full docs: install (Win/macOS/Linux), config, troubleshooting
public/plugin/            # static copies served to the demo site's download buttons
src/                      # demo site (Next.js 16 App Router + Tailwind + shadcn/ui)
.github/workflows/        # GitHub Pages deployment
```

## 🔧 Troubleshooting (top hit)

**`Agent not found: "architect"` right after `Switched agent from Plan to Architect`** —
you are on plugin **v0.1.0**, which never registered the persona agents. Update to
**v0.1.1+** and restart `opencode`; agents register at startup via `ctx.agent.transform`.
The full table lives in [`opencode-group-chat/README.md`](opencode-group-chat/README.md#troubleshooting).

## 🗺️ Roadmap

- [ ] Model-driven moderator (score "who should speak next" with a small model via `ctx.experimental.generate`)
- [ ] Cross-session rooms — several OpenCode instances chatting via `ctx.rpc` / `ctx.integration`
- [ ] TUI panel (`@opencode/plugin/tui`) showing the roster and current speaker

## 🙏 Credits

- [OpenCode](https://opencode.ai) ([anomalyco/opencode](https://github.com/anomalyco/opencode)) — the open source coding agent and its excellent plugin API.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — inspiration for the group-chat/rooms model.

## 📄 License

[MIT](LICENSE) © Farazjz
