# The debrief

This is what you send back. Run:

```sh
pnpm milestone report
```

It prints your timings, versions and plane automatically. Paste that block into
your reply, then answer the questions below underneath it and send the whole
thing privately.

**Fifteen to thirty minutes, not an afternoon.** Bullet points are fine. Rough
numbers are fine. An honest "I don't remember" is fine and better than a
guess. What is not fine is leaving sections 2 and 3 blank — they are the reason
this exercise exists.

---

## 1. The headline

- Total elapsed time, start to milestone 10:
- Of that, roughly how much was actual work vs. waiting, meetings, other jobs:
- Which milestone took the longest, and why:
- Did you reach all ten? If not, where did you stop and what stopped you:

---

## 2. Where you got stuck

One row per time you were blocked for more than about twenty minutes. Include
the ones you feel silly about — those are usually the most useful.

| # | Milestone | What you were trying to do | What was actually wrong | Roughly how long | What unstuck you |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

Anything you got stuck on **more than once**? Those are the worst kind and we
especially want them named.

---

## 3. Documentation defects

**Every time you had to ask a human, or read library source code, or guess and
check, instead of finding the answer in the docs, that is a documentation
defect.** Not a failure on your part — a bug in our product, filed against
<https://developer.kaafil.in>. Please list all of them. This section is the
single highest-value part of the report.

| # | What you needed to know | Where you looked first | How you eventually found out | Where it *should* have been |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

And about the AI tooling from step zero:

- Did you install both `npx kaafil-skills add` and the docs MCP? If not, why:
- Did the skills fire when you expected? Which ones helped:
- Did your assistant ever confidently give you something **wrong** — a method
  that does not exist, a prop that was never there, an invented field? Please
  quote it if you can. These matter a lot:
- Anything you expected a skill for and there wasn't one:

---

## 4. Customization

- **The twelve tokens test.** You set only the twelve and looked at all three
  surfaces. How close to the CRM did that get you? (A percentage feel is fine.)
- **Tokens beyond the twelve** you ended up needing:
- **Every time you had to write a selector against a `.kf-*` class** instead of
  setting a token — list them. What were you trying to change?
- **Which rung of the ladder** did each customization need (surface / composite
  / slot / hooks), and did anything force you further down than felt fair?
- **What could you not customize, and wanted to?** Be greedy here — this is the
  roadmap question. Even "I wanted X and I know that's a lot to ask".
- **Style isolation:** did you use `scoped` or `shadow`? Did the CRM's
  stylesheet and Kaafil's interfere in either direction?

---

## 5. What broke

Anything that crashed, lost data, rendered wrong, warned in the console, or
behaved in a way you could not explain. One block each; repeatable steps beat
prose.

```
What I did:
What I expected:
What happened:
Browser / device:
Reproducible? (always / sometimes / once)
Milestone:
```

Specifically, please answer these three explicitly even if the answer is "no":

- **Did any offline write fail to survive a reload?** (yes / no — and if yes,
  you should already have sent this to us separately)
- **Did you find any way to write to a closed-out (`423`) trip?** (yes / no)
- **Did you find any way to make a share-link section appear that the server
  had not sent?** (yes / no)

---

## 6. The verdict

Answer these plainly. Nobody is offended.

- **Would you ship on this?** yes / yes-with-caveats / no — and one paragraph
  saying why.
- What is the **single worst thing** about integrating Kaafil?
- What is the **single best** thing?
- On day one, what did you most wish someone had told you?
- If you were the engineer at a real partner CRM, given a month and this
  product, would you feel safe putting it in front of your customers?
- Was there a moment where you nearly gave up? What was it?
- Anything we did not ask about that you want to say:

---

## Sending it

Paste the `pnpm milestone report` output plus your answers into a private
message to whoever gave you this repo. Attach screenshots, HAR files, or a
diff of `app/src/kaafil/` if you are willing to share your integration code —
seeing how you actually structured it tells us things the answers above cannot.

Thank you. Genuinely: a cold read by someone who had never heard of Kaafil is
the only way we find out what this product is really like to adopt.
