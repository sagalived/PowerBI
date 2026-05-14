const DATA_URL = 'data/dashboard_financeiro.json';
const REFERENCIAS_URL = 'data/referencias_modelo.json';
const UPDATE_SIENGE_URL = '/api/atualizar-sienge';
const SEND_WEEKLY_REPORT_URL = '/api/enviar-relatorio';
const STORAGE_KEY = 'sienge_finance_web_filters_v2';
const FORECAST_STORAGE_KEY = 'sienge_finance_web_forecast_inputs_v1';
const REF_OPTIONS_KEY = 'sienge_finance_web_ref_options_v1';

let APP_DATA = null;
let LAST_EXPORT_ROWS = [];
let SIENGE_UPDATE_RUNNING = false;
let WEEKLY_REPORT_RUNNING = false;

function el(id) {
  return document.getElementById(id);
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function norm(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatBRL(value) {
  const v = number(value);
  const safe = Object.is(v, -0) ? 0 : v;
  return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatBRLAccounting(value) {
  const v = number(value);
  const safe = Object.is(v, -0) ? 0 : v;
  if (safe < 0) return `(${formatBRL(Math.abs(safe))})`;
  return formatBRL(safe);
}

function formatNumber(value) {
  return number(value).toLocaleString('pt-BR');
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
}

function formatMonthYear(yyyyMm) {
  const [y, m] = text(yyyyMm).split('-').map((p) => Number(p));
  if (!y || !m) return yyyyMm;
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleString('pt-BR', { month: 'long' });
  return `${label} ${y}`;
}

function parseNumberInput(value) {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function readForecastState() {
  try {
    const raw = localStorage.getItem(FORECAST_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function saveForecastState(state) {
  localStorage.setItem(FORECAST_STORAGE_KEY, JSON.stringify(state || {}));
}

function forecastScopeKey(filters) {
  const scope = {
    empresaId: text(filters.empresaId),
    centroId: text(filters.centroId),
    obraId: text(filters.obraId),
    contaId: text(filters.contaId),
  };
  return JSON.stringify(scope);
}

function getForecastInputs(state, scopeKey, yyyyMm) {
  const scoped = state?.[scopeKey] || {};
  const values = scoped?.[yyyyMm];
  if (!Array.isArray(values) || values.length !== 3) return [0, 0, 0];
  return values.map((v) => number(v));
}

function setForecastInput(state, scopeKey, yyyyMm, index, value) {
  const next = { ...(state || {}) };
  const scoped = { ...(next[scopeKey] || {}) };
  const current = getForecastInputs(next, scopeKey, yyyyMm);
  const updated = [...current];
  updated[index] = number(value);
  scoped[yyyyMm] = updated;
  next[scopeKey] = scoped;
  return next;
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function ensureChartTooltip(canvas) {
  if (!canvas) return null;
  const host = canvas.parentElement;
  if (!host) return null;

  const style = getComputedStyle(host);
  if (style.position === 'static') host.style.position = 'relative';

  let node = host.querySelector('.chart-tooltip');
  if (!node) {
    node = document.createElement('div');
    node.className = 'chart-tooltip';
    host.appendChild(node);
  }
  return node;
}

function bindCanvasTooltip(canvas) {
  if (!canvas || canvas.__tooltipBound) return;
  canvas.__tooltipBound = true;

  const tip = ensureChartTooltip(canvas);
  if (!tip) return;

  const hide = () => {
    tip.style.display = 'none';
  };

  canvas.addEventListener('mouseleave', hide);
  canvas.addEventListener('mousemove', (ev) => {
    const state = canvas.__tooltipState;
    if (!state || typeof state.getText !== 'function') {
      hide();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const textOut = state.getText(x, y);
    if (!textOut) {
      hide();
      return;
    }

    const hostRect = canvas.parentElement.getBoundingClientRect();
    tip.style.left = `${ev.clientX - hostRect.left}px`;
    tip.style.top = `${ev.clientY - hostRect.top}px`;
    tip.textContent = textOut;
    tip.style.display = 'block';
  });
}

function drawElectronicLineChart(canvas, points) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width || 600;
  const height = canvas.clientHeight || canvas.height || 140;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, width, height);

  const border = cssVar('--border', '#242836');
  const accent = cssVar('--accent', '#7cda7a');
  const muted = cssVar('--muted', '#a7adbd');

  const pad = 12;
  const plotW = Math.max(1, width - pad * 2);
  const plotH = Math.max(1, height - pad * 2);

  // grid
  ctx.strokeStyle = border;
  ctx.globalAlpha = 0.45;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (!Array.isArray(points) || points.length < 2) {
    ctx.fillStyle = muted;
    ctx.font = '12px system-ui';
    ctx.fillText('Sem dados para o período.', pad, pad + 14);
    canvas.__tooltipState = null;
    return;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const mapX = (x) => pad + ((x - minX) / spanX) * plotW;
  const mapY = (y) => pad + plotH - ((y - minY) / spanY) * plotH;

  // tooltip
  canvas.__tooltipState = {
    getText(mouseX) {
      if (mouseX < pad || mouseX > width - pad) return '';
      const xValue = minX + ((mouseX - pad) / Math.max(1, plotW)) * spanX;

      let best = points[0];
      let bestDist = Math.abs(points[0].x - xValue);
      for (let i = 1; i < points.length; i++) {
        const d = Math.abs(points[i].x - xValue);
        if (d < bestDist) {
          best = points[i];
          bestDist = d;
        }
      }

      const label = text(best.label);
      const dateLabel = label ? formatIsoBr(label) : '';
      const valueLabel = formatBRLAccounting(best.y);
      return dateLabel ? `${dateLabel} • ${valueLabel}` : valueLabel;
    },
  };
  bindCanvasTooltip(canvas);

  // glow pass
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.7;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const px = mapX(points[i].x);
    const py = mapY(points[i].y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();

  // crisp pass
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const px = mapX(points[i].x);
    const py = mapY(points[i].y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + number(selector(row)), 0);
}

function byLabel(a, b) {
  return text(a.label).localeCompare(text(b.label), 'pt-BR');
}

function toIsoDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentYearStart() {
  const today = new Date();
  return `${today.getFullYear()}-01-01`;
}

function currentMonthStart() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

function currentMonthEnd() {
  const today = new Date();
  return toIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
}

function monthKey(isoDate) {
  const s = text(isoDate);
  return s.length >= 7 ? s.slice(0, 7) : '';
}

function monthLabel(yyyyMm) {
  const [y, m] = text(yyyyMm).split('-').map((p) => Number(p));
  if (!y || !m) return yyyyMm;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
}

function monthsBetween(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function formatIsoBr(isoDate) {
  const [y, m, d] = text(isoDate)
    .split('-')
    .map((p) => Number(p));
  if (!y || !m || !d) return text(isoDate) || '-';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function quarterFromMonth(monthNumber1to12) {
  const m = Number(monthNumber1to12);
  if (!m) return 0;
  return Math.floor((m - 1) / 3) + 1;
}

function monthNameShortPt(monthNumber1to12) {
  const m = Number(monthNumber1to12);
  if (!m) return '';
  return new Date(2000, m - 1, 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
}

function defaultFilters() {
  return {
    empresaId: '',
    centroId: '',
    obraId: '',
    contaId: '',
    clienteId: '',
    fornecedorId: '',
    tipoAnalise: 'todos',
    busca: '',
    inicio: currentYearStart(),
    fim: toIsoDate(new Date()),
  };
}

function hasGlobalTipoAnaliseSelect() {
  const node = el('filterTipoAnalise');
  return Boolean(node && node.tagName === 'SELECT');
}

function shouldIgnoreGlobalTipoAnalise() {
  const page = text(document.body?.dataset?.page);
  return page !== 'referencias' && !hasGlobalTipoAnaliseSelect();
}

function sanitizeFiltersForPage(filters) {
  const next = { ...defaultFilters(), ...(filters || {}) };
  if (shouldIgnoreGlobalTipoAnalise()) {
    next.tipoAnalise = 'todos';
  }
  return next;
}
 
function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFilters();
    const parsed = JSON.parse(raw) || {};
    const merged = { ...defaultFilters(), ...parsed };

    const allowed = new Set(['todos', 'realizado', 'comprometido', 'a_realizar', 'entradas', 'saidas']);
    if (!allowed.has(merged.tipoAnalise)) merged.tipoAnalise = 'todos';
    return merged;
  } catch {
    return defaultFilters();
  }
}

function saveState(filters) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeFiltersForPage(filters)));
}

async function loadData() {
  if (APP_DATA) return APP_DATA;
  const response = await fetch(DATA_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Falha ao carregar ${DATA_URL}: ${response.status}`);
  APP_DATA = await response.json();
  return APP_DATA;
}
async function loadReferencias() {
  const response = await fetch(REFERENCIAS_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Falha ao carregar ${REFERENCIAS_URL}: ${response.status}`);
  return response.json();
}

function readRefOptions() {
  try {
    const raw = localStorage.getItem(REF_OPTIONS_KEY);
    if (!raw) return { tiposAnalise: ['realizado'] };
    const parsed = JSON.parse(raw) || {};

    // compat: versão antiga salvava string `tipoAnalise`
    const legacy = text(parsed.tipoAnalise);
    if (legacy && ['realizado', 'comprometido', 'a_realizar'].includes(legacy)) {
      return { tiposAnalise: [legacy] };
    }

    const list = Array.isArray(parsed.tiposAnalise) ? parsed.tiposAnalise : [];
    const clean = list
      .map((v) => text(v))
      .filter((v) => ['realizado', 'comprometido', 'a_realizar'].includes(v));
    const unique = Array.from(new Set(clean));
    return { tiposAnalise: unique.length ? unique : ['realizado'] };
  } catch {
    return { tiposAnalise: ['realizado'] };
  }
}

function saveRefOptions(options) {
  const list = Array.isArray(options?.tiposAnalise) ? options.tiposAnalise : [options?.tipoAnalise];
  const clean = (list || [])
    .map((v) => text(v))
    .filter((v) => ['realizado', 'comprometido', 'a_realizar'].includes(v));
  const unique = Array.from(new Set(clean));
  localStorage.setItem(REF_OPTIONS_KEY, JSON.stringify({ tiposAnalise: unique.length ? unique : ['realizado'] }));
}

function refTipoLabel(tipo) {
  if (tipo === 'comprometido') return 'Comprometido';
  if (tipo === 'a_realizar') return 'A realizar';
  return 'Realizado';
}

function refTiposLabel(tipos) {
  const list = Array.isArray(tipos) ? tipos : [];
  const clean = list.map((t) => text(t)).filter(Boolean);
  if (!clean.length) return 'Realizado';
  return clean.map(refTipoLabel).join(' + ');
}

function colLetter(index0) {
  const code = 'A'.charCodeAt(0) + index0;
  return String.fromCharCode(code);
}

async function renderReferenciasPage(data, filters) {
  const thead = document.querySelector('#tblReferencias thead');
  const tbody = document.querySelector('#tblReferencias tbody');
  if (!thead || !tbody) return;

  const opt = readRefOptions();
  document.querySelectorAll('input[type="checkbox"][name="refTipoAnalise"]').forEach((input) => {
    input.checked = (opt.tiposAnalise || []).includes(input.value);
  });

  const payload = await loadReferencias();
  const f = { ...defaultFilters(), ...(filters || {}) };
  const dims = data?.dimensoes;
  const labelById = (list, id, field = 'nome') => list?.find((item) => item.id === id)?.[field] || '';
  const empresaLabel =
    labelById(dims?.empresas, f.empresaId, 'fantasia') || labelById(dims?.empresas, f.empresaId, 'nome');
  const obraLabel = labelById(dims?.obras, f.obraId, 'nome');
  const centroLabel = labelById(dims?.centrosCusto, f.centroId, 'nome');
  const metaParts = [
    `Fonte: ${payload.sourceFile || '-'}`,
    `Aba: ${payload.sheet || '-'}`,
    `Gerado: ${payload.generatedAt || '-'}`,
    `Tipo: ${refTiposLabel(opt.tiposAnalise)}`,
  ];
  if (text(empresaLabel)) metaParts.push(`Empresa: ${empresaLabel}`);
  if (text(obraLabel)) metaParts.push(`Obra: ${obraLabel}`);
  if (text(centroLabel)) metaParts.push(`Centro: ${centroLabel}`);
  setText('refMeta', metaParts.join(' • '));

  renderActiveFilters(f);

  const maxCol = Math.max(1, number(payload.maxCol));
  thead.innerHTML = `
    <tr>
      <th style="width:70px">Linha</th>
      ${Array.from({ length: maxCol }, (_, i) => `<th>${colLetter(i)}</th>`).join('')}
    </tr>
  `;

  tbody.innerHTML = '';
  const allRows = Array.isArray(payload.rows) ? payload.rows : [];

  const rowMatchesToken = (row, tokenLower) => {
    const values = Array.isArray(row?.values) ? row.values : [];
    return values.some((v) => text(v).toLowerCase().includes(tokenLower));
  };

  const tryApplyToken = (rows, token) => {
    const t = text(token);
    if (!t) return rows;
    const tokenLower = t.toLowerCase();
    const next = rows.filter((r) => rowMatchesToken(r, tokenLower));
    return next.length ? next : rows;
  };

  const extractTokens = (label) => {
    const s = text(label);
    if (!s) return [];
    const stop = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'NA', 'NO', 'NAS', 'NOS', 'PARA', 'POR', 'COM', 'AO', 'AOS', 'AS', 'OS', 'A']);
    const raw = s.match(/\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/g) || [];
    const clean = raw.map((t) => t.trim()).filter((t) => t && !stop.has(t));

    const acronyms = clean.filter((t) => t.length <= 6);
    const preferred = (acronyms.length ? acronyms : clean).filter((t) => t.length >= 3);

    return Array.from(new Set(preferred)).slice(0, 4);
  };

  const tokens = [...extractTokens(obraLabel), ...extractTokens(centroLabel), ...extractTokens(empresaLabel)];

  let visibleRows = allRows;
  for (const token of tokens) {
    visibleRows = tryApplyToken(visibleRows, token);
  }

  for (const row of visibleRows) {
    const tr = document.createElement('tr');
    const values = Array.isArray(row.values) ? row.values : [];
    tr.innerHTML = `
      <td class="small">${row.row}</td>
      ${Array.from({ length: maxCol }, (_, i) => `<td>${text(values[i])}</td>`).join('')}
    `;
    tbody.appendChild(tr);
  }

  const btn = el('refVisualizar');
  if (btn) {
    btn.onclick = () => {
      const selected = Array.from(document.querySelectorAll('input[type="checkbox"][name="refTipoAnalise"]:checked'))
        .map((i) => i.value)
        .filter(Boolean);
      saveRefOptions({ tiposAnalise: selected });
      el('filterApply')?.click();
    };
  }
}

function hasFilterUI() {
  return Boolean(el('filterEmpresa') || el('filterInicio') || el('filterFim'));
}

function lockGlobalTipoAnaliseCheckboxes() {
  const page = text(document.body?.dataset?.page);
  if (page === 'referencias') return;

  const checks = document.querySelectorAll('input[type="checkbox"][name="filterTipoAnalise"]');
  if (!checks.length) return;

  checks.forEach((input) => {
    input.checked = false;
    input.disabled = true;
    input.setAttribute('aria-disabled', 'true');
  });
}

function getFiltersFromUI() {
  const out = {};
  if (el('filterEmpresa')) out.empresaId = text(el('filterEmpresa')?.value);
  if (el('filterCentroCusto')) out.centroId = text(el('filterCentroCusto')?.value);
  if (el('filterObra')) out.obraId = text(el('filterObra')?.value);
  if (el('filterConta')) out.contaId = text(el('filterConta')?.value);
  if (el('filterCliente')) out.clienteId = text(el('filterCliente')?.value);
  if (el('filterFornecedor')) out.fornecedorId = text(el('filterFornecedor')?.value);

  if (hasGlobalTipoAnaliseSelect()) out.tipoAnalise = text(el('filterTipoAnalise')?.value) || 'todos';
  if (shouldIgnoreGlobalTipoAnalise()) out.tipoAnalise = 'todos';
  if (el('filterBusca')) out.busca = text(el('filterBusca')?.value);
  if (el('filterInicio')) out.inicio = text(el('filterInicio')?.value);
  if (el('filterFim')) out.fim = text(el('filterFim')?.value);
  return out;
}

function setFiltersToUI(filters) {
  const f = { ...defaultFilters(), ...filters };
  if (el('filterEmpresa')) el('filterEmpresa').value = f.empresaId;
  if (el('filterCentroCusto')) el('filterCentroCusto').value = f.centroId;
  if (el('filterObra')) el('filterObra').value = f.obraId;
  if (el('filterConta')) el('filterConta').value = f.contaId;
  if (el('filterCliente')) el('filterCliente').value = f.clienteId;
  if (el('filterFornecedor')) el('filterFornecedor').value = f.fornecedorId;
  if (hasGlobalTipoAnaliseSelect()) el('filterTipoAnalise').value = f.tipoAnalise;
  if (el('filterBusca')) el('filterBusca').value = f.busca;
  if (el('filterInicio')) el('filterInicio').value = f.inicio;
  if (el('filterFim')) el('filterFim').value = f.fim;
}

function setSelectOptions(select, options, emptyLabel) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = '';

  const all = document.createElement('option');
  all.value = '';
  all.textContent = emptyLabel;
  select.appendChild(all);

  for (const item of options.sort(byLabel)) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  }

  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function populateFilters(data, filters) {
  if (!hasFilterUI()) return;
  const dims = data.dimensoes;
  const empresaId = text(filters.empresaId);

  setSelectOptions(
    el('filterEmpresa'),
    dims.empresas.map((empresa) => ({
      value: empresa.id,
      label: `${empresa.fantasia || empresa.nome} (${empresa.id})`,
    })),
    'Todas as empresas'
  );

  const centros = empresaId
    ? dims.centrosCusto.filter((centro) => centro.empresaId === empresaId)
    : dims.centrosCusto;

  setSelectOptions(
    el('filterCentroCusto'),
    centros.map((centro) => ({ value: centro.id, label: centro.nome })),
    'Todos os centros'
  );

  const obras = empresaId ? dims.obras.filter((obra) => obra.empresaId === empresaId) : dims.obras;
  setSelectOptions(
    el('filterObra'),
    obras.map((obra) => ({ value: obra.id, label: obra.nome })),
    'Todas as obras'
  );

  const contas = empresaId ? dims.contas.filter((conta) => conta.empresaId === empresaId) : dims.contas;
  setSelectOptions(
    el('filterConta'),
    contas.map((conta) => ({
      value: conta.id,
      label: `${conta.nome || conta.numero} (${conta.empresaId})`,
    })),
    'Todas as contas'
  );

  setSelectOptions(
    el('filterCliente'),
    dims.clientes.map((cliente) => ({
      value: cliente.id,
      label: cliente.fantasia || cliente.nome || cliente.id,
    })),
    'Todos os clientes'
  );

  setSelectOptions(
    el('filterFornecedor'),
    dims.fornecedores.map((fornecedor) => ({
      value: fornecedor.id,
      label: fornecedor.fantasia || fornecedor.nome || fornecedor.id,
    })),
    'Todos os fornecedores'
  );

  setFiltersToUI(filters);
}

function inDateRange(rowDate, filters) {
  const d = text(rowDate);
  if (!d) return false;
  if (filters.inicio && d < filters.inicio) return false;
  if (filters.fim && d > filters.fim) return false;
  return true;
}

function searchMatches(row, filters) {
  const needle = norm(filters.busca);
  if (!needle) return true;
  return norm(row.searchText || Object.values(row).join(' ')).includes(needle);
}

function arrayIntersectsSet(values, set) {
  if (!set || !set.size) return false;
  const list = Array.isArray(values) ? values : [];
  for (const value of list) {
    if (set.has(value)) return true;
  }
  return false;
}

function obraCentroSet(data, obraId) {
  if (!obraId) return null;
  const obra = data?.dimensoes?.obras?.find((item) => item.id === obraId);
  const ids = Array.isArray(obra?.centroCustoIds) ? obra.centroCustoIds : [];
  return new Set(ids);
}

function movementMatches(row, filters, obraCentros) {
  if (!inDateRange(row.data, filters)) return false;
  if (filters.empresaId && row.empresaId !== filters.empresaId) return false;
  if (filters.contaId && row.contaId !== filters.contaId) return false;
  const centros = Array.isArray(row.centroCustoIds) ? row.centroCustoIds : [];
  if (filters.centroId && !centros.includes(filters.centroId)) return false;
  if (filters.obraId && !arrayIntersectsSet(centros, obraCentros)) return false;
  if (filters.clienteId && row.clienteId !== filters.clienteId) return false;
  if (filters.fornecedorId && row.fornecedorId !== filters.fornecedorId) return false;
  if (filters.tipoAnalise === 'entradas' && row.tipo !== 'Entrada') return false;
  if (filters.tipoAnalise === 'saidas' && row.tipo !== 'Saida') return false;
  return searchMatches(row, filters);
}

const INTERNAL_MOV_TYPES = new Set(['Transferência', 'Saque', 'Transf.entre Caixas']);
function isInternalMovement(row) {
  return INTERNAL_MOV_TYPES.has(text(row?.tipoExtrato));
}

function payableMatches(row, filters) {
  if (!inDateRange(row.data, filters)) return false;
  if (filters.empresaId && row.empresaId !== filters.empresaId) return false;
  if (filters.fornecedorId && row.fornecedorId !== filters.fornecedorId) return false;
  if (filters.clienteId) return false;
  return searchMatches(row, filters);
}

function receivableMatches(row, filters) {
  if (!inDateRange(row.data, filters)) return false;
  if (filters.empresaId && row.empresaId !== filters.empresaId) return false;
  if (filters.clienteId && row.clienteId !== filters.clienteId) return false;
  if (filters.fornecedorId) return false;
  return searchMatches(row, filters);
}

function balanceMatches(row, filters) {
  if (filters.empresaId && row.empresaId !== filters.empresaId) return false;
  if (filters.contaId && row.contaId !== filters.contaId) return false;
  return true;
}

function filterData(data, filters) {
  const f = { ...defaultFilters(), ...filters };
  const obraCentros = f.obraId ? obraCentroSet(data, f.obraId) : null;

  const saldos = data.fatos.saldos.filter((row) => balanceMatches(row, f));
  const movimentos = data.fatos.movimentos
    .filter((row) => movementMatches(row, f, obraCentros))
    .filter((row) => !isInternalMovement(row));
  const despesas = data.fatos.despesas.filter((row) => payableMatches(row, f));
  const titulosReceber = data.fatos.titulosReceber.filter((row) => receivableMatches(row, f));

  return { saldos, movimentos, despesas, titulosReceber };
}

function groupSum(rows, keyFn, valueFn) {
  const map = new Map();
  for (const row of rows) {
    const key = text(keyFn(row));
    const value = number(valueFn(row));
    map.set(key, (map.get(key) || 0) + value);
  }
  return map;
}

function ensureObraIndex(data) {
  if (!data || data._obraIndex) return;
  const index = new Map();
  for (const obra of data.dimensoes?.obras || []) {
    const centros = Array.isArray(obra.centroCustoIds) ? obra.centroCustoIds : [];
    for (const centroId of centros) {
      if (!index.has(centroId)) index.set(centroId, obra);
    }
  }
  Object.defineProperty(data, '_obraIndex', { value: index, enumerable: false });
}

function obraFromMovement(data, row) {
  ensureObraIndex(data);
  const index = data?._obraIndex;
  if (!index) return null;
  const centros = Array.isArray(row?.centroCustoIds) ? row.centroCustoIds : [];
  return centros.map((centroId) => index.get(centroId)).find(Boolean) || null;
}

function isObraFaturavel(obra) {
  const nome = norm(obra?.nome);
  if (!nome) return false;

  // Heurística para excluir itens administrativos cadastrados como “obra” no Sienge.
  // Objetivo: em “Faturamento”, listar só obras/projetos.
  const banned = [
    'ESCRITORIO',
    'ESCRITÓRIO',
    'ALMOXARIFADO',
    'LICITACAO',
    'LICITAÇÃO',
    'LOGISTICA',
    'LOGÍSTICA',
    'CENTRO DE GESTAO INTEGRADA',
    'CENTRO DE GESTÃO INTEGRADA',
  ];
  for (const bad of banned) {
    if (nome.includes(norm(bad))) return false;
  }

  if (/^vt\s*\d+\b/.test(nome)) return false;
  if (/\bcgi\b/.test(nome)) return false;
  if (nome === norm('RAFAEL DE SÁ CRUZ') || nome === norm('RAFAEL DE SA CRUZ')) return false;

  return true;
}

function isFaturamentoMovement(row) {
  return row?.tipo === 'Entrada' && text(row?.tipoExtrato) === 'Recebimento';
}

function isRealCashMovement(row) {
  const t = text(row?.tipoExtrato);
  return t === 'Recebimento' || t === 'Pagamento';
}

function renderRelatorioFaturamento(data, filters) {
  const table = el('tblRelatorioFaturamento');
  if (!table) return;
  const body = table.querySelector('tbody');
  if (!body) return;

  const applied = { ...filters, tipoAnalise: 'entradas' };
  const filtered = filterData(data, applied);
  const faturamentoMovs = filtered.movimentos.filter((row) => {
    if (!isFaturamentoMovement(row)) return false;
    const obra = obraFromMovement(data, row);
    return obra && isObraFaturavel(obra);
  });

  const order = text(el('reportOrder')?.value) || 'Centro de custo/Cliente';
  const rows = faturamentoMovs
    .map((row) => {
      const obra = obraFromMovement(data, row);
      if (!obra) return null;

      const obraNome = obra.nome || '(Obra sem nome)';
      const pessoa = row.clienteNome || row.pessoaNome || '-';
      const documento = row.documento || '';

      let group;
      if (order === 'Documento') group = documento || '(sem documento)';
      else if (order === 'Cliente/Centro de custo') group = pessoa || '-';
      else group = obraNome;

      return {
        grupo: group,
        data: row.data,
        documento,
        pessoa,
        valor: row.valor,
      };
    })
    .filter(Boolean);

  const totals = groupSum(rows, (r) => r.grupo, (r) => r.valor);
  const top = [...totals.entries()]
    .map(([grupo, valor]) => ({ grupo, valor }))
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
    .slice(0, 200);

  body.innerHTML = '';

  {
    const total = sum(rows, (r) => r.valor);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>TOTAL</strong></td><td style="text-align:right"><strong>${formatBRL(total)}</strong></td>`;
    body.appendChild(tr);
  }

  for (const item of top) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.grupo}</td><td style="text-align:right">${formatBRL(item.valor)}</td>`;
    body.appendChild(tr);
  }

  setText('relatorioResumo', `${formatNumber(rows.length)} recebimentos (faturamento) em obras encontrados.`);
  renderActiveFilters(filters);
}

function renderFinanceiroObras(data, filters) {
  ensureObraIndex(data);
  const filtered = filterData(data, filters);
  const movimentos = filtered.movimentos.filter((row) => isRealCashMovement(row));

  const entradas = sum(movimentos, (row) => (row.tipo === 'Entrada' ? row.valor : 0));
  const saidas = sum(movimentos, (row) => (row.tipo === 'Saida' ? row.valor : 0));
  const liquido = entradas - saidas;

  setText('kpiObrasEntradas', formatBRL(entradas));
  setText('kpiObrasSaidas', formatBRL(saidas));
  setText('kpiObrasLiquido', formatBRL(liquido));
  setText('kpiObrasMovimentos', formatNumber(movimentos.length));

  // gráfico: entradas x saídas por dia (mesmo recorte dos KPIs)
  const days = seriesByDay(movimentos);
  drawBars(el('chartObrasResumo'), days);

  const tbody = document.querySelector('#tblFinanceiroObras tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const index = data._obraIndex;
  const perObra = new Map();
  for (const row of movimentos) {
    const signed = row.tipo === 'Saida' ? -row.valor : row.valor;
    const centros = Array.isArray(row.centroCustoIds) ? row.centroCustoIds : [];
    const obra = centros.map((centroId) => index.get(centroId)).find(Boolean);
    const obraId = obra?.id || '-';
    const current = perObra.get(obraId) || { obraId, obraNome: obra?.nome || '(Sem obra mapeada)', entradas: 0, saidas: 0, liquido: 0, movimentos: 0 };
    if (row.tipo === 'Entrada') current.entradas += row.valor;
    if (row.tipo === 'Saida') current.saidas += row.valor;
    current.liquido += signed;
    current.movimentos += 1;
    perObra.set(obraId, current);
  }

  const top = [...perObra.values()].sort((a, b) => Math.abs(b.liquido) - Math.abs(a.liquido)).slice(0, 80);
  for (const item of top) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.obraNome}</td>
      <td style="text-align:right">${formatBRL(item.entradas)}</td>
      <td style="text-align:right">${formatBRL(item.saidas)}</td>
      <td style="text-align:right">${formatBRL(item.liquido)}</td>
      <td style="text-align:right">${formatNumber(item.movimentos)}</td>
    `;
    tbody.appendChild(tr);
  }

  renderActiveFilters(filters);
}

function systemValueByMonthFromMovements(movimentos) {
  const map = new Map();
  for (const row of movimentos) {
    const key = monthKey(row.data);
    if (!key) continue;
    const signed = row.tipo === 'Saida' ? -number(row.valor) : number(row.valor);
    map.set(key, (map.get(key) || 0) + signed);
  }
  return map;
}

function updatePrevisaoTotals(rows) {
  const totalSistema = sum(rows, (r) => r.sistema);
  const totalInput1 = sum(rows, (r) => r.inputs?.[0] ?? 0);
  const totalInput2 = sum(rows, (r) => r.inputs?.[1] ?? 0);
  const totalInput3 = sum(rows, (r) => r.inputs?.[2] ?? 0);
  const totalPrev1 = sum(rows, (r) => r.prev[0]);
  const totalPrev2 = sum(rows, (r) => r.prev[1]);
  const totalPrev3 = sum(rows, (r) => r.prev[2]);
  setText('totalSistema', formatBRL(totalSistema));
  setText('totalInput1', formatBRL(totalInput1));
  setText('totalInput2', formatBRL(totalInput2));
  setText('totalInput3', formatBRL(totalInput3));
  setText('totalPrev1', formatBRL(totalPrev1));
  setText('totalPrev2', formatBRL(totalPrev2));
  setText('totalPrev3', formatBRL(totalPrev3));
}

function renderPrevisaoMaio(data, filters) {
  const tbody = document.querySelector('#tblPrevisao tbody');
  if (!tbody) return;

  const filtered = filterData(data, filters);
  const systemByMonth = systemValueByMonthFromMovements(filtered.movimentos);
  const months = monthsBetween(filters.inicio, filters.fim);

  const state = readForecastState();
  const scopeKey = forecastScopeKey(filters);

  const rows = months.map((yyyyMm) => {
    const sistema = number(systemByMonth.get(yyyyMm) || 0);
    const inputs = getForecastInputs(state, scopeKey, yyyyMm);
    const prev = [sistema + inputs[0], sistema + inputs[1], sistema + inputs[2]];
    return { yyyyMm, sistema, inputs, prev };
  });

  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${formatMonthYear(row.yyyyMm)}</strong><div class="small">${row.yyyyMm}</div></td>
      <td style="text-align:right">${formatBRL(row.sistema)}</td>
      <td style="text-align:right"><input type="number" step="0.01" data-month="${row.yyyyMm}" data-idx="0" value="${row.inputs[0]}" /></td>
      <td style="text-align:right" data-out="${row.yyyyMm}|0">${formatBRL(row.prev[0])}</td>
      <td style="text-align:right"><input type="number" step="0.01" data-month="${row.yyyyMm}" data-idx="1" value="${row.inputs[1]}" /></td>
      <td style="text-align:right" data-out="${row.yyyyMm}|1">${formatBRL(row.prev[1])}</td>
      <td style="text-align:right"><input type="number" step="0.01" data-month="${row.yyyyMm}" data-idx="2" value="${row.inputs[2]}" /></td>
      <td style="text-align:right" data-out="${row.yyyyMm}|2">${formatBRL(row.prev[2])}</td>
    `;
    tbody.appendChild(tr);
  }

  const rowIndex = new Map(rows.map((r) => [r.yyyyMm, r]));

  tbody.querySelectorAll('input[type="number"][data-month][data-idx]').forEach((input) => {
    input.addEventListener('input', () => {
      const month = text(input.dataset.month);
      const idx = Number(input.dataset.idx);
      const value = parseNumberInput(input.value);

      const currentState = readForecastState();
      const nextState = setForecastInput(currentState, scopeKey, month, idx, value);
      saveForecastState(nextState);

      const row = rowIndex.get(month);
      if (!row) return;
      row.inputs[idx] = value;
      row.prev[idx] = row.sistema + value;

      const out = tbody.querySelector(`[data-out="${month}|${idx}"]`);
      if (out) out.textContent = formatBRL(row.prev[idx]);
      updatePrevisaoTotals(rows);
    });
  });

  updatePrevisaoTotals(rows);
  setText('previsaoResumo', `Sistema (líquido) do Sienge + 3 inputs manuais por mês.`);
  renderActiveFilters(filters);
}

function setHtml(id, html) {
  const node = el(id);
  if (node) node.innerHTML = html;
}

function percentOrDash(value) {
  const n = Number(value);
  return Number.isFinite(n) ? formatPct(n) : '-';
}

function signClass(value) {
  const n = number(value);
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'zero';
}

function renderDre(data, filters) {
  const table = el('tblDreLinhas');
  const tbody = table?.querySelector('tbody');
  if (!tbody) return;

  const filtered = filterData(data, filters);
  const movimentos = filtered.movimentos;
  const despesas = filtered.despesas;
  const titulos = filtered.titulosReceber;
  const saldos = filtered.saldos;

  const saldo = sum(saldos, (r) => r.valor);
  const saldoConc = sum(saldos, (r) => r.valorConciliado);

  const entradas = sum(movimentos, (r) => (r.tipo === 'Entrada' ? r.valor : 0));
  const saidas = sum(movimentos, (r) => (r.tipo === 'Saida' ? r.valor : 0));
  const fluxo = entradas - saidas;

  const receberAberto = sum(
    titulos.filter((r) => !r.quitado),
    (r) => r.valor
  );
  const pagar = sum(despesas, (r) => r.valor);
  const fluxoPrev = receberAberto - pagar;

  const saldoFinalProjetado = saldo + fluxoPrev;
  const captacao = Math.max(0, -saldoFinalProjetado);
  const saldoFinal = saldoFinalProjetado + captacao;

  const margem = entradas ? fluxo / entradas : NaN;
  const saldoAcumulado = fluxo;

  setText('drePeriodo', `${formatIsoBr(filters.inicio)} a ${formatIsoBr(filters.fim)}`);
  setText('kpiDreSaldo', formatBRLAccounting(saldo));
  setText('kpiDreSaldoConc', formatBRLAccounting(saldoConc));
  setText('kpiDreEntradas', formatBRL(entradas));
  setText('kpiDreSaidas', formatBRL(saidas));
  setText('kpiDreFluxo', formatBRLAccounting(fluxo));
  setText('kpiDreFluxoPrev', formatBRLAccounting(fluxoPrev));

  setText('dreReceber', formatBRL(receberAberto));
  setText('drePagar', formatBRL(pagar));
  setText('dreCap', formatBRL(captacao));
  setText('dreSaldoFinal', formatBRLAccounting(saldoFinal));
  setText('dreMargem', percentOrDash(margem));
  setText('dreSaldoAcum', formatBRLAccounting(saldoAcumulado));

  // chips do topo (como o modelo): trimestre + meses, clicáveis (ajustam período)
  const periodMonths = monthsBetween(filters.inicio, filters.fim);
  const activeMonthNumbers = new Set(periodMonths.map((m) => Number(text(m).split('-')[1])));
  const year = Number(text(filters.inicio).slice(0, 4)) || new Date().getFullYear();

  setHtml(
    'dreTrimestres',
    [1, 2, 3, 4]
      .map((q) => {
        const startM = (q - 1) * 3 + 1;
        const endM = startM + 2;
        const isActive = [startM, startM + 1, endM].some((m) => activeMonthNumbers.has(m));
        return `<span class="chip" role="button" tabindex="0" data-action="dre-quarter" data-year="${year}" data-quarter="${q}" data-active="${isActive}">${q}º Trim</span>`;
      })
      .join('')
  );

  setHtml(
    'dreMeses',
    Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => {
        const isActive = activeMonthNumbers.has(m);
        return `<span class="chip" role="button" tabindex="0" data-action="dre-month" data-year="${year}" data-month="${m}" data-active="${isActive}">${monthNameShortPt(m)}</span>`;
      })
      .join('')
  );

  const applyPeriod = (startIso, endIso) => {
    const inicio = el('filterInicio');
    const fim = el('filterFim');
    if (inicio) inicio.value = startIso;
    if (fim) fim.value = endIso;
    el('filterApply')?.click();
  };

  const bindChipActions = (selector, handler) => {
    document.querySelectorAll(selector).forEach((node) => {
      const act = () => handler(node);
      node.addEventListener('click', act);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          act();
        }
      });
    });
  };

  bindChipActions('[data-action="dre-month"][data-year][data-month]', (node) => {
    const y = Number(node.dataset.year);
    const m = Number(node.dataset.month);
    const startIso = `${y}-${String(m).padStart(2, '0')}-01`;
    const endIso = toIsoDate(new Date(y, m, 0));
    applyPeriod(startIso, endIso);
  });

  bindChipActions('[data-action="dre-quarter"][data-year][data-quarter]', (node) => {
    const y = Number(node.dataset.year);
    const q = Number(node.dataset.quarter);
    const startM = (q - 1) * 3 + 1;
    const endM = startM + 2;
    const startIso = `${y}-${String(startM).padStart(2, '0')}-01`;
    const endIso = toIsoDate(new Date(y, endM, 0));
    applyPeriod(startIso, endIso);
  });

  // faixa de chips com filtros + contagem (como no print)
  const dims = data.dimensoes;
  const label = (list, id, field = 'nome') => list.find((item) => item.id === id)?.[field] || '';
  const metaParts = [
    ['Empresa', (label(dims.empresas, filters.empresaId, 'fantasia') || label(dims.empresas, filters.empresaId)) || 'Todas'],
    ['Obra', label(dims.obras, filters.obraId) || 'Todas'],
    ['Centro de custo', label(dims.centrosCusto, filters.centroId) || 'Todos'],
    ['Conta', dims.contas.find((item) => item.id === filters.contaId)?.nome || 'Todas'],
    ['Fornecedor', (label(dims.fornecedores, filters.fornecedorId, 'fantasia') || label(dims.fornecedores, filters.fornecedorId)) || 'Todos'],
    ['Movimentos', formatNumber(movimentos.length)],
  ];
  setHtml('dreMeta', metaParts.map(([k, v]) => `<span class="chip"><strong>${k}:</strong> ${v}</span>`).join(''));

  // cenários: soma dos inputs mensais (na mesma chave de escopo da Previsão)
  const state = readForecastState();
  const scopeKey = forecastScopeKey(filters);
  const inputTotals = [0, 0, 0];
  for (const yyyyMm of periodMonths) {
    const vals = getForecastInputs(state, scopeKey, yyyyMm);
    inputTotals[0] += number(vals[0]);
    inputTotals[1] += number(vals[1]);
    inputTotals[2] += number(vals[2]);
  }
  const cen1 = fluxoPrev + inputTotals[0];
  const cen2 = fluxoPrev + inputTotals[1];
  const cen3 = fluxoPrev + inputTotals[2];
  setText('dreInput1', formatBRL(inputTotals[0]));
  setText('dreInput2', formatBRL(inputTotals[1]));
  setText('dreInput3', formatBRL(inputTotals[2]));
  setText('dreCenario1', formatBRL(cen1));
  setText('dreCenario2', formatBRL(cen2));
  setText('dreCenario3', formatBRL(cen3));

  // tabela DRE
  const avBase = entradas || 0;
  const av = (value) => (avBase ? value / avBase : NaN);
  const varIncome = (real, prev) => (!prev ? NaN : (real - prev) / Math.abs(prev));
  const varNet = (real, prev) => (!prev ? NaN : (real - prev) / Math.abs(prev));
  const varExpense = (real, prev) => {
    const pr = Math.abs(prev);
    const rr = Math.abs(real);
    return !pr ? NaN : (pr - rr) / pr;
  };

  const rows = [
    {
      key: '1',
      desc: '1 - Entradas realizadas',
      level: 0,
      real: entradas,
      prev: receberAberto,
      av: av(entradas),
      variacao: varIncome(entradas, receberAberto),
    },
    {
      key: '2',
      desc: '2 - Saídas realizadas',
      level: 0,
      real: saidas,
      prev: pagar,
      av: av(saidas),
      variacao: varExpense(saidas, pagar),
      isExpenseLine: true,
    },
    {
      key: '3',
      desc: '(=) 3 - Fluxo líquido',
      level: 0,
      real: fluxo,
      prev: fluxoPrev,
      av: av(fluxo),
      variacao: varNet(fluxo, fluxoPrev),
      children: ['3.1', '3.2'],
    },
    {
      key: '3.1',
      parent: '3',
      desc: '3.1 - A receber em aberto',
      level: 1,
      real: receberAberto,
      prev: receberAberto,
      av: av(receberAberto),
      variacao: 0,
    },
    {
      key: '3.2',
      parent: '3',
      desc: '3.2 - A pagar / comprometido',
      level: 1,
      real: pagar,
      prev: pagar,
      av: av(pagar),
      variacao: 0,
      isExpenseLine: true,
    },
    {
      key: '4',
      desc: '4 - Saldo bancário',
      level: 0,
      real: saldo,
      prev: 0,
      av: av(saldo),
      variacao: NaN,
      children: ['4.1'],
    },
    {
      key: '4.1',
      parent: '4',
      desc: '4.1 - Saldo conciliado',
      level: 1,
      real: saldoConc,
      prev: saldoConc,
      av: av(saldoConc),
      variacao: 0,
    },
    {
      key: '5',
      desc: '5 - Necessidade de captação',
      level: 0,
      real: captacao,
      prev: captacao,
      av: av(captacao),
      variacao: 0,
      isExpenseLine: true,
    },
    {
      key: '6',
      desc: '(=) 6 - Saldo final projetado',
      level: 0,
      real: saldoFinal,
      prev: saldoFinal,
      av: av(saldoFinal),
      variacao: 0,
    },
  ];

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const expanded = new Map();
  for (const r of rows) {
    if (Array.isArray(r.children) && r.children.length) expanded.set(r.key, false);
  }

  const visibleRows = () => {
    const out = [];
    for (const r of rows) {
      if (r.parent) {
        if (!expanded.get(r.parent)) continue;
      }
      out.push(r);
    }
    return out;
  };

  const renderTable = () => {
    tbody.innerHTML = '';
    for (const r of visibleRows()) {
      const tr = document.createElement('tr');

      const hasChildren = Array.isArray(r.children) && r.children.length;
      const isExpanded = hasChildren ? !!expanded.get(r.key) : false;

      const expenseCellValue = r.isExpenseLine ? -Math.abs(r.real) : r.real;
      const expensePrevValue = r.isExpenseLine ? -Math.abs(r.prev) : r.prev;

      const realCell = formatBRLAccounting(expenseCellValue);
      const prevCell = formatBRLAccounting(expensePrevValue);

      const realClass = signClass(expenseCellValue);
      const prevClass = signClass(expensePrevValue);
      const avClass = signClass(r.av);
      const varClass = signClass(r.variacao);

      const indent = Array.from({ length: r.level || 0 }).map(() => '<span class="dre-indent"></span>').join('');
      const toggle = hasChildren
        ? `<button class="dre-toggle" type="button" data-dre-toggle="${r.key}" aria-expanded="${isExpanded}">${isExpanded ? '−' : '+'}</button>`
        : '<span style="width:18px; display:inline-block"></span>';

      tr.innerHTML = `
        <td>
          <div class="dre-desc">${indent}${toggle}<span>${r.level ? '' : '+ '}${r.desc}</span></div>
        </td>
        <td class="${realClass}" style="text-align:right">${realCell}</td>
        <td class="${avClass}" style="text-align:right">${percentOrDash(r.av)}</td>
        <td class="${prevClass}" style="text-align:right">${prevCell}</td>
        <td class="${varClass}" style="text-align:right">${percentOrDash(r.variacao)}</td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('button[data-dre-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = text(btn.dataset.dreToggle);
        const row = byKey.get(key);
        if (!row || !row.children?.length) return;
        expanded.set(key, !expanded.get(key));
        renderTable();
      });
    });
  };

  renderTable();

  renderActiveFilters(filters);
}

function renderFaturamentoGeral(data, filters) {
  ensureObraIndex(data);

  const onlyEntradas = { ...filters, tipoAnalise: 'entradas' };
  const filtered = filterData(data, onlyEntradas);
  const movimentos = filtered.movimentos.filter((row) => {
    if (!isFaturamentoMovement(row)) return false;
    const obra = obraFromMovement(data, row);
    return obra && isObraFaturavel(obra);
  });

  const tbody = document.querySelector('#tblFaturamentoGeral tbody');
  const thead = document.querySelector('#tblFaturamentoGeral thead');
  if (!tbody || !thead) return;

  const months = monthsBetween(filters.inicio, filters.fim).slice(0, 12);
  const headerMonths = months.length ? months : [...new Set(movimentos.map((r) => monthKey(r.data)).filter(Boolean))].sort().slice(-4);

  const index = data._obraIndex;
  const perObra = new Map();
  const totalByMonth = new Map();
  let totalGeral = 0;
  for (const row of movimentos) {
    const key = monthKey(row.data);
    if (headerMonths.length && !headerMonths.includes(key)) continue;
    const obra = obraFromMovement(data, row);
    if (!obra || !isObraFaturavel(obra)) continue;
    const obraId = obra?.id || '-';
    const current = perObra.get(obraId) || { obraId, obraNome: obra?.nome || '(Sem obra mapeada)', months: new Map(), total: 0 };
    const v = number(row.valor);
    current.months.set(key, (current.months.get(key) || 0) + v);
    current.total += v;
    perObra.set(obraId, current);

    totalByMonth.set(key, (totalByMonth.get(key) || 0) + v);
    totalGeral += v;
  }

  const items = [...perObra.values()].sort((a, b) => b.total - a.total).slice(0, 60);

  thead.innerHTML = `
    <tr>
      <th>Obra</th>
      ${headerMonths.map((m) => `<th style=\"text-align:right\">${monthLabel(m)}<br><span class=\"small\">${m}</span></th>`).join('')}
      <th style="text-align:right">Total</th>
    </tr>
  `;

  tbody.innerHTML = '';

  {
    const tds = headerMonths
      .map((m) => `<td class="num" style="text-align:right"><strong>${formatBRL(totalByMonth.get(m) || 0)}</strong></td>`)
      .join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>TOTAL</strong></td>${tds}<td class="num" style="text-align:right"><strong>${formatBRL(totalGeral)}</strong></td>`;
    tbody.appendChild(tr);
  }

  for (const item of items) {
    const tds = headerMonths
      .map((m) => `<td class="num" style="text-align:right">${formatBRL(item.months.get(m) || 0)}</td>`)
      .join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.obraNome}</td>${tds}<td class="num" style="text-align:right">${formatBRL(item.total)}</td>`;
    tbody.appendChild(tr);
  }

  setText('faturamentoResumo', `${formatBRL(totalGeral)} em recebimentos (faturamento) no período.`);
  renderActiveFilters(filters);
}

function badgeClass(tipo) {
  if (tipo === 'Entrada') return 'income';
  if (tipo === 'Saida' || tipo === 'Comprometido') return 'expense';
  if (tipo === 'A realizar') return 'pending';
  return '';
}

function buildAnaliseRows(filtered, tipoAnalise) {
  const movements = filtered.movimentos.map((row) => ({
    data: row.data,
    tipo: row.tipo,
    documento: row.documento,
    pessoa: row.pessoaNome || row.contaNome,
    descricao: row.descricao || row.observacao,
    origem: row.origem,
    status: 'Realizado',
    entrada: row.tipo === 'Entrada' ? row.valor : 0,
    saida: row.tipo === 'Saida' ? row.valor : 0,
  }));

  const payables = filtered.despesas.map((row) => ({
    data: row.data,
    tipo: 'Comprometido',
    documento: row.documento,
    pessoa: row.fornecedorNome,
    descricao: row.observacao,
    origem: row.origem || 'CP',
    status: row.status || 'A pagar',
    entrada: 0,
    saida: row.valor,
  }));

  const receivables = filtered.titulosReceber
    .filter((row) => !row.quitado)
    .map((row) => ({
      data: row.data,
      tipo: 'A realizar',
      documento: row.documento,
      pessoa: row.clienteNome,
      descricao: row.observacao,
      origem: 'CR',
      status: row.status,
      entrada: row.valor,
      saida: 0,
    }));

  if (tipoAnalise === 'realizado' || tipoAnalise === 'entradas' || tipoAnalise === 'saidas') return movements;
  if (tipoAnalise === 'comprometido') return payables;
  if (tipoAnalise === 'a_realizar') return [...receivables, ...payables];
  return [...movements, ...receivables, ...payables];
}

function seriesByDay(movimentos) {
  const map = new Map();
  for (const row of movimentos) {
    if (!row.data) continue;
    if (!map.has(row.data)) map.set(row.data, { date: row.data, income: 0, expense: 0, net: 0 });
    const bucket = map.get(row.data);
    if (row.tipo === 'Entrada') bucket.income += row.valor;
    if (row.tipo === 'Saida') bucket.expense += row.valor;
    bucket.net = bucket.income - bucket.expense;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function drawBars(canvas, points) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 260;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);

  if (!points.length) {
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.font = '12px Segoe UI';
    ctx.fillText('Sem dados para os filtros selecionados.', 14, 26);
    canvas.__tooltipState = null;
    return;
  }

  const pad = 18;
  const maxY = Math.max(1, ...points.map((p) => Math.max(p.income, p.expense)));
  const chartW = w - pad * 2;
  const chartH = h - pad * 2;
  const group = chartW / points.length;
  const barW = Math.max(3, Math.min(18, group / 3));

  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  points.forEach((point, index) => {
    const base = h - pad;
    const x = pad + index * group;
    const incomeH = (point.income / maxY) * chartH;
    const expenseH = (point.expense / maxY) * chartH;
    ctx.fillStyle = '#5fc178';
    ctx.fillRect(x + group * 0.35 - barW, base - incomeH, barW, incomeH);
    ctx.fillStyle = '#ff6758';
    ctx.fillRect(x + group * 0.65, base - expenseH, barW, expenseH);
  });

  canvas.__tooltipState = {
    getText(mouseX) {
      if (mouseX < pad || mouseX > w - pad) return '';
      const index = Math.max(0, Math.min(points.length - 1, Math.floor((mouseX - pad) / Math.max(1, group))));
      const p = points[index];
      if (!p) return '';
      const dateLabel = p.date ? formatIsoBr(p.date) : '';
      const inLabel = `Entradas: ${formatBRL(p.income)}`;
      const outLabel = `Saídas: ${formatBRL(p.expense)}`;
      const netLabel = `Líquido: ${formatBRLAccounting(p.net)}`;
      return dateLabel ? `${dateLabel} • ${inLabel} • ${outLabel} • ${netLabel}` : `${inLabel} • ${outLabel} • ${netLabel}`;
    },
  };
  bindCanvasTooltip(canvas);
}

function drawLineArea(canvas, points) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 260;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);

  if (!points.length) {
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.font = '12px Segoe UI';
    ctx.fillText('Sem dados para os filtros selecionados.', 14, 26);
    canvas.__tooltipState = null;
    return;
  }

  const values = points.map((p) => p.value);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const span = Math.max(1, maxY - minY);
  const pad = 18;
  const chartW = w - pad * 2;
  const chartH = h - pad * 2;
  const x = (i) => pad + (i * chartW) / Math.max(1, points.length - 1);
  const y = (v) => pad + ((maxY - v) * chartH) / span;

  ctx.beginPath();
  ctx.moveTo(x(0), h - pad);
  points.forEach((point, index) => ctx.lineTo(x(index), y(point.value)));
  ctx.lineTo(x(points.length - 1), h - pad);
  ctx.closePath();
  ctx.fillStyle = 'rgba(95,193,120,.12)';
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(x(index), y(point.value));
    else ctx.lineTo(x(index), y(point.value));
  });
  ctx.strokeStyle = '#5fc178';
  ctx.lineWidth = 2;
  ctx.stroke();

  canvas.__tooltipState = {
    getText(mouseX) {
      if (mouseX < pad || mouseX > w - pad) return '';
      const idx = Math.max(0, Math.min(points.length - 1, Math.round(((mouseX - pad) / Math.max(1, chartW)) * Math.max(1, points.length - 1))));
      const p = points[idx];
      if (!p) return '';
      const dateLabel = p.date ? formatIsoBr(p.date) : '';
      const valueLabel = formatBRLAccounting(p.value);
      return dateLabel ? `${dateLabel} • ${valueLabel}` : valueLabel;
    },
  };
  bindCanvasTooltip(canvas);
}

function renderGauge(container, value, min, max) {
  if (!container) return;
  const safeMin = Number.isFinite(min) ? min : -1;
  const safeMax = Number.isFinite(max) ? max : 1;
  const safeValue = number(value);
  const t = Math.max(0, Math.min(1, (safeValue - safeMin) / Math.max(1, safeMax - safeMin)));
  const angle = -90 + t * 180;

  container.innerHTML = `
    <svg viewBox="0 0 220 140" role="img" aria-label="Medidor de saldo liquido">
      <defs>
        <linearGradient id="gaugeGradient" x1="0" x2="1">
          <stop offset="0" stop-color="#ff6758" />
          <stop offset=".5" stop-color="rgba(255,255,255,.38)" />
          <stop offset="1" stop-color="#5fc178" />
        </linearGradient>
      </defs>
      <path d="M 20 120 A 90 90 0 0 1 200 120" fill="none" stroke="url(#gaugeGradient)" stroke-width="14" stroke-linecap="round" />
      <g transform="translate(110 120)">
        <circle r="6" fill="rgba(255,255,255,.65)" />
        <g transform="rotate(${angle})">
          <line x1="0" y1="0" x2="0" y2="-76" stroke="rgba(255,255,255,.78)" stroke-width="3" stroke-linecap="round" />
        </g>
      </g>
      <text x="110" y="134" text-anchor="middle" fill="rgba(255,255,255,.78)" font-size="12">${formatBRL(safeValue)}</text>
    </svg>
  `;
}

function renderActiveFilters(filters) {
  const node = el('activeFilters');
  if (!node || !APP_DATA) return;
  const dims = APP_DATA.dimensoes;
  const label = (list, id, field = 'nome') => list.find((item) => item.id === id)?.[field] || '';
  const parts = [
    ['Empresa', label(dims.empresas, filters.empresaId, 'fantasia') || label(dims.empresas, filters.empresaId)],
    ['Centro de custo', label(dims.centrosCusto, filters.centroId)],
    ['Obra', label(dims.obras, filters.obraId)],
    ['Conta', dims.contas.find((item) => item.id === filters.contaId)?.nome],
    ['Cliente', label(dims.clientes, filters.clienteId, 'fantasia') || label(dims.clientes, filters.clienteId)],
    ['Fornecedor', label(dims.fornecedores, filters.fornecedorId, 'fantasia') || label(dims.fornecedores, filters.fornecedorId)],
    ['Análise', analysisLabel(filters.tipoAnalise)],
    ['Período', `${filters.inicio || '-'} até ${filters.fim || '-'}`],
    ['Busca', filters.busca],
  ].filter(([, value]) => text(value));

  node.innerHTML = parts
    .map(([key, value]) => `<span class="chip"><strong>${key}:</strong> ${value}</span>`)
    .join('');
}

function analysisLabel(value) {
  const labels = {
    todos: 'Todos',
    realizado: 'Realizado',
    comprometido: 'Comprometido',
    a_realizar: 'A realizar',
    entradas: 'Somente entradas',
    saidas: 'Somente saídas',
  };
  return labels[value] || 'Todos';
}

function renderRows(tableSelector, rows, maxRows = 80) {
  const tbody = document.querySelector(`${tableSelector} tbody`);
  if (!tbody) return;
  tbody.innerHTML = '';

  const visibleRows = rows
    .sort((a, b) => text(b.data).localeCompare(text(a.data)))
    .slice(0, maxRows);

  let saldo = 0;
  for (const row of visibleRows.slice().reverse()) {
    saldo += number(row.entrada) - number(row.saida);
    row.saldo = saldo;
  }

  for (const row of visibleRows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.data || ''}</td>
      <td><span class="badge ${badgeClass(row.tipo)}">${row.tipo}</span></td>
      <td>${row.documento || ''}</td>
      <td>${row.origem || ''}</td>
      <td>${(row.pessoa || '').slice(0, 52)}</td>
      <td>${(row.descricao || '').slice(0, 72)}</td>
      <td style="text-align:right">${row.entrada ? formatBRL(row.entrada) : ''}</td>
      <td style="text-align:right">${row.saida ? formatBRL(row.saida) : ''}</td>
      <td>${row.status || ''}</td>
    `;
    tbody.appendChild(tr);
  }

  const note = el('limitNote');
  if (note) {
    note.textContent =
      rows.length > maxRows
        ? `Mostrando ${formatNumber(maxRows)} de ${formatNumber(rows.length)} registros. Use os filtros para refinar.`
        : `${formatNumber(rows.length)} registros encontrados.`;
  }
}

