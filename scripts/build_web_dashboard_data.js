const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'dados_sienge');
const outDir = path.join(root, 'web', 'data');
const outFile = path.join(outDir, 'dashboard_financeiro.json');

function readRows(fileName) {
  const fullPath = path.join(dataDir, fileName);
  const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function date(value) {
  const t = text(value);
  return t ? t.slice(0, 10) : '';
}

function linkHref(row, rel) {
  const links = Array.isArray(row.links) ? row.links : [];
  return links.find((link) => text(link.rel) === rel)?.href ?? '';
}

function parseHref(href, pattern) {
  const match = text(href).match(pattern);
  return match ? match[1] : '';
}

function extractCompanyId(row) {
  if (row.companyId !== null && row.companyId !== undefined && `${row.companyId}` !== '') {
    return text(row.companyId);
  }
  const companyHref = linkHref(row, 'company');
  const fromCompany = parseHref(companyHref, /\/companies\/(\d+)(?:\b|\/)/i);
  if (fromCompany) return fromCompany;
  const bankHref = linkHref(row, 'bank-account');
  return parseHref(bankHref, /\/companies\/(\d+)(?:\b|\/)/i);
}

function extractAccountNumber(row) {
  const bankHref = linkHref(row, 'bank-account');
  return decodeURIComponent(parseHref(bankHref, /\/bank-account\/([^/?#]+)/i));
}

function idsFromBudgetCategories(row, rel, pattern) {
  const ids = [];
  const categories = Array.isArray(row.budgetCategories) ? row.budgetCategories : [];
  for (const category of categories) {
    const links = Array.isArray(category.links) ? category.links : [];
    for (const link of links) {
      if (text(link.rel) !== rel) continue;
      const id = parseHref(link.href, pattern);
      if (id) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function normalizeSearch(...parts) {
  return parts
    .map(text)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(value) {
  return text(value).replace(/\D+/g, '');
}

function tokens(value) {
  const valueTokens = normalizeSearch(value)
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  return [...new Set(valueTokens)];
}

function tokenOverlapScore(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  let overlap = 0;
  for (const token of ta) {
    if (setB.has(token)) overlap += 1;
  }
  return overlap / Math.max(ta.length, tb.length);
}

const empresas = readRows('empresas_db.json').map((row) => ({
  id: text(row.id),
  nome: text(row.name),
  fantasia: text(row.tradeName),
  cnpj: text(row.cnpj),
}));

const empresaById = new Map(empresas.map((empresa) => [empresa.id, empresa]));

const centrosCusto = readRows('centros_custo_db.json').map((row) => ({
  id: text(row.id),
  nome: text(row.name),
  empresaId: text(row.idCompany),
  cnpj: text(row.cnpj),
}));

const centroById = new Map(centrosCusto.map((centro) => [centro.id, centro]));

const obrasRaw = readRows('obras_db.json');

const centrosByEmpresa = new Map();
for (const centro of centrosCusto) {
  const key = text(centro.empresaId);
  const list = centrosByEmpresa.get(key) || [];
  list.push(centro);
  centrosByEmpresa.set(key, list);
}

const obras = obrasRaw.map((row) => {
  const id = text(row.id);
  const nome = text(row.name);
  const empresaId = text(row.companyId);
  const obraCnpj = digits(row.cnpj);

  const candidatos = centrosByEmpresa.get(empresaId) || [];
  const matchedCentroIds = new Set();

  if (obraCnpj) {
    for (const centro of candidatos) {
      if (!digits(centro.cnpj)) continue;
      if (digits(centro.cnpj) === obraCnpj) matchedCentroIds.add(centro.id);
    }
  }

  const obraNorm = normalizeSearch(nome);
  for (const centro of candidatos) {
    const centroNorm = normalizeSearch(centro.nome);
    if (!centroNorm) continue;

    if (centroNorm === obraNorm) {
      matchedCentroIds.add(centro.id);
      continue;
    }

    if (obraNorm && (centroNorm.includes(obraNorm) || obraNorm.includes(centroNorm))) {
      matchedCentroIds.add(centro.id);
      continue;
    }

    const score = tokenOverlapScore(nome, centro.nome);
    if (score >= 0.75) matchedCentroIds.add(centro.id);
  }

  return {
    id,
    nome,
    empresaId,
    cnpj: text(row.cnpj),
    origem: 'obras_db',
    centroCustoIds: [...matchedCentroIds],
  };
});

const clientes = readRows('clientes_db.json').map((row) => ({
  id: text(row.id),
  nome: text(row.name),
  fantasia: text(row.fantasyName),
  documento: text(row.cnpj || row.cpf),
  email: text(row.email),
}));

const clienteById = new Map(clientes.map((cliente) => [cliente.id, cliente]));

const fornecedores = readRows('fornecedores_db.json').map((row) => ({
  id: text(row.id),
  nome: text(row.name),
  fantasia: text(row.tradeName),
  documento: text(row.cnpj || row.cpf),
  ativo: Boolean(row.active),
}));

const fornecedorById = new Map(fornecedores.map((fornecedor) => [fornecedor.id, fornecedor]));

const contas = readRows('contas_correntes_db.json').map((row) => ({
  id: `${text(row.companyId)}|${text(row.accountNumber)}`,
  numero: text(row.accountNumber),
  nome: text(row.accountName),
  tipo: text(row.accountType),
  banco: text(row.bankName || row.bankNumber),
  empresaId: text(row.companyId),
  empresaNome: text(row.companyName),
  status: text(row.accountStatus),
}));

const contaByKey = new Map(contas.map((conta) => [conta.id, conta]));

const despesas = readRows('despesas_db.json').map((row) => {
  const empresaId = text(row.debtorId) || extractCompanyId(row);
  const fornecedorId = text(row.creditorId) || parseHref(linkHref(row, 'creditor'), /\/creditors\/(\d+)(?:\b|\/)/i);
  const fornecedor = fornecedorById.get(fornecedorId);
  const data = date(row.issueDate);
  const valor = number(row.totalInvoiceAmount);
  return {
    id: text(row.id),
    data,
    valor,
    empresaId,
    empresaNome: empresaById.get(empresaId)?.fantasia || empresaById.get(empresaId)?.nome || '',
    fornecedorId,
    fornecedorNome: fornecedor?.fantasia || fornecedor?.nome || '',
    documento: [text(row.documentIdentificationId), text(row.documentNumber)].filter(Boolean).join(' '),
    origem: text(row.originId),
    status: text(row.status),
    observacao: text(row.notes),
    searchText: normalizeSearch(row.documentIdentificationId, row.documentNumber, row.notes, fornecedor?.nome, fornecedor?.fantasia),
  };
});

const despesaById = new Map(despesas.map((despesa) => [despesa.id, despesa]));

const titulosReceber = readRows('titulos_receber_db.json').map((row) => {
  const clienteId = text(row.customerId);
  const cliente = clienteById.get(clienteId);
  const quitado = Boolean(row.payOffDate);
  const inadimplente = Boolean(row.defaulting);
  const status = quitado ? 'Recebido' : inadimplente ? 'Inadimplente' : 'Aberto';
  const data = date(row.issueDate);
  const valor = number(row.receivableBillValue);
  return {
    id: text(row.receivableBillId),
    data,
    valor,
    empresaId: text(row.companyId),
    empresaNome: empresaById.get(text(row.companyId))?.fantasia || empresaById.get(text(row.companyId))?.nome || '',
    clienteId,
    clienteNome: cliente?.fantasia || cliente?.nome || '',
    documento: [text(row.documentId), text(row.documentNumber)].filter(Boolean).join(' '),
    status,
    quitado,
    inadimplente,
    observacao: text(row.note),
    searchText: normalizeSearch(row.documentId, row.documentNumber, row.note, cliente?.nome, cliente?.fantasia),
  };
});

const tituloReceberById = new Map(titulosReceber.map((titulo) => [titulo.id, titulo]));

const saldos = readRows('saldos_contas_db.json').map((row) => {
  const empresaId = text(row.companyId) || extractCompanyId(row);
  const numero = text(row.accountNumber) || extractAccountNumber(row);
  const conta = contaByKey.get(`${empresaId}|${numero}`);
  return {
    data: date(row.balanceDate),
    valor: number(row.amount),
    valorConciliado: number(row.reconciledAmount),
    empresaId,
    contaId: `${empresaId}|${numero}`,
    contaNumero: numero,
    contaNome: conta?.nome || numero,
    status: text(row.accountStatus),
  };
});

const movimentos = readRows('movimentacoes_bancarias_db.json').map((row) => {
  const empresaId = extractCompanyId(row);
  const accountNumber = extractAccountNumber(row);
  const conta = contaByKey.get(`${empresaId}|${accountNumber}`);
  const tipoApi = text(row.type);
  const tipo = tipoApi.toLowerCase() === 'income' ? 'Entrada' : tipoApi.toLowerCase() === 'expense' ? 'Saida' : 'Movimento';
  const billId = text(row.billId);
  const despesa = despesaById.get(billId);
  const titulo = tituloReceberById.get(billId);
  const fornecedorId = despesa?.fornecedorId || '';
  const clienteId = titulo?.clienteId || '';
  const centroCustoIds = idsFromBudgetCategories(row, 'cost-center', /\/cost-center\/(\d+)(?:\b|\/)/i);
  const planoFinanceiroIds = idsFromBudgetCategories(row, 'payment-categories', /\/payment-categories\/(\d+)(?:\b|\/)/i);
  const centroNomes = centroCustoIds.map((id) => centroById.get(id)?.nome).filter(Boolean);
  return {
    id: text(row.id),
    data: date(row.date),
    valor: number(row.value),
    tipo,
    tipoApi,
    documento: [text(row.documentId), text(row.documentNumber)].filter(Boolean).join(' '),
    numeroDocumento: text(row.documentNumber),
    documentoId: text(row.documentId),
    descricao: text(row.description),
    origem: text(row.statementOrigin),
    tipoExtrato: text(row.statementType),
    observacao: text(row.statementTypeNotes),
    billId,
    parcela: text(row.installmentNumber),
    empresaId,
    empresaNome: empresaById.get(empresaId)?.fantasia || empresaById.get(empresaId)?.nome || '',
    contaId: `${empresaId}|${accountNumber}`,
    contaNumero: accountNumber,
    contaNome: conta?.nome || accountNumber,
    centroCustoIds,
    centroCustoNomes: centroNomes,
    planoFinanceiroIds,
    fornecedorId,
    fornecedorNome: despesa?.fornecedorNome || '',
    clienteId,
    clienteNome: titulo?.clienteNome || '',
    pessoaNome: despesa?.fornecedorNome || titulo?.clienteNome || '',
    searchText: normalizeSearch(
      row.documentId,
      row.documentNumber,
      row.description,
      row.statementOrigin,
      row.statementType,
      row.statementTypeNotes,
      despesa?.fornecedorNome,
      titulo?.clienteNome,
      centroNomes.join(' ')
    ),
  };
});

const output = {
  meta: {
    geradoEm: new Date().toISOString(),
    fonte: 'Sienge REST local tratado',
    periodoPadraoInicio: '2026-01-01',
    periodoPadraoFim: new Date().toISOString().slice(0, 10),
    totais: {
      empresas: empresas.length,
      centrosCusto: centrosCusto.length,
      obras: obras.length,
      clientes: clientes.length,
      fornecedores: fornecedores.length,
      contas: contas.length,
      saldos: saldos.length,
      movimentos: movimentos.length,
      despesas: despesas.length,
      titulosReceber: titulosReceber.length,
    },
  },
  dimensoes: {
    empresas,
    centrosCusto,
    obras,
    clientes,
    fornecedores,
    contas,
  },
  fatos: {
    saldos,
    movimentos,
    despesas,
    titulosReceber,
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(output), 'utf8');

console.log(`OK: ${outFile}`);
console.log(JSON.stringify(output.meta.totais, null, 2));
