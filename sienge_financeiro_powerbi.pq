let
    // Sienge financeiro 2026 - Power BI / Power Query
    // Fluxo atual:
    // 1. Rode scripts/download_sienge_financeiro_rest.ps1 para baixar a API Sienge.
    // 2. O Power BI le os JSONs locais em dados_sienge, sem cabecalho Authorization.
    //
    // Credenciais usadas pelo script de download.
    // Nao versione tokens/segredos. Para rodar o download localmente, defina as variaveis de ambiente:
    //   SIENGE_INSTANCE, SIENGE_ACCESS_NAME, SIENGE_TOKEN
    // O Power BI usa apenas os JSONs locais em dados_sienge.
    SIENGE_INSTANCE = "<defina_via_env_SIENGE_INSTANCE>",
    SIENGE_ACCESS_NAME = "<defina_via_env_SIENGE_ACCESS_NAME>",
    SIENGE_TOKEN = "<defina_via_env_SIENGE_TOKEN>",

    RootPath = "C:\Users\dinam\OneDrive\Documentos\GitHub\powerbi\dados_sienge\",
    DataInicialTexto = "2026-01-01",
    DataFinalTexto = "2026-05-11",

    RowsFromFile = (fileName as text) as list =>
        let
            Payload = Json.Document(File.Contents(RootPath & fileName)),
            Rows =
                if Value.Is(Payload, type record) and Record.HasFields(Payload, "data") and Value.Is(Payload[data], type list) then
                    Payload[data]
                else if Value.Is(Payload, type list) then
                    Payload
                else
                    {}
        in
            Rows,

    RowsToTable = (rows as list, sourceName as text) as table =>
        let
            Records = List.Transform(rows, each if Value.Is(_, type record) then _ else [value = _]),
            Base =
                if List.IsEmpty(Records) then
                    #table({}, {})
                else
                    Table.FromRecords(Records, null, MissingField.UseNull),
            WithSource = Table.AddColumn(Base, "_tabela_origem", each sourceName, type text),
            WithStart = Table.AddColumn(WithSource, "data_inicial", each DataInicialTexto, type text),
            WithEnd = Table.AddColumn(WithStart, "data_final", each DataFinalTexto, type text)
        in
            WithEnd,

    Receitas = RowsToTable(RowsFromFile("receitas_db.json"), "receitas_db"),
    Despesas = RowsToTable(RowsFromFile("despesas_db.json"), "despesas_db"),
    Movimentacoes = RowsToTable(RowsFromFile("movimentacoes_bancarias_db.json"), "movimentacoes_bancarias_db"),
    Financeiro = Table.Combine({Receitas, Despesas, Movimentacoes})
in
    Financeiro
