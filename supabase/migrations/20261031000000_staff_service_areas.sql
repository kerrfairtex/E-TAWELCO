-- ============================================================================
-- Migration 1: staff_service_areas join table
-- ============================================================================
-- Creates a proper join table linking staff profiles to service areas.
-- staff_function column (text[]) ALREADY EXISTS on live profiles table
-- (added via Supabase Dashboard — NOT by any git migration). We do NOT
-- touch it here. Only staff_function column is needed for function-based
-- authorization; this join table provides area assignment tracking.
--
-- Migration system: Supabase CLI migrations at supabase/migrations/
-- Project: fncoiagflerxctfeuitg (https://fncoiagflerxctfeuitg.supabase.co)
-- ============================================================================

-- --- UP ---

-- Step 1: Create staff_service_areas join table
-- Links staff members to the service areas they are assigned to.
-- Uses FK constraints for referential integrity (no orphaned references).
CREATE TABLE IF NOT EXISTS public.staff_service_areas (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_area_id INTEGER NOT NULL REFERENCES public.service_areas(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, service_area_id)
);

-- Step 2: Indexes for performance
CREATE INDEX IF NOT EXISTS staff_service_areas_profile_id_idx ON public.staff_service_areas(profile_id);
CREATE INDEX IF NOT EXISTS staff_service_areas_service_area_id_idx ON public.staff_service_areas(service_area_id);

-- Step 3: Row-Level Security on the join table
ALTER TABLE public.staff_service_areas ENABLE ROW LEVEL SECURITY;

-- Staff can view their own area assignments (for dashboard display)
CREATE POLICY "Staff can view own service area assignments"
  ON public.staff_service_areas
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

-- Only service_role (used by API functions) can INSERT/UPDATE/DELETE assignments
CREATE POLICY "Insert service area assignments is service_role only"
  ON public.staff_service_areas
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "Update service area assignments is service_role only"
  ON public.staff_service_areas
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "Delete service area assignments is service_role only"
  ON public.staff_service_areas
  FOR DELETE
  TO authenticated
  USING (false);

-- --- ROLLBACK ---

-- Drop policies, table, and indexes
DROP TABLE IF EXISTS public.staff_service_areas CASCADE;
