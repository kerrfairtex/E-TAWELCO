-- ============================================================================
-- Tawi-Tawi Geography Seed
-- Idempotent seed: municipalities + barangays of Tawi-Tawi province
-- Sources: PSA PSGC (as of 30 April 2024), PhilAtlas 2020 barangay list
-- Coverage: TAWELCO confirmed for Bongao; 8 towns reported but unverified;
--   Mapun and Turtle Islands served by CASELCO (unverified for TAWELCO)
-- Run: supabase db reset --linked  (or psql with the Supabase service_role)
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Municipalities — INSERT ... ON CONFLICT DO UPDATE on psgc_code (natural key)
-- ---------------------------------------------------------------------------
INSERT INTO municipalities (
  psgc_code, name, income_class, population_2020, population_note,
  serving_utility, tawelco_coverage_status, coverage_note, is_capital, sort_order
) VALUES
  ('1907001000','Panglima Sugala','3rd',48055,
   '2020 census population; not electricity customers',
   'TAWELCO','unverified','Reported by news as served; confirm with TAWELCO',false,1),
  ('1907002000','Bongao','2nd',116118,
   '2020 census population; not electricity customers',
   'TAWELCO','confirmed','TAWELCO coverage reported as confirmed by NEA, DOE and news',true,2),
  ('1907003000','Mapun','4th',30038,
   '2020 census population; not electricity customers',
   'CASELCO','unverified','Listed under CASELCO by NEA, DOE and Wikipedia; confirm with both cooperatives',false,3),
  ('1907004000','Simunul','4th',34245,
   '2020 census population; not electricity customers',
   'TAWELCO','unverified','Reported by news as served; confirm with TAWELCO',false,4),
  ('1907005000','Sitangkai','1st',37319,
   '2020 census population; not electricity customers',
   'TAWELCO','unverified','Reported by news as served; confirm with TAWELCO',false,5),
  ('1907006000','South Ubian','3rd',29583,
   '2020 census population; not electricity customers',
   'TAWELCO','unverified','Reported by news as served; confirm with TAWELCO',false,6),
  ('1907007000','Tandubas','2nd',34316,
   '2020 census population; not electricity customers',
   'TAWELCO','unverified','Reported by news as served; confirm with TAWELCO',false,7),
  ('1907008000','Turtle Islands','5th',5683,
   '2020 census population; not electricity customers',
   'CASELCO','unverified','Listed under CASELCO by NEA, DOE and Wikipedia; confirm with both cooperatives',false,8),
  ('1907009000','Languyan','1st',37096,
   '2020 census population; not electricity customers',
   'TAWELCO','unverified','Reported by news as served; confirm with TAWELCO',false,9),
  ('1907010000','Sapa-Sapa','3rd',33580,
   '2020 census population; not electricity customers',
   'TAWELCO','unverified','Reported by news as served; confirm with TAWELCO',false,10),
  ('1907011000','Sibutu',null,34243,
   '2020 census population; not electricity customers',
   'TAWELCO','unverified','Reported by news as served; confirm with TAWELCO',false,11)
ON CONFLICT (psgc_code) DO UPDATE SET
  name              = EXCLUDED.name,
  income_class      = EXCLUDED.income_class,
  population_2020   = EXCLUDED.population_2020,
  population_note   = EXCLUDED.population_note,
  serving_utility   = EXCLUDED.serving_utility,
  tawelco_coverage_status = EXCLUDED.tawelco_coverage_status,
  coverage_note     = EXCLUDED.coverage_note,
  is_capital        = EXCLUDED.is_capital,
  sort_order        = EXCLUDED.sort_order,
  updated_at        = now();

