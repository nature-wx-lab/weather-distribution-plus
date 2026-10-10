#!/usr/bin/env python3
"""Fail a public workflow when reachable Git identities are not allowlisted."""

from __future__ import annotations

import subprocess


ALLOWED_EMAILS = {
    "nature-wx-lab@users.noreply.github.com",
    "41898282+github-actions[bot]@users.noreply.github.com",
}
ALLOWED_NAMES = {"nature-wx-lab", "github-actions[bot]"}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def main() -> None:
    rows = git("log", "--all", "--format=%H%x09%an%x09%ae%x09%cn%x09%ce").splitlines()
    failures: list[str] = []
    for row in rows:
        commit, author_name, author_email, committer_name, committer_email = row.split("\t")
        if author_email not in ALLOWED_EMAILS or committer_email not in ALLOWED_EMAILS:
            failures.append(f"{commit[:12]} has a non-allowlisted email identity")
        if author_name not in ALLOWED_NAMES or committer_name not in ALLOWED_NAMES:
            failures.append(f"{commit[:12]} has a non-allowlisted name identity")
    patterns = ["/" + "Users/", "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"]
    for pattern in patterns:
        result = subprocess.run(
            ["git", "grep", "-n", "-I", "-E", pattern, "--", ":!scripts/verify_public_git_identity.py"],
            text=True,
            capture_output=True,
        )
        for match in result.stdout.splitlines():
            if "@users.noreply.github.com" not in match:
                failures.append(f"{match.split(':', 1)[0]} contains a disallowed local path or email-like value")
    if failures:
        raise SystemExit("Public Git identity/privacy gate failed:\n" + "\n".join(sorted(set(failures))))
    print(f"Public Git identity/privacy gate passed: commits={len(rows)}")


if __name__ == "__main__":
    main()