function renderDashboard(data, filters) {
  const filtered = filterData(data, filters);
  const movimentos = filtered.movimentos;
  const entradas = sum(movimentos, (row) => (row.tipo === 'Entrada' ? row.valor : 0));
  const saidas = sum(movimentos, (row) => (row.tipo === 'Saida' ? row.valor : 0));
  const liquido = entradas - saidas;
  const saldos = sum(filtered.saldos, (row) => row.valor);
  const saldosConciliados = sum(filtered.saldos, (row) => row.valorConciliado);
  const aReceber = sum(filtered.titulosReceber.filter((row) => !row.quitado), (row) => row.valor);
  const aPagar = sum(filtered.despesas, (row) => row.valor);
  const fluxoPrevisto = aReceber - aPagar;
  const necessidade = Math.max(0, -liquido);
  const margem = entradas ? liquido / entradas : null;

  setText('kpiSaldoAtual', formatBRL(saldos));
  setText('kpiSaldoConciliado', formatBRL(saldosConciliados));
  setText('kpiEntradas', formatBRL(entradas));
  setText('kpiSaidas', formatBRL(saidas));
  setText('kpiAReceber', formatBRL(aReceber));
  setText('kpiAPagar', formatBRL(aPagar));
  setText('kpiLiquido', formatBRL(liquido));
  setText('kpiFluxoPrevisto', formatBRL(fluxoPrevisto));
  setText('kpiNecessidade', formatBRL(necessidade));
  setText('kpiMargem', margem === null ? '-' : formatPct(margem));
  setText('kpiMovimentos', formatNumber(movimentos.length));
  setText('kpiPeriodo', `${filters.inicio || '-'} até ${filters.fim || '-'}`);
  setText('kpiDadosTratados', `${formatNumber(data.meta.totais.movimentos)} movimentos tratados`);

  const rows = buildAnaliseRows(filtered, filters.tipoAnalise);
  LAST_EXPORT_ROWS = rows;
  renderRows('#tblResultadoAnalise', rows, 80);

  const days = seriesByDay(movimentos);
  drawBars(el('chartDailyBars'), days);

  let acc = 0;
  const cumulative = days.map((point) => {
    acc += point.net;
    return { date: point.date, value: acc };
  });
  drawLineArea(el('chartCumulative'), cumulative);

  const absMax = Math.max(1, Math.abs(entradas), Math.abs(saidas), Math.abs(liquido));
  renderGauge(el('gaugeLiquido'), liquido, -absMax, absMax);

  renderRankings(data, movimentos);
  renderActiveFilters(filters);
}

