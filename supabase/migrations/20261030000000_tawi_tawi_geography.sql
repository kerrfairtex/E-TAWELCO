BEGIN;

-- Tawi-Tawi geography seed and migration
-- Idempotent, safe to re-run, and designed for the current repo structure.

CREATE TABLE IF NOT EXISTS public.municipalities (
  id BIGSERIAL PRIMARY KEY,
  psgc_code TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE,
  income_class TEXT,
  population_2020 INTEGER,
  population_note TEXT,
  serving_utility TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (serving_utility IN ('TAWELCO','CASELCO','UNKNOWN')),
  tawelco_coverage_status TEXT
    CHECK (tawelco_coverage_status IN ('confirmed','unverified','not_served')),
  coverage_note TEXT,
  is_capital BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 999,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS municipalities_psgc_code_idx ON public.municipalities (psgc_code);
CREATE UNIQUE INDEX IF NOT EXISTS municipalities_name_idx ON public.municipalities (name);

ALTER TABLE public.service_areas
  ADD COLUMN IF NOT EXISTS municipality_id BIGINT REFERENCES public.municipalities(id);

ALTER TABLE public.barangays
  ADD COLUMN IF NOT EXISTS municipality_id BIGINT REFERENCES public.municipalities(id),
  ADD COLUMN IF NOT EXISTS psgc_code TEXT,
  ADD COLUMN IF NOT EXISTS alt_name TEXT,
  ADD COLUMN IF NOT EXISTS is_poblacion BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 999;

CREATE UNIQUE INDEX IF NOT EXISTS barangays_municipality_name_uidx
  ON public.barangays (municipality_id, name);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS municipality_id BIGINT REFERENCES public.municipalities(id),
  ADD COLUMN IF NOT EXISTS barangay_id BIGINT REFERENCES public.barangays(id),
  ADD COLUMN IF NOT EXISTS sitio_purok_landmark TEXT;

ALTER TABLE public.outage_reports
  ADD COLUMN IF NOT EXISTS municipality_id BIGINT REFERENCES public.municipalities(id),
  ADD COLUMN IF NOT EXISTS barangay_id BIGINT REFERENCES public.barangays(id),
  ADD COLUMN IF NOT EXISTS sitio_purok_landmark TEXT;

-- Seed municipality master list from the verified dataset.
INSERT INTO public.municipalities (
  psgc_code, name, income_class, population_2020, population_note,
  serving_utility, tawelco_coverage_status, coverage_note, is_capital, sort_order
) VALUES
  ('1907001000','Panglima Sugala','3rd',48055,NULL,'TAWELCO','unverified','reported by news as served; confirm with TAWELCO',FALSE,1),
  ('1907002000','Bongao','2nd',116118,NULL,'TAWELCO','confirmed','NEA, DOE and news agree on TAWELCO coverage',TRUE,2),
  ('1907003000','Mapun','4th',30038,NULL,'CASELCO','unverified','listed under CASELCO by NEA, DOE and Wikipedia; confirm with both cooperatives',FALSE,3),
  ('1907004000','Simunul','4th',34245,NULL,'TAWELCO','unverified','reported by news as served; confirm with TAWELCO',FALSE,4),
  ('1907005000','Sitangkai','1st',37319,NULL,'TAWELCO','unverified','reported by news as served; confirm with TAWELCO',FALSE,5),
  ('1907006000','South Ubian','3rd',29583,NULL,'TAWELCO','unverified','reported by news as served; confirm with TAWELCO',FALSE,6),
  ('1907007000','Tandubas','2nd',34316,NULL,'TAWELCO','unverified','reported by news as served; confirm with TAWELCO',FALSE,7),
  ('1907008000','Turtle Islands','5th',5683,NULL,'CASELCO','unverified','listed under CASELCO by NEA, DOE and Wikipedia; confirm with both cooperatives',FALSE,8),
  ('1907009000','Languyan','1st',37096,NULL,'TAWELCO','unverified','reported by news as served; confirm with TAWELCO',FALSE,9),
  ('1907010000','Sapa-Sapa','3rd',33580,NULL,'TAWELCO','unverified','reported by news as served; confirm with TAWELCO',FALSE,10),
  ('1907011000','Sibutu','none listed',34243,NULL,'TAWELCO','unverified','reported by news as served; confirm with TAWELCO',FALSE,11)
ON CONFLICT (psgc_code) DO UPDATE SET
  name = EXCLUDED.name,
  income_class = EXCLUDED.income_class,
  population_2020 = EXCLUDED.population_2020,
  population_note = EXCLUDED.population_note,
  serving_utility = EXCLUDED.serving_utility,
  tawelco_coverage_status = EXCLUDED.tawelco_coverage_status,
  coverage_note = EXCLUDED.coverage_note,
  is_capital = EXCLUDED.is_capital,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- Legacy service areas should map to the correct municipality.
UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Panglima Sugala'
)
WHERE id = 'panglima-sugala' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Bongao'
)
WHERE id = 'bongao' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Mapun'
)
WHERE id = 'mapun' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Simunul'
)
WHERE id = 'simunul' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Sitangkai'
)
WHERE id = 'sitangkai' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'South Ubian'
)
WHERE id = 'south-ubian' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Tandubas'
)
WHERE id = 'tandubas' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Turtle Islands'
)
WHERE id = 'taganak' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Languyan'
)
WHERE id = 'languyan' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Sapa-Sapa'
)
WHERE id = 'sapa-sapa' AND municipality_id IS NULL;

