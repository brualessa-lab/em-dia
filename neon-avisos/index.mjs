// Função na Neon que chama o Em Dia toda manhã para ele mandar os avisos de vencimento.
// Quem dispara é o agendamento (Function Trigger) "avisos-manha", às 11:30 UTC (08:30 em Brasília).
// O site no plano grátis do Render dorme sem uso, então tenta algumas vezes enquanto ele acorda.
const SITE = 'https://em-dia-kei5.onrender.com/api/avisos/rodar';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  async fetch(request) {
    // a Neon remove cabeçalhos x-neon-* vindos de fora: se ele existe, quem chamou foi o agendamento
    const id = request.headers.get('x-neon-trigger-invocation-id');
    let corpo = {};
    try { corpo = await request.json(); } catch {}
    if (!id || corpo.invocation_id !== id) return new Response('não autorizado', { status: 401 });

    let ultimo = '';
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fetch(SITE, { method: 'POST', signal: AbortSignal.timeout(90e3) });
        ultimo = `${r.status} ${await r.text()}`;
        if (r.ok) { console.log('Em Dia respondeu:', ultimo); return new Response(ultimo); }
      } catch (e) { ultimo = String(e.message || e); }
      await espera(20e3);
    }
    console.error('Em Dia não respondeu:', ultimo);
    return new Response(ultimo, { status: 502 });
  },
};
