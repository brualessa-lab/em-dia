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
  const ARQ_PUSH = path.join(dir, 'push.json');
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
    async config(chave, gerar) {
      const arq = path.join(dir, 'config.json');
      const c = lerJSON(arq, {});
      if (c[chave] == null) { c[chave] = gerar(); gravarJSON(arq, c); }
      return c[chave];
    },
    // inscrições de notificação (uma por aparelho), chave = endpoint
    async salvarInscricao(u, sub) {
      const todas = lerJSON(ARQ_PUSH, {});
      todas[sub.endpoint] = { usuario: u, sub, avisadoEm: todas[sub.endpoint]?.avisadoEm || '' };
      gravarJSON(ARQ_PUSH, todas);
    },
    async removerInscricao(endpoint) {
      const todas = lerJSON(ARQ_PUSH, {});
      delete todas[endpoint];
      gravarJSON(ARQ_PUSH, todas);
    },
    async inscricoes(u) {
      return Object.values(lerJSON(ARQ_PUSH, {})).filter((x) => !u || x.usuario === u);
    },
    async marcarAvisado(endpoint, dia) {
      const todas = lerJSON(ARQ_PUSH, {});
      if (todas[endpoint]) { todas[endpoint].avisadoEm = dia; gravarJSON(ARQ_PUSH, todas); }
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
  await query(`CREATE TABLE IF NOT EXISTS emdia_push (
    endpoint   text PRIMARY KEY,
    usuario    text NOT NULL REFERENCES emdia_usuarios(usuario) ON DELETE CASCADE,
    inscricao  jsonb NOT NULL,
    avisado_em text NOT NULL DEFAULT '',
    criado_em  timestamptz NOT NULL DEFAULT now())`);

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
    async config(chave, gerar) {
      // guarda como texto JSON; se dois servidores gerarem ao mesmo tempo, vale o primeiro
      await query('INSERT INTO emdia_config (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING',
        [chave, JSON.stringify(gerar())]);
      const r = await query('SELECT valor FROM emdia_config WHERE chave = $1', [chave]);
      return JSON.parse(r.rows[0].valor);
    },
    async salvarInscricao(u, sub) {
      await query(
        `INSERT INTO emdia_push (endpoint, usuario, inscricao) VALUES ($1, $2, $3)
         ON CONFLICT (endpoint) DO UPDATE SET usuario = EXCLUDED.usuario, inscricao = EXCLUDED.inscricao`,
        [sub.endpoint, u, JSON.stringify(sub)]);
    },
    async removerInscricao(endpoint) {
      await query('DELETE FROM emdia_push WHERE endpoint = $1', [endpoint]);
    },
    async inscricoes(u) {
      const r = u
        ? await query('SELECT usuario, inscricao, avisado_em FROM emdia_push WHERE usuario = $1', [u])
        : await query('SELECT usuario, inscricao, avisado_em FROM emdia_push', []);
      return r.rows.map((x) => ({ usuario: x.usuario, sub: x.inscricao, avisadoEm: x.avisado_em }));
    },
    async marcarAvisado(endpoint, dia) {
      await query('UPDATE emdia_push SET avisado_em = $2 WHERE endpoint = $1', [endpoint, dia]);
    },
  };
}

// A Neon entrega a URL com sslmode=require. Hoje o pacote pg já trata isso como verify-full
// (confere o certificado do servidor); a próxima versão vai afrouxar. Fixamos verify-full.
// Também perdoa erros comuns ao colar: espaços, "DATABASE_URL=" na frente e aspas em volta.
function urlSegura(url) {
  let u = String(url || '').trim().replace(/^DATABASE_URL\s*=\s*/, '').trim();
  if (/^(["']).*\1$/.test(u)) u = u.slice(1, -1).trim();
  return u.replace(/([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/, '$1sslmode=verify-full');
}

module.exports = { emArquivos, emPostgres, urlSegura };
