CREATE TABLE skill_ratings (
    skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    voter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_ratings_skill_voter_pk PRIMARY KEY (skill_id, voter_id)
);

CREATE INDEX skill_ratings_skill_updated_idx ON skill_ratings (skill_id, updated_at DESC);
