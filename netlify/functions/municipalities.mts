import type { Config, Context } from '@netlify/functions'
import { db, json } from '../lib/core.mts'

export default async (_req: Request, _context: Context) => {
  const sql = db().sql

  // Public reference data: municipalities + barangay counts
  // Serves the public site and dashboard municipality/barangay dropdowns.
  const municipalities = await sql`
    SELECT id, psgc_code, name, income_class, population_2020, population_note,
           serving_utility, tawelco_coverage_status, coverage_note, is_capital, sort_order
    FROM municipalities
    ORDER BY sort_order, name`

  const counts = await sql`
    SELECT municipality_id, COUNT(*) AS count
    FROM barangays
    GROUP BY municipality_id`

  const countMap = new Map(counts.map((c: any) => [Number(c.municipality_id), Number(c.count)]))

  const result = municipalities.map((m: any) => ({
    id: m.id,
    psgc_code: m.psgc_code,
    name: m.name,
    income_class: m.income_class,
    population_2020: m.population_2020,
    population_note: m.population_note,
    serving_utility: m.serving_utility,
    tawelco_coverage_status: m.tawelco_coverage_status,
    coverage_note: m.coverage_note,
    is_capital: m.is_capital,
    sort_order: m.sort_order,
    barangay_count: countMap.get(Number(m.id)) ?? 0,
  }))

  return json({ municipalities: result })
}

export const config: Config = { path: ['/api/municipalities'], method: ['GET'] }
