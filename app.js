// =====================================================================
// Em Dia — painel de finanças pessoais ou em casal
// Os dados de cada usuário ficam no servidor (dados/u_<usuario>.json).
// =====================================================================

// ================== HELPERS ==================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const fmt = (v) => num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v, t) => (t ? (v / t) * 100 : 0);
const DIA = 864e5;
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const mk = (ano, mes) => `${ano}-${String(mes + 1).padStart(2, '0')}`;
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const inicial = (s) => (String(s || '').trim().charAt(0) || '?').toUpperCase();
const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const isoData = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dataBR = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

function money(v) {
  const neg = v < 0;
  const [int, cents] = fmt(Math.abs(v)).split(',');
  return `<span class="cur">${neg ? '−' : ''}R$</span> ${int}<span class="cents">,${cents}</span>`;
}

function icone(nome) {
  const n = String(nome).toLowerCase();
  const mapa = [['alug', '🔑'], ['luz', '⚡'], ['energia', '⚡'], ['internet', '📶'], ['wi', '📶'], ['condom', '🏬'],
    ['cart', '💳'], ['água', '💧'], ['agua', '💧'], ['gás', '🔥'], ['gas', '🔥'], ['iptu', '🧾'], ['apart', '🏢'],
    ['financ', '🏢'], ['obra', '🏗️'], ['seguro', '🛡️'], ['celular', '📱'], ['academia', '🏋️'], ['saúde', '🩺'],
    ['stream', '📺'], ['escola', '🎓'], ['faculdade', '🎓'], ['ipva', '🚗'], ['emprést', '💰']];
  for (const [k, i] of mapa) if (n.includes(k)) return i;
  return '🏠';
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ================== DADOS ==================
const novoDados = () => ({
  versao: 2,
  perfil: { modo: 'individual', nome: '', parceiro: '', salario: 0, salarioParceiro: 0, diaADia: 0, diasAviso: 3 },
  despesas: [],   // { id, nome, valor, vencimento:'AAAA-MM-DD', recorrencia:'mensal'|'unica'|'parcelada', parcelas, tipo:'casa'|'pessoal', quem:'eu'|'ela', moradia, pagas:['AAAA-MM'] }
  cartoes: [],    // { id, banco, nome, cor, diaVencimento, limite, faturas:[atual, próxima, seguinte] }
  acertos: [],    // meses em que o Pix da divisão foi feito
});

function normalizar(d) {
  const base = novoDados();
  if (!d || typeof d !== 'object') return base;
  return {
    ...base,
    ...d,
    // contas antigas (de antes do modo individual) eram todas de casal
    perfil: { ...base.perfil, ...(d.perfil || {}), modo: d.perfil?.modo || (d.perfil ? 'casal' : 'individual') },
    despesas: (Array.isArray(d.despesas) ? d.despesas : []).map((x) => ({ pagas: [], ...x, id: x.id || uid() })),
    cartoes: (Array.isArray(d.cartoes) ? d.cartoes : []).map((x) => ({ faturas: [0, 0, 0], ...x, id: x.id || uid() })),
    acertos: Array.isArray(d.acertos) ? d.acertos : [],
  };
}

let dados = novoDados();
let usuario = null;

const agora = new Date();
const estado = {
  view: 'geral',
  mes: agora.getMonth(), ano: agora.getFullYear(),
  dia: null, verTodas: false,
  cartao: 0, fatura: 0,
  base: 'meu',
  filtro: 'todas',
};
const nomeEu = () => dados.perfil.nome || usuario || 'Você';
const nomeEla = () => dados.perfil.parceiro || 'Parceiro(a)';
const casal = () => dados.perfil.modo === 'casal';
// Quanto de uma conta sai do seu bolso: no modo casal, conta da casa é dividida ao meio
const parte = (o) => (casal() && o.d.tipo === 'casa' ? num(o.d.valor) / 2 : num(o.d.valor));

// ================== SERVIDOR ==================
async function api(url, opts = {}) {
  const r = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  let corpo = null;
  try { corpo = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(corpo?.erro || `Erro ${r.status}`), { status: r.status });
  return corpo;
}

let timerSalvar;
function salvar() {
  setStatus('salvando');
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(async () => {
    try {
      await api('/api/dados', { method: 'PUT', body: JSON.stringify(dados) });
      setStatus('salvo');
    } catch (e) {
      if (e.status === 401) return mostrarLogin('Sua sessão expirou. Entre de novo.');
      setStatus('erro');
    }
  }, 400);
}
function setStatus(s) {
  const txt = { salvo: '✓ Salvo', salvando: 'Salvando…', erro: '⚠ Não salvou — o servidor está ligado?' };
  $('saveStatus').textContent = txt[s];
  $('saveStatus').dataset.s = s;
}

// ================== LOGIN ==================
let modoLogin = 'entrar';
let modoConta = 'individual';

function marcarModo(container, modo) {
  container.querySelectorAll('[data-conta]').forEach((b) => b.classList.toggle('on', b.dataset.conta === modo));
}
$('modoConta').addEventListener('click', (e) => {
  const b = e.target.closest('[data-conta]');
  if (b) { modoConta = b.dataset.conta; marcarModo($('modoConta'), modoConta); }
});

function mostrarLogin(msg = '') {
  usuario = null;
  dados = novoDados();
  $('app').classList.add('hidden');
  $('modal').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('loginErro').textContent = msg;
  setModoLogin(modoLogin);
  $('loginForm').usuario.focus();
}

let pedeConvite = false; // o servidor diz se o cadastro exige código de convite

function setModoLogin(m) {
  modoLogin = m;
  const criar = m === 'criar';
  document.querySelectorAll('#loginTabs button').forEach((b) => b.classList.toggle('on', b.dataset.modo === m));
  $('confirmaWrap').classList.toggle('hidden', !criar);
  $('modoWrap').classList.toggle('hidden', !criar);
  $('conviteWrap').classList.toggle('hidden', !(criar && pedeConvite));
  $('loginForm').convite.required = criar && pedeConvite;
  $('loginForm').confirma.required = criar;
  $('loginForm').senha.autocomplete = criar ? 'new-password' : 'current-password';
  $('loginBtn').textContent = criar ? 'Criar conta' : 'Entrar';
  $('loginDica').textContent = criar ? 'Usuário: 3 a 30 letras minúsculas, números, ponto ou traço. Senha: mínimo 6 caracteres.' : '';
}

$('loginTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-modo]');
  if (b) { $('loginErro').textContent = ''; setModoLogin(b.dataset.modo); }
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const usuarioDigitado = f.usuario.value.trim().toLowerCase();
  if (modoLogin === 'criar' && f.senha.value !== f.confirma.value) {
    $('loginErro').textContent = 'As senhas não são iguais';
    return;
  }
  $('loginBtn').disabled = true;
  try {
    const r = await api(modoLogin === 'criar' ? '/api/registrar' : '/api/entrar', {
      method: 'POST', body: JSON.stringify({ usuario: usuarioDigitado, senha: f.senha.value, convite: f.convite.value }),
    });
    f.reset();
    await entrouComo(r.usuario, modoLogin === 'criar' ? modoConta : null);
  } catch (err) {
    $('loginErro').textContent = err.status ? err.message : 'Não consegui falar com o servidor. Confira a internet e tente de novo.';
  } finally {
    $('loginBtn').disabled = false;
  }
});

async function entrouComo(u, modoNovo = null) {
  usuario = u;
  const salvo = await api('/api/dados');
  dados = normalizar(salvo);
  // conta nova: aplica o modo escolhido. Se já existiam dados (conta recriada), mantém o que estava.
  const vazio = !salvo || !Object.keys(salvo).length;
  if (modoNovo && vazio) { dados.perfil.modo = modoNovo; salvar(); }
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  estado.view = 'geral';
  setStatus('salvo');
  render();
  avisarWindows();
}

async function sair() {
  try { await api('/api/sair', { method: 'POST' }); } catch {}
  modoLogin = 'entrar';
  mostrarLogin();
}

