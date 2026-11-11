// Em Dia — servidor
//
// No PC:        node server.js            -> http://localhost:5173 (dados na pasta ./dados)
// Na internet:  o Render define PORT e você define DATABASE_URL (Postgres do Neon).
//
// Variáveis de ambiente (todas opcionais no PC):
//   DATABASE_URL     conexão do Postgres. Sem ela, usa a pasta ./dados
//   CODIGO_CONVITE   se definido, só cria conta quem souber esse código
//   SEGREDO          chave que assina o cookie de login (sem ela, é gerada e guardada no banco)
//   PORT / HOST      porta e endereço (o Render define PORT sozinho)
//   AVISOS_CONTATO   contato enviado aos serviços de push (padrão: endereço do repositório)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { emArquivos, emPostgres, urlSegura } = require('./armazenamento');
const { criarAvisos } = require('./avisos');

const NA_NUVEM = !!process.env.PORT;
const PORTA = +process.env.PORT || 5173;
const HOST = process.env.HOST || (NA_NUVEM ? '0.0.0.0' : '127.0.0.1');
const ROOT = __dirname;
const CONVITE = (process.env.CODIGO_CONVITE || '').trim();
const LIMITE_CORPO = 8 * 1024 * 1024; // folga para as imagens dos cartões (~60 KB cada)
const SESSAO_DIAS = 30;

// Só estes arquivos são entregues ao navegador (nada de server.js, package.json, dados…)
const ESTATICOS = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/styles.css': 'styles.css',
  '/sw.js': 'sw.js',
  '/manifest.webmanifest': 'manifest.webmanifest',
  '/icones/icone-192.png': 'icones/icone-192.png',
  '/icones/icone-512.png': 'icones/icone-512.png',
  '/icones/apple-touch-icon.png': 'icones/apple-touch-icon.png',
  '/favicon.ico': 'icones/icone-192.png',
};
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

let store;    // armazenamento (arquivos ou Postgres)
let SEGREDO;  // chave do cookie
let avisos;   // notificações push (avisos.js)
const MAX_APARELHOS = 10;

// ---------- senha ----------
function gerarHash(senha, sal = crypto.randomBytes(16).toString('hex')) {
  return { sal, hash: crypto.scryptSync(senha, sal, 64).toString('hex') };
}
function senhaConfere(senha, reg) {
  if (!reg) return false;
  const { hash } = gerarHash(senha, reg.sal);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(reg.hash, 'hex'));
}
// compara textos sem vazar pelo tempo de resposta
const iguais = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(),
  crypto.createHash('sha256').update(String(b)).digest());

// ---------- sessão (cookie assinado) ----------
const assinar = (txt) => crypto.createHmac('sha256', SEGREDO).update(txt).digest('base64url');
function criarToken(usuario) {
  const exp = Date.now() + SESSAO_DIAS * 864e5;
  const corpo = `${Buffer.from(usuario).toString('base64url')}.${exp}`;
  return `${corpo}.${assinar(corpo)}`;
}
async function lerToken(token) {
  const partes = (token || '').split('.');
  if (partes.length !== 3) return null;
  const corpo = `${partes[0]}.${partes[1]}`;
  const esperado = Buffer.from(assinar(corpo));
  const recebido = Buffer.from(partes[2]);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  if (+partes[1] < Date.now()) return null;
  const usuario = Buffer.from(partes[0], 'base64url').toString();
  return (await store.usuario(usuario)) ? usuario : null;
}
function usuarioDaReq(req) {
  const m = /(?:^|;\s*)duofinn=([^;]+)/.exec(req.headers.cookie || '');
  return m ? lerToken(m[1]) : null;
}
const ehHttps = (req) => NA_NUVEM && req.headers['x-forwarded-proto'] === 'https';
const cookie = (req, valor, idade) =>
  `duofinn=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${idade}${ehHttps(req) ? '; Secure' : ''}`;

// ---------- limite de tentativas ----------
const contadores = new Map(); // chave -> { n, desde, bloqueadoAte }
function bloqueado(chave) {
  const c = contadores.get(chave);
  return !!c && c.bloqueadoAte > Date.now();
}
function contar(chave, max, janelaMs, bloqueioMs) {
  const agora = Date.now();
  let c = contadores.get(chave);
  if (!c || agora - c.desde > janelaMs) c = { n: 0, desde: agora, bloqueadoAte: 0 };
  c.n++;
  if (c.n >= max) { c.bloqueadoAte = agora + bloqueioMs; c.n = 0; c.desde = agora; }
  contadores.set(chave, c);
}
setInterval(() => {
  const agora = Date.now();
  for (const [k, c] of contadores) if (c.bloqueadoAte < agora && agora - c.desde > 3600e3) contadores.delete(k);
}, 600e3).unref();

function ipDe(req) {
  if (NA_NUVEM) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1]; // o último é o que o proxy do Render viu
  }
  return req.socket.remoteAddress || '?';
}

// ---------- http ----------
function cabecalhosSeguranca(req) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com', "img-src 'self' data: blob:", "connect-src 'self'",
      "manifest-src 'self'", "worker-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
    ].join('; '),
  };
  if (ehHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}
