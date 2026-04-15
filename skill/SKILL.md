---
name: hooklab
description: Generate Instagram Reel hooks from your brand voice profile. Two modes — reverse engineer top posts from research accounts, or start from your CTA and work backwards.
---

# HookLab

You are running HookLab for a Mastermind HQ participant. HookLab is the hook generation engine that runs underneath everything — the internal skill, the SaaS, and the cron-delivered weekly output.

---

## Step 1: Find and load the brand voice profile

Check for a participant file first. If the user mentions a name (e.g. "run it for pina" or "use my file"), look in:

`~/.openclaw/workspace/projects/mastermind/hook-writer/examples/[name].md`

Otherwise, use the default:

`~/.openclaw/workspace/projects/mastermind/hook-writer/personal/my-brand-voice.md`

Read the file. Do not summarize it back to the user. Just use it.

---

## Step 2: Determine the mode

Ask the user which mode they want to run — or infer from context:

**Mode 1 — Reverse Engineer**
Pull best posts from research accounts, deconstruct the top hooks, adapt them into the user's voice for their current topic.
Use when: the user has a topic but wants to see what's working in the space first.
Run: read and execute `~/.openclaw/workspace/projects/mastermind/hook-writer/mode-1-reverse-engineer.md`

**Mode 2 — CTA First**
Start from a giveaway, lead magnet, or call to action. Work backwards to find the 5 hooks most likely to drive that specific action.
Use when: the user knows what they're giving away and wants hooks that lead to it.
Run: read and execute `~/.openclaw/workspace/projects/mastermind/hook-writer/mode-2-cta-first.md`

**Standard Mode**
Full hook generation from brand voice + weekly topic. No deconstruction, no CTA-first logic. Generates 15 candidates, scores all, surfaces 5 with 2 winners.
Use when: the user just wants hooks, no specific direction.
Run: read and execute `~/.openclaw/workspace/projects/mastermind/hook-writer/generate-hooks-do-not-change.md`

If the user doesn't specify, ask:
"Which mode?
1. Reverse Engineer — deconstruct top posts from your research accounts, adapt the best into your voice
2. CTA First — tell me your giveaway or lead magnet, I'll work backwards to the hooks
3. Standard — generate 5 scored hooks from your brand voice and topic

Say 'go' to run Standard."

---

## Step 3: Check the topic (Standard and Mode 1 only)

If running Standard or Mode 1 — check `this-week.md`. If the topic field is empty or a placeholder, ask:

"What are you posting about this week? Topic, specific numbers, and what you want the viewer to feel."

Wait for the answer before continuing.

---

## Step 4: Run the selected mode

Read and execute the full prompt for the selected mode. Do not abbreviate. Deliver everything the mode specifies.

---

## Step 5: Offer to log the winner

After delivering output, ask: "Want me to add the winner to your hooks log?"

If yes, append one row to `~/.openclaw/workspace/projects/mastermind/hook-writer/personal/my-hooks-log.md`:

| [today's date] | [topic, shortened] | [hook category] | [first 8 words of winning hook] | [Claude's score] | -- | -- | -- | Pending |

Leave Views, Saves, 3s Retention, and Result blank. User fills in at 48 hours.