// ================== VENCIMENTOS ==================
// Devolve a ocorrência de uma despesa num mês (ou null se ela não cai naquele mês)
function ocorrencia(d, ano, mes) {
  const [y, m, dd] = String(d.vencimento).split('-').map(Number);
  if (!y || !m || !dd) return null;
  const n = ano * 12 + mes - (y * 12 + (m - 1)); // quantos meses depois do 1º vencimento
  if (n < 0) return null;
  if (d.recorrencia === 'unica' && n > 0) return null;
  if (d.recorrencia === 'parcelada' && n >= (num(d.parcelas) || 1)) return null;
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const chave = mk(ano, mes);
  return {
    d,
    data: new Date(ano, mes, Math.min(dd, ultimoDia)),
    chave,
    paga: d.pagas.includes(chave),
    parcela: d.recorrencia === 'parcelada' ? `${n + 1}/${d.parcelas}` : '',
  };
}
const doMes = (ano, mes) => dados.despesas.map((d) => ocorrencia(d, ano, mes)).filter(Boolean).sort((a, b) => a.data - b.data);
const somaO = (lista) => lista.reduce((s, o) => s + num(o.d.valor), 0);
const diasAte = (data) => Math.round((data - hoje0()) / DIA);

function situacao(o) {
  if (o.paga) return 'paga';
  const dias = diasAte(o.data);
  if (dias < 0) return 'vencida';
  if (dias <= num(dados.perfil.diasAviso)) return 'perto';
  return 'aberta';
}
function quando(dias) {
  if (dias < -1) return `venceu há ${-dias} dias`;
  if (dias === -1) return 'venceu ontem';
  if (dias === 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  return `vence em ${dias} dias`;
}

// Tudo que está em aberto e vencido ou dentro da janela de aviso (olha 3 meses pra trás)
function alertas() {
  const h = hoje0();
  const lista = [];
  for (let k = -3; k <= 1; k++) {
    const ref = new Date(h.getFullYear(), h.getMonth() + k, 1);
    for (const o of doMes(ref.getFullYear(), ref.getMonth())) {
      const s = situacao(o);
      if (s === 'vencida' || s === 'perto') lista.push({ ...o, dias: diasAte(o.data), s });
    }
  }
  return lista.sort((a, b) => a.data - b.data);
}

// Próximos vencimentos em aberto (hoje até 45 dias), mais os vencidos
function proximos() {
  const h = hoje0();
  const lim = +h + 45 * DIA;
  const lista = [];
  for (let k = -3; k <= 2; k++) {
    const ref = new Date(h.getFullYear(), h.getMonth() + k, 1);
    for (const o of doMes(ref.getFullYear(), ref.getMonth())) {
      if (!o.paga && +o.data <= lim) lista.push({ ...o, dias: diasAte(o.data), s: situacao(o) });
    }
  }
  return lista.sort((a, b) => a.data - b.data);
}

function alternarPaga(id, chave) {
  const d = dados.despesas.find((x) => x.id === id);
  if (!d) return;
  const i = d.pagas.indexOf(chave);
  if (i >= 0) d.pagas.splice(i, 1); else d.pagas.push(chave);
  salvar();
  render();
}

// ================== RENDER ==================
function render() {
  if (!usuario) return;
  const p = dados.perfil;

  // modo individual x casal
  const solo = !casal();
  document.body.classList.toggle('solo', solo);
  $('brandSub').textContent = solo ? 'Finanças pessoais' : 'Finanças em casal';
  $('navRenda').textContent = solo ? 'Sua renda e conta' : 'Nossa renda e conta';
  document.title = `Em Dia · ${solo ? 'Finanças pessoais' : 'Finanças em casal'}`;
  if (solo) {
    estado.base = 'meu';
    if (estado.filtro === 'casa' || estado.filtro === 'pessoal') estado.filtro = 'todas';
  }

  // marca, usuário e menu
  $('avEu').textContent = inicial(nomeEu());
  $('avEla').textContent = inicial(nomeEla());
  $('userAv').textContent = inicial(nomeEu());
  $('userNome').textContent = nomeEu();
  $('userSub').textContent = '@' + usuario;
  document.querySelectorAll('.nav-item[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === estado.view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + estado.view));

  // mês
  $('monthTitle').textContent = `${MESES[estado.mes]} ${estado.ano}`;
  $('hojeBtn').classList.toggle('hidden', estado.mes === agora.getMonth() && estado.ano === new Date().getFullYear());

  renderSino();
  if (estado.view === 'geral') renderGeral();
  if (estado.view === 'despesas') renderDespesas();
  if (estado.view === 'cartoes') renderCartoes();
  if (estado.view === 'renda') renderRenda();
}

// ---------- sino de alertas ----------
function renderSino() {
  const p = dados.perfil;
  const lista = alertas();
  const n = lista.length;
  $('bellBadge').textContent = n;
  $('bellBadge').classList.toggle('hidden', !n);
  document.querySelector('.bell').classList.toggle('tem', n > 0);
  $('navBadge').textContent = n;
  $('navBadge').classList.toggle('hidden', !n);

  const permissao = 'Notification' in window ? Notification.permission : 'indisponivel';
  $('bellPop').innerHTML = `
    <h4>Alertas de vencimento</h4>
    ${n ? lista.map((o) => `
      <div class="bell-item">
        <i class="dot ${o.s === 'vencida' ? 'dot-pink' : 'dot-orange'}"></i>
        <div class="txt"><b>${esc(o.d.nome)}</b><small class="mini ${o.s}" style="margin:0">${quando(o.dias)} · ${dataBR(o.data)}</small></div>
        <strong>R$ ${fmt(o.d.valor)}</strong>
        <button class="outline" data-pagar="${o.d.id}|${o.chave}">Paguei</button>
      </div>`).join('')
    : `<div class="bell-vazio">Nada vencendo nos próximos ${num(p.diasAviso)} dias. 🎉</div>`}
    <div class="bell-foot">
      <small>Avisa ${num(p.diasAviso)} dia(s) antes</small>
      ${permissao === 'default' ? '<button class="outline" data-acao="ativar-avisos">Ativar avisos no aparelho</button>' : ''}
      ${permissao === 'granted' ? '<small>🔔 Avisos ligados neste aparelho</small>' : ''}
    </div>`;

  // faixa de alerta na visão geral
  const vencidas = lista.filter((o) => o.s === 'vencida');
  const hoje = lista.filter((o) => o.dias === 0);
  const b = $('alertaBanner');
  if (!n) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.classList.toggle('grave', vencidas.length > 0);
  const partes = [];
  if (vencidas.length) partes.push(`<b>${vencidas.length} vencida${vencidas.length > 1 ? 's' : ''}</b>`);
  if (hoje.length) partes.push(`<b>${hoje.length} vence${hoje.length > 1 ? 'm' : ''} hoje</b>`);
  const resto = n - vencidas.length - hoje.length;
  if (resto) partes.push(`${resto} vence${resto > 1 ? 'm' : ''} nos próximos dias`);
  b.innerHTML = `
    <div><strong>${vencidas.length ? '⚠️' : '⏰'} Contas perto do vencimento</strong>
      <p>${partes.join(' · ')} — total de R$ ${fmt(somaO(lista))}</p></div>
    <div class="banner-btns"><button class="outline" data-acao="sino">Ver contas</button></div>`;
}

// ---------- visão geral ----------
function renderGeral() {
  const p = dados.perfil;
  const solo = !casal();
  const lista = doMes(estado.ano, estado.mes);
  const casa = solo ? [] : lista.filter((o) => o.d.tipo === 'casa');
  const totalCasa = somaO(casa);
  const metade = totalCasa / 2;
  const pessoais = somaO(lista.filter((o) => solo || o.d.tipo !== 'casa'));
  const sal = num(p.salario);
  const diaADia = num(p.diaADia);
  const sobra = sal - metade - pessoais - diaADia;

  $('boasVindas').classList.toggle('hidden', !!(sal || dados.despesas.length));

  // saldo previsto
  $('saldoValor').innerHTML = money(sobra);
  const sp = $('saldoPct');
  sp.textContent = sal ? `${sobra >= 0 ? '↗' : '↘'} ${Math.round(pct(sobra, sal))}% do salário ${sobra >= 0 ? 'livre' : '(faltando)'}` : 'Cadastre seu salário em Nossa renda';
  sp.style.color = sobra >= 0 ? 'var(--green)' : 'var(--pink)';
  const segs = [
    ...(solo ? [] : [{ lbl: 'Sua metade da casa', v: metade, cor: 'var(--blue-dark)', dot: 'navy' }]),
    { lbl: solo ? 'Contas do mês' : 'Contas pessoais', v: pessoais, cor: 'var(--blue)', dot: 'blue' },
    { lbl: 'Dia a dia', v: diaADia, cor: '#c5c9d2', dot: 'gray' },
    { lbl: 'Sobra', v: sobra, cor: sobra >= 0 ? 'var(--green)' : 'var(--pink)', dot: 'green' },
  ];
  $('saldoLegend').classList.toggle('quatro', solo);
  const temBarra = segs.some((s) => s.v > 0);
  $('saldoBar').innerHTML = temBarra
    ? segs.map((s) => `<span style="flex:${Math.max(s.v, 0)};background:${s.cor}"></span>`).join('')
    : '<span style="flex:1;background:var(--surface-2)"></span>';
  $('saldoLegend').innerHTML =
    `<div><small>Salário</small><strong>R$ ${fmt(sal)}</strong> <em style="cursor:pointer" data-view="renda" title="Editar">✎</em></div>` +
    segs.map((s) => `
      <div class="${s.lbl === 'Sobra' ? 'sobra' : ''}">
        <small><i class="dot dot-${s.dot}" style="margin-left:0"></i>${s.lbl}</small>
        <strong ${s.lbl === 'Sobra' && s.v < 0 ? 'style="color:var(--pink)"' : ''}>${s.lbl === 'Sobra' ? '' : '− '}R$ ${fmt(s.v)}</strong><em>${Math.round(pct(s.v, sal))}%</em>
      </div>`).join('');

  renderContasDoDia(lista);
  if (!solo) renderDivisao(casa, totalCasa, metade);
  renderCartaoCard();
  renderMoradia(lista);
  renderProximos();
}

function renderContasDoDia(lista) {
  const dias = [...new Set(lista.map((o) => o.data.getDate()))];
  if (!dias.includes(estado.dia)) {
    const ehMesAtual = estado.mes === new Date().getMonth() && estado.ano === new Date().getFullYear();
    const hojeDia = new Date().getDate();
    // começa no primeiro dia com conta em aberto (no mês atual, a partir de hoje)
    estado.dia = (ehMesAtual && dias.find((d) => d >= hojeDia)) ||
      lista.find((o) => !o.paga)?.data.getDate() || dias[0] || null;
  }
  const doDia = lista.filter((o) => o.data.getDate() === estado.dia);
  const pagas = doDia.filter((o) => o.paga).length;
  $('contasDia').textContent = estado.dia ? `• dia ${String(estado.dia).padStart(2, '0')}` : '';
  $('contasTotal').innerHTML = money(somaO(doDia.filter((o) => !o.paga)));
  $('contasSub').textContent = lista.length ? `${pagas} de ${doDia.length} pagas · ${lista.filter((o) => !o.paga).length} em aberto no mês` : 'nenhuma conta neste mês';

  $('daysTabs').innerHTML = dias.map((d) => {
    const doD = lista.filter((o) => o.data.getDate() === d);
    const alerta = doD.some((o) => ['perto', 'vencida'].includes(situacao(o)));
    const abertas = doD.filter((o) => !o.paga).length;
    return `<button class="day ${d === estado.dia ? 'on' : ''} ${alerta ? 'alerta' : ''}" data-dia="${d}" title="${abertas} em aberto">
      ${String(d).padStart(2, '0')}<i>${'•'.repeat(Math.min(doD.length, 5))}</i></button>`;
  }).join('');

  if (!lista.length) {
    $('contasList').innerHTML = `<li class="vazio">Nenhuma despesa vence em ${MESES[estado.mes].toLowerCase()}.
      <button class="primary rounded" data-acao="nova-despesa">+ Cadastrar despesa</button></li>`;
    return;
  }
  const visiveis = estado.verTodas ? doDia : doDia.slice(0, 5);
  $('contasList').innerHTML = visiveis.map((o) => {
    const s = situacao(o);
    const tag = s === 'vencida' ? '<span class="mini vencida">vencida</span>' : s === 'perto' ? `<span class="mini perto">${quando(diasAte(o.data))}</span>` : '';
    return `<li class="${o.paga ? 'paid' : ''}" data-pagar="${o.d.id}|${o.chave}" title="Clique para marcar como ${o.paga ? 'não paga' : 'paga'}">
      <span class="box">✓</span><span class="lbl">${esc(o.d.nome)}${o.parcela ? `<span class="mini">${o.parcela}</span>` : ''}${tag}</span>
      <span class="val">R$ ${fmt(o.d.valor)}</span></li>`;
  }).join('') +
    (doDia.length > 5 ? `<li class="more" data-more="1">${estado.verTodas ? 'Mostrar menos' : `+ ${doDia.length - 5} contas`}</li>` : '');
}

function renderDivisao(casa, total, metade) {
  const eu = somaO(casa.filter((o) => o.d.quem !== 'ela'));
  const ela = total - eu;
  $('casaTotal').innerHTML = money(total);
  $('vocePaga').textContent = `R$ ${fmt(eu)}`;
  $('esposaPaga').textContent = `R$ ${fmt(ela)}`;
  $('elaPagaLbl').textContent = `${nomeEla()} paga`;
  const pEu = total ? pct(eu, total) : 50;
  const lbl = (v) => (total ? `${v.toFixed(1).replace('.', ',')}%` : '');
  $('splitBar').innerHTML = `<span class="you" style="width:${pEu}%">${lbl(pEu)}</span><span class="her" style="width:${100 - pEu}%">${lbl(100 - pEu)}</span>`;
  $('casaList').innerHTML = casa.length
    ? casa.map((o) => `<li data-trocar="${o.d.id}" style="cursor:pointer" title="Trocar quem paga">
        <i class="dot dot-${o.d.quem === 'ela' ? 'pink' : 'blue'}"></i>${esc(o.d.nome)}<span class="val">R$ ${fmt(o.d.valor)}</span></li>`).join('')
    : '<li class="muted">Nenhuma conta da casa neste mês. Ao cadastrar uma despesa, escolha “Da casa”.</li>';

  const diff = eu - metade;
  const feito = dados.acertos.includes(mk(estado.ano, estado.mes));
  if (Math.abs(diff) < 0.005) {
    $('acerto').innerHTML = `<span class="muted">${casa.length ? 'Divisão certinha — ninguém deve nada.' : ''}</span>`;
    return;
  }
  const [de, para] = diff > 0 ? [nomeEla(), nomeEu()] : [nomeEu(), nomeEla()];
  const [cDe, cPara] = diff > 0 ? ['av-pink', 'av-blue'] : ['av-blue', 'av-pink'];
  $('acerto').innerHTML = `
    <span class="av ${cDe} sm">${inicial(de)}</span>→<span class="av ${cPara} sm">${inicial(para)}</span>
    <span>${diff > 0 ? `${esc(nomeEla())} te devolve` : `Você devolve a ${esc(nomeEla())}`} <b>R$ ${fmt(Math.abs(diff))}</b> no Pix</span>
    <button class="outline ${feito ? 'done' : ''}" data-acao="acerto">${feito ? '✓ Feito' : 'Marcar feito'}</button>`;
}

function rotulosFaturas() {
  return [0, 1, 2].map((i) => {
    const d = new Date(estado.ano, estado.mes + i, 1);
    return MES_CURTO[d.getMonth()] + (d.getFullYear() !== estado.ano ? ' ' + String(d.getFullYear()).slice(2) : '');
  });
}

// ================== VISUAL DOS CARTÕES ==================
// Cores inspiradas em cada banco, desenhadas aqui mesmo (sem imagem da internet).
const BANCOS = [
  { nome: 'Nubank',          chaves: ['nubank', 'nu'],     bg: ['#a43cf0', '#5a0fb0'], fg: '#fff' },
  { nome: 'Itaú',            chaves: ['itau'],              bg: ['#ff8a1f', '#e35f00'], fg: '#fff' },
  { nome: 'Bradesco',        chaves: ['bradesco'],          bg: ['#ee2a4f', '#a3072a'], fg: '#fff' },
  { nome: 'Santander',       chaves: ['santander'],         bg: ['#f2262b', '#a80000'], fg: '#fff' },
  { nome: 'Banco do Brasil', chaves: ['banco do brasil', 'bb'], bg: ['#fff04d', '#f2c500'], fg: '#0b3a8c' },
  { nome: 'Caixa',           chaves: ['caixa'],             bg: ['#1f7fd6', '#00468c'], fg: '#fff' },
  { nome: 'Inter',           chaves: ['inter'],             bg: ['#ff9a2e', '#ff5f00'], fg: '#fff' },
  { nome: 'C6 Bank',         chaves: ['c6'],                bg: ['#3a3a3c', '#0b0b0c'], fg: '#fff' },
  { nome: 'Mercado Pago',    chaves: ['mercado pago', 'mercadopago'], bg: ['#4ccdf7', '#0095d6'], fg: '#fff' },
  { nome: 'PicPay',          chaves: ['picpay'],            bg: ['#3ee07c', '#0ea84b'], fg: '#fff' },
  { nome: 'BTG Pactual',     chaves: ['btg'],               bg: ['#1b3f7a', '#061636'], fg: '#fff' },
  { nome: 'XP',              chaves: ['xp'],                bg: ['#2a2a2a', '#000000'], fg: '#f5d77a' },
  { nome: 'Neon',            chaves: ['neon'],              bg: ['#3ff0ff', '#00a9cc'], fg: '#00334d' },
  { nome: 'Next',            chaves: ['next'],              bg: ['#2bff8a', '#00b35c'], fg: '#06210f' },
  { nome: 'Banco Pan',       chaves: ['pan'],               bg: ['#24b6f0', '#0068a8'], fg: '#fff' },
  { nome: 'Sicredi',         chaves: ['sicredi'],           bg: ['#77c94a', '#2f7d14'], fg: '#fff' },
  { nome: 'Sicoob',          chaves: ['sicoob'],            bg: ['#167a73', '#003641'], fg: '#fff' },
  { nome: 'Will Bank',       chaves: ['will'],              bg: ['#ffe75c', '#ffc800'], fg: '#2a2a2a' },
  { nome: 'Porto Bank',      chaves: ['porto'],             bg: ['#3d78db', '#0d3a8a'], fg: '#fff' },
];
const CORES = {
  black:  { nome: 'Preto',    bg: ['#3a3a3d', '#121214'], fg: '#fff' },
  gold:   { nome: 'Dourado',  bg: ['#f3d48a', '#b8862b'], fg: '#3b2a06' },
  silver: { nome: 'Prata',    bg: ['#eef0f3', '#a9afb8'], fg: '#22262c' },
  blue:   { nome: 'Azul',     bg: ['#3b82f6', '#1d4ed8'], fg: '#fff' },
  purple: { nome: 'Roxo',     bg: ['#a855f7', '#6d28d9'], fg: '#fff' },
  red:    { nome: 'Vermelho', bg: ['#f43f5e', '#be123c'], fg: '#fff' },
  orange: { nome: 'Laranja',  bg: ['#ff8a1f', '#ec6a00'], fg: '#fff' },
  green:  { nome: 'Verde',    bg: ['#22c55e', '#15803d'], fg: '#fff' },
};
const BANDEIRAS = { '': 'Nenhuma', visa: 'Visa', master: 'Mastercard', elo: 'Elo', amex: 'American Express', hiper: 'Hipercard' };

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// chaves curtas (bb, xp, c6, pan, nu) só valem como palavra inteira
function bancoDe(nome) {
  const n = ` ${semAcento(nome).replace(/[^a-z0-9]+/g, ' ')} `;
  return BANCOS.find((b) => b.chaves.some((k) => (k.length <= 3 ? n.includes(` ${k} `) : n.includes(k)))) || null;
}
// cor final: a escolhida pela pessoa, ou a do banco, ou preto
function visualCartao(c) {
  if (c.cor && c.cor !== 'auto' && CORES[c.cor]) return CORES[c.cor];
  return bancoDe(c.banco) || CORES.black;
}
function bandeiraHTML(b) {
  if (b === 'visa') return '<span class="bd bd-visa">VISA</span>';
  if (b === 'master') return '<span class="bd bd-master"><i></i><i></i></span>';
  if (b === 'elo') return '<span class="bd bd-elo">elo</span>';
  if (b === 'amex') return '<span class="bd bd-amex">AMEX</span>';
  if (b === 'hiper') return '<span class="bd bd-hiper">Hipercard</span>';
  return '';
}

// só aceita imagem embutida (data URL) de png/jpeg/webp — nada de endereço externo
const imagemValida = (s) =>
  (typeof s === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '');

// Recebe o arquivo escolhido, corta as bordas vazias e ajusta ao formato de cartão (≈ 640×404)
function prepararImagem(arquivo) {
  return new Promise((ok, falha) => {
    if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) return falha(new Error('Use uma imagem PNG, JPG ou WEBP'));
    if (arquivo.size > 15 * 1024 * 1024) return falha(new Error('Imagem grande demais (máx. 15 MB)'));
    const url = URL.createObjectURL(arquivo);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      // 1) acha onde o cartão está (ignora fundo transparente ou branco)
      const W = im.naturalWidth, H = im.naturalHeight;
      const amostra = document.createElement('canvas');
      const fator = Math.min(1, 400 / Math.max(W, H));
      amostra.width = Math.max(1, Math.round(W * fator)); amostra.height = Math.max(1, Math.round(H * fator));
      const ax = amostra.getContext('2d');
      ax.drawImage(im, 0, 0, amostra.width, amostra.height);
      const px = ax.getImageData(0, 0, amostra.width, amostra.height).data;
      let x0 = amostra.width, y0 = amostra.height, x1 = -1, y1 = -1;
      for (let y = 0; y < amostra.height; y++) {
        for (let x = 0; x < amostra.width; x++) {
          const i = (y * amostra.width + x) * 4;
          const vazio = px[i + 3] < 20 || (px[i] > 248 && px[i + 1] > 248 && px[i + 2] > 248);
          if (!vazio) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      }
      let sx = 0, sy = 0, sw = W, sh = H;
      if (x1 > x0 && y1 > y0) { sx = x0 / fator; sy = y0 / fator; sw = (x1 - x0 + 1) / fator; sh = (y1 - y0 + 1) / fator; }
      // 2) recorta no formato de cartão (1,586 : 1), centralizado
      const R = 1.586;
      if (sw / sh > R) { const n = sh * R; sx += (sw - n) / 2; sw = n; } else { const n = sw / R; sy += (sh - n) / 2; sh = n; }
      const out = document.createElement('canvas');
      out.width = 640; out.height = 404;
      const ox = out.getContext('2d');
      ox.imageSmoothingQuality = 'high';
      ox.drawImage(im, sx, sy, sw, sh, 0, 0, out.width, out.height);
      ok(out.toDataURL('image/webp', 0.86));
    };
    im.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não consegui abrir essa imagem')); };
    im.src = url;
  });
}

function cartaoHTML(c, extraStyle = '') {
  const venc = `${String(num(c.diaVencimento) || 1).padStart(2, '0')}/${String(estado.mes + 1).padStart(2, '0')}`;
  const v = visualCartao(c);
  const final = String(c.final || '').replace(/\D/g, '').slice(-4);
  const img = imagemValida(c.imagem);
  if (img) {
    // com a imagem oficial: mostra a arte e só uma faixa com as informações embaixo
    return `
    <div class="cc cc-foto" style="${extraStyle}">
      <img class="cc-img" src="${img}" alt="Cartão ${esc(c.banco)}">
      <span class="cc-status">Aberta</span>
      <div class="cc-faixa">
        <div><small>VENCE</small><b>${venc}</b></div>
        ${final ? `<div><small>FINAL</small><b>${final}</b></div>` : ''}
        <div style="text-align:right"><small>LIMITE LIVRE</small><b>R$ ${fmt(c.limite)}</b></div>
      </div>
    </div>`;
  }
  return `
    <div class="cc" style="background:linear-gradient(135deg, ${v.bg[0]}, ${v.bg[1]} 75%);color:${v.fg};${extraStyle}">
      <div class="cc-top"><span class="cc-banco">${esc(c.banco || 'Seu banco')}</span><span class="cc-status">Aberta</span></div>
      <div class="cc-mid"><span class="chip"></span><span class="cc-name">${esc(c.nome || '').toUpperCase()}</span><span class="cc-nfc">)))</span></div>
      <div class="cc-num">•••• •••• •••• ${final || '••••'}</div>
      <div class="cc-bot">
        <div><small>VENCE</small><b>${venc}</b></div>
        <div><small>LIMITE LIVRE</small><b>R$ ${fmt(c.limite)}</b></div>
        ${bandeiraHTML(c.bandeira)}
      </div>
    </div>`;
}

function renderCartaoCard() {
  const el = $('cartoesCard');
  if (!dados.cartoes.length) {
    el.innerHTML = `
      <div class="card-head"><div><h2>Cartões</h2><small class="muted">Faturas e limites</small></div><div class="illus">💳</div></div>
      <div class="cartoes-vazio">Nenhum cartão cadastrado.<button class="primary rounded" data-acao="novo-cartao">+ Cadastrar cartão</button></div>`;
    return;
  }
  estado.cartao = Math.min(estado.cartao, dados.cartoes.length - 1);
  const c = dados.cartoes[estado.cartao];
  const rot = rotulosFaturas();
  const fat = num(c.faturas[estado.fatura]);
  el.innerHTML = `
    <div class="card-head">
      <div>
        <h2>Cartões</h2>
        <small class="muted">Fatura de ${MESES[(estado.mes + estado.fatura) % 12].toLowerCase()}</small>
        <div class="big-money">${money(fat)}</div>
        <button class="pill" data-editar-cartao="${c.id}">Editar fatura</button>
      </div>
      <div class="illus">💳</div>
    </div>
    <div class="card-nav">
      <button class="ghost round" data-cartao-nav="-1">‹</button>
      <button class="ghost round" data-cartao-nav="1">›</button>
    </div>
    <div class="card-carousel">
      ${dados.cartoes.map((x) => cartaoHTML(x, `transform:translateX(calc(${-estado.cartao} * (100% + 10px)))`)).join('')}
    </div>
    <h3 class="caps">Próximas faturas</h3>
    <div class="faturas" id="faturas"></div>`;
  renderFaturas(c, rot);
}

function renderFaturas(c, rot) {
  const vals = [0, 1, 2].map((i) => num(c.faturas[i]));
  const max = Math.max(...vals), min = Math.min(...vals);
  const y = (v) => 40 - ((v - min) / ((max - min) || 1)) * 30;
  const pts = vals.map((v, i) => [((i + 0.5) / 3) * 300, y(v)]);
  const svg = `
    <svg class="fat-line" viewBox="0 0 300 50" preserveAspectRatio="none">
      <polyline points="${pts.map((p) => p.join(',')).join(' ')} 300,${pts[2][1] - 2}" fill="none" stroke="#9aa1ad" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    </svg>`;
  const pontos = pts.map((p, i) => `<span style="position:absolute;left:calc(${p[0] / 3}% - 4px);top:${30 + p[1] - 4}px;width:9px;height:9px;border-radius:50%;background:var(--surface);border:1.5px solid ${i === estado.fatura ? 'var(--blue)' : '#9aa1ad'};z-index:2"></span>`).join('');
  $('faturas').innerHTML = svg + pontos + vals.map((v, i) => `
    <div class="fat ${i === estado.fatura ? 'on' : ''}" data-f="${i}">
      <b>${rot[i]}</b>${i === 0 ? '<span class="tagb">Aberta</span>' : ''}
      <span class="v">R$ ${fmt(v)}</span>
    </div>`).join('');
}

function renderMoradia(lista) {
  const p = dados.perfil;
  // toda conta marcada como moradia entra; a da casa conta só a sua metade
  const itens = lista.filter((o) => o.d.moradia);
  const moradia = itens.reduce((s, o) => s + parte(o), 0);
  const base = estado.base === 'meu' ? num(p.salario) : num(p.salario) + num(p.salarioParceiro);
  const pm = pct(moradia, base);
  const bom = pm <= 30;
  $('moradiaValor').innerHTML = money(moradia);
  $('moradiaPct').innerHTML = base
    ? `${bom ? '✓' : '⚠'} <b>${Math.round(pm)}% do salário</b> <span class="muted">referência: até 30%</span>`
    : '<span class="muted">Cadastre o salário para ver a porcentagem</span>';
  $('moradiaPct').style.color = bom ? 'var(--green)' : 'var(--orange)';
  $('gaugeFill').style.width = `${Math.min((pm / 60) * 100, 100)}%`;
  $('gaugeFill').style.background = bom ? 'var(--green)' : 'var(--orange)';
  document.querySelectorAll('#moradiaToggle button').forEach((b) => b.classList.toggle('on', b.dataset.base === estado.base));
  $('moradiaItens').innerHTML = itens.length
    ? itens.map((o) => `<div class="mi"><span class="ico">${icone(o.d.nome)}</span><div><small>${esc(o.d.nome)}</small><b>R$ ${fmt(parte(o))}</b></div></div>`).join('')
    : '<small class="muted" style="grid-column:1/-1">Marque “Entra no custo de moradia” nas despesas (aluguel, condomínio, luz…).</small>';
}

function renderProximos() {
  const lista = proximos();
  $('proxSub').textContent = lista.length ? `${lista.length} em aberto · R$ ${fmt(somaO(lista))}` : 'tudo em dia';
  $('proxList').innerHTML = lista.length
    ? lista.slice(0, casal() ? 8 : 5).map((o) => `
      <div class="prox ${o.s}">
        <div class="linha"><b>${esc(o.d.nome)}</b><small class="muted">${dataBR(o.data)}</small></div>
        <span class="valor">R$ ${fmt(o.d.valor)}</span>
        <div class="linha"><small class="mini ${o.s}" style="margin:0">${quando(o.dias)}</small>
          <button class="outline" data-pagar="${o.d.id}|${o.chave}">Paguei</button></div>
      </div>`).join('')
    : '<div class="prox-vazio">Nenhuma conta em aberto nos próximos 45 dias.</div>';
}

// ---------- tela de despesas ----------
function renderDespesas() {
  document.querySelectorAll('#filtros button').forEach((b) => b.classList.toggle('on', b.dataset.filtro === estado.filtro));
  let lista = dados.despesas.map((d) => ({ d, o: ocorrencia(d, estado.ano, estado.mes) }));
  if (estado.filtro === 'casa') lista = lista.filter((x) => x.d.tipo === 'casa');
  if (estado.filtro === 'pessoal') lista = lista.filter((x) => x.d.tipo !== 'casa');
  if (estado.filtro === 'abertas') lista = lista.filter((x) => x.o && !x.o.paga);
  lista.sort((a, b) => (a.o ? a.o.data.getDate() : 99) - (b.o ? b.o.data.getDate() : 99) || a.d.nome.localeCompare(b.d.nome));

  const doMesAtual = doMes(estado.ano, estado.mes);
  $('despSub').textContent = `${dados.despesas.length} cadastrada(s) · ${MESES[estado.mes]}: R$ ${fmt(somaO(doMesAtual))} no total, R$ ${fmt(somaO(doMesAtual.filter((o) => !o.paga)))} em aberto`;

  if (!lista.length) {
    $('despTabela').innerHTML = `<tr><td class="vazio">${dados.despesas.length ? 'Nada com esse filtro.' : 'Você ainda não cadastrou nenhuma despesa.'}
      <button class="primary rounded" data-acao="nova-despesa">+ Nova despesa</button></td></tr>`;
    return;
  }

  const repete = (d) => d.recorrencia === 'unica' ? 'Só uma vez' : d.recorrencia === 'parcelada' ? `${d.parcelas}x` : 'Todo mês';
  const venc = (d) => {
    const [y, m, dd] = d.vencimento.split('-');
    return d.recorrencia === 'unica' ? `${dd}/${m}/${y}` : `Dia ${+dd}<small>desde ${m}/${y}</small>`;
  };
  const statusHTML = (x) => {
    if (!x.o) return '<span class="status st-nada">não cai neste mês</span>';
    const s = situacao(x.o);
    const txt = { paga: '✓ Paga', aberta: 'Em aberto', perto: quando(diasAte(x.o.data)), vencida: 'Vencida' }[s];
    return `<span class="status st-${s}" data-pagar="${x.d.id}|${x.o.chave}" title="Clique para marcar como ${x.o.paga ? 'não paga' : 'paga'}">${txt}</span>`;
  };

  $('despTabela').innerHTML = `
    <thead><tr><th>Despesa</th><th>Vencimento</th><th>Repete</th><th>${casal() ? 'De quem' : 'Categoria'}</th><th class="num">Valor</th><th>${MESES[estado.mes]}</th><th></th></tr></thead>
    <tbody>${lista.map((x) => `
      <tr>
        <td><b>${esc(x.d.nome)}</b>${x.o?.parcela ? `<small>parcela ${x.o.parcela}</small>` : ''}</td>
        <td>${venc(x.d)}</td>
        <td>${repete(x.d)}</td>
        <td>${!casal()
          ? (x.d.moradia ? `${icone(x.d.nome)} Moradia` : '<span class="muted">—</span>')
          : x.d.tipo === 'casa'
          ? `<i class="dot dot-${x.d.quem === 'ela' ? 'pink' : 'blue'}" style="margin-left:0"></i>Casa · paga ${esc(x.d.quem === 'ela' ? nomeEla() : 'você')}${x.d.moradia ? '<small>entra na moradia</small>' : ''}`
          : `<i class="dot dot-navy" style="margin-left:0"></i>Só minha${x.d.moradia ? '<small>entra na moradia</small>' : ''}`}</td>
        <td class="num">R$ ${fmt(x.d.valor)}</td>
        <td>${statusHTML(x)}</td>
        <td class="acoes">
          <button data-editar="${x.d.id}" title="Editar">✎</button>
          <button data-excluir="${x.d.id}" title="Excluir">🗑</button>
        </td>
      </tr>`).join('')}</tbody>`;
}

// ---------- tela de cartões ----------
function renderCartoes() {
  if (!dados.cartoes.length) {
    $('cartoesLista').innerHTML = `<div class="cartoes-vazio" style="grid-column:1/-1">Nenhum cartão cadastrado ainda.
      <button class="primary rounded" data-acao="novo-cartao">+ Novo cartão</button></div>`;
    return;
  }
  const rot = rotulosFaturas();
  $('cartoesLista').innerHTML = dados.cartoes.map((c) => `
    <div class="cartao-item">
      ${cartaoHTML(c)}
      <div class="info">
        <small class="muted">${rot.map((r, i) => `${r}: <b>R$ ${fmt(c.faturas[i])}</b>`).join(' · ')}</small>
        <div class="acoes">
          <button class="outline" data-editar-cartao="${c.id}">Editar</button>
          <button class="outline" data-excluir-cartao="${c.id}">Excluir</button>
        </div>
      </div>
    </div>`).join('');
}

// ---------- tela de renda ----------
function renderRenda() {
  const f = $('rendaForm');
  const p = dados.perfil;
  if (document.activeElement?.form !== f) {
    previaModo(p.modo);
    f.nome.value = p.nome;
    f.parceiro.value = p.parceiro;
    f.salario.value = p.salario || '';
    f.salarioParceiro.value = p.salarioParceiro || '';
    f.diaADia.value = p.diaADia || '';
    f.diasAviso.value = String(p.diasAviso || 3);
  }
  $('contaUsuario').textContent = usuario;
  $('senhaUser').value = usuario;
  const perm = 'Notification' in window ? Notification.permission : 'indisponivel';
  $('notifStatus').innerHTML = {
    granted: '<span class="ok-msg">🔔 Avisos ligados neste navegador.</span>',
    denied: '<span class="erro">Os avisos foram bloqueados. Libere nas permissões do site (ícone ao lado do endereço).</span>',
    default: '<span class="muted">Avisos ainda não ativados.</span>',
    indisponivel: '<span class="muted">Este navegador não suporta avisos.</span>',
  }[perm];
  $('notifBtn').classList.toggle('hidden', perm !== 'default');
}

// mostra/esconde os campos do parceiro enquanto escolhe (só vale depois de Salvar)
function previaModo(modo) {
  const f = $('rendaForm');
  f.modo.value = modo;
  f.classList.toggle('solo', modo !== 'casal');
  marcarModo($('rendaModo'), modo);
  $('rendaTitulo').textContent = modo === 'casal' ? 'Nossa renda' : 'Sua renda';
}
$('rendaModo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-conta]');
  if (b) previaModo(b.dataset.conta);
});

