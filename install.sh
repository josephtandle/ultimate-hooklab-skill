#!/bin/bash
set -e

# Ultimate HookLab Skill — one-shot installer
# Usage: curl -fsSL https://raw.githubusercontent.com/josephtandle/ultimate-hooklab-skill/main/install.sh | bash

HOOKLAB_DIR="$HOME/.hooklab"
SKILL_DIR="$HOME/.claude/skills/hooklab"
REPO="https://github.com/josephtandle/ultimate-hooklab-skill"
BRANCH="main"

echo ""
echo "Installing Ultimate HookLab Skill..."
echo ""

# ── 1. Download repo ──────────────────────────────────────────────────────────

TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

if command -v git &>/dev/null; then
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMP_DIR/hooklab" --quiet
else
  echo "Error: git is required. Install it from https://git-scm.com and try again."
  exit 1
fi

SRC="$TMP_DIR/hooklab"

# ── 2. Install files to ~/.hooklab ───────────────────────────────────────────

mkdir -p "$HOOKLAB_DIR/personal"

# Core files
cp "$SRC/generate-hooks-do-not-change.md" "$HOOKLAB_DIR/"
cp "$SRC/mode-1-reverse-engineer.md"      "$HOOKLAB_DIR/"
cp "$SRC/mode-2-cta-first.md"             "$HOOKLAB_DIR/"
cp "$SRC/stale-openers.txt"               "$HOOKLAB_DIR/"
cp "$SRC/market-research.js"              "$HOOKLAB_DIR/"

# Personal templates — only if they don't already exist (never overwrite)
for f in my-brand-voice.md this-week.md my-hooks-log.md research-accounts.md; do
  if [ ! -f "$HOOKLAB_DIR/personal/$f" ]; then
    cp "$SRC/personal/$f" "$HOOKLAB_DIR/personal/$f"
  fi
done

# ── 3. Replace HOOKLAB_DIR placeholder with actual path ──────────────────────

for f in \
  "$HOOKLAB_DIR/generate-hooks-do-not-change.md" \
  "$HOOKLAB_DIR/mode-1-reverse-engineer.md" \
  "$HOOKLAB_DIR/mode-2-cta-first.md"; do
  sed -i.bak "s|HOOKLAB_DIR|$HOOKLAB_DIR|g" "$f" && rm "$f.bak"
done

# ── 4. Install Claude Code skill ─────────────────────────────────────────────

mkdir -p "$SKILL_DIR"
cp "$SRC/skill/SKILL.md" "$SKILL_DIR/SKILL.md"
sed -i.bak "s|HOOKLAB_DIR|$HOOKLAB_DIR|g" "$SKILL_DIR/SKILL.md" && rm "$SKILL_DIR/SKILL.md.bak"

# ── 5. Install Node dependencies ─────────────────────────────────────────────

if command -v npm &>/dev/null; then
  cd "$HOOKLAB_DIR"
  if [ ! -f "package.json" ]; then
    npm init -y --quiet > /dev/null 2>&1
  fi
  npm install playwright --save --quiet > /dev/null 2>&1 || true
  npx playwright install chromium --quiet > /dev/null 2>&1 || true
  cd - > /dev/null
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo "Done. HookLab installed to $HOOKLAB_DIR"
echo ""
echo "Next steps:"
echo "  1. Fill in $HOOKLAB_DIR/personal/my-brand-voice.md"
echo "  2. Add research accounts to $HOOKLAB_DIR/personal/research-accounts.md"
echo "  3. Open Claude Code and type /hooklab"
echo ""
