-- An end date for every position, education and project: `til`, a day like `fra`, empty while it goes on.
ALTER TABLE cv_position ADD COLUMN til TEXT;
ALTER TABLE cv_education ADD COLUMN til TEXT;
ALTER TABLE cv_project ADD COLUMN til TEXT;