UPDATE public.service_areas
SET municipality_id = (
  SELECT id FROM public.municipalities WHERE name = 'Sibutu'
)
WHERE id = 'sibutu' AND municipality_id IS NULL;

-- Seed all 203 barangays using municipality + name as the natural key.
INSERT INTO public.barangays (municipality_id, name, is_poblacion, sort_order, alt_name)
SELECT m.id, v.name, v.is_poblacion, v.sort_order, v.alt_name
FROM (
  VALUES
    ('Panglima Sugala','Balimbing Proper',FALSE,1,NULL),
    ('Panglima Sugala','Batu-batu',FALSE,2,NULL),
    ('Panglima Sugala','Bauno Garing',FALSE,3,NULL),
    ('Panglima Sugala','Belatan Halu',FALSE,4,NULL),
    ('Panglima Sugala','Buan',FALSE,5,NULL),
    ('Panglima Sugala','Dungon',FALSE,6,NULL),
    ('Panglima Sugala','Karaha',FALSE,7,NULL),
    ('Panglima Sugala','Kulape',FALSE,8,NULL),
    ('Panglima Sugala','Liyaburan',FALSE,9,NULL),
    ('Panglima Sugala','Luuk Buntal',FALSE,10,NULL),
    ('Panglima Sugala','Magsaggaw',FALSE,11,NULL),
    ('Panglima Sugala','Malacca',FALSE,12,NULL),
    ('Panglima Sugala','Parangan',FALSE,13,NULL),
    ('Panglima Sugala','Sumangday',FALSE,14,NULL),
    ('Panglima Sugala','Tabunan',FALSE,15,NULL),
    ('Panglima Sugala','Tundon',FALSE,16,NULL),
    ('Panglima Sugala','Tungbangkaw',FALSE,17,NULL),

    ('Bongao','Bongao Poblacion',TRUE,1,NULL),
    ('Bongao','Ipil',FALSE,2,NULL),
    ('Bongao','Kamagong',FALSE,3,NULL),
    ('Bongao','Karungdong',FALSE,4,NULL),
    ('Bongao','Lagasan',FALSE,5,NULL),
    ('Bongao','Lakit Lakit',FALSE,6,NULL),
    ('Bongao','Lamion',FALSE,7,NULL),
    ('Bongao','Lapid Lapid',FALSE,8,NULL),
    ('Bongao','Lato Lato',FALSE,9,NULL),
    ('Bongao','Luuk Pandan',FALSE,10,NULL),
    ('Bongao','Luuk Tulay',FALSE,11,NULL),
    ('Bongao','Malassa',FALSE,12,NULL),
    ('Bongao','Mandulan',FALSE,13,NULL),
    ('Bongao','Masantong',FALSE,14,NULL),
    ('Bongao','Montay Montay',FALSE,15,NULL),
    ('Bongao','Nalil',FALSE,16,NULL),
    ('Bongao','Pababag',FALSE,17,NULL),
    ('Bongao','Pag-asa',FALSE,18,NULL),
    ('Bongao','Pagasinan',FALSE,19,NULL),
    ('Bongao','Pagatpat',FALSE,20,NULL),
    ('Bongao','Pahut',FALSE,21,NULL),
    ('Bongao','Pakias',FALSE,22,NULL),
    ('Bongao','Paniongan',FALSE,23,NULL),
    ('Bongao','Pasiagan',FALSE,24,NULL),
    ('Bongao','Sanga-sanga',FALSE,25,NULL),
    ('Bongao','Silubog',FALSE,26,NULL),
    ('Bongao','Simandagit',FALSE,27,NULL),
    ('Bongao','Sumangat',FALSE,28,NULL),
    ('Bongao','Tarawakan',FALSE,29,NULL),
    ('Bongao','Tongsinah',FALSE,30,NULL),
    ('Bongao','Tubig Basag',FALSE,31,NULL),
    ('Bongao','Tubig Tanah',FALSE,32,NULL),
    ('Bongao','Tubig-Boh',FALSE,33,NULL),
    ('Bongao','Tubig-Mampallam',FALSE,34,NULL),
    ('Bongao','Ungus-ungus',FALSE,35,NULL),

    ('Mapun','Boki',FALSE,1,NULL),
    ('Mapun','Duhul Batu',FALSE,2,NULL),
    ('Mapun','Erok-erok',FALSE,3,NULL),
    ('Mapun','Guppah',FALSE,4,NULL),
    ('Mapun','Kompang',FALSE,5,NULL),
    ('Mapun','Liyubud',FALSE,6,NULL),
    ('Mapun','Lubbak Parang',FALSE,7,NULL),
    ('Mapun','Lupa Pula',FALSE,8,NULL),
    ('Mapun','Mahalo',FALSE,9,'Mahalu'),
    ('Mapun','Pawan',FALSE,10,NULL),
    ('Mapun','Sapa',FALSE,11,NULL),
    ('Mapun','Sikub',FALSE,12,NULL),
    ('Mapun','Tabulian',FALSE,13,NULL),
    ('Mapun','Tanduan',FALSE,14,NULL),
    ('Mapun','Umus Mataha',FALSE,15,NULL),

    ('Simunul','Bagid',FALSE,1,NULL),
    ('Simunul','Bakong',FALSE,2,NULL),
    ('Simunul','Doh-Tong',FALSE,3,NULL),
    ('Simunul','Luuk Datan',FALSE,4,NULL),
    ('Simunul','Manuk Mangkaw',FALSE,5,NULL),
    ('Simunul','Maruwa',FALSE,6,NULL),
    ('Simunul','Mongkay',FALSE,7,NULL),
    ('Simunul','Pagasinan',FALSE,8,NULL),
    ('Simunul','Panglima Mastul',FALSE,9,NULL),
    ('Simunul','Sukah-Bulan',FALSE,10,NULL),
    ('Simunul','Tampakan',FALSE,11,NULL),
    ('Simunul','Timundon',FALSE,12,NULL),
    ('Simunul','Tonggosong',FALSE,13,NULL),
    ('Simunul','Tubig Indangan',FALSE,14,NULL),
    ('Simunul','Ubol',FALSE,15,NULL),

    ('Sitangkai','Datu Baguinda Putih',FALSE,1,NULL),
    ('Sitangkai','Imam Sapie',FALSE,2,NULL),
    ('Sitangkai','North Larap',FALSE,3,NULL),
    ('Sitangkai','Panglima Alari',FALSE,4,NULL),
    ('Sitangkai','Sipangkot',FALSE,5,NULL),
    ('Sitangkai','Sitangkai Poblacion',TRUE,6,NULL),
    ('Sitangkai','South Larap',FALSE,7,NULL),
    ('Sitangkai','Tongmageng',FALSE,8,NULL),
    ('Sitangkai','Tongusong',FALSE,9,NULL),

    ('South Ubian','Babagan',FALSE,1,NULL),
    ('South Ubian','Bengkol',FALSE,2,NULL),
    ('South Ubian','Bintawlan',FALSE,3,NULL),
    ('South Ubian','Bohe',FALSE,4,NULL),
    ('South Ubian','Bubuan',FALSE,5,NULL),
    ('South Ubian','Bunay Bunay Center',FALSE,6,NULL),
    ('South Ubian','Bunay Bunay Lookan',FALSE,7,NULL),
    ('South Ubian','Bunay Bunay Tong',FALSE,8,NULL),
    ('South Ubian','East Talisay',FALSE,9,NULL),
    ('South Ubian','Lahad Dampong',FALSE,10,NULL),
    ('South Ubian','Laitan',FALSE,11,NULL),
    ('South Ubian','Lambi-lambian',FALSE,12,NULL),
    ('South Ubian','Laud',FALSE,13,NULL),
    ('South Ubian','Likud Dampong',FALSE,14,NULL),
    ('South Ubian','Likud Tabawan',FALSE,15,NULL),
    ('South Ubian','Nunuk',FALSE,16,NULL),
    ('South Ubian','Nusa',FALSE,17,NULL),
    ('South Ubian','Nusa-nusa',FALSE,18,NULL),
    ('South Ubian','Pampang',FALSE,19,NULL),
    ('South Ubian','Putat',FALSE,20,NULL),
    ('South Ubian','Sollogan',FALSE,21,NULL),
    ('South Ubian','Talisay',FALSE,22,NULL),
    ('South Ubian','Tampakan Dampong',FALSE,23,NULL),
    ('South Ubian','Tangngah',FALSE,24,NULL),
    ('South Ubian','Tinda-tindahan',FALSE,25,NULL),
    ('South Ubian','Tong Tampakan',FALSE,26,NULL),
    ('South Ubian','Tubig Dayang',FALSE,27,NULL),
    ('South Ubian','Tubig Dayang Center',FALSE,28,NULL),
    ('South Ubian','Tubig Dayang Riverside',FALSE,29,NULL),
    ('South Ubian','Tukkai',FALSE,30,NULL),
    ('South Ubian','Unas-unas',FALSE,31,NULL),

    ('Tandubas','Baliungan',FALSE,1,NULL),
    ('Tandubas','Ballak',FALSE,2,NULL),
    ('Tandubas','Butun',FALSE,3,NULL),
    ('Tandubas','Himbah',FALSE,4,NULL),
    ('Tandubas','Kakoong',FALSE,5,NULL),
    ('Tandubas','Kalang-kalang',FALSE,6,NULL),
    ('Tandubas','Kepeng',FALSE,7,NULL),
    ('Tandubas','Lahay-lahay',FALSE,8,NULL),
    ('Tandubas','Naungan',FALSE,9,NULL),
    ('Tandubas','Salamat',FALSE,10,NULL),
    ('Tandubas','Sallangan',FALSE,11,NULL),
    ('Tandubas','Sapa',FALSE,12,NULL),
    ('Tandubas','Sibakloon',FALSE,13,NULL),
    ('Tandubas','Silantup',FALSE,14,NULL),
    ('Tandubas','Tandubato',FALSE,15,NULL),
    ('Tandubas','Tangngah',FALSE,16,NULL),
    ('Tandubas','Tapian',FALSE,17,NULL),
    ('Tandubas','Tapian Sukah',FALSE,18,NULL),
    ('Tandubas','Taruk',FALSE,19,NULL),
    ('Tandubas','Tongbangkaw',FALSE,20,NULL),

    ('Turtle Islands','Likud Bakkao',FALSE,1,NULL),
    ('Turtle Islands','Taganak Poblacion',TRUE,2,NULL),

    ('Languyan','Adnin',FALSE,1,NULL),
    ('Languyan','Bakaw-bakaw',FALSE,2,NULL),
    ('Languyan','Bakong',FALSE,3,NULL),
    ('Languyan','Bas-bas Proper',FALSE,4,NULL),
    ('Languyan','BasLikud',FALSE,5,NULL),
    ('Languyan','Basnunuk',FALSE,6,NULL),
    ('Languyan','Darussalam',FALSE,7,NULL),
    ('Languyan','Jakarta',FALSE,8,NULL),
    ('Languyan','Kalupag',FALSE,9,NULL),
    ('Languyan','Kiniktal',FALSE,10,NULL),
    ('Languyan','Languyan Proper',FALSE,11,NULL),
    ('Languyan','Marang-marang',FALSE,12,NULL),
    ('Languyan','Maraning',FALSE,13,NULL),
    ('Languyan','Parang Pantay',FALSE,14,NULL),
    ('Languyan','Sikullis',FALSE,15,NULL),
    ('Languyan','Simalak',FALSE,16,NULL),
    ('Languyan','Tubig Dakula',FALSE,17,NULL),
    ('Languyan','Tuhog-tuhog',FALSE,18,NULL),
    ('Languyan','Tumahubong',FALSE,19,NULL),
    ('Languyan','Tumbagaan',FALSE,20,NULL),

    ('Sapa-Sapa','Baldatal Islam',FALSE,1,NULL),
    ('Sapa-Sapa','Butun',FALSE,2,NULL),
    ('Sapa-Sapa','Dalo-dalo',FALSE,3,NULL),
    ('Sapa-Sapa','Kohec',FALSE,4,NULL),
    ('Sapa-Sapa','Lakit-lakit',FALSE,5,NULL),
    ('Sapa-Sapa','Latuan',FALSE,6,NULL),
    ('Sapa-Sapa','Look Natuh',FALSE,7,NULL),
    ('Sapa-Sapa','Lookan Banaran',FALSE,8,NULL),
    ('Sapa-Sapa','Lookan Latuan',FALSE,9,NULL),
    ('Sapa-Sapa','Malanta',FALSE,10,NULL),
    ('Sapa-Sapa','Mantabuan Tabunan',FALSE,11,NULL),
    ('Sapa-Sapa','Nunuk Likud Sikubong',FALSE,12,NULL),
    ('Sapa-Sapa','Palate Gadjaminah',FALSE,13,NULL),
    ('Sapa-Sapa','Pamasan',FALSE,14,NULL),
    ('Sapa-Sapa','Sapa-sapa',FALSE,15,NULL),
    ('Sapa-Sapa','Sapaat',FALSE,16,NULL),
    ('Sapa-Sapa','Sukah-sukah',FALSE,17,NULL),
    ('Sapa-Sapa','Tabunan Likud Sikubong',FALSE,18,NULL),
    ('Sapa-Sapa','Tangngah',FALSE,19,NULL),
    ('Sapa-Sapa','Tapian Bohe North',FALSE,20,NULL),
    ('Sapa-Sapa','Tapian Bohe South',FALSE,21,NULL),
    ('Sapa-Sapa','Tonggusong Banaran',FALSE,22,NULL),
    ('Sapa-Sapa','Tup-tup Banaran',FALSE,23,NULL),

    ('Sibutu','Ambulong Sapal',FALSE,1,NULL),
    ('Sibutu','Datu Amilhamja Jaafar',FALSE,2,NULL),
    ('Sibutu','Hadji Imam Bidin',FALSE,3,NULL),
    ('Sibutu','Hadji Mohtar Sulayman',FALSE,4,NULL),
    ('Sibutu','Hadji Taha',FALSE,5,NULL),
    ('Sibutu','Imam Hadji Mohammad',FALSE,6,NULL),
    ('Sibutu','Ligayan',FALSE,7,NULL),
    ('Sibutu','Nunukan',FALSE,8,NULL),
    ('Sibutu','Sheik Makdum',FALSE,9,NULL),
    ('Sibutu','Sibutu',FALSE,10,NULL),
    ('Sibutu','Talisay',FALSE,11,NULL),
    ('Sibutu','Tandu Banak',FALSE,12,NULL),
    ('Sibutu','Taungoh',FALSE,13,NULL),
    ('Sibutu','Tongehat',FALSE,14,NULL),
    ('Sibutu','Tongsibalo',FALSE,15,NULL),
    ('Sibutu','Ungus-ungus',FALSE,16,NULL)
) AS v(municipality_name, name, is_poblacion, sort_order, alt_name)
JOIN public.municipalities m ON m.name = v.municipality_name
ON CONFLICT (municipality_id, name) DO UPDATE SET
  is_poblacion = EXCLUDED.is_poblacion,
  sort_order = EXCLUDED.sort_order,
  alt_name = EXCLUDED.alt_name,
  updated_at = NOW();

