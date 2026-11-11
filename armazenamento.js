// Onde o Em Dia guarda usuários e dados.
//   emArquivos(pasta)  -> no PC: pasta dados/ (usuarios.json, u_<usuario>.json, .segredo)
//   emPostgres(query)  -> na internet: banco Postgres (ex.: Neon), via DATABASE_URL
// Os dois têm exatamente as mesmas funções, então o servidor não precisa saber qual está usando.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function lerJSON(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}
function gravarJSON(arq, obj) {
  const tmp = arq + '.tmp'; // grava inteiro e só depois troca
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, arq);
}

function emArquivos(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ARQ_USUARIOS = path.join(dir, 'usuarios.json');
  const arqDados = (u) => path.join(dir, `u_${u}.json`);
  return {
    tipo: 'arquivos',
    async usuario(u) { return lerJSON(ARQ_USUARIOS, {})[u] || null; },
    async todosUsuarios() { return lerJSON(ARQ_USUARIOS, {}); },
    async criarUsuario(u, reg) {
      const todos = lerJSON(ARQ_USUARIOS, {});
      if (todos[u]) return false;
      todos[u] = reg;
      gravarJSON(ARQ_USUARIOS, todos);
      return true;
    },
    async salvarUsuario(u, reg) {
      const todos = lerJSON(ARQ_USUARIOS, {});
      todos[u] = reg;
      gravarJSON(ARQ_USUARIOS, todos);
    },
    async dados(u) { return lerJSON(arqDados(u), {}); },
    async salvarDados(u, d) { gravarJSON(arqDados(u), d); },
    async segredo() {
      const arq = path.join(dir, '.segredo');
      try { return fs.readFileSync(arq, 'utf8').trim(); } catch {}
      const s = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(arq, s);
      return s;
    },
  };
}

// query(sql, parametros) precisa devolver { rows } — igual ao pool do pacote "pg"
async function emPostgres(query) {
  await query(`CREATE TABLE IF NOT EXISTS emdia_usuarios (
    usuario   text PRIMARY KEY,
    registro  jsonb NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now())`);
  await query(`CREATE TABLE IF NOT EXISTS emdia_dados (
    usuario       text PRIMARY KEY REFERENCES emdia_usuarios(usuario) ON DELETE CASCADE,
    dados         jsonb NOT NULL,
    atualizado_em timestamptz NOT NULL DEFAULT now())`);
  await query(`CREATE TABLE IF NOT EXISTS emdia_config (
    chave text PRIMARY KEY,
    valor text NOT NULL)`);

  return {
    tipo: 'postgres',
    async usuario(u) {
      const r = await query('SELECT registro FROM emdia_usuarios WHERE usuario = $1', [u]);
      return r.rows[0]?.registro || null;
    },
    async todosUsuarios() {
      const r = await query('SELECT usuario, registro FROM emdia_usuarios', []);
      return Object.fromEntries(r.rows.map((x) => [x.usuario, x.registro]));
    },
    async criarUsuario(u, reg) {
      const r = await query(
        'INSERT INTO emdia_usuarios (usuario, registro) VALUES ($1, $2) ON CONFLICT (usuario) DO NOTHING RETURNING usuario',
        [u, JSON.stringify(reg)]);
      return r.rows.length > 0;
    },
    async salvarUsuario(u, reg) {
      await query('UPDATE emdia_usuarios SET registro = $2 WHERE usuario = $1', [u, JSON.stringify(reg)]);
    },
    async dados(u) {
      const r = await query('SELECT dados FROM emdia_dados WHERE usuario = $1', [u]);
      return r.rows[0]?.dados || {};
    },
    async salvarDados(u, d) {
      await query(
        `INSERT INTO emdia_dados (usuario, dados) VALUES ($1, $2)
         ON CONFLICT (usuario) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()`,
        [u, JSON.stringify(d)]);
    },
    async segredo() {
      await query('INSERT INTO emdia_config (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING',
        ['segredo', crypto.randomBytes(32).toString('hex')]);
      const r = await query('SELECT valor FROM emdia_config WHERE chave = $1', ['segredo']);
      return r.rows[0].valor;
    },
  };
}

module.exports = { emArquivos, emPostgres };
