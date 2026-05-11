# 4- Visual HTML

Este diretório contém **páginas HTML completas** (para abrir no navegador) e as **medidas DAX** que retornam *string HTML* (para usar no visual **HTML Content** do Power BI).

## Estrutura

- `pages/` → HTML completo (multi-páginas) no estilo do dashboard
- `dax/` → medidas DAX (cada uma retorna uma página/"tela" em HTML)

## Como usar no Power BI (visual HTML)

1. No Power BI, insira o visual **HTML Content**.
2. Crie uma medida copiando o conteúdo de um arquivo em `dax/`.
3. Arraste a medida para **Values** do visual.
4. Para ter "mais de uma página" no relatório, crie **páginas do Power BI** diferentes e use **uma medida HTML diferente** em cada página.

### Página "Previsão" (3 inputs)

- Medida HTML: `HTML Executivo (Previsão)` (arquivo `dax/4_visual_html_previsao.dax`)
- Inputs (via slicers):
  - `param_previsao_1[Valor]`
  - `param_previsao_2[Valor]`
  - `param_previsao_3[Valor]`
- Medidas de apoio (já no modelo): `Sistema CP (Maio)`, `Input Previsão 1/2/3`, `Previsão 1/2/3 (Maio)`

Observação: `Sistema CP (Maio)` mantém os filtros do relatório (Empresa/Obra/etc.) e substitui apenas o filtro de data para o mês de Maio.

## Como visualizar o HTML completo (fora do Power BI)

- Abra os arquivos em `pages/` no navegador.
- Se quiser servir com o servidor local do projeto: `powershell -ExecutionPolicy Bypass -File .\scripts\serve_web.ps1`
  - Depois acesse `http://localhost:<porta>/exibicao/4-%20visual%20HTML/pages/executivo.html`
