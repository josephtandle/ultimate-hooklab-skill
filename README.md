# Ultimate HookLab Skill

A Claude Code skill that generates scored Instagram Reel hooks — either reverse engineered from top posts in your niche, or built backwards from your CTA.

Built for creators who want hooks that actually convert, not content that just gets views.

---

## What this is

HookLab is a prompt-based skill for Claude Code. It reads your brand voice, pulls from research accounts, scores every hook on 5 axes, and outputs scripts you can film the same day.

Three modes:

| Mode | Use when |
|------|----------|
| **Standard** | You want 5 scored hooks from your brand voice and topic |
| **Mode 1: Reverse Engineer** | You want to see what's working in your niche first, then adapt the best into your voice |
| **Mode 2: CTA First** | You know your giveaway or lead magnet, and want hooks that lead to it |

---

## Requirements

- [Claude Code](https://claude.ai/code) installed
- Node.js (for market research in Mode 1)
- An Instagram account you can use for research (or use accounts you follow in your niche)

---

## Installation

```bash
git clone https://github.com/josephtandle/ultimate-hooklab-skill.git
cd ultimate-hooklab-skill
```

Then copy the `skill/` folder into your Claude Code skills directory:

```bash
cp -r skill/ ~/.claude/skills/hooklab/
```

Or if you're running Claude Code with a custom skills path, adjust accordingly.

---

## Setup (do this before your first run)

1. Open `personal/my-brand-voice.md` and fill it in completely. Every blank field produces a weaker hook.
2. Open `personal/research-accounts.md` and add 3-5 Instagram accounts in your niche that post high-performing content.
3. Open `personal/this-week.md` and add your topic for this week (Standard and Mode 1 only).

---

## Running HookLab

In Claude Code, type:

```
/hooklab
```

It will ask which mode you want to run. Or say "Mode 1", "Mode 2", or "go" for Standard.

---

## Scoring axes

Every hook is scored out of 50 across five dimensions:

| Axis | What it measures |
|------|-----------------|
| **Concreteness** | Is the central noun nameable and countable? |
| **Mechanism** | Does the psychological trigger fire without explanation? |
| **Voice Fidelity** | Does it sound like something you'd actually say? |
| **Self-Recognition** | Would your target viewer think "that's me" before finishing? |
| **Thumb Stop** | Would the first 3 words cause a mid-scroll pause? |

---

## The Kill List

`stale-openers.txt` is the hook kill list. HookLab never opens with anything in that file.
Add overused patterns as you spot them.

---

## Logging results

After posting, log your hook in `personal/my-hooks-log.md`. At 48 hours, fill in views, saves, and 3-second retention.

After 8 weeks you'll know which hook category outperforms for your specific audience. HookLab uses that data to weight its recommendations.

---

## Built by

Mastermind HQ — [mastermindshq.business](https://mastermindshq.business)
