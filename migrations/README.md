# Database migration policy

- `db/schema.sql` is the canonical baseline for an empty Supabase project.
- Files in this directory are immutable, ordered upgrades for an existing database.
- Apply them with `python migrate.py`; never paste fragments into production.
- Back up and perform a restore smoke test before every upgrade.
- A changed checksum is a release blocker. Add a new migration instead of editing an
  already-applied file.

The 2026-07-13 upgrade quarantines legacy citizen proposals that have no explicit
consent evidence. Operators must review the quarantine offline; the migration does
not infer consent or silently publish legacy reports.
