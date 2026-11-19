-- Schema of `.data/site.db`, written from the collection specs in packages/content/src/collections
-- by `npm run generate --workspace @designsystem/content`; edit a collection there, not here. Every
-- statement is idempotent. A changed or dropped column is a numbered migration in `db/migrations/site/`.

-- Page preview.
CREATE TABLE IF NOT EXISTS og_page (
  id TEXT PRIMARY KEY, -- Page
  title TEXT NOT NULL, -- Title
  description TEXT NOT NULL, -- Description
  heading TEXT, -- Page heading
  lead TEXT, -- Page lead
  image TEXT -- Preview image
);

-- Glossary term.
CREATE TABLE IF NOT EXISTS glossary_term (
  id TEXT PRIMARY KEY, -- Id
  term TEXT NOT NULL, -- Term
  url TEXT NOT NULL -- Address
);
