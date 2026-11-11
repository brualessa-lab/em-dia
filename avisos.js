// Avisos de vencimento com o app fechado (Web Push).
//
// Cada aparelho que ativa os avisos manda ao servidor a sua "inscrição" (endpoint do Google,
// Apple, Mozilla ou Microsoft). Uma vez por dia o servidor confere as contas de cada usuário e,
// se houver alguma vencida ou perto de vencer, manda uma notificação para os aparelhos dele.
//
// A conferência roda quando alguém chama POST /api/avisos/rodar (o GitHub Actions faz isso
// toda manhã, ver .github/workflows/avisos.yml) e também de hora em hora enquanto o servidor
// estiver acordado. Cada aparelho recebe no máximo um aviso por dia, então rodar a mais não incomoda.
const webpush = require('web-push');

const FUSO = 'America/Sao_Paulo';
const HORA_MIN = 8;   // não acorda ninguém de madrugada
const HORA_MAX = 21;
const DIA = 864e5;

// Só manda para serviços de push conhecidos (o servidor faz um pedido para essa URL)
const HOSTS_PUSH = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/,
];

const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const fmt = (v) => num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mk = (ano, mes) => `${ano}-${String(mes + 1).padStart(2, '0')}`;

// data e hora de agora no Brasil
function agoraBR(agora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: +p.hour, data: Date.UTC(+p.year, +p.month - 1, +p.day) };
}

// mesma regra do app (app.js → ocorrencia/alertas), com datas em UTC
function ocorrencia(d, ano, mes) {
  const [y, m, dd] = String(d.vencimento).split('-').map(Number);
  if (!y || !m || !dd) return null;
  const n = ano * 12 + mes - (y * 12 + (m - 1));
  if (n < 0) return null;
  if (d.recorrencia === 'unica' && n > 0) return null;
  if (d.recorrencia === 'parcelada' && n >= (num(d.parcelas) || 1)) return null;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const chave = mk(ano, mes);
  return { d, data: Date.UTC(ano, mes, Math.min(dd, ultimoDia)), paga: (d.pagas || []).includes(chave) };
}

function alertas(dados, hoje) {
  const janela = num(dados.perfil?.diasAviso) || 3;
  const h = new Date(hoje);
  const lista = [];
  for (let k = -3; k <= 1; k++) {
    const ano = h.getUTCFullYear();
    const mes = h.getUTCMonth() + k;
    const ref = new Date(Date.UTC(ano, mes, 1));
    for (const d of dados.despesas || []) {
      const o = ocorrencia(d, ref.getUTCFullYear(), ref.getUTCMonth());
      if (!o || o.paga) continue;
      const dias = Math.round((o.data - hoje) / DIA);
      if (dias <= janela) lista.push({ ...o, dias });
    }
  }
  return lista.sort((a, b) => a.data - b.data);
}

function quando(dias) {
  if (dias < -1) return `venceu há ${-dias} dias`;
  if (dias === -1) return 'venceu ontem';
  if (dias === 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  return `vence em ${dias} dias`;
}

function mensagem(lista) {
  const corpo = lista.slice(0, 4).map((o) => `${o.d.nome} · R$ ${fmt(o.d.valor)} · ${quando(o.dias)}`).join('\n') +
    (lista.length > 4 ? `\n+ ${lista.length - 4} outras` : '');
  const titulo = lista.length === 1 ? 'Em Dia · conta perto de vencer' : `Em Dia · ${lista.length} contas perto de vencer`;
  return { titulo, corpo, tag: 'duofinn' };
}

// confere se o que o navegador mandou parece mesmo uma inscrição de push
function inscricaoValida(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || !HOSTS_PUSH.some((r) => r.test(url.hostname))) return null;
  const b64 = /^[A-Za-z0-9_-]{10,200}={0,2}$/;
  if (!keys || !b64.test(keys.p256dh || '') || !b64.test(keys.auth || '')) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function criarAvisos(store, { contato }) {
  let chaves;
  async function preparar() {
    chaves = await store.config('vapid', () => webpush.generateVAPIDKeys());
    webpush.setVapidDetails(contato, chaves.publicKey, chaves.privateKey);
  }

  // manda para uma inscrição; se o aparelho cancelou (404/410), esquece ela
  async function mandar(item, msg) {
    try {
      await webpush.sendNotification(item.sub, JSON.stringify(msg), { TTL: 12 * 3600, urgency: 'high' });
      return true;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await store.removerInscricao(item.sub.endpoint);
      else console.error('Push falhou:', e.statusCode || '', String(e.body || e.message).slice(0, 200));
      return false;
    }
  }

  let rodando = null;
  let ultimaRodada = 0;
  async function rodar({ forcar = false } = {}) {
    const { dia, hora, data } = agoraBR();
    if (!forcar && (hora < HORA_MIN || hora > HORA_MAX)) return { enviados: 0, motivo: 'fora do horário' };
    const pendentes = (await store.inscricoes()).filter((x) => x.avisadoEm !== dia);
    const porUsuario = new Map();
    let enviados = 0;
    for (const item of pendentes) {
      if (!porUsuario.has(item.usuario)) porUsuario.set(item.usuario, alertas(await store.dados(item.usuario), data));
      const lista = porUsuario.get(item.usuario);
      if (lista.length && await mandar(item, mensagem(lista))) enviados++;
      // marca mesmo sem contas: assim ninguém recebe aviso atrasado no fim do dia
      await store.marcarAvisado(item.sub.endpoint, dia);
    }
    return { enviados, aparelhos: pendentes.length };
  }

  return {
    preparar,
    chavePublica: () => chaves.publicKey,
    inscricaoValida,
    // várias chamadas seguidas viram uma só
    rodar() {
      if (rodando) return rodando;
      if (Date.now() - ultimaRodada < 60e3) return Promise.resolve({ enviados: 0, motivo: 'rodou há pouco' });
      rodando = rodar().finally(() => { rodando = null; ultimaRodada = Date.now(); });
      return rodando;
    },
    async teste(usuario) {
      const itens = await store.inscricoes(usuario);
      const msg = { titulo: 'Em Dia · avisos ligados', corpo: 'Quando uma conta estiver perto de vencer, o aviso chega aqui.', tag: 'duofinn-teste' };
      let ok = 0;
      for (const item of itens) if (await mandar(item, msg)) ok++;
      return { aparelhos: itens.length, enviados: ok };
    },
  };
}

module.exports = { criarAvisos, alertas, agoraBR, inscricaoValida };
