#!/bin/bash
set -e

# Ultimate HookLab Skill — one-shot installer
# Usage: curl -fsSL https://raw.githubusercontent.com/josephtandle/ultimate-hooklab-skill/main/install.sh | bash

HOOKLAB_DIR="$HOME/.hooklab"
SKILL_DIR="$HOME/.claude/skills/hooklab"
REPO="https://github.com/josephtandle/ultimate-hooklab-skill"
BRANCH="main"
# The repo is kept as a clone in ~/.hooklab/repo so it can update itself weekly.
# HOOKLAB_SYNC_ONLY=1 (used by the weekly self-test) re-copies the files from
# that clone and skips dependencies and scheduling.
CLONE_DIR="$HOOKLAB_DIR/repo"
SYNC_ONLY="${HOOKLAB_SYNC_ONLY:-0}"

echo ""
echo "Installing Ultimate HookLab Skill..."
echo ""

# ── 1. Download repo ──────────────────────────────────────────────────────────

if [ "$SYNC_ONLY" = "1" ]; then
  SRC="$(cd "$(dirname "$0")" && pwd)"
else
  if ! command -v git &>/dev/null; then
    echo "Error: git is required. Install it from https://git-scm.com and try again."
    exit 1
  fi
  mkdir -p "$HOOKLAB_DIR"
  if [ -d "$CLONE_DIR/.git" ]; then
    git -C "$CLONE_DIR" pull --ff-only --quiet || echo "Could not update the existing copy; using what is there."
  else
    rm -rf "$CLONE_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO" "$CLONE_DIR" --quiet
  fi
  SRC="$CLONE_DIR"
fi

# ── 2. Install files to ~/.hooklab ───────────────────────────────────────────

mkdir -p "$HOOKLAB_DIR/personal"

# Core files
cp "$SRC/generate-hooks-do-not-change.md" "$HOOKLAB_DIR/"
cp "$SRC/mode-1-reverse-engineer.md"      "$HOOKLAB_DIR/"
cp "$SRC/mode-2-cta-first.md"             "$HOOKLAB_DIR/"
cp "$SRC/stale-openers.txt"               "$HOOKLAB_DIR/"
cp "$SRC/market-research.js"              "$HOOKLAB_DIR/"
cp "$SRC/fetch-instagram-captions.py"     "$HOOKLAB_DIR/"
chmod +x "$HOOKLAB_DIR/fetch-instagram-captions.py" 2>/dev/null || true

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

if [ "$SYNC_ONLY" != "1" ] && command -v npm &>/dev/null; then
  cd "$HOOKLAB_DIR"
  # npm init -y derives the package name from the cwd basename, and ".hooklab"
  # is rejected as invalid (names can't start with a dot). Write package.json
  # directly instead so the install survives under "set -e".
  if [ ! -f "package.json" ]; then
    cat > package.json <<'JSON'
{
  "name": "hooklab-local",
  "version": "1.0.0",
  "private": true,
  "description": "Local dependencies for the Ultimate HookLab skill.",
  "license": "SEE LICENSE IN LICENSE"
}
JSON
  fi
  npm install playwright --save --quiet > /dev/null 2>&1 || true
  npx playwright install chromium --quiet > /dev/null 2>&1 || true
  cd - > /dev/null
fi

# ── 6. Install Python dependency for Instagram caption fetcher ───────────────

if [ "$SYNC_ONLY" != "1" ] && command -v python3 &>/dev/null; then
  if ! python3 -c "import instaloader" 2>/dev/null; then
    python3 -m pip install --user --quiet instaloader > /dev/null 2>&1 || \
      pip3 install --user --quiet instaloader > /dev/null 2>&1 || true
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────

if [ "$SYNC_ONLY" = "1" ]; then
  echo "HookLab files refreshed in $HOOKLAB_DIR"
  exit 0
fi

echo "Done. HookLab installed to $HOOKLAB_DIR"
echo ""
echo "Next steps:"
echo "  1. Fill in $HOOKLAB_DIR/personal/my-brand-voice.md"
echo "  2. Add research accounts to $HOOKLAB_DIR/personal/research-accounts.md"
echo "  3. Open Claude Code and type /hooklab"
echo ""

# Weekly self-update: on by default, one line turns it off. It fast-forwards
# the clone in ~/.hooklab/repo from its origin, re-copies the HookLab files
# (your files in personal/ are never overwritten), backs up first and rolls
# back if the self-test fails.
echo ""
if [ "${HOOKLAB_SKIP_UPDATES:-0}" = "1" ]; then
  echo "Weekly updates not scheduled (HOOKLAB_SKIP_UPDATES=1). Later: node \"$CLONE_DIR/scripts/self-update.js\" --register"
else
  node "$CLONE_DIR/scripts/self-update.js" --register || echo "Weekly updates could not be scheduled. Try later: node \"$CLONE_DIR/scripts/self-update.js\" --register"
fi
