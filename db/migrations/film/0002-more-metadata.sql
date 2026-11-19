-- More of what the register says: ratings, money, the Norwegian age rating and release, the series, the ids on other
-- sites, and the companies, keywords and people of a film (the new tables come from the schema).
ALTER TABLE film_title ADD COLUMN vote_average REAL;
ALTER TABLE film_title ADD COLUMN vote_count INTEGER;
ALTER TABLE film_title ADD COLUMN budget INTEGER;
ALTER TABLE film_title ADD COLUMN revenue INTEGER;
ALTER TABLE film_title ADD COLUMN imdb_id TEXT;
ALTER TABLE film_title ADD COLUMN wikidata_id TEXT;
ALTER TABLE film_title ADD COLUMN certification TEXT;
ALTER TABLE film_title ADD COLUMN released_no TEXT;
ALTER TABLE film_title ADD COLUMN collection_id INTEGER;
ALTER TABLE film_title ADD COLUMN collection TEXT;
