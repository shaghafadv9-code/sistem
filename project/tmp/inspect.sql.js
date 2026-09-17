const initSqlJs = require('sql.js'); const fs = require('fs');
initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(process.argv[2] || 'data/smart-secretary.db'));
  const q = (s) => { try { const r = db.exec(s); return r[0] ? r[0].values : []; } catch(e){ return 'ERR: '+e.message; } };
  console.log('tables:', q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").flat().join(', '));
  console.log('colors:', q("SELECT * FROM migrations").length, JSON.stringify(q("SELECT COUNT(*) FROM payments")));
  console.log('counts:', JSON.stringify({ clients: q('SELECT COUNT(*) FROM clients')[0][0], units: q('SELECT COUNT(*) FROM units')[0][0], sales: q('SELECT COUNT(*) FROM sales')[0][0], payments: q('SELECT COUNT(*) FROM payments')[0][0] }));
});