-- ---------------------------------------------------------------------------
-- Barangays — INSERT ... ON CONFLICT DO UPDATE on (municipality_id, name)
-- area_id is back-filled from service_areas.municipality_id mapping
-- ---------------------------------------------------------------------------
WITH mun AS (SELECT id, psgc_code FROM municipalities)
INSERT INTO barangays (municipality_id, area_id, name, psgc_code, alt_name, is_poblacion, sort_order)
VALUES
  -- Panglima Sugala (17) — muni id = 1
  (1,'panglima-sugala','Balimbing Proper',null,null,false,1),
  (1,'panglima-sugala','Batu-batu',null,null,false,2),
  (1,'panglima-sugala','Bauno Garing',null,null,false,3),
  (1,'panglima-sugala','Belatan Halu',null,null,false,4),
  (1,'panglima-sugala','Buan',null,null,false,5),
  (1,'panglima-sugala','Dungon',null,null,false,6),
  (1,'panglima-sugala','Karaha',null,null,false,7),
  (1,'panglima-sugala','Kulape',null,null,false,8),
  (1,'panglima-sugala','Liyaburan',null,null,false,9),
  (1,'panglima-sugala','Luuk Buntal',null,null,false,10),
  (1,'panglima-sugala','Magsaggaw',null,null,false,11),
  (1,'panglima-sugala','Malacca',null,null,false,12),
  (1,'panglima-sugala','Parangan',null,null,false,13),
  (1,'panglima-sugala','Sumangday',null,null,false,14),
  (1,'panglima-sugala','Tabunan',null,null,false,15),
  (1,'panglima-sugala','Tundon',null,null,false,16),
  (1,'panglima-sugala','Tungbangkaw',null,null,false,17),

  -- Bongao (35) — muni id = 2
  (2,'bongao','Bongao Poblacion',null,null,true,1),
  (2,'bongao','Ipil',null,null,false,2),
  (2,'bongao','Kamagong',null,null,false,3),
  (2,'bongao','Karungdong',null,null,false,4),
  (2,'bongao','Lagasan',null,null,false,5),
  (2,'bongao','Lakit Lakit',null,null,false,6),
  (2,'bongao','Lamion',null,null,false,7),
  (2,'bongao','Lapid Lapid',null,null,false,8),
  (2,'bongao','Lato Lato',null,null,false,9),
  (2,'bongao','Luuk Pandan',null,null,false,10),
  (2,'bongao','Luuk Tulay',null,null,false,11),
  (2,'bongao','Malassa',null,null,false,12),
  (2,'bongao','Mandulan',null,null,false,13),
  (2,'bongao','Masantong',null,null,false,14),
  (2,'bongao','Montay Montay',null,null,false,15),
  (2,'bongao','Nalil',null,null,false,16),
  (2,'bongao','Pababag',null,null,false,17),
  (2,'bongao','Pag-asa',null,null,false,18),
  (2,'bongao','Pagasinan',null,null,false,19),
  (2,'bongao','Pagatpat',null,null,false,20),
  (2,'bongao','Pahut',null,null,false,21),
  (2,'bongao','Pakias',null,null,false,22),
  (2,'bongao','Paniongan',null,null,false,23),
  (2,'bongao','Pasiagan',null,null,false,24),
  (2,'bongao','Sanga-sanga',null,null,false,25),
  (2,'bongao','Silubog',null,null,false,26),
  (2,'bongao','Simandagit',null,null,false,27),
  (2,'bongao','Sumangat',null,null,false,28),
  (2,'bongao','Tarawakan',null,null,false,29),
  (2,'bongao','Tongsinah',null,null,false,30),
  (2,'bongao','Tubig Basag',null,null,false,31),
  (2,'bongao','Tubig Tanah',null,null,false,32),
  (2,'bongao','Tubig-Boh',null,null,false,33),
  (2,'bongao','Tubig-Mampallam',null,null,false,34),
  (2,'bongao','Ungus-ungus',null,null,false,35),

  -- Mapun (15) — muni id = 3
  (3,'mapun','Boki',null,null,false,1),
  (3,'mapun','Duhul Batu',null,null,false,2),
  (3,'mapun','Erok-erok',null,null,false,3),
  (3,'mapun','Guppah',null,null,false,4),
  (3,'mapun','Kompang',null,null,false,5),
  (3,'mapun','Liyubud',null,null,false,6),
  (3,'mapun','Lubbak Parang',null,null,false,7),
  (3,'mapun','Lupa Pula',null,null,false,8),
  (3,'mapun','Mahalo','MAHALU','Mahalu',false,9),  -- NEA spells it "Mahalu"; PSA uses "Mahalo"
  (3,'mapun','Pawan',null,null,false,10),
  (3,'mapun','Sapa',null,null,false,11),
  (3,'mapun','Sikub',null,null,false,12),
  (3,'mapun','Tabulian',null,null,false,13),
  (3,'mapun','Tanduan',null,null,false,14),
  (3,'mapun','Umus Mataha',null,null,false,15),

  -- Simunul (15) — muni id = 4
  (4,'simunul','Bagid',null,null,false,1),
  (4,'simunul','Bakong',null,null,false,2),
  (4,'simunul','Doh-Tong',null,null,false,3),
  (4,'simunul','Luuk Datan',null,null,false,4),
  (4,'simunul','Manuk Mangkaw',null,null,false,5),
  (4,'simunul','Maruwa',null,null,false,6),
  (4,'simunul','Mongkay',null,null,false,7),
  (4,'simunul','Pagasinan',null,null,false,8),
  (4,'simunul','Panglima Mastul',null,null,false,9),
  (4,'simunul','Sukah-bulan',null,null,false,10),
  (4,'simunul','Tampakan',null,null,false,11),
  (4,'simunul','Timundon',null,null,false,12),
  (4,'simunul','Tonggosong',null,null,false,13),
  (4,'simunul','Tubig Indangan',null,null,false,14),
  (4,'simunul','Ubol',null,null,false,15),

  -- Sitangkai (9) — muni id = 5
  (5,'sitangkai','Datu Baguinda Putih',null,null,false,1),
  (5,'sitangkai','Imam Sapie',null,null,false,2),
  (5,'sitangkai','North Larap',null,null,false,3),
  (5,'sitangkai','Panglima Alari',null,null,false,4),
  (5,'sitangkai','Sipangkot',null,null,false,5),
  (5,'sitangkai','Sitangkai Poblacion',null,null,true,6),
  (5,'sitangkai','South Larap',null,null,false,7),
  (5,'sitangkai','Tongmageng',null,null,false,8),
  (5,'sitangkai','Tongusong',null,null,false,9),

  -- South Ubian (31) — muni id = 6
  (6,'south-ubian','Babagan',null,null,false,1),
  (6,'south-ubian','Bengkol',null,null,false,2),
  (6,'south-ubian','Bintawlan',null,null,false,3),
  (6,'south-ubian','Bohe',null,null,false,4),
  (6,'south-ubian','Bubuan',null,null,false,5),
  (6,'south-ubian','Bunay Bunay Center',null,null,false,6),
  (6,'south-ubian','Bunay Bunay Lookan',null,null,false,7),
  (6,'south-ubian','Bunay Bunay Tong',null,null,false,8),
  (6,'south-ubian','East Talisay',null,null,false,9),
  (6,'south-ubian','Lahad Dampong',null,null,false,10),
  (6,'south-ubian','Laitan',null,null,false,11),
  (6,'south-ubian','Lambi-lambian',null,null,false,12),
  (6,'south-ubian','Laud',null,null,false,13),
  (6,'south-ubian','Likud Dampong',null,null,false,14),
  (6,'south-ubian','Likud Tabawan',null,null,false,15),
  (6,'south-ubian','Nunuk',null,null,false,16),
  (6,'south-ubian','Nusa',null,null,false,17),
  (6,'south-ubian','Nusa-nusa',null,null,false,18),
  (6,'south-ubian','Pampang',null,null,false,19),
  (6,'south-ubian','Putat',null,null,false,20),
  (6,'south-ubian','Sollogan',null,null,false,21),
  (6,'south-ubian','Talisay',null,null,false,22),
  (6,'south-ubian','Tampakan Dampong',null,null,false,23),
  (6,'south-ubian','Tangngah',null,null,false,24),
  (6,'south-ubian','Tinda-tindahan',null,null,false,25),
  (6,'south-ubian','Tong Tampakan',null,null,false,26),
  (6,'south-ubian','Tubig Dayang',null,null,false,27),
  (6,'south-ubian','Tubig Dayang Center',null,null,false,28),
  (6,'south-ubian','Tubig Dayang Riverside',null,null,false,29),
  (6,'south-ubian','Tukkai',null,null,false,30),
  (6,'south-ubian','Unas-unas',null,null,false,31),

  -- Tandubas (20) — muni id = 7
  (7,'tandubas','Baliungan',null,null,false,1),
  (7,'tandubas','Ballak',null,null,false,2),
  (7,'tandubas','Butun',null,null,false,3),
  (7,'tandubas','Himbah',null,null,false,4),
  (7,'tandubas','Kakoong',null,null,false,5),
  (7,'tandubas','Kalang-kalang',null,null,false,6),
  (7,'tandubas','Kepeng',null,null,false,7),
  (7,'tandubas','Lahay-lahay',null,null,false,8),
  (7,'tandubas','Naungan',null,null,false,9),
  (7,'tandubas','Salamat',null,null,false,10),
  (7,'tandubas','Sallangan',null,null,false,11),
  (7,'tandubas','Sapa',null,null,false,12),
  (7,'tandubas','Sibakloon',null,null,false,13),
  (7,'tandubas','Silantup',null,null,false,14),
  (7,'tandubas','Tandubato',null,null,false,15),
  (7,'tandubas','Tangngah',null,null,false,16),
  (7,'tandubas','Tapian',null,null,false,17),
  (7,'tandubas','Tapian Sukah',null,null,false,18),
  (7,'tandubas','Taruk',null,null,false,19),
  (7,'tandubas','Tongbangkaw',null,null,false,20),

  -- Turtle Islands (2) — muni id = 8
  (8,'taganak','Likud Bakkao',null,null,false,1),
  (8,'taganak','Taganak Poblacion',null,null,true,2),

  -- Languyan (20) — muni id = 9
  (9,'languyan','Adnin',null,null,false,1),
  (9,'languyan','Bakaw-bakaw',null,null,false,2),
  (9,'languyan','Bakong',null,null,false,3),
  (9,'languyan','Bas-bas Proper',null,null,false,4),
  (9,'languyan','BasLikud',null,null,false,5),
  (9,'languyan','Basnunuk',null,null,false,6),
  (9,'languyan','Darussalam',null,null,false,7),
  (9,'languyan','Jakarta',null,null,false,8),
  (9,'languyan','Kalupag',null,null,false,9),
  (9,'languyan','Kiniktal',null,null,false,10),
  (9,'languyan','Languyan Proper',null,null,false,11),
  (9,'languyan','Marang-marang',null,null,false,12),
  (9,'languyan','Maraning',null,null,false,13),
  (9,'languyan','Parang Pantay',null,null,false,14),
  (9,'languyan','Sikullis',null,null,false,15),
  (9,'languyan','Simalak',null,null,false,16),
  (9,'languyan','Tubig Dakula',null,null,false,17),
  (9,'languyan','Tuhog-tuhog',null,null,false,18),
  (9,'languyan','Tumahubong',null,null,false,19),
  (9,'languyan','Tumbagaan',null,null,false,20),

  -- Sapa-Sapa (23) — muni id = 10
  (10,'sapa-sapa','Baldatal Islam',null,null,false,1),
  (10,'sapa-sapa','Butun',null,null,false,2),
  (10,'sapa-sapa','Dalo-dalo',null,null,false,3),
  (10,'sapa-sapa','Kohec',null,null,false,4),
  (10,'sapa-sapa','Lakit-lakit',null,null,false,5),
  (10,'sapa-sapa','Latuan',null,null,false,6),
  (10,'sapa-sapa','Look Natuh',null,null,false,7),
  (10,'sapa-sapa','Lookan Banaran',null,null,false,8),
  (10,'sapa-sapa','Lookan Latuan',null,null,false,9),
  (10,'sapa-sapa','Malanta',null,null,false,10),
  (10,'sapa-sapa','Mantabuan Tabunan',null,null,false,11),
  (10,'sapa-sapa','Nunuk Likud Sikubong',null,null,false,12),
  (10,'sapa-sapa','Palate Gadjaminah',null,null,false,13),
  (10,'sapa-sapa','Pamasan',null,null,false,14),
  (10,'sapa-sapa','Sapa-sapa',null,null,false,15),
  (10,'sapa-sapa','Sapaat',null,null,false,16),
  (10,'sapa-sapa','Sukah-sukah',null,null,false,17),
  (10,'sapa-sapa','Tabunan Likud Sikubong',null,null,false,18),
  (10,'sapa-sapa','Tangngah',null,null,false,19),
  (10,'sapa-sapa','Tapian Bohe North',null,null,false,20),
  (10,'sapa-sapa','Tapian Bohe South',null,null,false,21),
  (10,'sapa-sapa','Tonggusong Banaran',null,null,false,22),
  (10,'sapa-sapa','Tup-tup Banaran',null,null,false,23),

  -- Sibutu (16) — muni id = 11
  (11,'sibutu','Ambulong Sapal',null,null,false,1),
  (11,'sibutu','Datu Amilhamja Jaafar',null,null,false,2),
  (11,'sibutu','Hadji Imam Bidin',null,null,false,3),
  (11,'sibutu','Hadji Mohtar Sulayman',null,null,false,4),
  (11,'sibutu','Hadji Taha',null,null,false,5),
  (11,'sibutu','Imam Hadji Mohammad',null,null,false,6),
  (11,'sibutu','Ligayan',null,null,false,7),
  (11,'sibutu','Nunukan',null,null,false,8),
  (11,'sibutu','Sheik Makdum',null,null,false,9),
  (11,'sibutu','Sibutu',null,null,false,10),
  (11,'sibutu','Talisay',null,null,false,11),
  (11,'sibutu','Tandu Banak',null,null,false,12),
  (11,'sibutu','Taungoh',null,null,false,13),
  (11,'sibutu','Tongehat',null,null,false,14),
  (11,'sibutu','Tongsibalo',null,null,false,15),
  (11,'sibutu','Ungus-ungus',null,null,false,16)

ON CONFLICT (municipality_id, name) DO UPDATE SET
  psgc_code      = EXCLUDED.psgc_code,
  alt_name       = EXCLUDED.alt_name,
  is_poblacion   = EXCLUDED.is_poblacion,
  sort_order     = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- Backfill area_id from service_areas for any barangays missing it
-- (area_id = the service_areas.id that maps to the same municipality)
-- ---------------------------------------------------------------------------
UPDATE barangays b
   SET area_id = sa.id
  FROM service_areas sa
 WHERE b.municipality_id = sa.municipality_id
   AND b.area_id IS DISTINCT FROM sa.id;

COMMIT;