function enviar(req, res, codigo, obj, extras = {}) {
  res.writeHead(codigo, {
    ...cabecalhosSeguranca(req),
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras,
  });
  res.end(JSON.stringify(obj ?? {}));
}
function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let txt = '';
    let estourou = false;
    req.on('data', (p) => {
      if (estourou) return; // descarta o resto, só para conseguir responder
      txt += p;
      if (txt.length > LIMITE_CORPO) { estourou = true; txt = ''; falha(Object.assign(new Error('grande'), { grande: true })); }
    });
    req.on('end', () => { if (estourou) return; try { ok(txt ? JSON.parse(txt) : {}); } catch { falha(new Error('json')); } });
    req.on('error', falha);
  });
}
const erroCorpo = (e) => (e && e.grande
  ? [413, { erro: 'Dados grandes demais (máx. 8 MB). Use imagens de cartão menores.' }]
  : [400, { erro: 'Pedido inválido' }]);
// pedido que muda algo precisa vir do próprio site
function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try { return new URL(origem).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}
const validarUsuario = (u) => /^[a-z0-9._-]{3,30}$/.test(u);

async function api(req, res, rota) {
  const metodo = req.method;
  if (metodo !== 'GET' && !mesmaOrigem(req)) return enviar(req, res, 403, { erro: 'Origem não permitida' });

  if (metodo === 'GET' && rota === '/api/saude') return enviar(req, res, 200, { ok: true });
  if (metodo === 'GET' && rota === '/api/config') return enviar(req, res, 200, { convite: !!CONVITE, push: avisos.chavePublica() });

  // -- conferência diária dos vencimentos (chamada pelo GitHub Actions). Não precisa de login:
  //    cada aparelho recebe no máximo um aviso por dia, então chamar a mais não faz mal.
  if (metodo === 'POST' && rota === '/api/avisos/rodar') return enviar(req, res, 200, await avisos.rodar());

  // -- criar conta / entrar
  if (metodo === 'POST' && (rota === '/api/registrar' || rota === '/api/entrar')) {
    const ip = ipDe(req);
    const chaveIp = (rota === '/api/registrar' ? 'cad:' : 'ip:') + ip;
    if (bloqueado(chaveIp)) return enviar(req, res, 429, { erro: 'Muitas tentativas. Espere alguns minutos.' });
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return enviar(req, res, ...erroCorpo(e)); }
    const usuario = String(corpo.usuario || '').trim().toLowerCase();
    const senha = String(corpo.senha || '');

    if (rota === '/api/registrar') {
      contar(chaveIp, 6, 3600e3, 3600e3); // até 6 tentativas de cadastro por hora por IP
      if (CONVITE && !iguais(String(corpo.convite || '').trim(), CONVITE)) {
        return enviar(req, res, 403, { erro: 'Código de convite incorreto' });
      }
      if (!validarUsuario(usuario)) return enviar(req, res, 400, { erro: 'Usuário deve ter de 3 a 30 letras minúsculas, números, ponto, traço ou _' });
      if (senha.length < 6) return enviar(req, res, 400, { erro: 'A senha precisa ter pelo menos 6 caracteres' });
      if (senha.length > 200) return enviar(req, res, 400, { erro: 'Senha longa demais' });
      const criou = await store.criarUsuario(usuario, { ...gerarHash(senha), criadoEm: new Date().toISOString() });
      if (!criou) return enviar(req, res, 409, { erro: 'Esse usuário já existe' });
    } else {
      if (bloqueado('u:' + usuario)) return enviar(req, res, 429, { erro: 'Muitas tentativas. Espere 1 minuto.' });
      const reg = await store.usuario(usuario);
      if (senha.length > 200 || !senhaConfere(senha, reg)) {
        contar('u:' + usuario, 5, 600e3, 60e3);   // 5 erros -> 1 min de espera
        contar(chaveIp, 20, 600e3, 900e3);        // 20 erros no mesmo IP -> 15 min
        return enviar(req, res, 401, { erro: 'Usuário ou senha incorretos' });
      }
      contadores.delete('u:' + usuario);
    }
    return enviar(req, res, 200, { usuario }, { 'Set-Cookie': cookie(req, criarToken(usuario), SESSAO_DIAS * 86400) });
  }

  if (metodo === 'POST' && rota === '/api/sair') {
    return enviar(req, res, 200, {}, { 'Set-Cookie': cookie(req, '', 0) });
  }

  // -- daqui pra baixo precisa estar logado
  const usuario = await usuarioDaReq(req);
  if (!usuario) return enviar(req, res, 401, { erro: 'Faça login' });

  if (metodo === 'GET' && rota === '/api/eu') return enviar(req, res, 200, { usuario });

  if (rota === '/api/dados') {
    if (metodo === 'GET') return enviar(req, res, 200, await store.dados(usuario));
    if (metodo === 'PUT') {
      let corpo;
      try { corpo = await lerCorpo(req); } catch (e) { return enviar(req, res, ...erroCorpo(e)); }
      if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return enviar(req, res, 400, { erro: 'Dados inválidos' });
      await store.salvarDados(usuario, { ...corpo, salvoEm: new Date().toISOString() });
      return enviar(req, res, 200, { ok: true });
    }
  }

  // -- avisos com o app fechado
  if (metodo === 'POST' && rota.startsWith('/api/push/')) {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return enviar(req, res, ...erroCorpo(e)); }
    if (rota === '/api/push/inscrever') {
      const sub = avisos.inscricaoValida(corpo.inscricao);
      if (!sub) return enviar(req, res, 400, { erro: 'Inscrição de aviso inválida' });
      const minhas = await store.inscricoes(usuario);
      if (minhas.length >= MAX_APARELHOS && !minhas.some((x) => x.sub.endpoint === sub.endpoint)) {
        return enviar(req, res, 400, { erro: `Limite de ${MAX_APARELHOS} aparelhos com aviso` });
      }
      await store.salvarInscricao(usuario, sub);
      return enviar(req, res, 200, { ok: true });
    }
    if (rota === '/api/push/remover') {
      const minhas = await store.inscricoes(usuario);
      if (minhas.some((x) => x.sub.endpoint === corpo.endpoint)) await store.removerInscricao(corpo.endpoint);
      return enviar(req, res, 200, { ok: true });
    }
    if (rota === '/api/push/teste') {
      if (bloqueado('teste:' + usuario)) return enviar(req, res, 429, { erro: 'Espere alguns minutos para testar de novo' });
      contar('teste:' + usuario, 5, 600e3, 600e3);
      return enviar(req, res, 200, await avisos.teste(usuario));
    }
  }

  if (metodo === 'POST' && rota === '/api/senha') {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return enviar(req, res, ...erroCorpo(e)); }
    const reg = await store.usuario(usuario);
    if (!senhaConfere(String(corpo.atual || '').slice(0, 200), reg)) return enviar(req, res, 401, { erro: 'Senha atual incorreta' });
    const nova = String(corpo.nova || '');
    if (nova.length < 6 || nova.length > 200) return enviar(req, res, 400, { erro: 'A nova senha precisa ter de 6 a 200 caracteres' });
    await store.salvarUsuario(usuario, { ...reg, ...gerarHash(nova) });
    return enviar(req, res, 200, { ok: true });
  }

  enviar(req, res, 404, { erro: 'Rota não encontrada' });
}

