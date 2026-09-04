#!/usr/bin/env python3
"""Create ~/.chromium/history (Windows: %USERPROFILE%\\.chromium\\history)."""

from pathlib import Path


def main() -> None:
    target = Path.home() / ".chromium" / "history"
    target.mkdir(parents=True, exist_ok=True)
    print(target)


if __name__ == "__main__":
    main()
