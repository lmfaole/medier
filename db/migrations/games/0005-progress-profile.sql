-- How far an achievement is (2026-10-28): the value and the goal it counts towards, and the tier of a medal that has tiers.
ALTER TABLE game_achievement ADD COLUMN progress REAL;
ALTER TABLE game_achievement ADD COLUMN target REAL;
ALTER TABLE game_achievement ADD COLUMN tier INTEGER;
ALTER TABLE game_achievement ADD COLUMN tiers INTEGER;
