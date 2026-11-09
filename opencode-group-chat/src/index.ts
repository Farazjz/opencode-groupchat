/**
 * opencode-group-chat — multi-agent group chat rooms for OpenCode V2.
 *
 * Gives OpenCode a Hermes-style "group chat": a room bound to the current
 * session where several agent personas (architect, implementer, reviewer,
 * tester, ...) take turns working on the same project. A turn scheduler
 * (the "moderator") hands the floor from one persona to the next; every
 * persona sees the shared transcript and can hand off explicitly or call
 * DONE when the group's goal is reached.
 *
 * Built entirely on public V2 plugin APIs:
 *  - ctx.agent.transform            → register persona agents (upsert)
 *  - ctx.command.transform          → /group slash command
 *  - ctx.event.subscribe()          → capture what each persona said
 *  - ctx.session.hook("experimental.idle") → turn scheduler entry point
 *  - ctx.session.switchAgent(...)   → give the floor to the next persona
 *  - ctx.session.synthetic(...)     → inject turn prompts / system notices
 *  - ctx.storage                    → persist rooms + transcripts
 *
 * Install (local):  copy this folder to  .opencode/plugins/group-chat/
 * Install (npm):    opencode.json → { "plugin": ["opencode-group-chat"] }
 *
 * Usage in a session:
 *   /group start refactor the auth module
 *   /group status | transcript | add <agent> | remove <agent> | stop
 */

import { Plugin } from "@opencode/plugin"
import { Schema } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One recorded group message. */
interface Turn {
  readonly n: number
  readonly speaker: string
  readonly text: string
  readonly at: number
}

/** A group chat room bound to an OpenCode session. */
interface Room {
  readonly sessionID: string
  topic: string
  /** Agent to restore when the room closes. */
  baseAgent: string
  /** Participant persona ids, in speaking order. */
  roster: string[]
  /** Round-robin pointer (index of the last speaker). */
  cursor: number
  /** Turns handed out so far (including the one in flight). */
  turn: number
  maxTurns: number
  active: boolean
  startedAt: number
  transcript: Turn[]
}

interface PersonaDef {
  id: string
  name: string
  color: string
  description: string
  system: string
}

// ---------------------------------------------------------------------------
// Default cast of personas (override via plugin options `personas`)
// ---------------------------------------------------------------------------

const DEFAULT_PERSONAS: PersonaDef[] = [
  {
    id: "architect",
    name: "Architect",
    color: "#d97706",
    description: "system designer who plans and decomposes work",
    system: [
      "You are Architect, a member of an OpenCode group chat.",
      "You own the big picture: requirements, structure, trade-offs, task breakdown.",
      "Speak concisely (a few sentences or a short list). Do not write large code blocks;",
      "hand implementation to the Implementer and review concerns to the Reviewer.",
    ].join("\n"),
  },
  {
    id: "implementer",
    name: "Implementer",
    color: "#059669",
    description: "hands-on coder who writes and edits the project files",
    system: [
      "You are Implementer, a member of an OpenCode group chat.",
      "You turn agreed plans into real code: read files, edit files, run quick checks.",
      "Do the hands-on work yourself with your tools, then report what you changed in 1-3 sentences.",
      "Do not redesign the architecture; ask the Architect when scope is unclear.",
    ].join("\n"),
  },
  {
    id: "reviewer",
    name: "Reviewer",
    color: "#e11d48",
    description: "critical reviewer who checks correctness, edge cases and security",
    system: [
      "You are Reviewer, a member of an OpenCode group chat.",
      "You inspect recent changes and plans for correctness, edge cases, security and simplicity.",
      "Be specific: point at files/functions and say what to change. Approve explicitly when satisfied.",
      "Do not edit files yourself; route fixes to the Implementer.",
    ].join("\n"),
  },
  {
    id: "tester",
    name: "Tester",
    color: "#7c3aed",
    description: "QA engineer who verifies behavior with tests",
    system: [
      "You are Tester, a member of an OpenCode group chat.",
      "You verify the work: write or run tests, execute the relevant commands, report pass/fail precisely.",
      "Keep reports short and factual; route fixes to the Implementer and scope questions to the Architect.",
    ].join("\n"),
  },
]

// ---------------------------------------------------------------------------
// Small parsing helpers
// ---------------------------------------------------------------------------

