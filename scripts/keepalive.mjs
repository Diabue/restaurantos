const endpoint = process.env.SUPABASE_HEALTH_URL ||
  'https://nyubvcwrthpbeeaiaquu.supabase.co/functions/v1/restaurantos-api/api/health';

// This endpoint performs SELECT 1 in PostgreSQL. No rows are added or removed.
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(25000), cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result?.ok !== true) throw new Error('Niepoprawna odpowiedź API.');
    console.log(`${new Date().toISOString()} — Supabase: połączenie z bazą działa.`);
    break;
  } catch (error) {
    console.error(`Próba ${attempt}/3: ${error instanceof Error ? error.message : 'Brak połączenia.'}`);
    if (attempt === 3) { process.exitCode = 1; break; }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
