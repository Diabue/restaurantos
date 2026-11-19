-- All application access goes through NestJS. Supabase anon/authenticated
-- clients must not read tables containing PINs, passwords or bearer digests.
-- The backend connects as the schema/table owner, which bypasses RLS.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Restaurant', 'Category', 'Product', 'DiningTable', 'Visit', 'GuestAccess',
    'CartOperation', 'Order', 'ServiceCall', 'Receipt', 'Employee', 'StaffAccess',
    '_prisma_migrations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', current_schema(), table_name);
  END LOOP;
END $$;
