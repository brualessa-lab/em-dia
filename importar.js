// Copia as contas e os dados do PC (pasta ./dados) para o banco Postgres da internet.
// As senhas continuam as mesmas (vai só o hash).
//
// No PowerShell:
//   $env:DATABASE_URL = "cole aqui a connection string do Neon"
//   node importar.js
//
// Pode rodar mais de uma vez: conta que já existe no banco é pulada (nada é sobrescrito).
const path = require('path');
const { Pool } = require('pg');
const { emArquivos, emPostgres } = require('./armazenamento');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('Defina DATABASE_URL antes (veja as instruções no topo deste arquivo).');
    process.exit(1);
  }
  const local = emArquivos(path.join(__dirname, 'dados'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const nuvem = await emPostgres((sql, params) => pool.query(sql, params));

  const usuarios = await local.todosUsuarios();
  const nomes = Object.keys(usuarios);
  if (!nomes.length) console.log('Nenhuma conta na pasta dados/.');
  for (const u of nomes) {
    const criou = await nuvem.criarUsuario(u, usuarios[u]);
    if (!criou) { console.log(`- ${u}: já existe no banco, pulei`); continue; }
    const d = await local.dados(u);
    if (Object.keys(d).length) await nuvem.salvarDados(u, d);
    console.log(`✓ ${u}: conta e dados copiados (${(d.despesas || []).length} despesas, ${(d.cartoes || []).length} cartões)`);
  }
  await pool.end();
})().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