$('rendaForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const mudouModo = f.modo.value !== dados.perfil.modo;
  Object.assign(dados.perfil, {
    modo: f.modo.value === 'casal' ? 'casal' : 'individual',
    nome: f.nome.value.trim(),
    parceiro: f.parceiro.value.trim(),
    salario: num(f.salario.value),
    salarioParceiro: num(f.salarioParceiro.value),
    diaADia: num(f.diaADia.value),
    diasAviso: num(f.diasAviso.value) || 3,
  });
  salvar();
  document.activeElement.blur();
  render();
  $('rendaOk').textContent = '✓ Salvo';
  if (mudouModo) toast(casal() ? 'Agora sua conta é em casal' : 'Agora sua conta é individual');
  setTimeout(() => ($('rendaOk').textContent = ''), 2000);
});

$('senhaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('senhaErro').textContent = '';
  try {
    await api('/api/senha', { method: 'POST', body: JSON.stringify({ atual: f.atual.value, nova: f.nova.value }) });
    f.reset();
    $('senhaOk').textContent = '✓ Senha trocada';
    setTimeout(() => ($('senhaOk').textContent = ''), 2500);
  } catch (err) {
    $('senhaErro').textContent = err.message;
  }
});

// ================== MODAL ==================
function abrirModal(titulo, html, aoSalvar, aoMudar) {
  $('modalTitulo').textContent = titulo;
  const f = $('modalForm');
  f.innerHTML = html + `
    <div class="form-foot">
      <button type="button" class="outline" data-fechar>Cancelar</button>
      <button class="primary rounded">Salvar</button>
    </div>`;
  f.onsubmit = (e) => { e.preventDefault(); if (aoSalvar(f) !== false) { fecharModal(); salvar(); render(); } };
  f.oninput = aoMudar ? () => aoMudar(f) : null;
  if (aoMudar) aoMudar(f);
  $('modal').classList.remove('hidden');
  f.querySelector('input,select')?.focus();
}
function fecharModal() { $('modal').classList.add('hidden'); }

