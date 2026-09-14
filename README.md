# Sharma Travels Admin — the Kaafil QA handoff

A working mock CRM for an Indian tour operator. Your job is to integrate the
**Kaafil React UI Kit** into it, and to tell us honestly how that went.

You do not need to know anything about Kaafil yet. **Read
[`docs/00-START-HERE.md`](docs/00-START-HERE.md) first** — it explains what
Kaafil is, what this repo is, and what you are being asked to do. This page is
only the commands.

---

## Setup

### Step zero — give your AI assistant the Kaafil knowledge

Do this **before** anything else. The exercise assumes you have both.

```bash
npx kaafil-skills add
claude mcp add --transport http kaafil-docs https://developer.kaafil.in/api/mcp
```

The first installs 21 skills that teach your coding agent how Kaafil actually
works. The second gives it the full documentation — all 349 pages — to query
directly. Then `/kaafil` in your editor is the way in.

Part of what we are measuring is whether these are *enough*. Every time you
have to ask a human instead, that is a gap we want to hear about.

### Step one — install

```bash
pnpm install
```

Node 20.11+ and pnpm. Nothing else — no Docker, no database to run.

### Step two — get an API key

Sign in to the partner console at **<https://console.kaafil.in>** with the
account you were given, then **API keys** in the left nav → **Create key**.
Copy the secret at creation time; it is shown exactly once.

```bash
cp .env.example .env
# paste the key into KAAFIL_API_KEY
```

A `kf_test_` key runs against the sandbox and is what we suggest. A `kf_live_`
key also works, and the server tells you at boot what that choice costs you.

### Step three — run it

```bash
pnpm dev
```

That wipes and re-seeds the CRM's local SQLite, pushes the seeded tours into
**your own** Kaafil tenant, and serves the CRM at <http://localhost:5173>.

Restarting is always safe — the CRM resets itself every time. Resetting
**Kaafil** is separate and deliberate (`pnpm reset:kaafil`), because that call
is destructive and rate-limited.

---

## The exercise

You are integrating three Kaafil surfaces into a CRM that already exists and
already has its own look:

| Persona | What they get |
|---|---|
| Desk executive | The agency console — every departure the office runs |
| Tour leader | The manager app, built for a phone with no signal |
| Traveller | A share link, no account needed |

Your work goes in **`app/src/kaafil/`**, which is empty on purpose. The CRM's
own screens under `app/src/crm/` already work and contain no Kaafil code —
leave them working.

[`docs/01-the-exercise.md`](docs/01-the-exercise.md) has the ten milestones and
what "done" means for each.
[`docs/02-what-to-look-for.md`](docs/02-what-to-look-for.md) is where to push
hard once it renders.

### Record your progress

```bash
pnpm milestone 3        # stamp a milestone as you reach it
pnpm milestone list     # see the ten
pnpm milestone report   # the report you send back
```

Stamp them as you go rather than reconstructing at the end. The timings are the
point: we want to know how long a real CRM takes to go live, and where the time
actually goes.

---

## Commands

| | |
|---|---|
| `pnpm dev` | CRM + server. Wipes SQLite, re-seeds, ingests into Kaafil |
| `pnpm seed:bulk` | 50 more tours, to stress lists and pagination. **Live keys only** — a sandbox tenant is capped at 5 trips |
| `pnpm reset:kaafil` | Rebuild your Kaafil tenant to pristine (test keys only). Costs you one of your 5 sandbox trip slots |
| `pnpm milestone …` | Stamp progress, print the report |
| `pnpm typecheck` | Both halves |
| `pnpm lint` | Biome |

---

## How this repo is laid out

```
docs/          read these — written for someone new to Kaafil
app/src/crm/   the CRM's existing screens. Not yours to rewrite.
app/src/kaafil/  YOUR WORK GOES HERE. Empty on purpose.
shared/        the HTTP contract both halves import
server/        node:http. Holds the API key; mints sessions.
  ingest.ts    the CRM → Kaafil push, narrated as it runs
fixtures/      the seed data: 6 tours, 62 travellers, every state
tools/         the milestone CLI and the Kaafil reset
```

Two things worth knowing before you read any of it:

**The API key never reaches the browser.** It is read by `server/` and
`tools/` only. The browser holds a short-lived session token the server mints
for it. If you find a way to make the key reach a bundle, that is a finding we
very much want.

**The CRM's vocabulary is not Kaafil's.** Sharma Travels says *tour*, *tour
leader*, `ON_TOUR`, `CALLED_OFF`. Kaafil says *trip*, *manager*,
`IN_PROGRESS`, `CANCELLED`. Translating between them is a real part of the
integration, not an accident — `server/ingest.ts` shows how the seed data is
mapped, and you will make the same kind of calls.

---

## Your work stays local — do not push to this repo

`main` is protected and you will be refused if you try. That is deliberate,
and it is not about trust: every QA works from the same starting state, and
one person's integration landing here would change what the next person
clones and make their timings meaningless.

So just work in your clone and leave it there. Commit locally as much as
you like. If you want to show us code, zip the repo or push it to a repo of
your own and send the link — do not open a PR here.

The one exception is a genuine fix to the handoff itself (a broken command,
a wrong path in the docs). Tell us and we will make the change centrally,
so everyone picks it up.

---

## Telling us how it went

Send the output of `pnpm milestone report` along with the debrief in
[`docs/03-report-template.md`](docs/03-report-template.md).

What we most want: where you got stuck and for how long, every time the docs
or the skills let you down, what you could not customize and wanted to, and
anything that broke. **A blunt report is more useful than a polite one.** If
something is confusing, that is our bug, not yours.