const HANDOFF_RE = /\[\s*NEXT\s*:\s*([A-Za-z0-9_.-]+)\s*\]/
const ADDRESS_RE = /^@([A-Za-z0-9_.-]+)/
const DONE_LINE_RE = /^\s*[*_~`]*\s*\[?\bDONE\b\]?[*_~`]*\s*[.:!]?$/im
const DONE_TAG_RE = /\[\s*DONE\s*\]/i

/** Returns "DONE", the id of the member being handed the floor, or undefined. */
function parseDirectives(text: string, roster: string[], current: string): string | undefined {
  if (DONE_TAG_RE.test(text) || DONE_LINE_RE.test(text)) return "DONE"
  const explicit = HANDOFF_RE.exec(text)?.[1]
  if (explicit && explicit !== current && roster.includes(explicit)) return explicit
  const addressed = ADDRESS_RE.exec(text.trim())?.[1]
  if (addressed && addressed !== current && roster.includes(addressed)) return addressed
  return undefined
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…"
}

function firstName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/** Best-effort extraction of the text typed after a slash command. */
function commandText(prompt: unknown): string {
  if (typeof prompt === "string") return prompt
  const p = prompt as { text?: unknown; message?: unknown } | undefined
  if (typeof p?.text === "string") return p.text
  if (typeof p?.message === "string") return p.message
  return ""
}