// Atalhos do formulário de nova despesa. "casa" = no modo casal já marca como conta da casa.
const COMUNS = [
  { nome: 'Aluguel',          ico: '🔑', moradia: true, casa: true },
  { nome: 'Condomínio',       ico: '🏬', moradia: true, casa: true },
  { nome: 'Luz',              ico: '⚡', moradia: true, casa: true },
  { nome: 'Água',             ico: '💧', moradia: true, casa: true },
  { nome: 'Gás',              ico: '🔥', moradia: true, casa: true },
  { nome: 'Internet',         ico: '📶', moradia: true, casa: true },
  { nome: 'Financiamento',    ico: '🏢', moradia: true, casa: true },
  { nome: 'IPTU',             ico: '🧾', moradia: true, casa: true, recorrencia: 'parcelada', parcelas: 10 },
  { nome: 'Fatura do cartão', ico: '💳' },
  { nome: 'Celular',          ico: '📱' },
  { nome: 'Plano de saúde',   ico: '🩺' },
  { nome: 'Academia',         ico: '🏋️' },
  { nome: 'Streaming',        ico: '📺' },
  { nome: 'Escola/Faculdade', ico: '🎓' },
  { nome: 'Seguro do carro',  ico: '🛡️' },
  { nome: 'IPVA',             ico: '🚗', recorrencia: 'parcelada', parcelas: 3 },
  { nome: 'Empréstimo',       ico: '💰', recorrencia: 'parcelada', parcelas: 12 },
];