-- Backfill legacy barangay rows to their proper municipality if they are the existing Bongao set.
UPDATE public.barangays b
SET municipality_id = (
  SELECT m.id FROM public.municipalities m WHERE m.name = 'Bongao'
)
WHERE b.area_id = 'bongao' AND b.municipality_id IS NULL;

-- Make municipality_id required for barangays after backfill.
ALTER TABLE public.barangays
  ALTER COLUMN municipality_id SET NOT NULL;

-- Public read access for geography tables.
ALTER TABLE public.municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barangays ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.municipalities TO anon, authenticated;
GRANT SELECT ON public.barangays TO anon, authenticated;

DROP POLICY IF EXISTS municipalities_public_select ON public.municipalities;
CREATE POLICY municipalities_public_select
ON public.municipalities
FOR SELECT
TO anon, authenticated
USING (TRUE);

DROP POLICY IF EXISTS barangays_public_select ON public.barangays;
CREATE POLICY barangays_public_select
ON public.barangays
FOR SELECT
TO anon, authenticated
USING (TRUE);

DROP POLICY IF EXISTS municipalities_admin_write ON public.municipalities;
CREATE POLICY municipalities_admin_write
ON public.municipalities
AS PERMISSIVE
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.identity_id = auth.uid()::TEXT
      AND p.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.identity_id = auth.uid()::TEXT
      AND p.role = 'admin'
  )
);