function argAfter(raw: string, command: string): string {
  const withoutSlash = raw.replace(/^\//, "")
  const withoutCommand = withoutSlash.startsWith(command)
    ? withoutSlash.slice(command.length)
    : withoutSlash
  return withoutCommand.trim()
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default Plugin.define({
  id: "opencode-group-chat",

  setup: async (ctx) => {
    const options = (ctx.options ?? {}) as Record<string, unknown>

    // ---- configuration -----------------------------------------------------
    const personas: PersonaDef[] = Array.isArray(options.personas)
      ? (options.personas as PersonaDef[])
      : DEFAULT_PERSONAS
    const personaIds = personas.map((p) => p.id)
    const defaultRoster: string[] = Array.isArray(options.roster)
      ? (options.roster as string[]).filter((id) => personaIds.includes(id))
      : personaIds
    const maxTurns = Number.isFinite(Number(options.maxTurns))
      ? Math.max(2, Number(options.maxTurns))
      : 16
    const startAgent = typeof options.startAgent === "string" ? options.startAgent : personaIds[0]
    const tailTurns = 4 // transcript entries quoted into each turn prompt

    // ---- register persona agents (upsert) -----------------------------------
    //
    // This is what makes the personas real OpenCode agents. Without it,
    // switchAgent("architect") records the session agent but the next run fails
    // with `Agent not found: "architect"` when the runner resolves it.
    //
    // editor.update(id, fn) is an upsert: missing agents are created via
    // Info.default(id) (mode "primary", hidden false, allow-all permissions,
    // empty request settings), then fn mutates them and the id is forced.

    if (typeof (ctx.agent as unknown as { transform?: unknown } | undefined)?.transform !== "function") {
      console.error(
        "[group-chat] this OpenCode build does not expose ctx.agent.transform — " +
          "persona agents cannot be registered and group chat will fail. " +
          "Update OpenCode to a build with the V2 plugin agent API.",
      )
    } else {
      try {
        await ctx.agent.transform((editor) => {
          const ed = editor as unknown as {
            update: (id: string, fn: (agent: Record<string, unknown>) => void) => void
            list: () => readonly unknown[]
          }
          for (const persona of personas) {
            ed.update(persona.id, (agent) => {
              agent.name = persona.name
              agent.description = persona.description
              agent.system = persona.system
              agent.mode = "all" // can hold the session floor and work as a subagent
              agent.hidden = false
              agent.color = persona.color
            })
          }
          const known = new Set(
            ed
              .list()
              .map((a) => (a as { id?: unknown }).id)
              .filter((id): id is string => typeof id === "string"),
          )
          const missing = personaIds.filter((id) => !known.has(id))
          if (missing.length > 0) {
            console.error("[group-chat] WARNING: persona agents not registered:", missing.join(", "))
          } else {
            console.log(`[group-chat] persona agents ready: ${personaIds.join(", ")}`)
          }
        })
      } catch (error) {
        console.error("[group-chat] failed to register persona agents:", error)
      }
    }

    // ---- runtime state -----------------------------------------------------
    const rooms = new Map<string, Room>()
    /** assistantMessageID → agent that produced it (from session.step.started). */
    const stepAgent = new Map<string, string>()
    /** assistantMessageID → { sessionID, text } accumulated (from session.text.ended). */
    const messageText = new Map<string, { sessionID: string; text: string }>()
    /** sessionID → speaker currently holding the floor. */
    const speaking = new Map<string, string>()
    /** sessionID → Set of assistantMessageIDs still being produced. */
    const inFlight = new Map<string, Set<string>>()

    const rosterRoom = (sessionID: string) => rooms.get(sessionID)

    async function persist(room: Room) {
      try {
        await ctx.storage.set(`group-chat/room/${room.sessionID}`, {
          sessionID: room.sessionID,
          topic: room.topic,
          baseAgent: room.baseAgent,
          roster: room.roster,
          cursor: room.cursor,
          turn: room.turn,
          maxTurns: room.maxTurns,
          active: room.active,
          startedAt: room.startedAt,
          transcript: room.transcript.slice(-200),
        } satisfies Record<string, unknown> as unknown as Schema.Json)
      } catch {
        // storage is best-effort; the room keeps working from memory
      }
    }

    async function writeTranscriptFile(room: Room): Promise<string | undefined> {
      try {
        const loc = ctx.location as unknown as
          | { root?: string; directory?: string; path?: string; worktree?: string }
          | undefined
        const root = loc?.root ?? loc?.directory ?? loc?.worktree ?? loc?.path ?? process.cwd()
        const dir = path.join(root, ".opencode", "group-chat")
        await mkdir(dir, { recursive: true })
        const file = path.join(dir, `${room.sessionID}.md`)
        const lines = [
          `# Group chat — ${room.topic}`,
          ``,
          `- Session: \`${room.sessionID}\``,
          `- Members: ${room.roster.join(", ")}`,
          `- Turns used: ${room.turn}/${room.maxTurns}`,
          `- Started: ${new Date(room.startedAt).toISOString()}`,
          ``,
          ...room.transcript.map(
            (t) => `## ${t.n}. ${t.speaker}\n\n${t.text}\n`,
          ),
        ]
        await writeFile(file, lines.join("\n"), "utf8")
        return file
      } catch {
        return undefined
      }
    }

    // ---- capture what personas say ------------------------------------------
    //
    // All turns run in the room's own session, so child sessions (subagents)
    // are filtered out automatically by the sessionID check. Auxiliary agents
    // (title/summary/compaction) are filtered out by the persona check.

    const pump = (async () => {
      try {
        for await (const event of ctx.event.subscribe()) {
          const ev = event as unknown as { type?: string; data?: Record<string, unknown> }
          const type = ev?.type
          const data = ev?.data
          if (!type || !data) continue

          const sessionID = data.sessionID
          if (typeof sessionID !== "string") continue

          if (type === "session.step.started" && typeof data.assistantMessageID === "string") {
            if (rooms.has(sessionID)) {
              stepAgent.set(data.assistantMessageID, String(data.agent ?? ""))
              let set = inFlight.get(sessionID)
              if (!set) inFlight.set(sessionID, (set = new Set()))
              set.add(data.assistantMessageID)
            }
            continue
          }

          if (type === "session.text.ended" && typeof data.assistantMessageID === "string") {
            const agent = stepAgent.get(data.assistantMessageID)
            if (agent && personaIds.includes(agent)) {
              const previous = messageText.get(data.assistantMessageID)
              messageText.set(data.assistantMessageID, {
                sessionID,
                text: (previous?.sessionID === sessionID ? previous.text : "") + String(data.text ?? ""),
              })
            }
            continue
          }

          // step.ended only clears the in-flight marker; transcript finalization
          // happens when the whole execution goes idle (the persona may run
          // several steps — tool calls — before its turn is over).
          if (type === "session.step.ended" && typeof data.assistantMessageID === "string") {
            inFlight.get(sessionID)?.delete(data.assistantMessageID)
          }
        }
      } catch (error) {
        console.error("[group-chat] event stream stopped:", error)
      }
    })()

    /** Give the event bus a moment so the last step's text is captured. */
    async function settle(sessionID: string) {
      const deadline = Date.now() + 3_000
      while (Date.now() < deadline && (inFlight.get(sessionID)?.size ?? 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      // Small grace period so a trailing session.text.ended lands before we read.
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    // ---- transcript + turn prompts ------------------------------------------

    function collectTurnText(sessionID: string): string {
      const chunks: string[] = []
      for (const [messageID, entry] of messageText) {
        if (entry.sessionID !== sessionID) continue
        if (entry.text.trim()) chunks.push(entry.text.trim())
        messageText.delete(messageID)
        stepAgent.delete(messageID)
      }
      return chunks.join("\n\n")
    }

    function transcriptTail(room: Room): string {
      const slice = room.transcript.slice(-tailTurns)
      if (slice.length === 0) return "(no messages yet — you open the discussion)"
      return slice.map((t) => `${t.speaker}: ${truncate(t.text, 500)}`).join("\n")
    }

    function turnPrompt(room: Room, speaker: string): string {
      const persona = personas.find((p) => p.id === speaker)
      const members = room.roster.map((id) => firstName(id)).join(", ")
      return [
        `[GROUP CHAT] Room "${room.topic}" — turn ${room.turn}/${room.maxTurns}`,
        `Members: ${members}. You are ${firstName(speaker)}.`,
        ``,
        `Recent messages:`,
        transcriptTail(room),
        ``,
        `It is your turn. Contribute as the ${persona?.description ?? speaker}.`,
        `Rules:`,
        `- Be concise and concrete; do the work with your tools when it is your job.`,
        `- To hand the floor to a specific member, end your message with [NEXT: member].`,
        `- When the group's goal is reached, end your message with DONE.`,
      ].join("\n")
    }

    // ---- scheduling ----------------------------------------------------------

    function pickNext(room: Room, last: Turn | undefined): string | undefined {
      if (room.roster.length === 0) return undefined
      if (last) {
        const directive = parseDirectives(last.text, room.roster, last.speaker)
        if (directive === "DONE") return undefined
        if (directive) {
          room.cursor = room.roster.indexOf(directive)
          return directive
        }
      }
      room.cursor = (room.cursor + 1) % room.roster.length
      return room.roster[room.cursor]
    }

    async function advance(room: Room): Promise<void> {
      if (!room.active) return
      const last = room.transcript[room.transcript.length - 1]

      if (room.turn >= room.maxTurns) {
        return close(room, `turn budget of ${room.maxTurns} reached`)
      }
      const next = pickNext(room, last)
      if (!next) return close(room, "the group agreed the goal is done (DONE)")

      speaking.set(room.sessionID, next)
      room.turn += 1
      try {
        await ctx.session.switchAgent({ sessionID: room.sessionID, agent: next })
        await ctx.session.synthetic({
          sessionID: room.sessionID,
          text: turnPrompt(room, next),
          metadata: { groupChat: { room: room.topic, turn: room.turn, speaker: next } },
        })
      } catch (error) {
        room.active = false
        speaking.delete(room.sessionID)
        const reason = error instanceof Error ? error.message : String(error)
        console.error("[group-chat] failed to hand the floor to", next, error)
        try {
          // The session may now point at an unregistered persona — restore the
          // base agent first so the failure notice itself can run.
          await ctx.session.switchAgent({ sessionID: room.sessionID, agent: room.baseAgent })
          await ctx.session.synthetic({
            sessionID: room.sessionID,
            text: [
              `[GROUP CHAT] Room "${room.topic}" stopped — could not hand the floor to "${next}".`,
              `Reason: ${reason}`,
              reason.includes("not found")
                ? `The persona agent "${next}" is not registered. Update the group-chat plugin (it must register agents via ctx.agent.transform) and restart OpenCode, then /group start again.`
                : `Start a new room with /group start <topic>.`,
            ].join("\n"),
            metadata: { groupChat: { stopped: true, reason } },
          })
        } catch {
          // best-effort notice
        }
        return persist(room)
      }
      await persist(room)
    }

    async function close(room: Room, reason: string): Promise<void> {
      room.active = false
      speaking.delete(room.sessionID)
      try {
        await ctx.session.switchAgent({ sessionID: room.sessionID, agent: room.baseAgent })
        const file = await writeTranscriptFile(room)
        await ctx.session.synthetic({
          sessionID: room.sessionID,
          text: [
            `[GROUP CHAT] Room "${room.topic}" closed — ${reason}.`,
            `Turns used: ${room.turn}/${room.maxTurns}. Speakers: ${[...new Set(room.transcript.map((t) => t.speaker))].join(", ") || "none"}.`,
            file ? `Transcript saved to ${file}.` : `Control restored to ${room.baseAgent}.`,
            `Start a new room any time with /group start <topic>.`,
          ].join("\n"),
          metadata: { groupChat: { closed: true, reason } },
        })
      } catch (error) {
        console.error("[group-chat] failed to close room:", error)
      }
      await persist(room)
    }

    /** Finalize the speaker's turn from captured events, then schedule. */
    async function concludeAndSchedule(room: Room): Promise<void> {
      await settle(room.sessionID)
      const text = collectTurnText(room.sessionID)
      const speaker = speaking.get(room.sessionID)
      if (speaker && text) {
        room.transcript.push({ n: room.transcript.length + 1, speaker, text, at: Date.now() })
        await persist(room)
      }
      await advance(room)
    }

    // ---- the idle hook: the group chat's engine ------------------------------
    //
    // Runs when the session finishes model work with no pending input. If a
    // room is active we hand the floor to the next persona, which keeps the
    // execution alive. The loop is bounded by maxTurns as the plugin docs
    // require.

    await ctx.session.hook("experimental.idle", async (event) => {
      const room = rosterRoom(event.sessionID)
      if (!room?.active) return
      // Wait for the room's own background work (shells, subagents) to finish.
      if (event.background.length > 0) return
      try {
        await concludeAndSchedule(room)
      } catch (error) {
        // A failing hook fails the execution — deactivate instead of looping.
        room.active = false
        await persist(room)
        console.error("[group-chat] scheduler error; room deactivated:", error)
        try {
          await ctx.session.switchAgent({ sessionID: room.sessionID, agent: room.baseAgent })
        } catch {
          // best-effort restore
        }
      }
    })

    // ---- /group command -------------------------------------------------------

    function statusReport(room: Room): string {
      return [
        `[GROUP CHAT] Room "${room.topic}" — ${room.active ? "active" : "closed"}`,
        `Members: ${room.roster.map(firstName).join(", ")}`,
        `Turns: ${room.turn}/${room.maxTurns} — on the floor: ${speaking.get(room.sessionID) ?? "-"}`,
        room.transcript.length
          ? `Last message from ${room.transcript[room.transcript.length - 1].speaker}: "${truncate(room.transcript[room.transcript.length - 1].text, 160)}"`
          : `No messages yet.`,
        `Commands: /group start <topic> · stop · status · transcript · add <agent> · remove <agent>`,
      ].join("\n")
    }

    async function currentBaseAgent(sessionID: string): Promise<string> {
      try {
        const info = (await ctx.session.get({ sessionID })) as unknown as
          | { data?: { agent?: unknown }; agent?: unknown }
          | undefined
        const agent = info?.data?.agent ?? info?.agent
        if (typeof agent === "string" && agent) return agent
      } catch {
        // fall through to the default
      }
      return "build"
    }

    await ctx.command.transform((commands) => {
      commands.add({
        name: "group",
        description:
          "Multi-agent group chat: /group start <topic> · stop · status · transcript · add <agent> · remove <agent>",
        execute: async ({ sessionID, prompt }) => {
          const args = argAfter(commandText(prompt), "group")
          const [sub, ...rest] = args.split(/\s+/)
          const topic = rest.join(" ").trim()

          let room = rosterRoom(sessionID)

          switch (sub || "help") {
            case "start": {
              if (room?.active) {
                await ctx.session.synthetic({
                  sessionID,
                  text: `[GROUP CHAT] A room is already active in this session ("${room.topic}"). Use /group stop first.`,
                })
                return
              }
              const base: Room = room ?? {
                sessionID,
                topic: "",
                baseAgent: "build",
                roster: [...defaultRoster],
                cursor: -1,
                turn: 0,
                maxTurns,
                active: false,
                startedAt: Date.now(),
                transcript: [],
              }
              base.topic = topic || "untitled topic"
              base.baseAgent = await currentBaseAgent(sessionID)
              base.roster = [...defaultRoster]
              // Cursor sits one seat before the opener so pickNext() hands the
              // first turn to options.startAgent (falls back to roster[0]).
              const startIdx = base.roster.indexOf(startAgent)
              base.cursor = startIdx > 0 ? startIdx - 1 : -1
              base.turn = 0
              base.maxTurns = maxTurns
              base.active = true
              base.startedAt = Date.now()
              base.transcript = []
              rooms.set(sessionID, base)
              await persist(base)
              await ctx.session.synthetic({
                sessionID,
                text: [
                  `[GROUP CHAT] Room started — "${base.topic}".`,
                  `Members: ${base.roster.map(firstName).join(", ")}.`,
                  `They will take turns until the goal is DONE or ${base.maxTurns} turns pass. You can interject any time.`,
                ].join("\n"),
                metadata: { groupChat: { started: true } },
              })
              await advance(base)
              return
            }

            case "resume": {
              if (!room) return
              room.active = true
              await persist(room)
              await advance(room)
              return
            }

            case "stop": {
              if (!room) {
                await ctx.session.synthetic({
                  sessionID,
                  text: `[GROUP CHAT] No room in this session. Start one with /group start <topic>.`,
                })
                return
              }
              await close(room, "stopped by user")
              return
            }

            case "status": {
              if (!room) {
                await ctx.session.synthetic({
                  sessionID,
                  text: `[GROUP CHAT] No room in this session. Start one with /group start <topic>.`,
                })
                return
              }
              await ctx.session.synthetic({ sessionID, text: statusReport(room) })
              return
            }

            case "transcript": {
              if (!room) {
                await ctx.session.synthetic({
                  sessionID,
                  text: `[GROUP CHAT] No room in this session.`,
                })
                return
              }
              const file = await writeTranscriptFile(room)
              const body = file
                ? `Transcript (${room.transcript.length} turns) saved to ${file}.`
                : room.transcript
                  .slice(-30)
                  .map((t) => `${t.n}. ${t.speaker}:\n${truncate(t.text, 800)}`)
                  .join("\n\n") || "Transcript is empty."
              await ctx.session.synthetic({ sessionID, text: `[GROUP CHAT] ${body}` })
              return
            }

            case "add":
            case "remove": {
              const id = (rest[0] ?? "").toLowerCase()
              if (!room) {
                await ctx.session.synthetic({
                  sessionID,
                  text: `[GROUP CHAT] No room in this session. Start one first.`,
                })
                return
              }
              if (!personaIds.includes(id)) {
                await ctx.session.synthetic({
                  sessionID,
                  text: `[GROUP CHAT] Unknown member "${id}". Available: ${personaIds.join(", ")}.`,
                })
                return
              }
              if (sub === "add" && !room.roster.includes(id)) room.roster.push(id)
              if (sub === "remove") {
                room.roster = room.roster.filter((m) => m !== id)
                if (speaking.get(sessionID) === id) speaking.delete(sessionID)
              }
              await persist(room)
              await ctx.session.synthetic({
                sessionID,
                text: `[GROUP CHAT] Members now: ${room.roster.map(firstName).join(", ") || "(none)"}.`,
              })
              return
            }

            default:
              await ctx.session.synthetic({
                sessionID,
                text: [
                  `[GROUP CHAT] Usage:`,
                  `/group start <topic> — open a room with ${defaultRoster.map(firstName).join(", ")}`,
                  `/group status — roster, turns, current speaker`,
                  `/group transcript — dump the conversation`,
                  `/group add <agent> · remove <agent> — manage membership`,
                  `/group stop — close the room and restore ${await currentBaseAgent(sessionID)}`,
                  `Available agents: ${personaIds.join(", ")}.`,
                ].join("\n"),
              })
              return
          }
        },
      })
    })

    // ---- best-effort restore of persisted rooms (restored as inactive) ------

    try {
      const scan = (await ctx.storage.scan({ prefix: "group-chat/room/" })) as unknown as
        | { entries?: Array<{ key?: string; value?: unknown }>; results?: Array<{ key?: string; value?: unknown }> }
        | Array<{ key?: string; value?: unknown }>
        | undefined
      const entries = Array.isArray(scan)
        ? scan
        : (scan?.entries ?? scan?.results ?? [])
      for (const entry of entries) {
        const value = entry?.value as Room | undefined
        if (typeof value?.sessionID !== "string") continue
        if (rooms.has(value.sessionID)) continue
        rooms.set(value.sessionID, { ...value, active: false, transcript: value.transcript ?? [] })
      }
      if (rooms.size > 0) {
        console.log(`[group-chat] restored ${rooms.size} room(s) from storage (inactive; /group resume to continue)`)
      }
    } catch {
      // storage scan is optional; a fresh start is fine
    }

    // Keep the event pump referenced for the plugin's lifetime.
    void pump

    return () => {
      rooms.clear()
      stepAgent.clear()
      messageText.clear()
      speaking.clear()
      inFlight.clear()
    }
  },
})