function comunsHTML() {
  let oculto = false;
  try { oculto = localStorage.getItem('emdia-comuns-oculto') === '1'; } catch {}
  const jaTem = new Set(dados.despesas.map((x) => x.nome.toLowerCase()));
  return `
    <div class="comuns">
      <div class="comuns-head">
        <span class="lbl-form">⚡ Despesas comuns</span>
        <button type="button" class="link" data-toggle-comuns>${oculto ? 'mostrar' : 'ocultar'}</button>
      </div>
      <div class="comuns-corpo ${oculto ? 'hidden' : ''}">
        <div class="chips">
          ${COMUNS.map((c, i) => {
            const ja = jaTem.has(c.nome.toLowerCase());
            return `<button type="button" class="pick ${ja ? 'ja' : ''}" data-comum="${i}" title="${ja ? 'Você já tem uma despesa com esse nome' : ''}">${c.ico} ${esc(c.nome)}${ja ? ' ✓' : ''}</button>`;
          }).join('')}
        </div>
        <small class="muted">Toque numa para preencher, ou escreva qualquer outra no campo Nome.</small>
      </div>
    </div>`;
}

// liga os botões de despesa comum no formulário aberto
function ligarComuns(f) {
  const box = f.querySelector('.comuns');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const tog = e.target.closest('[data-toggle-comuns]');
    if (tog) {
      const corpo = box.querySelector('.comuns-corpo');
      const ocultar = !corpo.classList.contains('hidden');
      corpo.classList.toggle('hidden', ocultar);
      tog.textContent = ocultar ? 'mostrar' : 'ocultar';
      try { localStorage.setItem('emdia-comuns-oculto', ocultar ? '1' : '0'); } catch {}
      return;
    }
    const b = e.target.closest('[data-comum]');
    if (!b) return;
    const c = COMUNS[+b.dataset.comum];
    box.querySelectorAll('.pick').forEach((x) => x.classList.toggle('on', x === b));
    f.nome.value = c.nome;
    f.recorrencia.value = c.recorrencia || 'mensal';
    if (c.parcelas) f.parcelas.value = c.parcelas;
    f.moradia.checked = !!c.moradia;
    if (f.tipo) f.tipo.value = c.casa ? 'casa' : 'pessoal';
    f.dispatchEvent(new Event('input'));
    f.valor.focus();
  });
  // se a pessoa editar o nome à mão, tira o destaque do botão
  f.nome.addEventListener('input', () => box.querySelectorAll('.pick.on').forEach((x) => x.classList.remove('on')));
}

