-- Schema of `.data/cv.db`, written from the collection specs in packages/content/src/collections
-- by `npm run generate --workspace @designsystem/content`; edit a collection there, not here. Every
-- statement is idempotent. A changed or dropped column is a numbered migration in `db/migrations/cv/`.

-- Person.
CREATE TABLE IF NOT EXISTS cv_person (
  id INTEGER PRIMARY KEY, -- Id
  navn TEXT NOT NULL, -- Name
  tittel TEXT, -- Title
  arbeidsgiver TEXT, -- Employer
  sted TEXT, -- Place
  kilde TEXT, -- Source
  hentet TEXT -- Fetched
);

-- Employer.
CREATE TABLE IF NOT EXISTS cv_employer (
  id INTEGER PRIMARY KEY, -- Id
  navn TEXT NOT NULL, -- Name
  sted TEXT -- Place
);

-- Position.
CREATE TABLE IF NOT EXISTS cv_position (
  id INTEGER PRIMARY KEY, -- Id
  arbeidsgiver_id INTEGER NOT NULL, -- Employer it was a role at (a role always has one)
  fra TEXT, -- From
  til TEXT, -- To (empty: still going)
  aar INTEGER NOT NULL, -- Year
  tittel TEXT NOT NULL, -- Title
  beskrivelse TEXT, -- Description
  kortbeskrivelse TEXT -- Short description
);

-- Education.
CREATE TABLE IF NOT EXISTS cv_education (
  id INTEGER PRIMARY KEY, -- Id
  fra TEXT, -- From
  til TEXT, -- To (empty: still going)
  aar INTEGER NOT NULL, -- Year
  grad TEXT NOT NULL, -- Degree
  institusjon TEXT, -- Institution
  beskrivelse TEXT, -- Description
  kortbeskrivelse TEXT -- Short description
);

-- Project.
CREATE TABLE IF NOT EXISTS cv_project (
  id INTEGER PRIMARY KEY, -- Id
  stilling_id INTEGER NOT NULL, -- Position it was done in (a project always belongs to one)
  fra TEXT, -- From
  til TEXT, -- To (empty: still going)
  aar INTEGER NOT NULL, -- Year
  navn TEXT, -- Name
  tittel TEXT, -- Title
  url TEXT, -- Address
  repo TEXT, -- GitHub repository, public (owner/name); its latest commit by the owner is shown
  beskrivelse TEXT, -- Description
  kortbeskrivelse TEXT -- Short description
);

-- Link.
CREATE TABLE IF NOT EXISTS cv_link (
  id INTEGER PRIMARY KEY, -- Id
  navn TEXT NOT NULL, -- Name
  url TEXT NOT NULL -- Address
);
