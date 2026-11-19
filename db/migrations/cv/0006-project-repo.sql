-- The public GitHub repository of a project, `owner/name`: work-sync fetches the owner's latest commit there.
ALTER TABLE cv_project ADD COLUMN repo TEXT;
UPDATE cv_project SET repo = 'fremtind/jokul' WHERE id = 1;
