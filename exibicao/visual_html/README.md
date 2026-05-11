# Visual HTML (Power BI)

Este diretorio guarda artefatos de exibicao voltados ao Power BI.

## 4) Visual HTML executivo

- **Tipo de retorno**: string HTML (DAX Measure)
- **Objetivo**: visual executivo moderno, limpo e responsivo, semelhante ao print de referencia.
- **Medida no modelo**: `HTML Executivo (dashboard)`
- **Filtro funcional**: funciona por contexto do Power BI. Use slicers/filtros da pagina para Empresa, Obra, Centro de custo, Conta, Fornecedor, Trimestre, Mes e Periodo.

### Como usar no Power BI

1. Garanta que voce tenha o visual **HTML Content** (custom visual) no relatorio.
2. A medida `HTML Executivo (dashboard)` ja foi atualizada no modelo. Se precisar recriar, cole o conteudo de `4_visual_executivo_html.dax` na tabela `medidas_db`.
3. Arraste a medida `HTML Executivo (dashboard)` para o campo **Values** do visual.

### Observacoes importantes

- O visual **HTML Content** costuma nao executar JavaScript e pode limitar algumas tags/CSS. Por isso, este HTML usa CSS inline e estrutura simples.
- O arquivo `FC_Maio_Modelo.xlsx` nao e fonte de dados deste visual; ele foi usado somente como referencia de estrutura/layout.
- Se o visual estiver em fundo claro, ajuste as variaveis de cor no inicio da medida DAX.
