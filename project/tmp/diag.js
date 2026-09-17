process.env.SKIP_MIGRATIONS = '1';
(async () => {
  const dbm = require('../server/db');
  await dbm.init();
  const db = dbm.db;
  const origExec = db.exec.bind(db);
  db.exec = (sql) => { try { return origExec(sql); } catch (e) { console.log('FAILED EXEC >>>\n' + String(sql).slice(0, 1200)); throw e; } };
  const origPrep = db.prepare.bind(db);
  let wrapped = false;
  db.prepare = (sql) => {
    const st = origPrep(sql);
    if (!wrapped) { wrapped = true; const proto = Object.getPrototypeOf(st); const oRun = proto.run; proto.run = function (...a) { try { return oRun.apply(this, a); } catch (e) { console.log('FAILED RUN >>> ' + JSON.stringify(this.getSQL ? this.getSQL() : '').slice(0, 600)); throw e; } }; }
    return st;
  };
  try { require('../server/migrations').runMigrations(); console.log('MIGRATIONS OK'); } catch (e) { console.log('MIGRATION ERROR:', e.message); }
})();
