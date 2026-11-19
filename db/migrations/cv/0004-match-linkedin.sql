-- The CV follows LinkedIn (screenshots of the profile, 2026-10-17): titles, dates, places and the texts
-- LinkedIn has. Rows LinkedIn does not have as projects (the Vipps and Shortcut projects, which the two positions
-- already are) and the personal package are left out; the old texts are in `.data/archive/cv-before-linkedin.db`.
UPDATE cv_person SET tittel = 'Senior frontend-utvikler', kilde = 'LinkedIn (profilen, skjermbilder 2026-10-17)', hentet = '2026-10-17' WHERE id = 1;

-- Positions. 1 and 2 keep their rows; the others are new, or corrected to LinkedIn.
UPDATE cv_position SET fra = '2024-05-01', til = NULL, aar = 2024, tittel = 'Frontend-utvikler hos Fremtind', arbeidsgiver = 'Fremtind', sted = 'Oslo',
  beskrivelse = 'Utvikling av Jøkul; komponenter, mønster og dokumentasjon som gir folk en felles plattform for god kundekontakt. Designet i Figma, utviklet i React, dokumentert med Sanity + Next.js.',
  kortbeskrivelse = 'Utvikling av Jøkul; komponenter, mønster og dokumentasjon som gir folk en felles plattform for god kundekontakt.' WHERE id = 1;
UPDATE cv_position SET fra = '2023-04-01', til = '2024-04-30', aar = 2023, tittel = 'Interaksjonsdesigner hos Fremtind', arbeidsgiver = 'Fremtind', sted = 'Oslo',
  beskrivelse = 'Designer for kundeportalen for bedriftskunder.', kortbeskrivelse = 'Designer for kundeportalen for bedriftskunder.' WHERE id = 2;
UPDATE cv_position SET fra = '2021-11-01', til = '2023-03-31', aar = 2021, tittel = 'Produktdesigner hos NAV', arbeidsgiver = 'NAV', sted = 'Oslo',
  beskrivelse = 'Design av komponenter i Figma, og dokumentasjon lagd med Sanity.', kortbeskrivelse = 'Design av komponenter i Figma, og dokumentasjon lagd med Sanity.' WHERE id = 3;
UPDATE cv_position SET fra = '2021-06-01', til = '2021-08-31', aar = 2021, tittel = 'Interaksjonsdesigner hos Vipps', arbeidsgiver = 'Vipps', sted = 'Oslo', beskrivelse = NULL, kortbeskrivelse = NULL WHERE id = 4;
UPDATE cv_position SET fra = '2021-01-01', til = '2021-06-30', aar = 2021, tittel = 'Interaksjonsdesigner hos Shortcut', arbeidsgiver = 'Shortcut', sted = 'Oslo', beskrivelse = NULL, kortbeskrivelse = NULL WHERE id = 5;
INSERT OR REPLACE INTO cv_position (id, fra, til, aar, tittel, arbeidsgiver, sted, beskrivelse, kortbeskrivelse) VALUES
  (6, '2026-06-01', NULL, 2026, 'Senior frontend-utvikler hos Fremtind', 'Fremtind', 'Oslo',
    'Ansvarlig for frontend-miljøet i Fremtind, samt leder for Fremtind Ung; en sosial møteplass for unge og unge til sinns.',
    'Ansvarlig for frontend-miljøet i Fremtind, samt leder for Fremtind Ung.'),
  (7, '2019-08-01', '2021-06-30', 2019, 'Lærerassistent hos Høyskolen Kristiania', 'Høyskolen Kristiania', 'Oslo', NULL, NULL),
  (8, '2019-09-01', '2020-02-29', 2019, 'Frontend-utvikler hos Flow Digital', 'Flow Digital AS', 'Oslo', NULL, NULL),
  (9, '2019-09-01', '2019-09-30', 2019, 'Valgobservatør hos Oslo kommune', 'Oslo kommune', 'Oslo', NULL, NULL),
  (10, '2017-11-01', '2018-01-31', 2017, 'Frontend-utvikler hos Zabai', 'Zabai', 'Oslo', NULL, NULL),
  (11, '2015-04-01', '2015-08-31', 2015, 'Kundestøtterepresentant hos Telenor', 'Telenor', 'Gjøvik', NULL, NULL);

-- Education: the dates LinkedIn has, and the year at Volda that was missing.
UPDATE cv_education SET fra = '2018-08-01', til = '2021-06-30' WHERE id = 4;
INSERT OR REPLACE INTO cv_education (id, fra, til, aar, grad, institusjon, beskrivelse, kortbeskrivelse) VALUES
  (5, '2016-08-01', '2017-06-30', 2017, 'Årsstudium, kommunikasjon og mediefag', 'Høgskulen i Volda', NULL, NULL);

-- Projects: the three LinkedIn has, with its dates and words; each belongs to the position it was done in.
DELETE FROM cv_project WHERE id IN (4, 5, 6);
UPDATE cv_project SET stilling_id = 1, fra = '2025-01-01', til = NULL, aar = 2025, navn = 'Jøkul', tittel = 'Jøkul', beskrivelse = 'Fremtinds designsystem', kortbeskrivelse = 'Fremtinds designsystem' WHERE id = 1;
UPDATE cv_project SET stilling_id = 3, fra = '2022-08-01', til = '2023-03-31', aar = 2022, navn = 'Aksel', tittel = 'Aksel', beskrivelse = NULL, kortbeskrivelse = NULL WHERE id = 2;
UPDATE cv_project SET stilling_id = 3, fra = '2022-04-01', til = '2022-05-31', aar = 2022, navn = 'Mangfold i mai', tittel = 'Mangfold i mai', beskrivelse = NULL, kortbeskrivelse = NULL WHERE id = 3;
