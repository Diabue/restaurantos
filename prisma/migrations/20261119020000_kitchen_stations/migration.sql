CREATE TYPE "PrepStation" AS ENUM ('KITCHEN', 'BAR');
ALTER TABLE "Product" ADD COLUMN "station" "PrepStation" NOT NULL DEFAULT 'KITCHEN';
ALTER TABLE "Restaurant" ADD COLUMN "kitchenAlertMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Order" ADD COLUMN "acceptedAt" TIMESTAMP(3);

UPDATE "Product" p SET "station" = 'BAR'
FROM "Category" c JOIN "Restaurant" r ON r.id = c."restaurantId"
WHERE p."categoryId" = c.id AND r.slug = 'oliwa' AND p."fiscalCode" = 'DEMO31'
  AND p.name = 'Lemoniada domowa';

-- Preserve the current stage of open tickets created before line-level preparation.
UPDATE "Order" o SET lines = (
  SELECT jsonb_agg(
    line || jsonb_build_object('station', COALESCE(p.station::text, 'KITCHEN'))
    || CASE WHEN o.status IN ('PREPARING', 'READY', 'SERVED') AND NOT (line ? 'canceled')
            THEN jsonb_build_object('startedAt', o."updatedAt" AT TIME ZONE 'UTC') ELSE '{}'::jsonb END
    || CASE WHEN o.status IN ('READY', 'SERVED') AND NOT (line ? 'canceled')
            THEN jsonb_build_object('readyAt', o."updatedAt" AT TIME ZONE 'UTC') ELSE '{}'::jsonb END
    ORDER BY seq)
  FROM jsonb_array_elements(o.lines) WITH ORDINALITY AS items(line, seq)
  LEFT JOIN "Product" p ON p.id = line->>'productId'
)
FROM "Visit" v
WHERE v.id = o."visitId" AND v."activeTable" IS NOT NULL AND jsonb_array_length(o.lines) > 0;

UPDATE "Order" SET "acceptedAt" = "createdAt" WHERE source = 'STAFF';