DROP POLICY IF EXISTS barangays_admin_write ON public.barangays;
CREATE POLICY barangays_admin_write
ON public.barangays
AS PERMISSIVE
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.identity_id = auth.uid()::TEXT
      AND p.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.identity_id = auth.uid()::TEXT
      AND p.role = 'admin'
  )
);

-- Geography update audit trail.
CREATE OR REPLACE FUNCTION public.audit_geography_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.audit_log (actor_id, actor_email, action, entity, entity_id, details, created_at)
  VALUES (
    auth.uid()::TEXT,
    (SELECT p.email FROM public.profiles p WHERE p.identity_id = auth.uid()::TEXT LIMIT 1),
    'geography.update',
    TG_TABLE_NAME,
    COALESCE(NEW.id::TEXT, OLD.id::TEXT),
    jsonb_build_object(
      'before', to_jsonb(OLD),
      'after', to_jsonb(NEW)
    ),
    NOW()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS municipalities_audit ON public.municipalities;
CREATE TRIGGER municipalities_audit
AFTER INSERT OR UPDATE OF psgc_code, name, income_class, population_2020, population_note,
  serving_utility, tawelco_coverage_status, coverage_note, is_capital, sort_order
ON public.municipalities
FOR EACH ROW
EXECUTE FUNCTION public.audit_geography_change();

DROP TRIGGER IF EXISTS barangays_audit ON public.barangays;
CREATE TRIGGER barangays_audit
AFTER INSERT OR UPDATE OF municipality_id, name, alt_name, is_poblacion, sort_order
ON public.barangays
FOR EACH ROW
EXECUTE FUNCTION public.audit_geography_change();

COMMIT;
