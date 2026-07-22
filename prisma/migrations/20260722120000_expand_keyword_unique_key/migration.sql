-- Fix silent GSC data loss: the Keyword unique key was (siteId, query, date)
-- but rows are fetched broken down by device/country/page, so those variants
-- collapsed onto one row and overwrote each other. Widen the unique key to
-- include all fetched dimensions.

-- 1. Backfill NULL dimension values so they can participate in the unique key
--    (Postgres treats NULL as distinct, which would defeat upserts).
UPDATE "Keyword" SET "page" = '' WHERE "page" IS NULL;
UPDATE "Keyword" SET "device" = '' WHERE "device" IS NULL;
UPDATE "Keyword" SET "country" = '' WHERE "country" IS NULL;

-- 2. Make the dimension columns NOT NULL DEFAULT ''.
ALTER TABLE "Keyword"
  ALTER COLUMN "page" SET NOT NULL,
  ALTER COLUMN "page" SET DEFAULT '',
  ALTER COLUMN "device" SET NOT NULL,
  ALTER COLUMN "device" SET DEFAULT '',
  ALTER COLUMN "country" SET NOT NULL,
  ALTER COLUMN "country" SET DEFAULT '';

-- 3. Collapse any pre-existing rows that would violate the wider unique key,
--    keeping one arbitrary row per full-dimension tuple.
DELETE FROM "Keyword" a
USING "Keyword" b
WHERE a.ctid < b.ctid
  AND a."siteId" = b."siteId"
  AND a."query" = b."query"
  AND a."date" = b."date"
  AND a."device" = b."device"
  AND a."country" = b."country"
  AND a."page" = b."page";

-- 4. Swap the unique index.
DROP INDEX "Keyword_siteId_query_date_key";
CREATE UNIQUE INDEX "Keyword_siteId_query_date_device_country_page_key"
  ON "Keyword"("siteId", "query", "date", "device", "country", "page");