function renderFluxo(data, filters) {
  const filtered = filterData(data, filters);
  const movimentos = filtered.movimentos;
  const rows = buildAnaliseRows(filtered, filters.tipoAnalise);
  LAST_EXPORT_ROWS = rows;

  const entradas = sum(movimentos, (row) => (row.tipo === 'Entrada' ? row.valor : 0));
  const saidas = sum(movimentos, (row) => (row.tipo === 'Saida' ? row.valor : 0));
  const liquido = entradas - saidas;
  const origens = new Set(movimentos.map((row) => row.origem).filter(Boolean));

  setText('periodoLabel', `${filters.inicio || '-'} até ${filters.fim || '-'}`);
  setText('qtdRegistros', formatNumber(rows.length));
  setText('kpiEntradas', formatBRL(entradas));
  setText('kpiSaidas', formatBRL(saidas));
  setText('kpiLiquido', formatBRL(liquido));
  setText('kpiOrigens', formatNumber(origens.size));

  renderRows('#tblFluxoAnalitico', rows, 250);

  const days = seriesByDay(movimentos);
  drawBars(el('chartDailyBars'), days);
  let acc = 0;
  drawLineArea(
    el('chartCumulative'),
    days.map((point) => {
      acc += point.net;
      return { date: point.date, value: acc };
    })
  );
  const absMax = Math.max(1, Math.abs(entradas), Math.abs(saidas), Math.abs(liquido));
  renderGauge(el('gaugeLiquido'), liquido, -absMax, absMax);
  renderActiveFilters(filters);
}

