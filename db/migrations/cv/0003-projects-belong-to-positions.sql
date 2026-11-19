-- A project always belongs to the position it was done in (`stilling_id`). SQLite cannot add a NOT NULL column
-- without a default, so the table is rebuilt. Vipps and Shortcut become positions, since two projects were done
-- there and nowhere else; @lmfaole/basics (id 6) belongs to no position and is left out (its row is in the backup
-- `.data/archive/cv-before-project-link.db`).
INSERT OR IGNORE INTO cv_position (id, fra, til, aar, tittel, arbeidsgiver) VALUES
  (4, '2021-06-01', '2021-08-31', 2021, 'Sommerjobb hos Vipps', 'Vipps'),
  (5, '2021-01-01', '2021-05-31', 2021, 'Bacheloroppgave hos Shortcut', 'Shortcut');

ALTER TABLE cv_project RENAME TO cv_project_before_link;
CREATE TABLE cv_project (
  id INTEGER PRIMARY KEY,
  stilling_id INTEGER NOT NULL,
  fra TEXT,
  til TEXT,
  aar INTEGER NOT NULL,
  navn TEXT,
  tittel TEXT,
  url TEXT,
  beskrivelse TEXT,
  kortbeskrivelse TEXT
);
INSERT INTO cv_project (id, stilling_id, fra, til, aar, navn, tittel, url, beskrivelse, kortbeskrivelse)
  SELECT id, CASE id WHEN 1 THEN 1 WHEN 2 THEN 3 WHEN 3 THEN 3 WHEN 4 THEN 4 WHEN 5 THEN 5 END, fra, til, aar, navn, tittel, url, beskrivelse, kortbeskrivelse
  FROM cv_project_before_link WHERE id IN (1, 2, 3, 4, 5);
DROP TABLE cv_project_before_link;
