import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://fncoiagflerxctfeuitg.supabase.co'
const ANON_KEY = 'sb_publishable_0wZbAOopbneA56MjKUU16A_6EQrW2Xu'

const supabase = createClient(SUPABASE_URL, ANON_KEY)

async function runQueries() {
  try {
    // 1. List all tables - use information_schema directly
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .order('table_name')
    console.log('=== TABLES ===')
    console.log(JSON.stringify(tables, null, 2), tablesError)
    
    // 2. academic_years
    const { data: ay, error: ayError } = await supabase
      .from('academic_years')
      .select('*')
      .order('id')
    console.log('=== ACADEMIC_YEARS ===')
    console.log(JSON.stringify(ay, null, 2), ayError)
    
    // 3. Foreign keys to academic_years - need raw SQL
    // 4. schedules status
    const { data: sched, error: schedError } = await supabase
      .from('schedules')
      .select('status')
    console.log('=== SCHEDULES RAW ===')
    console.log(JSON.stringify(sched, null, 2), schedError)
    
    // 5. Counts
    const { data: cs, error: csError } = await supabase
      .from('class_sections')
      .select('*', { count: 'exact', head: true })
    console.log('=== CLASS_SECTIONS COUNT ===')
    console.log(cs, csError)
    
    const { data: courses, error: coursesError } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true })
    console.log('=== COURSES COUNT ===')
    console.log(courses, coursesError)
    
    const { data: faculty, error: facultyError } = await supabase
      .from('faculty')
      .select('*', { count: 'exact', head: true })
    console.log('=== FACULTY COUNT ===')
    console.log(faculty, facultyError)
    
    const { data: depts, error: deptsError } = await supabase
      .from('departments')
      .select('*', { count: 'exact', head: true })
    console.log('=== DEPARTMENTS COUNT ===')
    console.log(depts, deptsError)
    
  } catch (e) {
    console.error('Error:', e)
  }
}

runQueries()
