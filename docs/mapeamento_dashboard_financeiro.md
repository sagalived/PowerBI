# Mapeamento do Dashboard Financeiro Sienge

Data da analise: 2026-05-11

## Objetivo

Criar um dashboard financeiro completo em portugues, cobrindo:

- faturamento geral por obra e mes;
- fluxo de caixa sintetico e analitico;
- contas a receber;
- contas a pagar;
- previsoes e realizado;
- comprometido e a realizar;
- visao por empresa, obra, centro de custo e plano financeiro;
- inadimplencia, saldos e necessidade de captacao.

## Referencias analisadas

- Arquivo de exemplo: `C:\Users\dinam\Downloads\FC_Maio_Modelo.xlsx` (apenas referencia visual/estrutura, nao fonte de dados)
- Modelo Power BI aberto: `dinamicafinanceiro`
- Tabelas atuais carregadas no Power BI:
  - `receitas_db`: 1.351 linhas
  - `despesas_db`: 3.278 linhas
  - `movimentacoes_bancarias_db`: 8.108 linhas
- Documentacao oficial Sienge:
  - APIs REST: `https://api.sienge.com.br/docs/general-rest.html`
  - APIs Bulk Data: `https://api.sienge.com.br/docs/general-bulk.html`
  - Indice de APIs: `https://api.sienge.com.br/docs/`

## Padrao de nomes

Usar nomes em portugues, com sufixo `_db`:

- dimensoes: `empresas_db`, `obras_db`, `centros_custo_db`;
- fatos: `titulos_pagar_db`, `parcelas_pagar_db`, `titulos_receber_db`;
- apoio/ponte: `apropriacoes_pagar_db`, `plano_financeiro_db`.

## Tabelas ja carregadas

| Tabela | Origem Sienge | Uso no dashboard | Observacao |
| --- | --- | --- | --- |
| `receitas_db` | REST `/accounts-statements` filtrado para `type = Income` | Entradas realizadas, recebimentos e faturamento realizado | Inclui transferencias; deve haver medida para ignorar transferencias/saques quando o visual pedir caixa operacional. |
| `despesas_db` | REST `/bills` | Titulos a pagar por emissao, fornecedor, origem e status | Ainda precisa de parcelas e rateios para vencimento, pagamento, obra e centro de custo. |
| `movimentacoes_bancarias_db` | REST `/accounts-statements` | Fluxo de caixa realizado, entradas, saidas e saldo | Base principal para Fluxo de Caixa Analitico. |

## Tabelas financeiras recomendadas

### Dimensoes

| Tabela Power BI | Endpoint Sienge | Finalidade |
| --- | --- | --- |
| `empresas_db` | `/companies` | Filtro Empresa e grupo de empresa. |
| `obras_db` | `/enterprises` | Filtro Obra e agrupamentos como IFCE, Subestacao, Outros. |
| `centros_custo_db` | `/cost-centers` | Filtro Centro de custo e apropriacao por obra/departamento. |
| `plano_financeiro_db` | `/payment-categories` | Plano financeiro, DRE, natureza da conta, grupo e categoria. |
| `clientes_db` | `/customers` | Cliente em contas a receber. |
| `fornecedores_db` | `/creditors` | Fornecedor/credor em contas a pagar. |
| `contas_correntes_db` | `/checking-accounts` | Banco, conta, caixa e portador. |
| `portadores_receber_db` | `/bearers-receivable` | Portadores no contas a receber. |
| `indexadores_db` | `/indexers` | Correcoes por indexador, se usar valores corrigidos. |
| `calendario_db` | Gerada no Power BI | Eixo por dia, mes, trimestre, ano e periodo selecionado. |

### Fatos de caixa, receber e pagar

