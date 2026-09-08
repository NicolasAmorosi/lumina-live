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
- **Scopes:** `main`, `preload`, `renderer`, `ui`, `ipc`, `db`, `bible`, `slides`, `projection`,
  `protocol`, `build`
- **Subject:** imperative mood, no trailing period, ≤50 chars preferred, never >72
- **Language:** English only

---

## Output format

Return exactly this structure — nothing else:

```
Option 1: fix(protocol): honor Range requests when serving media files
Option 2: fix(main): return 206 with Accept-Ranges from serveFile
Option 3: fix(protocol): restore video seeking by handling partial requests
```

Do not explain the options. Do not add context. Do not commit anything — only generate the messages.