function formDespesa(d) {
  const v = d || {
    nome: '', valor: '', vencimento: isoData(new Date(estado.ano, estado.mes, Math.min(new Date().getDate(), 28))),
    recorrencia: 'mensal', parcelas: 2, tipo: 'pessoal', quem: 'eu', moradia: false,
  };
  const opt = (val, txt, atual) => `<option value="${val}" ${val === atual ? 'selected' : ''}>${esc(txt)}</option>`;
  abrirModal(d ? 'Editar despesa' : 'Nova despesa', `
    ${d ? '' : comunsHTML()}
    <label>Nome<input name="nome" required maxlength="60" value="${esc(v.nome)}" placeholder="Ex.: Aluguel, Luz, Fatura do cartão"></label>
    <div class="row2">
      <label>Valor (R$)<input name="valor" type="number" step="0.01" min="0" required value="${v.valor}" placeholder="0,00"></label>
      <label><span id="lblVenc">Vencimento</span><input name="vencimento" type="date" required value="${esc(v.vencimento)}"></label>
    </div>
    <label>Repete
      <select name="recorrencia">
        ${opt('mensal', 'Todo mês, no mesmo dia', v.recorrencia)}
        ${opt('parcelada', 'Parcelada (um número de meses)', v.recorrencia)}
        ${opt('unica', 'Só uma vez', v.recorrencia)}
      </select>
    </label>
    <label data-se-rec="parcelada">Quantas parcelas<input name="parcelas" type="number" min="2" max="360" value="${num(v.parcelas) || 2}"></label>
    ${casal() ? `
    <label>De quem é
      <select name="tipo">
        ${opt('pessoal', 'Só minha', v.tipo)}
        ${opt('casa', `Da casa (dividida com ${nomeEla()})`, v.tipo)}
      </select>
    </label>
    <label data-se-tipo="casa">Quem paga
      <select name="quem">${opt('eu', nomeEu() + ' (você)', v.quem)}${opt('ela', nomeEla(), v.quem)}</select>
    </label>` : ''}
    <label class="check"><input type="checkbox" name="moradia" ${v.moradia ? 'checked' : ''}> Entra no custo de moradia (aluguel, condomínio, luz…)</label>
  `, (f) => {
    // no modo individual o formulário não pergunta "de quem é": mantém o que já estava
    const tipo = casal() ? f.tipo.value : (d?.tipo || 'pessoal');
    const quem = casal() ? (tipo === 'casa' ? f.quem.value : 'eu') : (d?.quem || 'eu');
    const novo = {
      nome: f.nome.value.trim(),
      valor: num(f.valor.value),
      vencimento: f.vencimento.value,
      recorrencia: f.recorrencia.value,
      parcelas: f.recorrencia.value === 'parcelada' ? Math.max(2, Math.round(num(f.parcelas.value))) : undefined,
      tipo,
      quem,
      moradia: f.moradia.checked,
    };
    if (!novo.nome || !novo.vencimento) return false;
    if (d) Object.assign(d, novo);
    else dados.despesas.push({ id: uid(), pagas: [], ...novo });
    toast(d ? 'Despesa atualizada' : 'Despesa cadastrada');
  }, (f) => {
    f.querySelectorAll('[data-se-rec]').forEach((el) => el.classList.toggle('hidden', f.recorrencia.value !== el.dataset.seRec));
    if (f.tipo) f.querySelectorAll('[data-se-tipo]').forEach((el) => el.classList.toggle('hidden', f.tipo.value !== el.dataset.seTipo));
    $('lblVenc').textContent = f.recorrencia.value === 'unica' ? 'Vencimento' : '1º vencimento';
  });
  ligarComuns($('modalForm'));
}

