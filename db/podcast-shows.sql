-- The shows found in the listens on 2026-10-08, for `.data/podcasts.db` (the table is there since the podcast data left `data.db`).
-- Run once: a show deleted from `podcast_shows` afterwards is not added back by
-- anything. Names are as ListenBrainz has them. Left out because they could be
-- music: 'Seasoned Sessions' (two 40-55 minute plays) and 'Android Police'.
INSERT OR IGNORE INTO podcast_shows (artist_name) VALUES
  ('Desken brenner'),
  ('Dagsnytt 18'),
  ('Politisk kvarter'),
  ('Kommentert'),
  ('Debatten'),
  ('TrueAnon'),
  ('The Down Low'),
  ('Aftermath Hours'),
  ('Upstairs Neighbors'),
  ('The 404 Media Podcast'),
  ('Accidental Tech Podcast'),
  ('Power User with Taylor Lorenz'),
  ('cocteau twinks'),
  ('Accessibility Craft'),
  ('Gossip Without Prejudice'),
  ('PodRocket - A web development podcast from LogRocket');

-- Found in the Last.fm scrobbles on 2026-10-17, where a show is the track.
INSERT OR IGNORE INTO podcast_shows (artist_name) VALUES ('Hele historien'), ('Din venn, Nora');
