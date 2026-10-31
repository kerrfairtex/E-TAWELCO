import { json, supabase } from '../_lib/core'

export default async (_req: Request) => {
  const client = supabase()

  const { data: municipalities, error } = await client
    .from('municipalities')
    .select('id,psgc_code,name,income_class,population_2020,population_note,serving_utility,tawelco_coverage_status,coverage_note,is_capital,sort_order')
    .order('sort_order')
  if (error) throw error

  const { data: counts, error: countsError } = await client
    .from('barangays')
    .select('municipality_id,count:municipality_id')
  if (countsError) throw countsError

  const countMap = new Map<number, number>()
  for (const c of (counts ?? [])) {
    countMap.set(Number(c.municipality_id), (countMap.get(Number(c.municipality_id)) ?? 0) + 1)
  }

  return json({
    municipalities: (municipalities ?? []).map((m: any) => ({
      ...m,
      barangay_count: countMap.get(Number(m.id)) ?? 0,
    })),
  })
}