| Tabela Power BI | Endpoint Sienge | Finalidade |
| --- | --- | --- |
| `movimentacoes_bancarias_db` | `/accounts-statements` ou Bulk `/bank-movement` | Fluxo de caixa realizado; analitico com Data, Documento, Tit/Parc, Origem, Cliente/Fornecedor, Observacao, Entradas, Saidas e Saldo. |
| `titulos_receber_db` | `/accounts-receivable/receivable-bills` | Dashboard de contas a receber, titulos e previsao de recebimento. |
| `parcelas_receber_db` | `/accounts-receivable/receivable-bills/{id}/installments` | Vencimento, saldo em aberto, recebido, no prazo/vencido. |
| `apropriacoes_receber_db` | `/accounts-receivable/{id}/budget-categories` | Centro de custo/plano financeiro para recebimentos. |
| `titulos_pagar_db` | `/bills` | Titulos a pagar, documento, origem, fornecedor e status. |
| `parcelas_pagar_db` | `/bills/{id}/installments` | Vencimento, pagamento, saldo, comprometido, realizado e a realizar. |
| `apropriacoes_pagar_db` | `/bills/{id}/budget-categories` | Plano financeiro e centro de custo dos titulos a pagar. |
| `rateio_obras_pagar_db` | `/bills/{id}/buildings-cost` | Rateio por obra para custo/obra e faturamento por obra. |
| `rateio_departamentos_pagar_db` | `/bills/{id}/departments-cost` | Rateio por departamento/centro administrativo. |
| `impostos_pagar_db` | `/bills/{id}/taxes` | Indicador "considerar impostos retidos". |
| `saldos_contas_db` | `/accounts-balances` | Saldo bancario e saldo anterior. |
| `inadimplentes_receber_db` | Bulk `/defaulters-receivable-bills` | Titulos vencidos/inadimplentes. |
| `saldo_devedor_cliente_db` | `/current-debit-balance`, `/total-current-debit-balance` ou Bulk `/customer-debt-balance` | Perspectiva de recebimento por cliente/unidade. |
| `orcamento_empresarial_db` | Bulk `/business-budget` | Base para comparativo orcado x realizado, quando disponivel. |

## Verificacao dos endpoints com as credenciais atuais

Consulta leve em 2026-05-11:

| Tabela sugerida | Endpoint | Status | Total informado |
| --- | --- | --- | ---: |
| `empresas_db` | `/companies` | OK | 10 |
| `obras_db` | `/enterprises` | OK | 348 |
| `centros_custo_db` | `/cost-centers` | OK | 347 |
| `plano_financeiro_db` | `/payment-categories` | OK | 341 |
| `clientes_db` | `/customers` | OK | 134 |
| `fornecedores_db` | `/creditors` | OK | 3.412 |
| `contas_correntes_db` | `/checking-accounts` | OK | 113 |
| `saldos_contas_db` | `/accounts-balances?balanceDate=2026-05-11` | OK | 113 |
| `portadores_receber_db` | `/bearers-receivable` | OK | 5 |
| `titulos_receber_db` | `/accounts-receivable/receivable-bills` | OK | 1.497 |
| `titulos_pagar_db` | `/bills?startDate=2026-01-01&endDate=2026-05-11` | OK | 3.278 |
| `movimentacoes_bancarias_db` | `/accounts-statements?startDate=2026-01-01&endDate=2026-05-11` | OK | 8.108 |
| `indexadores_db` | `/indexers` | OK | 4 |

## Opcoes em portugues para o dashboard

### Menu lateral

- Visao geral
- Fluxo de caixa
- Fluxo analitico
- Faturamento por obra
- Contas a receber
- Contas a pagar
- Previsoes
- Inadimplencia
- Centros de custo
- Plano financeiro
- Saldos bancarios
- Relatorios

### Filtros principais

- Empresa
- Grupo de empresa
- Obra
- Centro de custo
- Plano financeiro
- Cliente
- Fornecedor
- Conta corrente
- Portador
- Periodo inicial
- Periodo final
- Selecao por data:
  - Emissao
  - Vencimento
  - Pagamento
  - Competencia
- Tipo de analise:
  - Realizado
  - Comprometido
  - A realizar
- Considerar documentos de previsao
- Incluir titulos inadimplentes
- Calcular saldo anterior
- Considerar impostos retidos
- Apresentar plano financeiro
- Incluir informacoes de cartao de credito

## Paginas recomendadas

### 1. Visao geral

KPIs:

- Saldo atual
- Entradas do periodo
- Saidas do periodo
- Saldo projetado
- A receber
- A pagar
- Vencido
- Necessidade de captacao

Graficos:

- fluxo mensal realizado x previsto;
- entradas x saidas por mes;
- saldo acumulado;
- top obras por faturamento;
- top centros de custo por saida.

### 2. Fluxo de caixa analitico

Colunas no estilo do print:

- Data
- Documento
- Titulo/Parcela
- Origem
- Cliente/Fornecedor
- Observacao
- Entradas
- Saidas
- Saldo

### 3. Faturamento geral

Tabela no estilo do Excel:

- Obra
- Janeiro
- Fevereiro
- Marco
- Abril
- Maio
- Total

Linhas sintenticas:

- Total faturamento
- Total IFCE
- Total IFCE - Subestacao
- Total outros

### 4. Projecao de caixa

Estrutura inspirada no `FC_Maio_Modelo.xlsx`, mas alimentada por Sienge e pelos filtros do Power BI:

