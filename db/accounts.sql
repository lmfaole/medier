-- Schema of `.data/accounts.db`. No app reads it since its frontend was removed (2026-10-15); the rows are kept in
-- `data-dump/accounts/`. Edit this file by hand: a changed or dropped column is a numbered migration in `db/migrations/accounts/`.

-- Platform.
CREATE TABLE IF NOT EXISTS platform (
  id TEXT PRIMARY KEY, -- Id
  tjeneste TEXT NOT NULL, -- Platform
  kategori TEXT, -- Category
  avatar TEXT, -- Profile picture path
  brukernavn TEXT NOT NULL -- Usernames and use, JSON
);

-- Account category.
CREATE TABLE IF NOT EXISTS account_category (
  id TEXT PRIMARY KEY, -- Id
  navn TEXT NOT NULL, -- Name
  beskrivelse TEXT NOT NULL, -- Description
  sortering INTEGER NOT NULL -- Sort order
);
