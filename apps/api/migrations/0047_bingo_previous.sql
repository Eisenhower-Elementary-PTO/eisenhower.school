-- 0047_bingo_previous.sql — remember the game that was just cleared.
--
-- Clearing the board (the letters-column tap) used to erase the only record of
-- which numbers had been called, so a winner still queued for their prize
-- could no longer be refereed by the card scanner. The row now keeps ONE
-- finished game: the call list as it stood when the board was cleared, and
-- when. The next clear that ends a real game replaces it — one game back,
-- never a history.
--
-- Same posture as the rest of the row (0040): 75 numbers, nothing that names
-- anyone, published on purpose through `readBingoState`.
ALTER TABLE bingo_state ADD COLUMN previous_marked_numbers TEXT; -- JSON array, call order; NULL = no finished game yet
ALTER TABLE bingo_state ADD COLUMN previous_ended_at TEXT;       -- ISO-8601 UTC of the clear
