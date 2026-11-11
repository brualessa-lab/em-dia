# Em Dia

Finanças pessoais ou em casal, com cadastro de despesas por vencimento e alertas.

## Rodar no PC

```
node server.js
```

Abra http://localhost:5173. Os dados ficam na pasta `dados/`, que nunca vai para o GitHub.

Para rodar no PC usando o banco da Neon (os mesmos dados do site na internet):

```
node --env-file=.env.local server.js
```

## Publicar na internet (grátis)

O site roda no **Render** e os dados ficam num banco Postgres do **Neon**.

### 1. Banco de dados (Neon) — feito

O projeto `em-dia` já existe na Neon, na região `aws-us-east-1` (Virgínia). O site no Render roda em Oregon.
Esta pasta está ligada a ele pelo arquivo `.neon`, e a connection string fica em `.env.local`.
Os dois arquivos ficam só no PC (o git ignora).

Guarde a connection string com cuidado: quem tiver essa string acessa os dados.
Para ver de novo: abra `.env.local` e copie o valor de `DATABASE_URL`, ou rode `neon connection-string`.

### 2. Levar seus dados do PC para o banco — feito

Se criar contas novas no PC e quiser levá-las também, dentro de `D:\DuoFinn`:

```
node --env-file=.env.local importar.js
```

As contas continuam com a mesma senha. Conta que já existe no banco é pulada.

### 3. Site (Render)

1. Crie uma conta em https://render.com entrando com o GitHub.
2. **New → Blueprint** e escolha o repositório `em-dia`. O Render lê o arquivo `render.yaml`.
3. Preencha as duas variáveis:
   - `DATABASE_URL`: a connection string do Neon.
   - `CODIGO_CONVITE`: um código que você inventar. Só quem souber esse código consegue criar conta.
4. Clique em **Apply**. Em alguns minutos o site fica no ar num endereço como `https://em-dia.onrender.com`.

No plano grátis, o site "dorme" depois de 15 minutos sem uso. A primeira abertura depois disso demora cerca de 1 minuto.

### 4. No celular

- **Android (Chrome):** abra o endereço, menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
- **iPhone (Safari):** abra o endereço, botão Compartilhar → **Adicionar à Tela de Início**.

Depois, em **Ajustes → Avisos no aparelho**, toque em **Ativar avisos**. No iPhone, ative por dentro do app instalado (o Safari comum não recebe avisos com o app fechado).

## Avisos com o app fechado

Ao ativar os avisos, o aparelho se inscreve no serviço de notificações dele (Google, Apple, Mozilla ou Microsoft) e o Em Dia guarda essa inscrição na tabela `emdia_push`.

Toda manhã, às 8h30 de Brasília, o GitHub Actions (`.github/workflows/avisos.yml`) chama `POST /api/avisos/rodar`. O servidor confere as contas de cada pessoa e, se houver alguma vencida ou dentro da janela de aviso, manda uma notificação para os aparelhos dela. Cada aparelho recebe no máximo um aviso por dia, e nada sai entre 21h e 8h.

- Para rodar na hora: no GitHub, aba **Actions → Avisos de vencimento → Run workflow**.
- O botão **Enviar aviso de teste** (em Ajustes) confere se o aparelho está recebendo.
- As chaves VAPID são criadas sozinhas e guardadas no banco (`emdia_config`). Se forem apagadas, os aparelhos precisam ativar os avisos de novo.
- O GitHub pausa agendamentos de repositórios sem nenhum commit por 60 dias. Se os avisos pararem, reative em **Actions**.

## Atualizar o site

Cada `git push` para o GitHub faz o Render publicar a versão nova sozinho.

## Variáveis de ambiente

| Variável         | Para quê                                                        |
|------------------|-----------------------------------------------------------------|
| `DATABASE_URL`   | Banco Postgres. Sem ela, usa a pasta `dados/`.                  |
| `CODIGO_CONVITE` | Exige esse código para criar conta.                             |
| `SEGREDO`        | Chave do login. Opcional: sem ela, é gerada e guardada no banco. |
| `PORT`, `HOST`   | Porta e endereço. O Render define `PORT` sozinho.               |
| `AVISOS_CONTATO` | Contato enviado aos serviços de push. Opcional.                 |