function estatico(req, res, url) {
  const nome = ESTATICOS[url];
  if (!nome || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, cabecalhosSeguranca(req));
    return res.end('404');
  }
  fs.readFile(path.join(ROOT, nome), (err, conteudo) => {
    if (err) { res.writeHead(404, cabecalhosSeguranca(req)); return res.end('404'); }
    res.writeHead(200, {
      ...cabecalhosSeguranca(req),
      'Content-Type': TIPOS[path.extname(nome)] || 'application/octet-stream',
      // o service worker e a página sempre conferem se há versão nova
      'Cache-Control': nome.startsWith('icones/') ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : conteudo);
  });
}

function tratar(req, res) {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url.startsWith('/api/')) {
    return api(req, res, url).catch((e) => {
      console.error(e);
      if (!res.headersSent) enviar(req, res, 500, { erro: 'Erro no servidor' });
    });
  }
  estatico(req, res, url);
}

async function iniciar() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const url = urlSegura(process.env.DATABASE_URL);
    if (!/^postgres(ql)?:\/\/[^\s"']+$/.test(url)) {
      // nunca imprime o valor: ele contém a senha do banco
      throw new Error('DATABASE_URL inválida. Ela deve começar com postgresql:// e não ter espaços nem aspas.');
    }
    const pool = new Pool({ connectionString: url, max: +process.env.PG_POOL_MAX || 5 });
    pool.on('error', (e) => console.error('Banco:', e.message));
    store = await emPostgres((sql, params) => pool.query(sql, params));
  } else {
    store = emArquivos(path.join(ROOT, 'dados'));
  }
  SEGREDO = process.env.SEGREDO || await store.segredo();
  avisos = criarAvisos(store, { contato: process.env.AVISOS_CONTATO || 'https://github.com/brualessa-lab/em-dia' });
  await avisos.preparar();
  // enquanto o servidor estiver acordado, confere de hora em hora (no máximo 1 aviso por dia)
  setInterval(() => avisos.rodar().catch((e) => console.error('Avisos:', e.message)), 3600e3).unref();
  http.createServer(tratar).listen(PORTA, HOST, () => {
    console.log(`Em Dia em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}`);
    console.log(`  dados: ${store.tipo === 'postgres' ? 'banco Postgres' : 'pasta ./dados'}`);
    console.log(`  cadastro: ${CONVITE ? 'só com código de convite' : 'aberto'}`);
  });
}

iniciar().catch((e) => {
  // a mensagem do pg pode citar o endereço do banco; esconde qualquer connection string
  console.error('Não consegui iniciar:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<DATABASE_URL>'));
  process.exit(1);
});
