## A table-level CHECK is invisible to Drizzle: a rename must be `ALTER TABLE`, and a column drop must be a hand-written rebuild
**Area:** data
**Trigger:** renaming OR dropping a table/column in `src/main/db/schema.ts` — especially `program_items` (formerly `service_items`), the one table with a table-level `CHECK`; also when `drizzle-kit generate` emits a one-line migration that fails at runtime

- Drizzle's schema builder cannot express a table-level `CHECK` constraint. It lives only in the
  raw migration SQL (`drizzle/0000_init.sql`) and is **invisible to the snapshot JSON** —
  `checkConstraints` for that table is always `{}`, even though the constraint is real and SQLite
  enforces it.
- A recreate-based migration (`CREATE TABLE` + copy rows + `DROP` + rename — what a tool would
  emit for a rename without the snapshot hand-edited to match) would silently **drop the CHECK
  with no error anywhere**: nothing in the schema, the snapshot, or a normal `db:smoke` run would
  reveal it missing.
- The safe migration is plain `ALTER TABLE \`x\` RENAME TO \`y\`` / `RENAME COLUMN`, which SQLite
  applies in place and never touches the CHECK clause baked into the table's original DDL. See
  `drizzle/0004_rename_programs.sql` for the `services`→`programs`/`service_items`→`program_items`
  rename done this way.
- Two side effects of `ALTER TABLE RENAME` to remember: it does **not** rename indexes tied to the
  table (`ix_items_service`/`ix_services_recent` had to be `DROP`ped and recreated by hand as
  `ix_items_program`/`ix_programs_recent`) — but with `PRAGMA foreign_keys = ON` set on every
  connection (`src/main/db/client.ts`), SQLite *does* automatically rewrite FK clauses in
  referencing tables (`projection_history.program_id`) when the referenced table/column is
  renamed — no manual FK fixup needed there.
- Verified by hand-building a DB at the pre-rename schema (migrations 0000–0003 only), inserting
  rows, then running the real migration folder (with 0004) on top of it: `PRAGMA foreign_key_check`
  came back clean, an insert violating the CHECK (`kind='bible'` with `bible_text` NULL) was still
  rejected, and both renamed indexes existed under their new names.

### Dropping a column named in the CHECK: the opposite conclusion, same root cause

- The rule above is about a **rename**, where `ALTER TABLE` preserves the CHECK. Dropping a column
  the CHECK *names* is the mirror image: `ALTER TABLE ... DROP COLUMN` is impossible and a rebuild
  is the only option. Same root cause — the snapshot does not know the CHECK exists — but the
  opposite fix, so do not read the rule above as "never recreate".
- `drizzle-kit generate` happily emitted the whole migration as
  `ALTER TABLE \`program_items\` DROP COLUMN \`text_body\`;` (removing the `text` program-item
  kind, 2026-09-15). SQLite rejects it, and **the error names the wrong thing**:

  ```
  SqliteError: error in table program_items after drop column: no such column: text_body
  ```

  Code `SQLITE_ERROR`. Read literally it says the column you just asked to drop does not exist.
  What it actually means is that *something else in the table's DDL still references it* — here the
  `CHECK`'s third branch, `(\`kind\` = 'text' AND \`text_body\` IS NOT NULL AND ...)`. SQLite
  re-parses the table after the drop and that clause no longer resolves.
- The fix is `drizzle/0009_drop_text_program_items.sql`: hand-written `CREATE TABLE
  __new_program_items` (with the narrowed CHECK), `INSERT ... SELECT` of every surviving column,
  `DROP TABLE`, `RENAME TO`, then `CREATE INDEX` — the index is **not** carried over by the rename,
  same as the note above. Nothing references `program_items`, so the `DROP` is safe with FK
  enforcement on; if something did, the rebuild would need `PRAGMA foreign_keys=OFF`, which is a
  no-op inside the migrator's transaction.
- A rebuild that narrows a CHECK must **delete the rows the new CHECK would reject, first**, in the
  same migration (`DELETE FROM program_items WHERE kind = 'text'` before the copy). One surviving
  row aborts the entire migration at another machine's launch, and the operator has no way to act
  on it.
- The journal tag is derived from the filename, so renaming a generated migration means editing
  `drizzle/meta/_journal.json`'s `tag` to match — the snapshot JSON beside it stays as generated.
- Useful fixture: the pre-migration backup `migrate.ts` takes (`userData/backups/worship-<ISO>.db`)
  is a database at exactly the previous schema, which is what reproduced the error above after the
  real migration had already run.

### Adding a column: the third case, and the one that looks safest (2026-09-18)

- A rename is safe, a drop is impossible — so `ADD COLUMN` reads like the easy one. It is not,
  for this table. Adding `utility_scene_id` (F3 of the Funciones plan) had drizzle-kit emit
  exactly one line:

  ```sql
  ALTER TABLE `program_items` ADD `utility_scene_id` integer REFERENCES utility_scenes(id);
  ```

  which SQLite **accepts**. That is the trap: nothing fails, and two things are silently wrong.

  1. **The `ON DELETE restrict` is gone.** The schema declares it; the generated SQL has a bare
     `REFERENCES`, which is `NO ACTION`. Deleting a scene a saved program used would have
     succeeded and left a row pointing at nothing — the exact failure the FK existed to prevent,
     with no error at any point.
  2. **The CHECK still does not know the new kind.** It is invisible to the snapshot, as ever, so
     it keeps its two branches and rejects every `kind = 'utility'` row — at runtime, in front of
     the operator, naming a constraint that appears nowhere in the TypeScript.

- So the rule generalizes: **any migration touching `program_items` is a hand-written rebuild**,
  whatever the operation and whatever `drizzle-kit generate` emits. `drizzle/0011_program_item_utility.sql`
  is the copy of 0009 with the CHECK widened to three branches and the new FK spelled out.
- Verified the same way 0004 was, and it is worth the twenty lines: a temp database migrated to
  0010 with the journal trimmed, filled with a `media` and a `bible` row, then 0011 applied on
  top. Both rows survived with their ids and titles, `integrity_check` returned `ok`,
  `foreign_key_check` was empty, `ix_items_program` was back, a `utility` row was accepted, a
  sceneless one was refused (`SQLITE_CONSTRAINT_CHECK`) and deleting a referenced scene was
  refused as `SQLITE_CONSTRAINT_TRIGGER` — the code
  [fk-restrict-delete-is-silently-swallowed.md](fk-restrict-delete-is-silently-swallowed.md)
  warns about.

**Last updated:** 2026-09-18
