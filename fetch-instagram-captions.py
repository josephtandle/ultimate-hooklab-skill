#!/usr/bin/env python3
"""Fetch recent Instagram post captions for a public handle.

Usage:
    python3 fetch-instagram-captions.py <handle> [count]

Writes one caption hook per line to stdout (the first non-empty line of
each post's caption, which is where the hook actually lives). Exit codes
match what market-research.js expects:

    0  ok            success, hooks on stdout
    1  not-found     profile does not exist
    2  private       profile is private
    3  rate-limited  Instagram blocked the request (401 / 429 / login wall)
    4  other         any other failure

This script is intentionally dependency-light: it only needs the
`instaloader` package. If instaloader is missing it exits 4 so the
caller treats the source as unavailable and falls through to YouTube.
"""

import os
import re
import sys
import tempfile

EXIT_OK = 0
EXIT_NOT_FOUND = 1
EXIT_PRIVATE = 2
EXIT_RATE_LIMITED = 3
EXIT_OTHER = 4

RATE_LIMIT_HINTS = ("429", "checkpoint", "wait a few minutes", "please wait", "too many")


def parse_args(argv):
    if len(argv) < 2:
        sys.stderr.write("Usage: fetch-instagram-captions.py <handle> [count]\n")
        sys.exit(EXIT_OTHER)
    handle = argv[1].lstrip("@").strip().lower()
    try:
        count = max(1, min(50, int(argv[2]))) if len(argv) > 2 else 18
    except ValueError:
        count = 18
    return handle, count


def first_hook_line(caption):
    if not caption:
        return None
    text = caption.strip()
    if not text:
        return None
    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if cleaned.startswith("#") and " " not in cleaned:
            continue
        cleaned = re.sub(r"\s+", " ", cleaned)
        if len(cleaned) > 8:
            return cleaned[:240]
    return None


def main():
    handle, count = parse_args(sys.argv)

    try:
        import instaloader
    except ImportError:
        sys.stderr.write(
            "instaloader is not installed. Run: pip install --user instaloader\n"
        )
        sys.exit(EXIT_OTHER)

    with tempfile.TemporaryDirectory() as tmpdir:
        loader = instaloader.Instaloader(
            dirname_pattern=tmpdir,
            download_pictures=False,
            download_videos=False,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            post_metadata_txt_pattern="",
            quiet=True,
            max_connection_attempts=1,
            request_timeout=8.0,
        )
        loader.context.raise_all_errors = True

        try:
            profile = instaloader.Profile.from_username(loader.context, handle)
        except instaloader.exceptions.ProfileNotExistsException:
            sys.exit(EXIT_NOT_FOUND)
        except instaloader.exceptions.ConnectionException as exc:
            msg = str(exc).lower()
            if any(hint in msg for hint in RATE_LIMIT_HINTS):
                sys.exit(EXIT_RATE_LIMITED)
            sys.exit(EXIT_OTHER)
        except instaloader.exceptions.LoginRequiredException:
            sys.exit(EXIT_RATE_LIMITED)
        except Exception:
            sys.exit(EXIT_OTHER)

        if profile.is_private:
            sys.exit(EXIT_PRIVATE)

        hooks = []
        try:
            for idx, post in enumerate(profile.get_posts()):
                if idx >= count:
                    break
                hook = first_hook_line(post.caption)
                if hook:
                    hooks.append(hook)
        except instaloader.exceptions.ConnectionException as exc:
            msg = str(exc).lower()
            if any(hint in msg for hint in RATE_LIMIT_HINTS):
                sys.exit(EXIT_RATE_LIMITED)
            if hooks:
                pass
            else:
                sys.exit(EXIT_OTHER)
        except instaloader.exceptions.LoginRequiredException:
            sys.exit(EXIT_RATE_LIMITED)
        except Exception:
            if not hooks:
                sys.exit(EXIT_OTHER)

    for hook in hooks:
        sys.stdout.write(hook + "\n")

    sys.exit(EXIT_OK)


if __name__ == "__main__":
    main()
