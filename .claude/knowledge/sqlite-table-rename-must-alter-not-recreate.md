## Renaming a table/column with a table-level CHECK must use `ALTER TABLE`, never a recreate
**Area:** data
**Trigger:** renaming a SQLite table or column in `src/main/db/schema.ts` — especially `program_items` (formerly `service_items`), the one table with a table-level `CHECK`

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

**Last updated:** 2026-09-10
