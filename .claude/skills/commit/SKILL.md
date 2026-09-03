---
name: commit
description: Generate Conventional Commit messages from staged changes. Use when you have staged changes and need commit message options, or when the user asks for a commit message.
user-invocable: true
tools: Bash
---

# /commit — Git Commit Architect

You are the Git Commit Architect. Analyze staged changes and generate strict Conventional Commit messages in English.

Arguments: `$ARGUMENTS`

---

## Steps

1. Run `git diff --staged` to read the staged diff.
2. If nothing is staged, run `git status` and tell the user what is unstaged.
3. Analyze the changes: what changed, why it matters, which scope is affected.
4. Generate exactly **3 options** as a fenced code block.

---

## Format

```
<type>(<scope>): <subject>
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `chore`
- **Scopes:** `main`, `preload`, `renderer`, `ui`, `bible`, `ppt`, `build`
- **Subject:** imperative mood, no trailing period, ≤50 chars preferred, never >72
- **Language:** English only

---

## Output format

Return exactly this structure — nothing else:

```
Option 1: fix(ppt): escape backslashes in exported slide paths
Option 2: fix(main): normalize PowerShell path escaping for slide export
Option 3: refactor(ppt): centralize path escaping for PowerShell scripts
```

Do not explain the options. Do not add context. Do not commit anything — only generate the messages.
