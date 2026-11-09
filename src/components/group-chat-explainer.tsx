"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2,
  CircleDot,
  Copy,
  Download,
  Hand,
  ListChecks,
  MessageSquareLock,
  Play,
  RotateCcw,
  Square,
  Users,
  Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types & demo script                                                 */
/* ------------------------------------------------------------------ */

type Persona = {
  id: string;
  name: string;
  color: string;
  role: string;
};

const PERSONAS: Persona[] = [
  {
    id: "architect",
    name: "Architect",
    color: "#d97706",
    role: "plans & decomposes work",
  },
  {
    id: "implementer",
    name: "Implementer",
    color: "#059669",
    role: "writes & edits code",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    color: "#e11d48",
    role: "checks correctness & security",
  },
  {
    id: "tester",
    name: "Tester",
    color: "#7c3aed",
    role: "verifies with tests",
  },
];

type ScriptTurn = {
  speaker: string;
  text: string;
  directive: "handoff" | "done" | null;
  to?: string;
  rule: string;
};

const SCRIPT: ScriptTurn[] = [
  {
    speaker: "architect",
    text: "Plan for \"rate limiting\": 1) token-bucket middleware in src/middleware/rate-limit.ts keyed by API key, 2) config in rate-limit.config.ts, 3) 429 handler with Retry-After header. Implementer, please build the middleware.",
    directive: "handoff",
    to: "implementer",
    rule: "explicit hand-off [NEXT: implementer]",
  },
  {
    speaker: "implementer",
    text: "Done — added src/middleware/rate-limit.ts with a token bucket (60 req/min, burst 10) wired into the router, plus rate-limit.config.ts. Reviewer, please check the TTL handling.",
    directive: "handoff",
    to: "reviewer",
    rule: "explicit hand-off [NEXT: reviewer]",
  },
  {
    speaker: "reviewer",
    text: "Found one: the bucket TTL is never checked before refill, so expired keys get a free refill window. Also the Retry-After value should be integer seconds. Implementer, fix both.",
    directive: "handoff",
    to: "implementer",
    rule: "explicit hand-off [NEXT: implementer]",
  },
  {
    speaker: "implementer",
    text: "Fixed — refill now clamps expired windows and Retry-After is Math.ceil on remaining seconds. Tester, please verify with the integration suite.",
    directive: "handoff",
    to: "tester",
    rule: "explicit hand-off [NEXT: tester]",
  },
  {
    speaker: "tester",
    text: "Ran npm test -- rate-limit: 14 passed, 0 failed, including expired-key refill and 429 header cases. Reviewer, ready for final approval.",
    directive: "handoff",
    to: "reviewer",
    rule: "explicit hand-off [NEXT: reviewer]",
  },
  {
    speaker: "reviewer",
    text: "Approved — TTL clamp is correct, headers are per spec, tests cover the edge cases. The group's goal is reached.",
    directive: "done",
    rule: "DONE detected → room closes, control restored",
  },
];

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function persona(id: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [code]);
  return (
    <div className="group relative overflow-hidden rounded-lg border bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="font-mono text-xs text-zinc-400">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={copy}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="scrollbar-thin max-h-96 overflow-y-auto p-4 text-xs leading-relaxed text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive room simulation                                         */
/* ------------------------------------------------------------------ */

type Message = ScriptTurn & { n: number };

function RoomSimulator() {
  const [topic, setTopic] = useState("add rate limiting to the API");
  const [phase, setPhase] = useState<"idle" | "running" | "closed">("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [turn, setTurn] = useState(0);
  const [floor, setFloor] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [rule, setRule] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const step = useCallback(() => {
    setTyping(null);
    setMessages((prev) => {
      if (prev.length >= SCRIPT.length) return prev;
      const next = SCRIPT[prev.length];
      const withN = { ...next, n: prev.length + 1 };
      setTurn(withN.n);
      setFloor(next.directive === "done" ? null : next.to ?? next.speaker);
      setRule(next.rule);
      if (next.directive === "done") {
        setPhase("closed");
        setTyping(null);
        setAuto(false);
      } else {
        setTyping(next.to ?? next.speaker);
      }
      return [...prev, withN];
    });
  }, []);

  const start = useCallback(() => {
    clearTimers();
    setMessages([]);
    setTurn(0);
    setRule("room opened — round-robin starts the roster");
    setPhase("running");
    setFloor("architect");
    setTyping("architect");
  }, [clearTimers]);

  const stop = useCallback(() => {
    clearTimers();
    setPhase("closed");
    setFloor(null);
    setTyping(null);
    setAuto(false);
    setRule("room closed by user — control restored");
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setMessages([]);
    setTurn(0);
    setFloor(null);
    setTyping(null);
    setRule(null);
    setAuto(true);
  }, [clearTimers]);

  useEffect(() => {
    if (phase !== "running" || !auto || typing === null) return;
    const t = setTimeout(step, 1700);
    timers.current.push(t);
    return () => clearTimeout(t);
  }, [phase, auto, typing, step]);

  useEffect(() => clearTimers, [clearTimers]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquareLock className="h-5 w-5 text-amber-600" />
              Try the turn-taking engine
            </CardTitle>
            <CardDescription className="mt-1">
              A faithful simulation of what the plugin does inside a real
              OpenCode session: inject a turn prompt, the persona works, the
              scheduler reads its directives and hands the floor on.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={
              phase === "running"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : phase === "closed"
                  ? "border-zinc-300 bg-zinc-100 text-zinc-600"
                  : "border-amber-300 bg-amber-50 text-amber-700"
            }
          >
            {phase === "running" ? "room active" : phase === "closed" ? "room closed" : "no room"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* controls */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="/group start <topic>"
            aria-label="Group chat topic"
            className="font-mono text-sm"
            disabled={phase === "running"}
          />
          {phase === "idle" && (
            <Button onClick={start} className="gap-2 bg-amber-600 text-white hover:bg-amber-700">
              <Play className="h-4 w-4" /> /group start
            </Button>
          )}
          {phase === "running" && (
            <>
              <Button onClick={step} variant="outline" className="gap-2">
                <CircleDot className="h-4 w-4" /> Next turn
              </Button>
              <Button
                onClick={() => setAuto((a) => !a)}
                variant="outline"
                className="gap-2"
                aria-label="Toggle automatic turns"
              >
                <Zap className="h-4 w-4" /> {auto ? "Pause" : "Auto"}
              </Button>
              <Button
                onClick={stop}
                variant="outline"
                className="gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
              >
                <Square className="h-4 w-4" /> Stop
              </Button>
            </>
          )}
          {phase === "closed" && (
            <Button onClick={reset} variant="outline" className="gap-2">
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          )}
        </div>

        {/* roster */}
        <div className="flex flex-wrap gap-2" aria-label="Room members">
          {PERSONAS.map((p) => {
            const onFloor = floor === p.id && phase === "running";
            const speakingNow = typing === p.id;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-all ${
                  onFloor
                    ? "border-transparent shadow-sm"
                    : "border-zinc-200 bg-white opacity-60"
                }`}
                style={onFloor ? { backgroundColor: `${p.color}14` } : undefined}
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: p.color }}
                  aria-hidden
                >
                  {p.name.charAt(0)}
                </span>
                <span className="font-medium" style={{ color: p.color }}>
                  {p.name}
                </span>
                {speakingNow && (
                  <span className="flex gap-0.5" aria-label="typing">
                    <i className="h-1 w-1 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
                    <i className="h-1 w-1 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
                    <i className="h-1 w-1 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
                  </span>
                )}
                {onFloor && (
                  <Badge variant="outline" className="ml-1 border-transparent bg-white/70 px-1.5 py-0 text-[10px] text-zinc-600">
                    on the floor
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        {/* scheduler strip */}
        {rule && (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <Hand className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span className="font-medium">scheduler:</span>
            <span className="font-mono">{rule}</span>
          </div>
        )}

        {/* transcript */}
        <ScrollArea className="scrollbar-thin h-96 rounded-lg border bg-white">
          <div className="flex h-full flex-col gap-3 p-4">
            {phase === "idle" && messages.length === 0 && (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
                No room yet — press <span className="mx-1 font-mono text-zinc-500">/group start</span> to
                open one.
              </div>
            )}
            {messages.map((m) => {
              const p = persona(m.speaker);
              return (
                <div key={m.n} className="flex gap-3">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: p.color }}
                    aria-hidden
                  >
                    {p.name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1 rounded-lg border bg-zinc-50/60 p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: p.color }}>
                        {p.name}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        turn {m.n}/16
                      </span>
                      {m.directive === "handoff" && m.to && (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700"
                        >
                          [NEXT: {m.to}]
                        </Badge>
                      )}
                      {m.directive === "done" && (
                        <Badge className="border-transparent bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-700">
                          DONE
                        </Badge>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                      {m.text}
                    </p>
                  </div>
                </div>
              );
            })}
            {phase === "closed" && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <span className="font-semibold">[GROUP CHAT]</span> Room
                &quot;{topic}&quot; closed — the group agreed the goal is done
                (DONE). Turns used: {turn}/16. Control restored to build.
                Transcript saved to{" "}
                <span className="font-mono text-xs">.opencode/group-chat/&lt;sessionID&gt;.md</span>.
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Mapping table                                                       */
/* ------------------------------------------------------------------ */

/** Build-time base path — set to /opencode-groupchat for the GitHub Pages build. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

const MAPPING: Array<{ need: string; api: string; note: string }> = [
  {
    need: "Distinct participants",
    api: "ctx.agent.transform",
    note: "registers each persona as an agent (update() upserts new agents) with its own system prompt",
  },
  {
    need: "Open & manage rooms",
    api: "ctx.command.transform",
    note: "adds the /group slash command: start, stop, status, transcript, add, remove",
  },
  {
    need: "Capture what was said",
    api: "ctx.event.subscribe()",
    note: "session.step.started attributes messages; session.text.ended carries the full text",
  },
  {
    need: "Turn-taking engine",
    api: 'ctx.session.hook("experimental.idle")',
    note: "runs when the session has no pending input — admits the next turn in the same execution",
  },
  {
    need: "Give the floor",
    api: "ctx.session.switchAgent(...)",
    note: "re-points the session at the next persona before its turn",
  },
  {
    need: "Prompt the next turn",
    api: "ctx.session.synthetic(...)",
    note: "injects the turn prompt (room header, transcript tail, rules) with metadata tags",
  },
  {
    need: "Room persistence",
    api: "ctx.storage",
    note: "rooms + transcripts survive restarts; /group resume continues a restored room",
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const INDEX_EXCERPT = `// opencode-group-chat/src/index.ts (excerpt)
import { Plugin } from "@opencode/plugin"
import { Schema } from "effect"

export default Plugin.define({
  id: "opencode-group-chat",
  setup: async (ctx) => {
    // 1) Register persona agents (update() upserts brand-new agents)
    await ctx.agent.transform((editor) => {
      for (const p of personas) {
        editor.update(p.id, (a) => {
          a.name = p.name
          a.description = p.description
          a.system = p.system
          a.color = p.color
          a.mode = "all"           // usable as primary AND subagent
        })
      }
    })

    // 2) The /group slash command: start | stop | status | transcript | ...
    await ctx.command.transform((commands) => {
      commands.add({
        name: "group",
        description: "Multi-agent group chat: /group start <topic> ...",
        execute: async ({ sessionID, prompt }) => { /* open/close rooms */ },
      })
    })

    // 3) Capture what each persona says from the event stream
    for await (const event of ctx.event.subscribe()) {
      // session.step.started  → who is speaking (data.agent)
      // session.text.ended    → what was said (data.text)
    }

    // 4) The engine: when the session goes idle, schedule the next speaker
    await ctx.session.hook("experimental.idle", async (event) => {
      const room = rooms.get(event.sessionID)
      if (!room?.active) return
      if (event.background.length > 0) return   // wait for shells/subagents

      const next = pickNext(room, last)         // DONE | [NEXT: x] | round-robin
      if (!next) return closeRoom(room)

      await ctx.session.switchAgent({ sessionID: room.sessionID, agent: next })
      await ctx.session.synthetic({             // inject the turn prompt
        sessionID: room.sessionID,
        text: turnPrompt(room, next),
        metadata: { groupChat: { turn: room.turn, speaker: next } },
      })
    })
  },
})`;

const CONFIG_EXAMPLE = `// opencode.json — install + configure
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-group-chat"],
  // optional tuning:
  // "plugin": { "opencode-group-chat": { "options": {
  //   "maxTurns": 16,
  //   "roster": ["architect", "implementer", "reviewer", "tester"],
  //   "personas": [ { "id": "security", "name": "Security", ... } ]
  // }}}
}`;

const USAGE_EXAMPLE = `# in an OpenCode session
/group start add rate limiting to the API
# … the group takes turns; interject any time by typing
/group status          # roster, turns, current speaker
/group transcript      # dump conversation (saved to .opencode/group-chat/)
/group stop            # close room, restore your previous agent`;

export default function GroupChatExplainer() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Hero */}
        <header className="mb-10">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge className="border-transparent bg-emerald-100 text-emerald-800">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Yes — fully possible
            </Badge>
            <Badge variant="outline" className="border-zinc-300 text-zinc-600">
              OpenCode V2 · plugin API
            </Badge>
            <Badge variant="outline" className="border-zinc-300 text-zinc-600">
              Hermes-inspired
            </Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            A group-chat plugin for OpenCode
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-zinc-600">
            OpenCode (opencode.ai, the <code className="rounded bg-zinc-200 px-1 font-mono text-[13px]">anomalyco/opencode</code>{" "}
            agent) ships a powerful V2 plugin API with exactly the primitives a
            multi-agent group chat needs: persona agents, slash commands, an
            event stream, session-level hooks and message injection. This is a
            working plugin — <span className="font-medium text-zinc-800">opencode-group-chat</span> —
            that adds Hermes-style rooms where several agents take turns on one
            shared project, hand the floor to each other, and call{" "}
            <span className="font-mono text-sm">DONE</span> when the goal is met.
          </p>
        </header>

        {/* Interactive demo */}
        <section aria-label="Interactive demo" className="mb-12">
          <RoomSimulator />
        </section>

        {/* How it maps */}
        <section aria-label="API mapping" className="mb-12">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
            <ListChecks className="h-5 w-5 text-amber-600" />
            Every group-chat need maps to a public plugin API
          </h2>
          <div className="overflow-hidden rounded-lg border bg-white">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-3 font-medium">Group-chat need</th>
                    <th className="px-4 py-3 font-medium">OpenCode plugin primitive</th>
                    <th className="px-4 py-3 font-medium">What the plugin does</th>
                  </tr>
                </thead>
                <tbody>
                  {MAPPING.map((row) => (
                    <tr key={row.need} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{row.need}</td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-800">
                          {row.api}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* The plugin code */}
        <section aria-label="Plugin source" className="mb-12">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <Users className="h-5 w-5 text-amber-600" />
              The plugin — ready to drop in
            </h2>
            <div className="flex gap-2">
              <a href={`${BASE}/plugin/src/index.ts`} download>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" /> index.ts
                </Button>
              </a>
              <a href={`${BASE}/plugin/package.json`} download>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" /> package.json
                </Button>
              </a>
              <a href={`${BASE}/plugin/README.md`} download>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" /> README
                </Button>
              </a>
            </div>
          </div>
          <Tabs defaultValue="engine" className="w-full">
            <TabsList className="mb-3">
              <TabsTrigger value="engine">src/index.ts</TabsTrigger>
              <TabsTrigger value="config">opencode.json</TabsTrigger>
              <TabsTrigger value="usage">usage</TabsTrigger>
            </TabsList>
            <TabsContent value="engine">
              <CodeBlock code={INDEX_EXCERPT} label="opencode-group-chat/src/index.ts" />
            </TabsContent>
            <TabsContent value="config">
              <CodeBlock code={CONFIG_EXAMPLE} label="opencode.json" />
            </TabsContent>
            <TabsContent value="usage">
              <CodeBlock code={USAGE_EXAMPLE} label="terminal — inside opencode" />
            </TabsContent>
          </Tabs>
        </section>

        {/* Install */}
        <section aria-label="Install" className="mb-6">
          <h2 className="mb-4 text-xl font-semibold">Install — macOS, Linux & Windows</h2>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Option A — macOS & Linux</CardTitle>
                <CardDescription>
                  Local plugin, no publishing needed; resolved from your project.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-200">
                  <code>{`mkdir -p .opencode/plugins
cp -r opencode-group-chat \\
  .opencode/plugins/group-chat`}</code>
                </pre>
              </CardContent>
            </Card>
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  🪟 Option B — Windows
                </CardTitle>
                <CardDescription>
                  Native PowerShell / CMD — no WSL required.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-200">
                  <code>{`# PowerShell, from your project root
git clone https://github.com/Farazjz/opencode-groupchat.git
New-Item -ItemType Directory -Force \`
  -Path ".opencode\\plugins" | Out-Null
Copy-Item -Recurse -Force \`
  ".\\opencode-groupchat" \`
  ".\\.opencode\\plugins\\group-chat"

opencode   # that's it`}</code>
                </pre>
                <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                  CMD equivalent:{" "}
                  <span className="font-mono">
                    xcopy /E /I /Y opencode-groupchat .opencode\plugins\group-chat
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Option C — from npm</CardTitle>
                <CardDescription>
                  Publish once, then reference it in opencode.json.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-200">
                  <code>{`npm i -g opencode-group-chat

// opencode.json
{ "plugin": ["opencode-group-chat"] }`}</code>
                </pre>
              </CardContent>
            </Card>
          </div>

          {/* Where plugins live */}
          <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm leading-relaxed text-zinc-600">
            <p className="mb-2 font-medium text-zinc-800">Where plugins live (all platforms)</p>
            <ul className="space-y-1 font-mono text-xs">
              <li>
                <span className="text-zinc-800">This project only:</span>{" "}
                &lt;project&gt;\.opencode\plugins\group-chat
              </li>
              <li>
                <span className="text-zinc-800">All your projects (global):</span>{" "}
                %USERPROFILE%\.config\opencode\plugins\group-chat{" "}
                <span className="text-zinc-400">(Windows)</span> ·
                ~/.config/opencode/plugins/group-chat{" "}
                <span className="text-zinc-400">(macOS/Linux)</span>
              </li>
            </ul>
            <p className="mt-2 text-xs text-zinc-500">
              Running OpenCode inside WSL? Use the macOS/Linux steps and keep the plugin inside
              the WSL filesystem — WSL can&#39;t reliably load plugins from Windows paths like
              C:\…
            </p>
          </div>
        </section>

        {/* Hermes comparison */}
        <section aria-label="Comparison with Hermes" className="mb-4">
          <h2 className="mb-4 text-xl font-semibold">
            How it compares to the Hermes agent
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "Hermes rooms",
                body: "A gateway owns the room log and drives turns between bots, even across machines; Desktop renders the room.",
                tone: "bg-white",
              },
              {
                title: "This plugin",
                body: "One OpenCode session is the room: the plugin drives turns between persona agents, so they share full history and can edit the same files.",
                tone: "bg-white",
              },
              {
                title: "Shared idea",
                body: "Explicit hand-offs, a DONE marker, bounded turns, and a transcript you can inspect — the discipline that makes group chat converge.",
                tone: "bg-amber-50 border-amber-200",
              },
            ].map((c) => (
              <Card key={c.title} className={c.tone}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">{c.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-relaxed text-zinc-600">
                  {c.body}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        {/* Troubleshooting */}
        <section aria-label="Troubleshooting" className="mb-6">
          <h2 className="mb-4 text-xl font-semibold">Troubleshooting</h2>
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4 sm:p-5">
            <p className="mb-1 font-mono text-xs font-semibold text-rose-700 sm:text-sm">
              Error: Agent not found: &quot;architect&quot;
            </p>
            <p className="text-sm leading-relaxed text-zinc-700">
              Seen right after <span className="font-mono text-xs">Switched agent from Plan to
              Architect</span>? You are on plugin <strong>v0.1.0</strong> — it never registered
              the persona agents (<span className="font-mono text-xs">ctx.agent.transform</span>{" "}
              was missing from <span className="font-mono text-xs">setup()</span>). OpenCode
              switches the session agent without validation, then the run fails when it resolves
              the agent. <strong>Fix:</strong> update to <strong>v0.1.1+</strong> (re-download or{" "}
              <span className="font-mono text-xs">git pull</span>) and restart{" "}
              <span className="font-mono text-xs">opencode</span> — agents register at startup.
            </p>
          </div>
          <ul className="mt-3 space-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm leading-relaxed text-zinc-600">
            <li>
              <span className="font-medium text-zinc-800">/group is unknown</span> — the plugin
              didn’t load; check{" "}
              <span className="font-mono text-xs">.opencode/plugins/group-chat/package.json</span>{" "}
              exists and restart <span className="font-mono text-xs">opencode</span>.
            </li>
            <li>
              <span className="font-medium text-zinc-800">Room never ends</span> — lower{" "}
              <span className="font-mono text-xs">maxTurns</span>, end messages with{" "}
              <span className="font-mono text-xs">DONE</span>, or run{" "}
              <span className="font-mono text-xs">/group stop</span>.
            </li>
            <li>
              <span className="font-medium text-zinc-800">Room vanished after restart</span> —
              rooms restore <em>inactive</em> on purpose; run{" "}
              <span className="font-mono text-xs">/group resume</span>.
            </li>
            <li>
              <span className="font-medium text-zinc-800">Persona does nothing</span> — check a
              reachable model in your provider config.
            </li>
          </ul>
        </section>
      </main>

      <footer className="mt-auto border-t bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-start justify-between gap-2 px-4 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:px-6">
          <p>
            Built on public APIs from{" "}
            <span className="font-medium text-zinc-700">anomalyco/opencode</span> (dev branch) —
            no forks, no patches.
          </p>
          <p className="font-mono text-xs">
            MIT · opencode-group-chat v0.1.1
          </p>
        </div>
      </footer>
    </div>
  );
}
