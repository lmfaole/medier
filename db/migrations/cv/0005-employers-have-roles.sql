-- An employer is its own row and a position is a role at it (`arbeidsgiver_id`, never empty), so a change of
-- title at one employer (Fremtind: interaction designer, front-end developer, senior) is several roles under
-- one employer and not several unrelated rows. The title of a role is the role only («Frontend-utvikler», not
-- «Frontend-utvikler hos Fremtind»); the place is the employer's. Position ids are unchanged, so a project
-- keeps its `stilling_id`.
CREATE TABLE cv_employer (
  id INTEGER PRIMARY KEY,
  navn TEXT NOT NULL,
  sted TEXT
);
INSERT INTO cv_employer (navn, sted)
  SELECT arbeidsgiver, MIN(sted) FROM cv_position WHERE arbeidsgiver IS NOT NULL GROUP BY arbeidsgiver ORDER BY MAX(fra) DESC, arbeidsgiver;

ALTER TABLE cv_position RENAME TO cv_position_before_employers;
CREATE TABLE cv_position (
  id INTEGER PRIMARY KEY,
  arbeidsgiver_id INTEGER NOT NULL,
  fra TEXT,
  til TEXT,
  aar INTEGER NOT NULL,
  tittel TEXT NOT NULL,
  beskrivelse TEXT,
  kortbeskrivelse TEXT
);
INSERT INTO cv_position (id, arbeidsgiver_id, fra, til, aar, tittel, beskrivelse, kortbeskrivelse)
  SELECT id, (SELECT employer.id FROM cv_employer AS employer WHERE employer.navn = old.arbeidsgiver),
         fra, til, aar, CASE WHEN instr(tittel, ' hos ') > 0 THEN substr(tittel, 1, instr(tittel, ' hos ') - 1) ELSE tittel END,
         beskrivelse, kortbeskrivelse
  FROM cv_position_before_employers AS old;
DROP TABLE cv_position_before_employers;