function formCartao(c) {
  const v = c || { banco: '', nome: '', cor: 'auto', bandeira: '', final: '', diaVencimento: 10, limite: '', faturas: ['', '', ''] };
  const rot = rotulosFaturas();
  const atalhos = ['Nubank', 'Itaú', 'Bradesco', 'Santander', 'Banco do Brasil', 'Caixa', 'Inter', 'C6 Bank', 'Mercado Pago', 'PicPay'];
  const optCor = [['auto', 'Automática (cor do banco)'], ...Object.entries(CORES).map(([k, x]) => [k, x.nome])]
    .map(([k, t]) => `<option value="${k}" ${k === (v.cor || 'auto') ? 'selected' : ''}>${t}</option>`).join('');
  const optBand = Object.entries(BANDEIRAS).map(([k, t]) => `<option value="${k}" ${k === (v.bandeira || '') ? 'selected' : ''}>${t}</option>`).join('');
  abrirModal(c ? 'Editar cartão' : 'Novo cartão', `
    <div class="cc-preview" id="ccPreview"></div>
    <div class="comuns">
      <span class="lbl-form">🖼️ Imagem oficial do cartão <small class="muted">(opcional)</small></span>
      <div class="img-acoes">
        <button type="button" class="outline" data-escolher-imagem>Escolher imagem…</button>
        <button type="button" class="link hidden" data-remover-imagem>Remover imagem</button>
        <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-arquivo-imagem>
      </div>
      <small class="muted">Salve a imagem do seu cartão no site ou app do banco e escolha aqui. <b>Não use foto do cartão de verdade</b>: ela mostra o número completo. Sem imagem, o cartão é desenhado com a cor do banco.</small>
      <p class="erro" id="imgErro"></p>
    </div>
    <div class="comuns">
      <span class="lbl-form">🏦 Escolha o banco</span>
      <div class="chips">${atalhos.map((b) => `<button type="button" class="pick" data-banco="${esc(b)}">${esc(b)}</button>`).join('')}</div>
      <small class="muted">Não achou? Escreva o nome do banco no campo abaixo.</small>
    </div>
    <div class="row2">
      <label>Banco<input name="banco" required maxlength="20" value="${esc(v.banco)}" placeholder="Ex.: Nubank"></label>
      <label>Nome do cartão<input name="nome" maxlength="20" value="${esc(v.nome)}" placeholder="Ex.: Platinum"></label>
    </div>
    <div class="row2">
      <label>Bandeira<select name="bandeira">${optBand}</select></label>
      <label>4 últimos números <small class="muted">(opcional)</small><input name="final" inputmode="numeric" maxlength="4" pattern="\\d{4}" value="${esc(v.final || '')}" placeholder="1234"></label>
    </div>
    <div class="row2">
      <label>Cor<select name="cor">${optCor}</select></label>
      <label>Dia de vencimento<input name="diaVencimento" type="number" min="1" max="31" required value="${num(v.diaVencimento) || 10}"></label>
    </div>
    <label>Limite livre (R$)<input name="limite" type="number" step="0.01" min="0" value="${v.limite}"></label>
    <div class="row2">
      <label>Fatura ${rot[0]} (R$)<input name="f0" type="number" step="0.01" min="0" value="${v.faturas[0] ?? ''}"></label>
      <label>Fatura ${rot[1]} (R$)<input name="f1" type="number" step="0.01" min="0" value="${v.faturas[1] ?? ''}"></label>
    </div>
    <label>Fatura ${rot[2]} (R$)<input name="f2" type="number" step="0.01" min="0" value="${v.faturas[2] ?? ''}"></label>
    <small class="muted">Dica: para ser avisado do vencimento da fatura, cadastre também uma despesa “Fatura ${esc(v.banco || 'do cartão')}” todo mês.</small>
  `, (f) => {
    const novo = lerCartao(f);
    if (c) Object.assign(c, novo);
    else { dados.cartoes.push({ id: uid(), ...novo }); estado.cartao = dados.cartoes.length - 1; }
    toast(c ? 'Cartão atualizado' : 'Cartão cadastrado');
  }, (f) => {
    // prévia ao vivo enquanto preenche
    $('ccPreview').innerHTML = cartaoHTML(lerCartao(f));
    f.querySelector('[data-remover-imagem]').classList.toggle('hidden', !f._imagem);
    f.querySelector('[data-escolher-imagem]').textContent = f._imagem ? 'Trocar imagem…' : 'Escolher imagem…';
    const b = bancoDe(f.banco.value);
    f.querySelectorAll('[data-banco]').forEach((x) => x.classList.toggle('on', !!b && bancoDe(x.dataset.banco) === b));
  });
  const f = $('modalForm');
  f._imagem = imagemValida(v.imagem);
  f.dispatchEvent(new Event('input'));
  const arquivo = f.querySelector('[data-arquivo-imagem]');
  f.querySelector('[data-escolher-imagem]').addEventListener('click', () => arquivo.click());
  f.querySelector('[data-remover-imagem]').addEventListener('click', () => { f._imagem = ''; f.dispatchEvent(new Event('input')); });
  arquivo.addEventListener('change', async () => {
    const a = arquivo.files[0];
    arquivo.value = '';
    if (!a) return;
    $('imgErro').textContent = '';
    try {
      f._imagem = await prepararImagem(a);
      f.dispatchEvent(new Event('input'));
    } catch (e) {
      $('imgErro').textContent = e.message;
    }
  });
  f.querySelectorAll('.chips')[0].addEventListener('click', (e) => {
    const b = e.target.closest('[data-banco]');
    if (!b) return;
    f.banco.value = b.dataset.banco;
    f.dispatchEvent(new Event('input'));
    f.nome.focus();
  });
}

