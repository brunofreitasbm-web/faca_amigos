const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ivjvpdzsfjdpyabbzzuj.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh';

async function fetchDetails() {
  const unitsRes = await fetch(`${SUPABASE_URL}/rest/v1/fa_kiosk_units?select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  console.log('Units:', await unitsRes.json());

  const plansRes = await fetch(`${SUPABASE_URL}/rest/v1/fa_kiosk_plans?select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  console.log('Plans:', await plansRes.json());
}

fetchDetails();