function renderRankings(data, movimentos) {
  const centroTotals = new Map();
  const empresaTotals = new Map();

  for (const row of movimentos) {
    const signed = row.tipo === 'Saida' ? -row.valor : row.valor;
    if (row.empresaId) empresaTotals.set(row.empresaId, (empresaTotals.get(row.empresaId) || 0) + signed);
    for (const centroId of row.centroCustoIds) {
      centroTotals.set(centroId, (centroTotals.get(centroId) || 0) + signed);
    }
  }

  const topCentro = [...centroTotals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const topEmpresa = [...empresaTotals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];

  const centroNome = topCentro
    ? data.dimensoes.centrosCusto.find((centro) => centro.id === topCentro[0])?.nome || topCentro[0]
    : '-';
  const empresa = topEmpresa ? data.dimensoes.empresas.find((item) => item.id === topEmpresa[0]) : null;
  const empresaNome = empresa ? empresa.fantasia || empresa.nome : '-';

  setText('topCentroCusto', topCentro ? `${centroNome} • ${formatBRL(topCentro[1])}` : '-');
  setText('topEmpresas', topEmpresa ? `${empresaNome} • ${formatBRL(topEmpresa[1])}` : '-');
}

function exportCsv(rows) {
  if (!rows.length) return;
  const headers = ['Data', 'Tipo', 'Documento', 'Origem', 'Cliente/Fornecedor', 'Descricao', 'Entradas', 'Saidas', 'Status'];
  const lines = rows.map((row) =>
    [
      row.data,
      row.tipo,
      row.documento,
      row.origem,
      row.pessoa,
      row.descricao,
      number(row.entrada).toFixed(2).replace('.', ','),
      number(row.saida).toFixed(2).replace('.', ','),
      row.status,
    ]
      .map((value) => `"${text(value).replaceAll('"', '""')}"`)
      .join(';')
  );

  const blob = new Blob([[headers.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashboard_financeiro_${toIsoDate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function updateSiengeStatus(status, message, kind = '') {
  if (!status) return;
  status.textContent = message || '';
  status.className = `sync-status ${kind}`.trim();
}

function updateSiengeButton(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  button.textContent = busy ? 'Atualizando...' : 'Atualizar Sienge';
}

function updateWeeklyReportButton(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  button.textContent = busy ? 'Enviando...' : 'Enviar relatório';
}

function siengeUpdateSupport() {
  const protocol = text(window.location?.protocol);
  const host = text(window.location?.hostname);

  if (protocol === 'file:') {
    return { ok: false, reason: 'Abra pelo servidor local: scripts/serve_web.ps1' };
  }

  // O endpoint /api/atualizar-sienge só existe no servidor local.
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocalhost) return { ok: false, reason: '' };

  return { ok: true, reason: '' };
}

async function runWeeklyReportEmail(button, status) {
  if (WEEKLY_REPORT_RUNNING) return;
  WEEKLY_REPORT_RUNNING = true;
  updateWeeklyReportButton(button, true);
  updateSiengeStatus(status, 'Enviando relatório semanal...');

  try {
    const support = siengeUpdateSupport();
    if (!support.ok) throw new Error(support.reason);

    const response = await fetch(SEND_WEEKLY_REPORT_URL, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok || !payload?.ok) {
      const message = payload?.error || payload?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    updateSiengeStatus(status, 'Relatório enviado.', 'success');
    updateWeeklyReportButton(button, false);
  } catch (error) {
    updateSiengeStatus(status, error.message || 'Falha ao enviar relatório.', 'error');
    updateWeeklyReportButton(button, false);
  } finally {
    WEEKLY_REPORT_RUNNING = false;
  }
}

async function runSiengeUpdate(button, status) {
  if (SIENGE_UPDATE_RUNNING) return;
  SIENGE_UPDATE_RUNNING = true;
  updateSiengeButton(button, true);
  updateSiengeStatus(status, 'Baixando dados do Sienge...');

  try {
    const support = siengeUpdateSupport();
    if (!support.ok) throw new Error(support.reason);

    const response = await fetch(UPDATE_SIENGE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok || !payload?.ok) {
      const message = payload?.error || payload?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    APP_DATA = null;
    updateSiengeStatus(status, 'Sienge atualizado. Recarregando...', 'success');
    window.setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    updateSiengeStatus(status, error.message || 'Falha ao atualizar Sienge.', 'error');
    updateSiengeButton(button, false);
  } finally {
    SIENGE_UPDATE_RUNNING = false;
  }
}

function initSiengeUpdater() {
  const target = document.querySelector('.topbar .dre-actions') || document.querySelector('.topbar .controls');
  if (!target || target.querySelector('[data-action="atualizar-sienge"]')) return;

  const support = siengeUpdateSupport();
  if (!support.ok) return;

  const button = document.createElement('button');
  button.className = 'button primary sync-button';
  button.type = 'button';
  button.dataset.action = 'atualizar-sienge';
  button.textContent = 'Atualizar Sienge';

  const buttonReport = document.createElement('button');
  buttonReport.className = 'button sync-button';
  buttonReport.type = 'button';
  buttonReport.dataset.action = 'enviar-relatorio';
  buttonReport.textContent = 'Enviar relatório';

  const status = document.createElement('span');
  status.className = 'sync-status';
  status.setAttribute('aria-live', 'polite');

  button.addEventListener('click', () => {
    void runSiengeUpdate(button, status);
  });

  buttonReport.addEventListener('click', () => {
    void runWeeklyReportEmail(buttonReport, status);
  });

  target.appendChild(button);
  target.appendChild(buttonReport);
  target.appendChild(status);
}

async function initFilters(onApply) {
  if (!hasFilterUI()) return;
  const data = await loadData();
  let filters = sanitizeFiltersForPage(readState());
  populateFilters(data, filters);
  setFiltersToUI(filters);

  const apply = (nextFilters) => {
    filters = sanitizeFiltersForPage(nextFilters);
    populateFilters(data, filters);
    setFiltersToUI(filters);
    saveState(filters);
    onApply(data, filters);
  };

  el('filterEmpresa')?.addEventListener('change', () => {
    const next = { ...filters, ...getFiltersFromUI(), centroId: '', obraId: '', contaId: '' };
    populateFilters(data, next);
    setFiltersToUI(next);
    filters = next;
  });

  el('filterCentroCusto')?.addEventListener('change', () => {
    const next = { ...filters, ...getFiltersFromUI() };
    setFiltersToUI(next);
    filters = next;
  });

  el('filterObra')?.addEventListener('change', () => {
    const next = { ...filters, ...getFiltersFromUI() };
    setFiltersToUI(next);
    filters = next;
  });

  el('filterApply')?.addEventListener('click', () => apply(getFiltersFromUI()));
  el('filterClear')?.addEventListener('click', () => apply(defaultFilters()));
  el('filterExport')?.addEventListener('click', () => exportCsv(LAST_EXPORT_ROWS));
  el('filterMonth')?.addEventListener('click', () =>
    apply({ ...getFiltersFromUI(), inicio: currentMonthStart(), fim: currentMonthEnd() })
  );
  el('filterYear')?.addEventListener('click', () =>
    apply({ ...getFiltersFromUI(), inicio: currentYearStart(), fim: toIsoDate(new Date()) })
  );

  el('filterBusca')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply(getFiltersFromUI());
    }
  });

  apply(filters);
}

function markCurrentNav() {
  const current = document.body.dataset.page;
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

async function boot() {
  markCurrentNav();
  lockGlobalTipoAnaliseCheckboxes();
  initSiengeUpdater();
  const page = document.body.dataset.page;
  try {
    if (page === 'referencias') {
      if (hasFilterUI()) {
        await initFilters(renderReferenciasPage);
      } else {
        const data = await loadData();
        const filters = readState();
        await renderReferenciasPage(data, filters);
      }
      return;
    }
    if (page === 'visao-geral') await initFilters(renderDashboard);
    if (page === 'dre') await initFilters(renderDre);
    if (page === 'fluxo-analitico') await initFilters(renderFluxo);
    if (page === 'previsao-maio') await initFilters((data, filters) => renderPrevisaoMaio(data, filters));
    if (page === 'faturamento-geral') await initFilters(renderFaturamentoGeral);
    if (page === 'relatorio-faturamento') await initFilters(renderRelatorioFaturamento);
    if (page === 'financeiro-obras') await initFilters(renderFinanceiroObras);
  } catch (error) {
    const box = el('errorBox');
    if (box) {
      box.style.display = 'block';
      box.textContent = `Erro ao carregar os dados tratados. Rode o servidor local e tente novamente. Detalhe: ${error.message || error}`;
    }
    console.error(error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void boot();
});