function lerCartao(f) {
  return {
    banco: f.banco.value.trim(), nome: f.nome.value.trim(), cor: f.cor.value,
    bandeira: f.bandeira.value,
    final: f.final.value.replace(/\D/g, '').slice(-4),
    imagem: f._imagem || '',
    diaVencimento: Math.min(31, Math.max(1, Math.round(num(f.diaVencimento.value)) || 1)),
    limite: num(f.limite.value),
    faturas: [num(f.f0.value), num(f.f1.value), num(f.f2.value)],
  };
}

// ================== AVISOS NO APARELHO ==================
// Mostra uma notificação do sistema para cada conta que ainda não foi avisada hoje.
function avisarWindows() {
  if (!usuario || !('Notification' in window) || Notification.permission !== 'granted') return;
  const lista = alertas();
  if (!lista.length) return;
  const chave = `duofinn-avisos-${usuario}-${isoData(new Date())}`;
  let ja = [];
  try { ja = JSON.parse(localStorage.getItem(chave) || '[]'); } catch {}
  const novos = lista.filter((o) => !ja.includes(o.d.id + o.chave));
  if (!novos.length) return;
  const corpo = novos.slice(0, 4).map((o) => `${o.d.nome} · R$ ${fmt(o.d.valor)} · ${quando(o.dias)}`).join('\n') +
    (novos.length > 4 ? `\n+ ${novos.length - 4} outras` : '');
  const titulo = novos.length === 1 ? 'Em Dia · conta perto de vencer' : `Em Dia · ${novos.length} contas perto de vencer`;
  const opcoes = { body: corpo, tag: 'duofinn', icon: '/icones/icone-192.png', badge: '/icones/icone-192.png' };
  mostrarNotificacao(titulo, opcoes);
  try { localStorage.setItem(chave, JSON.stringify([...ja, ...novos.map((o) => o.d.id + o.chave)])); } catch {}
}

// No celular (Android) a notificação precisa sair pelo service worker; no PC qualquer jeito serve.
async function mostrarNotificacao(titulo, opcoes) {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) return await reg.showNotification(titulo, opcoes);
  } catch {}
  try {
    const n = new Notification(titulo, opcoes);
    n.onclick = () => { window.focus(); $('bellPop').classList.remove('hidden'); };
  } catch {}
}

async function ativarAvisos() {
  if (!('Notification' in window)) return toast('Este navegador não suporta avisos');
  const r = await Notification.requestPermission();
  if (r === 'granted') { toast('Avisos ativados'); avisarWindows(); }
  render();
}

// confere de novo a cada 30 min (e quando a aba volta a ficar visível)
setInterval(() => { if (usuario) { render(); avisarWindows(); } }, 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && usuario) { render(); avisarWindows(); } });

// ================== EVENTOS ==================
document.addEventListener('click', (e) => {
  // fecha popovers ao clicar fora
  if (!e.target.closest('.pop-wrap')) { $('bellPop').classList.add('hidden'); $('addPop').classList.add('hidden'); }
  if (e.target === $('modal') || e.target.closest('[data-fechar]')) return fecharModal();

  const t = e.target.closest('[data-view],[data-acao],[data-dia],[data-pagar],[data-trocar],[data-more],[data-f],[data-base],[data-theme-btn],[data-editar],[data-excluir],[data-editar-cartao],[data-excluir-cartao],[data-cartao-nav],[data-filtro]');
  if (!t || !usuario) return;
  const ds = t.dataset;
  if (t.tagName === 'A') e.preventDefault();

  if (ds.view) { estado.view = ds.view; window.scrollTo(0, 0); }
  else if (ds.acao) {
    const a = ds.acao;
    if (a !== 'menu-add') $('addPop').classList.add('hidden');
    if (a === 'nova-despesa') return formDespesa();
    if (a === 'novo-cartao') return formCartao();
    if (a === 'sair') return sair();
    if (a === 'ativar-avisos') return ativarAvisos();
    if (a === 'menu-add') { $('addPop').classList.toggle('hidden'); return; }
    if (a === 'sino') { $('bellPop').classList.toggle('hidden'); e.stopPropagation(); return; }
    if (a === 'acerto') {
      const k = mk(estado.ano, estado.mes);
      const i = dados.acertos.indexOf(k);
      if (i >= 0) dados.acertos.splice(i, 1); else dados.acertos.push(k);
      salvar();
    }
  }
  else if (ds.pagar) { const [id, chave] = ds.pagar.split('|'); return alternarPaga(id, chave); }
  else if (ds.dia) { estado.dia = +ds.dia; estado.verTodas = false; }
  else if (ds.more) estado.verTodas = !estado.verTodas;
  else if (ds.trocar) {
    const d = dados.despesas.find((x) => x.id === ds.trocar);
    if (d) { d.quem = d.quem === 'ela' ? 'eu' : 'ela'; dados.acertos = dados.acertos.filter((k) => k !== mk(estado.ano, estado.mes)); salvar(); }
  }
  else if (ds.f) estado.fatura = +ds.f;
  else if (ds.base) estado.base = ds.base;
  else if (ds.themeBtn) return setTheme(ds.themeBtn);
  else if (ds.filtro) estado.filtro = ds.filtro;
  else if (ds.editar) return formDespesa(dados.despesas.find((x) => x.id === ds.editar));
  else if (ds.excluir) {
    const d = dados.despesas.find((x) => x.id === ds.excluir);
    if (!d || !confirm(`Excluir a despesa “${d.nome}”? Isso apaga também o histórico de pagamentos dela.`)) return;
    dados.despesas = dados.despesas.filter((x) => x.id !== d.id);
    salvar(); toast('Despesa excluída');
  }
  else if (ds.editarCartao) return formCartao(dados.cartoes.find((x) => x.id === ds.editarCartao));
  else if (ds.excluirCartao) {
    const c = dados.cartoes.find((x) => x.id === ds.excluirCartao);
    if (!c || !confirm(`Excluir o cartão ${c.banco} ${c.nome}?`)) return;
    dados.cartoes = dados.cartoes.filter((x) => x.id !== c.id);
    estado.cartao = 0; salvar(); toast('Cartão excluído');
  }
  else if (ds.cartaoNav) {
    estado.cartao = Math.min(dados.cartoes.length - 1, Math.max(0, estado.cartao + +ds.cartaoNav));
    estado.fatura = 0;
  }
  render();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharModal(); $('bellPop').classList.add('hidden'); $('addPop').classList.add('hidden'); } });

function mudarMes(delta) {
  const d = new Date(estado.ano, estado.mes + delta, 1);
  estado.ano = d.getFullYear(); estado.mes = d.getMonth();
  estado.dia = null; estado.verTodas = false; estado.fatura = 0;
  render();
}
$('prevMonth').onclick = () => mudarMes(-1);
$('nextMonth').onclick = () => mudarMes(1);
$('hojeBtn').onclick = () => { const h = new Date(); estado.ano = h.getFullYear(); estado.mes = h.getMonth(); estado.dia = null; render(); };

// ================== TEMA ==================
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-theme-btn]').forEach((b) => b.classList.toggle('on', b.dataset.themeBtn === t));
  try { localStorage.setItem('duofinn-tema', t); } catch {}
}
let temaSalvo = 'light';
try { temaSalvo = localStorage.getItem('duofinn-tema') || 'light'; } catch {}
setTheme(temaSalvo);

// ================== INÍCIO ==================
// service worker: deixa instalar como app no celular e entrega as notificações
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

(async () => {
  try {
    pedeConvite = !!(await api('/api/config')).convite;
  } catch {}
  try {
    const eu = await api('/api/eu');
    await entrouComo(eu.usuario);
  } catch {
    mostrarLogin();
  }
})();
