process.env.SKIP_MIGRATIONS = '1';
(async () => {
  const dbm = require('../server/db'); await dbm.init();
  const db = dbm.db;
  const q = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return 'ERR: ' + e.message; } };
  const sql = `SELECT s.*, c.name client_name, u.code unit_code, p.code project_code, ct.code contract_code, b2.name broker_display,
      (SELECT COUNT(*) FROM payment_schedule sch WHERE sch.sale_id=s.id AND sch.deleted_at IS NULL) schedule_count
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id JOIN projects p ON p.id=u.project_id
    LEFT JOIN contracts ct ON ct.id=s.contract_id LEFT JOIN brokers b2 ON b2.id=s.broker_id WHERE s.status<>'cancelled' ORDER BY s.id DESC LIMIT 2`;
  const r = q(sql, );
  console.log('list:', typeof r === 'string' ? r : 'OK ' + r.length);
  const F = require('../server/finance_core');
  for (const col of ['sale_id']) {}
  try { console.log('saleTotals(1):', JSON.stringify(F.saleTotals(1)).slice(0,200)); } catch(e) { console.log('saleTotals ERR', e.message); }
  console.log('payments cols:', db.prepare('PRAGMA table_info(payments)').all().map(c=>c.name).join(','));
  console.log('commission_payments cols:', db.prepare('PRAGMA table_info(commission_payments)').all().map(c=>c.name).join(','));
  console.log('refunds cols:', db.prepare('PRAGMA table_info(refunds)').all().map(c=>c.name).join(','));
})();
