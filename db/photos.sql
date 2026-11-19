-- Schema of `.data/photos.db`. No app reads it since its frontend was removed (2026-10-15); the rows are kept in
-- `data-dump/photos/`. Edit this file by hand: a changed or dropped column is a numbered migration in `db/migrations/photos/`.

-- Photo group.
CREATE TABLE IF NOT EXISTS photo_group (
  id TEXT PRIMARY KEY, -- Id
  tittel TEXT NOT NULL, -- Title
  beskrivelse TEXT NOT NULL -- Description
);

-- Photo.
CREATE TABLE IF NOT EXISTS photo (
  id INTEGER PRIMARY KEY, -- Id
  fil TEXT NOT NULL, -- Path
  gruppenavn TEXT NOT NULL, -- Group
  undergruppe TEXT, -- Subgroup
  filnavn TEXT NOT NULL, -- File name
  dato_tidligst TEXT, -- Earliest date
  dato_senest TEXT, -- Latest date
  datokilde TEXT, -- Where the date comes from
  sted TEXT, -- Place
  stedkilde TEXT, -- Where the place comes from
  breddegrad REAL, -- Latitude
  lengdegrad REAL, -- Longitude
  bilde TEXT -- Picture
);
