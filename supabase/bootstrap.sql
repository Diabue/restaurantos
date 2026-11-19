CREATE SCHEMA IF NOT EXISTS restaurantos; SET search_path TO restaurantos;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('WAITER', 'KITCHEN', 'MANAGER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PREPARED', 'SENDING', 'UNKNOWN', 'ISSUED', 'FAILED');

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "logo" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdOrder" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "options" JSONB NOT NULL DEFAULT '[]',
    "fiscalCode" TEXT NOT NULL,
    "vatCode" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiningTable" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 25,

    CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "activeTable" TEXT,
    "pin" TEXT NOT NULL,
    "cart" JSONB NOT NULL DEFAULT '[]',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestAccess" (
    "digest" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,

    CONSTRAINT "GuestAccess_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "CartOperation" (
    "visitId" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "CartOperation_pkey" PRIMARY KEY ("visitId","key")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "lines" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCall" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "openVisit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "lockedVisit" TEXT,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PREPARED',
    "lines" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "roles" "Role"[],
    "canFiscalize" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAccess" (
    "digest" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAccess_pkey" PRIMARY KEY ("digest")
);

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_slug_key" ON "Restaurant"("slug");

-- CreateIndex
CREATE INDEX "Category_restaurantId_position_idx" ON "Category"("restaurantId", "position");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_code_key" ON "DiningTable"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_restaurantId_number_key" ON "DiningTable"("restaurantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_activeTable_key" ON "Visit"("activeTable");

-- CreateIndex
CREATE INDEX "Visit_tableId_openedAt_idx" ON "Visit"("tableId", "openedAt");

-- CreateIndex
CREATE INDEX "GuestAccess_visitId_idx" ON "GuestAccess"("visitId");

-- CreateIndex
CREATE INDEX "Order_visitId_status_idx" ON "Order"("visitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_visitId_key_key" ON "Order"("visitId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCall_openVisit_key" ON "ServiceCall"("openVisit");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_lockedVisit_key" ON "Receipt"("lockedVisit");

-- CreateIndex
CREATE INDEX "Receipt_visitId_createdAt_idx" ON "Receipt"("visitId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_restaurantId_username_key" ON "Employee"("restaurantId", "username");

-- CreateIndex
CREATE INDEX "StaffAccess_employeeId_idx" ON "StaffAccess"("employeeId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestAccess" ADD CONSTRAINT "GuestAccess_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartOperation" ADD CONSTRAINT "CartOperation_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCall" ADD CONSTRAINT "ServiceCall_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAccess" ADD CONSTRAINT "StaffAccess_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Visit" ALTER COLUMN "pin" DROP NOT NULL;

UPDATE "Visit" SET "pin" = NULL WHERE "activeTable" IS NULL;

CREATE TABLE "AccessAttempt" (key text PRIMARY KEY, count integer NOT NULL, expires timestamptz NOT NULL);
-- All application access goes through NestJS. Supabase anon/authenticated
-- clients must not read tables containing PINs, passwords or bearer digests.
-- The backend connects as the schema/table owner, which bypasses RLS.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Restaurant', 'Category', 'Product', 'DiningTable', 'Visit', 'GuestAccess',
    'CartOperation', 'Order', 'ServiceCall', 'Receipt', 'Employee', 'StaffAccess', 'AccessAttempt'
  ] LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', current_schema(), table_name);
  END LOOP;
END $$;

REVOKE ALL ON SCHEMA restaurantos FROM anon, authenticated; REVOKE ALL ON ALL TABLES IN SCHEMA restaurantos FROM anon, authenticated;