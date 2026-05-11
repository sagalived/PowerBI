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
