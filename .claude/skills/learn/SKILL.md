---
name: learn
description: Record a durable finding from this session into .claude/knowledge/ and index it in INDEX.md. Use at the end of a non-trivial task, when a bug's real cause turned out to be non-obvious, when a library/tool behaved differently than expected, or when the user says "record this", "learn this", "save this finding".
user-invocable: true
tools: Read, Write, Edit, Bash, Glob, Grep
---

# /learn — Self-improvement cycle (WorshipApp)

Turn what this session discovered into a knowledge entry the next session will find. One
finding per file, indexed in `INDEX.md`.

Arguments: `$ARGUMENTS` — optionally the finding to record. If empty, derive candidates from
the current session's work.

---

## Phase 0 — Is there anything worth recording?

A finding qualifies only if **all** of these hold:

- **Non-derivable.** A future session cannot get it from reading the code, `git log`, or
  `CLAUDE.md`. (If the code already says it, the code is the documentation.)
- **It cost something to discover.** A wrong assumption, a misleading error, a tool behaving
  against its docs, a fix that took several attempts.
- **It will matter again.** It constrains a whole area (protocol, slides pipeline, projection
  state, DB, packaging), not one line.

Explicitly **do NOT** record: what a file does, structure git already tracks, a rule already in
`CLAUDE.md` or `docs/knowledge/`, or task state (that belongs in `HANDOFF.md`).

If nothing qualifies, say so in one line and stop. **An empty cycle is a valid outcome** — do
not invent an entry to have something to write.

## Phase 1 — Check for an existing entry first

```bash
ls .claude/knowledge/
```

Read `.claude/knowledge/INDEX.md` and any entry whose area overlaps. Then decide:

- **The finding refines an existing entry** → edit that file, refresh its `**Last updated:**`
  line, and adjust its INDEX hook if the hook no longer matches. Do **not** create a second
  file on the same subject.
- **It is genuinely new** → create a new file (Phase 2).
- **It is now a structural rule of the project, not a war story** → it graduates: fold it into
  the matching `docs/knowledge/0X-*.md` and, if it is a non-negotiable, add one line to
  `CLAUDE.md`. Leave the atomic entry in place as the detailed diagnosis and link to it.

## Phase 2 — Write the entry

File: `.claude/knowledge/<kebab-case-slug>.md`. Content in **English** (project rule), the
existing format — match `worship-protocol-range-and-video-lifecycle.md` as the reference:

```markdown
## <Title: the finding as a claim, not a topic>
**Area:** <build | data | ipc | slides | projection | renderer | ui>
**Trigger:** <when a future session should open this file — the symptom or the file being touched>

- <What was believed, and what is actually true.>
- <The evidence: the error text, the measured behavior, the file and symbol involved.>
- <The consequence: what must never be done again, and what to do instead.>

**Last updated:** <YYYY-MM-DD>
```

Rules for the body:

- Lead with the claim, not the narrative. `Range` support is mandatory — not "we investigated
  video playback".
- Name real symbols and paths (`serveFile()` in `src/main/protocol/worship-protocol.ts`), so the
  next session can verify the entry is still true.
- Include the **exact** error string when there is one (`PIPELINE_ERROR_DECODE (-12909)`) — that
  is what a future search will match on.
- Absolute dates, never "yesterday" or "last week".
- Link related entries with a markdown link to the other file.

## Phase 3 — Index it

Append one line to `.claude/knowledge/INDEX.md`, under the existing entries:

```markdown
- [Title](file.md) — one-line hook: the surprising part, not a summary
```

The hook exists so a future session can decide whether to open the file. `— fixes about video`
is useless; `— the ignored Range header that made seeking impossible` is the point.

`INDEX.md` holds **only** pointers. Never put finding content in it.

## Phase 4 — Report

Two or three lines, in the user's language:

- which file was created or updated, and why it qualified;
- whether anything graduated to `docs/knowledge/` or `CLAUDE.md`;
- what you deliberately did **not** record, if the session raised something that failed Phase 0.