- Entradas:
  - Medicoes em execucao
  - Previsao de recebimento
  - Outros recebimentos
- Saidas:
  - Obras
  - Demais desembolsos
  - Folha
  - Beneficios
  - Impostos
  - Emprestimos
  - Outros pagamentos
- Resultado:
  - Entradas - saidas
  - Saldo anterior
  - Saldo acumulado
  - Necessidade de captacao
  - Saldo final

## Observacoes tecnicas

- O Power BI bloqueou `Authorization` em `Web.Contents` quando a fonte nao estava anonima.
- O fluxo funcional atual baixa JSONs por script e o Power BI le arquivos locais.
- Bulk Data retornou `429` no pacote atual; REST paginado funcionou.
- Para dashboard completo, priorizar REST para tabelas pequenas e Bulk assincrono apenas para bases grandes, respeitando limites do Sienge.
- Transferencias, saques e inicializacao de saldo aparecem em `accounts-statements`; criar medidas separadas para caixa bruto e caixa operacional.

## Status implementado no modelo Power BI

Implementado em 2026-05-11:

- Tabelas Sienge carregadas:
  - `receitas_db`
  - `despesas_db`
  - `movimentacoes_bancarias_db`
  - `empresas_db`
  - `obras_db`
  - `centros_custo_db`
  - `plano_financeiro_db`
  - `clientes_db`
  - `fornecedores_db`
  - `contas_correntes_db`
  - `portadores_receber_db`
  - `indexadores_db`
  - `saldos_contas_db`
  - `titulos_receber_db`
- Tabela calendario:
  - `calendario_db`, marcada como tabela de datas.
- Tabela de previsao:
  - `previsoes_manuais_db` foi mantida apenas como estrutura vazia/compatibilidade e esta oculta; nao le mais `FC_Maio_Modelo.xlsx`.
  - As previsoes usadas no dashboard partem do Sienge:
    - `Entradas Previstas` = `Total a Receber Aberto`;
    - `Saidas Previstas` = `Total a Pagar`;
    - `Fluxo Previsto` = `Entradas Previstas - Saidas Previstas`.
- Tabela de medidas:
  - `medidas_db`.
- Medidas criadas:
  - `Entradas Totais`
  - `Saidas Totais`
  - `Entradas Operacionais`
  - `Saidas Operacionais`
  - `Fluxo Liquido`
  - `Saldo Acumulado`
  - `Necessidade de Captacao`
  - `Saldo Final Projetado`
  - `Saldo Bancario`
  - `Saldo Bancario Conciliado`
  - `Total a Receber`
  - `Total Recebido`
  - `Total a Receber Aberto`
  - `Total a Pagar`
  - `Quantidade de Movimentacoes`
  - `Quantidade de Titulos a Receber`
  - `Quantidade de Titulos a Pagar`
  - `Margem de Caixa`
  - `Previsao Manual`
  - `Previsao Planejada`
  - `Previsao Sienge Referencia`
  - `Entradas Previstas`
  - `Saidas Previstas`
  - `Fluxo Previsto`
  - `Variacao Realizado x Previsto`
  - `HTML Executivo (dashboard)`

Validacao DAX apos processamento:

- `fornecedores_db`: 3.412 linhas
- `contas_correntes_db`: 113 linhas
- `indexadores_db`: 4 linhas
- `previsoes_manuais_db`: 0 linhas com fonte Excel neutralizada
- `HTML Executivo (dashboard)`: string HTML valida
- `Entradas Previstas`: baseada em titulos a receber abertos do Sienge
- `Saidas Previstas`: baseada em contas a pagar do Sienge
- `Fluxo Previsto`: baseado em Sienge e contexto de filtro
- `Fluxo Liquido`: -R$ 4.805.911,45

## Visual HTML executivo

Arquivo local:

- `C:\Users\dinam\OneDrive\Documentos\GitHub\powerbi\exibicao\visual_html\4_visual_executivo_html.dax`

Medida no Power BI:

- `HTML Executivo (dashboard)`

Caracteristicas:

- retorno em string HTML para visual HTML Content;
- visual escuro, executivo e responsivo, no estilo do print de referencia;
- chips de filtros para Empresa, Obra, Centro de custo, Conta, Fornecedor, Trimestre e Mes;
- KPIs de Saldo bancario, Entradas, Saidas, Fluxo liquido, Fluxo previsto, A receber, A pagar, Necessidade de captacao e Margem de caixa;
- tabela tipo DRE/fluxo com Realizado, AV %, Previsto/Sienge e Var %;
- filtros funcionais por contexto do Power BI, usando slicers/filtros da pagina.
