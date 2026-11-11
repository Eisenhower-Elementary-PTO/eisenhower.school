-- 0046_lf_crop.sql — the vision model's suggested SQUARE for a lost & found
-- photo, so the grid can show the item filling its tile.
--
-- The photo itself is NEVER cropped: the model can be wrong, and pixels cut
-- away are gone. The crop is only four numbers the display reads (CSS draws
-- the square; the full photo stays in R2 and on the item page). A rectangle
-- in fractions of the image's width and height (x, y = top-left corner),
-- chosen by the server to be square in PIXELS, so a client needs no aspect
-- ratio to draw it. All four are NULL (no crop, show the usual centre fit) or
-- all four are set (`cleanCrop` is the only writer).
--
-- Geometry, not content: it enters `publicItemOf` on purpose (the public grid
-- draws it). A rotation of the photo turns the rectangle with it
-- (`turnCrop`); a replacement photo of unknown geometry clears it.
ALTER TABLE lf_item ADD COLUMN crop_x REAL;
ALTER TABLE lf_item ADD COLUMN crop_y REAL;
ALTER TABLE lf_item ADD COLUMN crop_w REAL;
ALTER TABLE lf_item ADD COLUMN crop_h REAL;
