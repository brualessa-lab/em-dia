# Em Dia

Finanças pessoais ou em casal, com cadastro de despesas por vencimento e alertas.

## Rodar no PC

```
node server.js
```

Abra http://localhost:5173. Os dados ficam na pasta `dados/`, que nunca vai para o GitHub.

## Publicar na internet (grátis)

O site roda no **Render** e os dados ficam num banco Postgres do **Neon**.

### 1. Banco de dados (Neon)

1. Crie uma conta em https://neon.tech (pode entrar com o GitHub).
2. Crie um projeto. Na região, escolha a mais próxima do Brasil.
3. Copie a **connection string**. Ela começa com `postgresql://` e termina com `?sslmode=require`.
   Guarde com cuidado: quem tiver essa string acessa os dados.

### 2. Levar seus dados do PC para o banco (opcional)

No PowerShell, dentro de `D:\DuoFinn`:

```
$env:DATABASE_URL = "cole aqui a connection string"
node importar.js
```

As contas continuam com a mesma senha. Pode rodar de novo sem medo: conta que já existe no banco é pulada.

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

Depois, em **Ajustes → Avisos no aparelho**, toque em **Ativar avisos**.

## Atualizar o site

Cada `git push` para o GitHub faz o Render publicar a versão nova sozinho.

## Variáveis de ambiente

| Variável         | Para quê                                                        |
|------------------|-----------------------------------------------------------------|
| `DATABASE_URL`   | Banco Postgres. Sem ela, usa a pasta `dados/`.                  |
| `CODIGO_CONVITE` | Exige esse código para criar conta.                             |
| `SEGREDO`        | Chave do login. Opcional: sem ela, é gerada e guardada no banco. |
| `PORT`, `HOST`   | Porta e endereço. O Render define `PORT` sozinho.               |
