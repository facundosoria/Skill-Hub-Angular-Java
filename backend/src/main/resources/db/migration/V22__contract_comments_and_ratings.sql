ALTER TABLE skill_ratings ALTER COLUMN rating DROP NOT NULL;
ALTER TABLE skill_ratings DROP CONSTRAINT IF EXISTS skill_ratings_rating_check;
ALTER TABLE skill_ratings ADD CONSTRAINT skill_ratings_rating_check CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5));
