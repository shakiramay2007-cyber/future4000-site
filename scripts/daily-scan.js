// Entry point for the daily scan (AWS EventBridge Scheduler, 8:30 AM Eastern every day).
import { migrate, pool } from '../src/db.js';
import { runDailyScan } from '../src/scan.js';

try {
  await migrate();
  const result = await runDailyScan();
  console.log(JSON.stringify({ ...result, reports: undefined }, null, 2));
  await pool?.end();
  process.exit(0);
} catch (e) {
  console.error('Daily scan failed:', e);
  await pool?.end();
  process.exit(1);
}
