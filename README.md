# PowerBI / Dashboard Financeiro (Sienge)

Este repositório contém:

- `web/`: dashboard web estático (HTML/CSS/JS) com dados em `web/data/`.
- `scripts/`: scripts para baixar dados do Sienge, normalizar e gerar `web/data/dashboard_financeiro.json`.
- `dados_sienge/`: JSONs brutos/normalizados baixados da API.

## Rodar no localhost (com botão "Atualizar Sienge")

1) Configure as credenciais 1 vez (salva em variáveis de ambiente do Windows):

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\configure_sienge_env.ps1`

2) Suba o servidor local:

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\serve_web.ps1 -Port 8000`

Abra:

- http://localhost:8000/web/index.html

## Atualizar dados manualmente

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\download_sienge_financeiro_rest.ps1`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\normalize_dados_sienge.ps1`
- `node scripts\build_web_dashboard_data.js`

## Hospedar grátis (GitHub Pages) + atualizar Sienge automaticamente

Este repositório já inclui workflows do GitHub Actions para:

- Publicar o site estático (`web/`) no GitHub Pages.
- Atualizar os dados do Sienge diariamente e regenerar `web/data/dashboard_financeiro.json`.

### 1) Ativar GitHub Pages

No GitHub do repositório:

1. Settings → Pages
2. Em **Build and deployment**, selecione **GitHub Actions**

O deploy é feito pelo workflow em `.github/workflows/pages.yml`.

### 2) Configurar secrets do Sienge (Actions)

No GitHub do repositório:

1. Settings → Secrets and variables → Actions
2. Crie os **Repository secrets** abaixo (nomes exatos):

- `SIENGE_INSTANCE` (ex.: `dinamicaempreendimentos`)
- `SIENGE_ACCESS_NAME` (ex.: `dinamicaempreendimentos-jrmorais`)
- `SIENGE_TOKEN` (token da API)

O update automático usa o workflow `.github/workflows/atualizar-sienge.yml`.

### 3) Agendamento (11:59 BRT)

O GitHub Actions usa UTC no `cron`.

- 11:59 BRT (UTC-3) = 14:59 UTC

Observação: a execução agendada pode atrasar alguns minutos; isso é normal.

### 4) Rodar a atualização agora (manual)

GitHub → Actions → workflow **Atualizar Sienge (diário)** → **Run workflow**.

### Importante (dados sensíveis)

Se o repositório estiver público, os arquivos publicados no Pages também ficam públicos (incluindo `web/data/`).
Para testes, prefira um repositório privado ou dados anonimizados.
