-- ============================================================================
-- Migration 1: staff_service_areas join table
-- ============================================================================
-- This migration is for the Supabase project at:
--   PROJECT_REF: fncoiagflerxctfeuitg
--   URL: https://fncoiagflerxctfeuitg.supabase.co
--   Migration system: Supabase CLI migrations (supabase/migrations/)
--   Applied via: supabase db push  (applies migrations to linked project)
--   Local folder: supabase/migrations/
--
-- The staff_function column (text[]) already exists on the live profiles table
-- (added via Supabase Dashboard, NOT by any git migration). This migration
-- does NOT touch it. It only adds the staff_service_areas join table.
-- ============================================================================

-- --- UP ---

-- Step 1: Create staff_service_areas join table
-- Replaces the assigned_service_area_ids array column approach with a
-- proper normalized join table for referential integrity and indexing.
CREATE TABLE IF NOT EXISTS public.staff_service_areas (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_area_id INTEGER NOT NULL REFERENCES public.service_areas(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, service_area_id)
);

-- Step 2: RLS on the join table
ALTER TABLE public.staff_service_areas ENABLE ROW LEVEL SECURITY;

-- Staff can read their own service area assignments
CREATE POLICY "staff can read own service area assignments"
  ON public.staff_service_areas
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

-- INSERT/UPDATE/DELETE restricted to service_role (admin operations only)
-- Authenticated users cannot write to this table — assignments are managed
-- by admin via the dashboard / API using the service_role client.
CREATE POLICY "insert service area assignments is admin only"
  ON public.staff_service_areas
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "update service area assignments is admin only"
  ON public.staff_service_areas
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "delete service area assignments is admin only"
  ON public.staff_service_areas
  FOR DELETE
  TO authenticated
  USING (false);

-- Step 3: Indexes for performance
CREATE INDEX IF NOT EXISTS staff_service_areas_profile_id_idx ON public.staff_service_areas(profile_id);
CREATE INDEX IF NOT EXISTS staff_service_areas_service_area_id_idx ON public.staff_service_areas(service_area_id);

-- --- ROLLBACK ---

-- Drop the join table and its policies
DROP TABLE IF EXISTS public.staff_service_areas CASCADE;
