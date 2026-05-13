const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const dataFile = path.join(root, 'web', 'data', 'dashboard_financeiro.json');
const reportsDir = path.join(root, 'reports');
const snapshotsDir = path.join(reportsDir, 'snapshots');
const weeklyDir = path.join(reportsDir, 'weekly');

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readFileIfExists(filePath) {
  try {
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function findLogoDataUri() {
  const candidates = [
    path.join(root, 'web', 'assets', 'logo.png'),
    path.join(root, 'web', 'assets', 'logo.jpg'),
    path.join(root, 'web', 'assets', 'logo.jpeg'),
    path.join(root, 'web', 'assets', 'logo.webp'),
    path.join(root, 'reports', 'assets', 'logo.png'),
    path.join(root, 'reports', 'assets', 'logo.jpg'),
    path.join(root, 'reports', 'assets', 'logo.jpeg'),
    path.join(root, 'reports', 'assets', 'logo.webp'),
  ];

  for (const filePath of candidates) {
    const buf = readFileIfExists(filePath);
    if (!buf) continue;
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : null;
    if (!mime) continue;
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  return null;
}

function parseIsoDate(iso) {
  const [y, m, d] = text(iso)
    .slice(0, 10)
    .split('-')
    .map((p) => Number(p));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function isoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfIsoWeekUtc(date) {
  // ISO week starts Monday.
  const d = new Date(date.getTime());
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function inRangeUtc(iso, startUtc, endUtc) {
  const d = parseIsoDate(iso);
  if (!d) return false;
  return d >= startUtc && d <= endUtc;
}

function sum(list, fn) {
  let total = 0;
  for (const item of list || []) total += number(fn(item));
  return total;
}

function distinctCount(list, fn) {
  const set = new Set();
  for (const item of list || []) {
    const key = text(fn(item));
    if (key) set.add(key);
  }
  return set.size;
}

function duplicatesById(list, idField = 'id') {
  const seen = new Set();
  const dups = new Set();
  for (const row of list || []) {
    const id = text(row?.[idField]);
    if (!id) continue;
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

function safeReadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listSnapshots() {
  if (!fs.existsSync(snapshotsDir)) return [];
  return fs
    .readdirSync(snapshotsDir)
    .filter((name) => name.startsWith('dashboard_') && name.endsWith('.json'))
    .sort();
}

function latestSnapshotPath() {
  const names = listSnapshots();
  if (!names.length) return null;
  return path.join(snapshotsDir, names[names.length - 1]);
}

function latestSnapshotPathBefore(runDateIso) {
  const cutoff = text(runDateIso);
  const names = listSnapshots().filter((name) => {
    const m = /^dashboard_(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (!m) return false;
    return m[1] < cutoff;
  });
  if (!names.length) return null;
  return path.join(snapshotsDir, names[names.length - 1]);
}

function getFacts(data) {
  const facts = data?.fatos;
  if (facts && typeof facts === 'object') return facts;
  return data || {};
}

function toBRL(value) {
  const v = number(value);
  const safe = Object.is(v, -0) ? 0 : v;
  return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toPct(value, digits = 1) {
  const n = number(value);
  const safe = Object.is(n, -0) ? 0 : n;
  const abs = Math.abs(safe);
  const s = safe > 0 ? '+' : safe < 0 ? '-' : '';
  return `${s}${abs.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function pctChange(now, prev) {
  const n = number(now);
  const p = number(prev);
  if (!p) return 0;
  return ((n - p) / Math.abs(p)) * 100;
}

function htmlEscape(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function delta(now, prev) {
  return number(now) - number(prev);
}

function sign(value) {
  const n = number(value);
  if (n > 0) return '+';
  if (n < 0) return '';
  return '';
}

function cls(value) {
  const n = number(value);
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'zero';
}

function buildWeekMetrics(data, startUtc, endUtc) {
  const facts = getFacts(data);
  const movimentos = (facts?.movimentos || []).filter((r) => inRangeUtc(r.data, startUtc, endUtc));
  const despesas = (facts?.despesas || []).filter((r) => inRangeUtc(r.data, startUtc, endUtc));
  const titulos = (facts?.titulosReceber || []).filter((r) => inRangeUtc(r.data, startUtc, endUtc));

  const entradas = sum(movimentos, (r) => (r.tipo === 'Entrada' ? r.valor : 0));
  const saidas = sum(movimentos, (r) => (r.tipo === 'Saida' ? r.valor : 0));
  const liquido = entradas - saidas;

  return {
    range: { start: isoDateUtc(startUtc), end: isoDateUtc(endUtc) },
    movimentos: {
      count: movimentos.length,
      entradas,
      saidas,
      liquido,
      empresas: distinctCount(movimentos, (r) => r.empresaId),
      contas: distinctCount(movimentos, (r) => r.contaId),
      origens: distinctCount(movimentos, (r) => r.origem),
    },
    despesas: {
      count: despesas.length,
      total: sum(despesas, (r) => r.valor),
      empresas: distinctCount(despesas, (r) => r.empresaId),
      fornecedores: distinctCount(despesas, (r) => r.fornecedorId),
    },
    titulosReceber: {
      count: titulos.length,
      total: sum(titulos, (r) => r.valor),
      empresas: distinctCount(titulos, (r) => r.empresaId),
      clientes: distinctCount(titulos, (r) => r.clienteId),
    },
  };
}

function buildWeekRangeSeries(data, endWeekStartUtc, points = 6) {
  // Builds a series for the last N closed weeks (Mon..Sun) ending at endWeekStartUtc+6.
  // We need N points and comparisons vs previous week, so compute N+1 ranges.
  const ranges = [];
  for (let i = points; i >= 0; i--) {
    const start = addDaysUtc(endWeekStartUtc, -7 * i);
    const end = addDaysUtc(start, 6);
    ranges.push({ start, end });
  }

  const metrics = ranges.map((r) => buildWeekMetrics(data, r.start, r.end));
  const labels = metrics.slice(1).map((m) => {
    const d = parseIsoDate(m.range.start);
    if (!d) return m.range.start;
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  });

  const growthPct = [];
  const spendPct = [];

  for (let i = 1; i < metrics.length; i++) {
    const now = metrics[i];
    const prev = metrics[i - 1];
    growthPct.push(pctChange(now.movimentos.liquido, prev.movimentos.liquido));
    // "Baixa" aqui interpretada como variacao de saidas (negativo = reduziu saidas)
    spendPct.push(pctChange(now.movimentos.saidas, prev.movimentos.saidas));
  }

  return {
    labels,
    growthPct,
    spendPct,
  };
}

function buildChartSvg(series) {
  const width = 520;
  const height = 190;
  const padX = 0;
  const padYTop = 18;
  const padYBottom = 20;
  const points = series.growthPct.length;

  const all = [...series.growthPct, ...series.spendPct];
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = -5;
    max = 5;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  // Add some breathing room
  const margin = Math.max(2, (max - min) * 0.15);
  min -= margin;
  max += margin;

  const xAt = (i) => (points <= 1 ? width / 2 : padX + (i * (width - 2 * padX)) / (points - 1));
  const yAt = (v) => {
    const t = (v - min) / (max - min);
    const y = padYTop + (1 - t) * (height - padYTop - padYBottom);
    return Math.max(padYTop, Math.min(height - padYBottom, y));
  };

  const ptsGrowth = series.growthPct.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const ptsSpend = series.spendPct.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');

  const labelGrowth = series.growthPct
    .map((v, i) => {
      const x = xAt(i);
      const y = yAt(v) - 12;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${htmlEscape(toPct(v))}</text>`;
    })
    .join('');

  const labelSpend = series.spendPct
    .map((v, i) => {
      const x = xAt(i);
      const y = yAt(v) + 20;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${htmlEscape(toPct(v))}</text>`;
    })
    .join('');

  const circles = (values, color) =>
    values
      .map((v, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="6" />`)
      .join('');

  return `\
<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">\
  <polyline points="${ptsGrowth}" fill="none" stroke="#5caf2d" stroke-width="5" />\
  <polyline points="${ptsSpend}" fill="none" stroke="#f39a05" stroke-width="5" />\
  <g fill="#5caf2d">${circles(series.growthPct, '#5caf2d')}</g>\
  <g fill="#f39a05">${circles(series.spendPct, '#f39a05')}</g>\
  <g font-size="14" fill="#0d2b3a" font-weight="700" text-anchor="middle">${labelGrowth}</g>\
  <g font-size="14" fill="#ff6b00" font-weight="700" text-anchor="middle">${labelSpend}</g>\
</svg>`;
}

function findEdgeExecutable() {
  const env = text(process.env.EDGE_PATH);
  if (env && fs.existsSync(env)) return env;

  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function renderPdfWithEdge({ htmlPath, pdfPath }) {
  const edge = findEdgeExecutable();
  if (!edge) {
    throw new Error('Nao encontrei o Microsoft Edge (msedge.exe) para gerar o PDF. Defina EDGE_PATH ou instale o Edge.');
  }

  const fileUrl = pathToFileURL(htmlPath).toString();
  const args = [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--print-to-pdf-no-header',
    `--print-to-pdf=${pdfPath}`,
    fileUrl,
  ];

  const res = spawnSync(edge, args, { encoding: 'utf8', timeout: 120000 });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`Falha ao gerar PDF via Edge (code=${res.status}). ${text(res.stderr || res.stdout)}`);
  }
  if (!fs.existsSync(pdfPath)) {
    throw new Error('Edge executou, mas o PDF nao foi gerado.');
  }
}

function buildSnapshotSummary(data) {
  const meta = data?.meta || {};
  const totais = meta?.totais || {};

  const facts = getFacts(data);
  const saldos = facts?.saldos || [];
  const saldoAtual = sum(saldos, (r) => r.valor);
  const saldoConc = sum(saldos, (r) => r.valorConciliado);

  return {
    geradoEm: text(meta.geradoEm),
    periodoPadraoInicio: text(meta.periodoPadraoInicio),
    periodoPadraoFim: text(meta.periodoPadraoFim),
    totais: {
      movimentos: number(totais.movimentos),
      despesas: number(totais.despesas),
      titulosReceber: number(totais.titulosReceber),
      saldos: number(totais.saldos),
      contas: number(totais.contas),
      empresas: number(totais.empresas),
      centrosCusto: number(totais.centrosCusto),
      obras: number(totais.obras),
      clientes: number(totais.clientes),
      fornecedores: number(totais.fornecedores),
    },
    saldos: {
      saldoAtual,
      saldoConciliado: saldoConc,
    },
    duplicidades: {
      movimentosIdDuplicado: duplicatesById(facts?.movimentos || []).length,
      despesasIdDuplicado: duplicatesById(facts?.despesas || []).length,
      titulosReceberIdDuplicado: duplicatesById(facts?.titulosReceber || [], 'id').length,
    },
  };
}

function buildHtmlReport(context) {
  const { runDateIso, week, prevWeek, snapshotNow } = context;

  const facts = getFacts(context.data);

  const logoDataUri = findLogoDataUri();
  const weekStart = week.range.start;
  const weekEnd = week.range.end;

  const pctLiquido = pctChange(week.movimentos.liquido, prevWeek.movimentos.liquido);
  const pctSaidas = pctChange(week.movimentos.saidas, prevWeek.movimentos.saidas);
  const pctEntradas = pctChange(week.movimentos.entradas, prevWeek.movimentos.entradas);

  const empresasAtivasSemana = week.movimentos.empresas;
  const empreendimentos = snapshotNow.totais.obras || snapshotNow.totais.empresas || 0;

  const series = buildWeekRangeSeries(context.data, startOfIsoWeekUtc(parseIsoDate(week.range.start) || new Date()), 6);
  const svgChart = buildChartSvg(series);

  // Ranking simples: top 4 empresas por valor absoluto do fluxo liquido na semana
  const weekStartUtc = parseIsoDate(weekStart);
  const weekEndUtc = parseIsoDate(weekEnd);
  const prevStartUtc = parseIsoDate(prevWeek.range.start);
  const prevEndUtc = parseIsoDate(prevWeek.range.end);

  const movimentosSemana = (facts?.movimentos || []).filter((r) => (weekStartUtc && weekEndUtc ? inRangeUtc(r.data, weekStartUtc, weekEndUtc) : false));
  const movPrev = (facts?.movimentos || []).filter((r) => (prevStartUtc && prevEndUtc ? inRangeUtc(r.data, prevStartUtc, prevEndUtc) : false));

  const byEmpresa = new Map();
  const byEmpresaPrev = new Map();
  const add = (map, r) => {
    const id = text(r.empresaId) || '0';
    const name = text(r.empresaNome) || `Empresa ${id}`;
    const curr = map.get(id) || { id, name, entradas: 0, saidas: 0, movimentos: 0 };
    if (r.tipo === 'Entrada') curr.entradas += number(r.valor);
    if (r.tipo === 'Saida') curr.saidas += number(r.valor);
    curr.movimentos += 1;
    map.set(id, curr);
  };
  for (const r of movimentosSemana) add(byEmpresa, r);
  for (const r of movPrev) add(byEmpresaPrev, r);

  const rows = [...byEmpresa.values()].map((r) => {
    const prev = byEmpresaPrev.get(r.id) || { entradas: 0, saidas: 0, movimentos: 0 };
    const liquido = r.entradas - r.saidas;
    const prevLiquido = prev.entradas - prev.saidas;
    const perf = pctChange(liquido, prevLiquido);
    const baixa = pctChange(r.saidas, prev.saidas);
    const cresc = pctChange(r.entradas, prev.entradas);
    return { ...r, liquido, perf, baixa, cresc, prevMovimentos: prev.movimentos };
  });
  rows.sort((a, b) => Math.abs(b.liquido) - Math.abs(a.liquido));
  const topRows = rows.slice(0, 4);

  const totalRow = {
    name: 'Total Geral',
    movimentos: week.movimentos.count,
    cresc: pctEntradas,
    baixa: pctSaidas,
    perf: pctLiquido,
    isTotal: true,
  };

  const tr = (r) => {
    const fmtMov = r.isTotal ? String(r.movimentos) : String(r.movimentos);
    const fmtC = toPct(r.cresc);
    const fmtB = toPct(r.baixa);
    const fmtP = toPct(r.perf);
    const clsC = r.cresc >= 0 ? 'positive' : 'negative';
    const clsB = r.baixa >= 0 ? 'negative' : 'positive';
    const clsP = r.perf >= 0 ? 'positive' : 'negative';
    return `<tr${r.isTotal ? ' class="total"' : ''}><td>${htmlEscape(r.name)}</td><td>${htmlEscape(fmtMov)}</td><td class="${clsC}">${htmlEscape(fmtC)}</td><td class="${clsB}">${htmlEscape(fmtB)}</td><td class="${clsP}">${htmlEscape(fmtP)}</td></tr>`;
  };

  const logoTag = logoDataUri
    ? `<img src="${logoDataUri}" alt="Dinâmica Empreendimentos" />`
    : `<div style="width:345px;height:105px"></div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório Semanal - Dinâmica Empreendimentos</title>
  <style>
    :root {
      --verde: #5caf2d;
      --verde-claro: #eef8ea;
      --azul: #062536;
      --azul-2: #0c3346;
      --laranja: #f39a05;
      --cinza: #eef2f4;
      --texto: #0d2b3a;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: #f3f6f7;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--texto);
    }

    .page {
      width: 1120px;
      margin: 30px auto;
      background: #fff;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,.12);
    }

    .content { padding: 44px 54px 34px; }

    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      border-bottom: 4px solid var(--verde);
      padding-bottom: 28px;
      margin-bottom: 30px;
    }

    .logo img {
      width: 345px;
      max-height: 105px;
      object-fit: contain;
    }

    .title-box { text-align: right; }
    .title-box h1 {
      margin: 0 0 12px;
      color: var(--azul);
      font-size: 36px;
      letter-spacing: .5px;
    }
    .title-box p {
      margin: 0;
      font-size: 22px;
      color: #39515c;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--azul);
      margin: 22px 0 18px;
      font-size: 24px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .icon-bars {
      display: inline-grid;
      grid-template-columns: repeat(3, 8px);
      gap: 4px;
      align-items: end;
      height: 28px;
    }
    .icon-bars span { display:block; width:8px; background:var(--verde); border-radius:3px; }
    .icon-bars span:nth-child(1){height:14px}.icon-bars span:nth-child(2){height:21px}.icon-bars span:nth-child(3){height:28px}

    .kpis {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 16px;
      margin-bottom: 18px;
    }

    .card {
      background: #fff;
      border: 1px solid #dfe6ea;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,.04);
    }

    .kpi {
      padding: 20px 14px;
      text-align: center;
      min-height: 188px;
    }

    .circle {
      width: 62px;
      height: 62px;
      margin: 0 auto 12px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 30px;
      color: #fff;
      background: var(--azul);
    }
    .circle.green { background: var(--verde); }
    .circle.orange { background: var(--laranja); }

    .kpi h3 {
      margin: 0 0 14px;
      font-size: 14px;
      text-transform: uppercase;
      color: var(--azul);
    }
    .kpi .value {
      font-size: 36px;
      font-weight: 900;
      color: var(--azul);
      line-height: 1;
    }
    .kpi .value.green { color: var(--verde); }
    .kpi .value.orange { color: var(--laranja); }
    .kpi small { display:block; margin-top:10px; font-size:14px; color:#47606b; }

    .grid-2 {
      display: grid;
      grid-template-columns: 1.15fr .85fr;
      gap: 18px;
      margin-bottom: 18px;
    }

    .panel { padding: 22px 24px; }
    .panel h2 {
      margin: 0 0 18px;
      font-size: 21px;
      color: var(--azul);
      text-transform: uppercase;
    }

    .chart {
      height: 292px;
      position: relative;
      padding: 20px 12px 26px 38px;
      background: linear-gradient(#fff, #fff), repeating-linear-gradient(to top, transparent 0 58px, #e8eef1 59px 60px);
      border-left: 2px solid #c9d3d8;
      border-bottom: 2px solid #c9d3d8;
    }

    .legend { text-align:center; font-size:14px; margin-bottom:10px; }
    .legend span { margin:0 12px; }
    .dot { display:inline-block; width:12px; height:12px; border-radius:50%; margin-right:6px; vertical-align:-1px; }

    svg { width:100%; height:200px; overflow:visible; }
    .axis-labels {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 4px;
      margin-left: 0;
      font-size: 13px;
      color: #304b57;
      text-align: center;
    }

    .summary-item {
      display: grid;
      grid-template-columns: 66px 1fr;
      gap: 16px;
      padding: 16px 0;
      border-top: 1px solid #dfe6ea;
    }
    .summary-item:first-of-type { border-top: 0; padding-top: 0; }
    .summary-item h3 { margin: 0 0 6px; font-size: 20px; color: var(--azul); }
    .summary-item p { margin: 0; font-size: 16px; line-height: 1.35; color: #314a55; }
    .outline-icon {
      width: 58px; height: 58px; border-radius:50%; display:grid; place-items:center;
      border: 4px solid currentColor; font-size: 28px;
    }
    .outline-icon.green{ color:var(--verde); }.outline-icon.orange{ color:var(--laranja); }.outline-icon.blue{ color:var(--azul); }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      overflow: hidden;
      border-radius: 8px;
      font-size: 15px;
    }
    th {
      background: linear-gradient(180deg, var(--azul-2), var(--azul));
      color: #fff;
      padding: 15px 10px;
      text-transform: uppercase;
      font-size: 13px;
      border-right: 1px solid rgba(255,255,255,.25);
    }
    td {
      padding: 13px 14px;
      border-right: 1px solid #e0e7ea;
      border-bottom: 1px solid #e0e7ea;
      text-align: center;
    }
    td:first-child { text-align: left; }
    tr.total td { background: var(--verde-claro); font-weight: 800; }
    .positive { color: var(--verde); font-weight: 800; }
    .negative { color: #ff6b00; font-weight: 800; }

    .bottom-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin-top: 18px;
    }
    ul { margin: 0; padding-left: 22px; line-height: 1.75; }
    li::marker { color: var(--verde); }

    footer {
      background: linear-gradient(90deg, #052534, #07384b);
      color: #fff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 22px 54px;
      font-size: 15px;
    }
    footer img { width: 170px; filter: brightness(0) invert(1); opacity: .95; }

    @media print {
      body { background: #fff; }
      .page { width: 100%; margin: 0; border-radius: 0; box-shadow: none; }
      @page { size: A4; margin: 0; }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="content">
      <header>
        <div class="logo">
          ${logoTag}
        </div>
        <div class="title-box">
          <h1>RELATÓRIO SEMANAL</h1>
          <p>PERÍODO: ${htmlEscape(weekStart)} a ${htmlEscape(weekEnd)} 🗓️</p>
        </div>
      </header>

      <div class="section-title"><span class="icon-bars"><span></span><span></span><span></span></span> Visão Geral dos KPI</div>

      <section class="kpis">
        <div class="card kpi"><div class="circle">🏢</div><h3>Empreendimentos</h3><div class="value">${htmlEscape(String(empreendimentos))}</div><small>Total ativos</small></div>
        <div class="card kpi"><div class="circle green">📊</div><h3>Crescimento semanal</h3><div class="value green">${htmlEscape(toPct(pctLiquido))}</div><small>vs. semana anterior</small></div>
        <div class="card kpi"><div class="circle orange">🏗️</div><h3>Baixa por saídas</h3><div class="value orange">${htmlEscape(toPct(pctSaidas))}</div><small>vs. semana anterior</small></div>
        <div class="card kpi"><div class="circle">👥</div><h3>Empresas ativas</h3><div class="value">${htmlEscape(String(empresasAtivasSemana))}</div><small>Na semana</small></div>
        <div class="card kpi"><div class="circle green">↗</div><h3>Variação entradas</h3><div class="value green">${htmlEscape(toPct(pctEntradas))}</div><small>vs. semana anterior</small></div>
      </section>

      <section class="grid-2">
        <div class="card panel">
          <h2>Evolução Semanal</h2>
          <div class="legend"><span><i class="dot" style="background:var(--verde)"></i>Crescimento (fluxo líquido)</span><span><i class="dot" style="background:var(--laranja)"></i>Variação de saídas</span></div>
          <div class="chart">
            ${svgChart}
            <div class="axis-labels">${series.labels.map((l) => `<span>${htmlEscape(l)}</span>`).join('')}</div>
          </div>
        </div>

        <div class="card panel">
          <h2>Resumo da Semana</h2>
          <div class="summary-item"><div class="outline-icon green">↗</div><div><h3>Crescimento semanal</h3><p>Variação de ${htmlEscape(toPct(pctLiquido))} no fluxo líquido em relação à semana anterior (${htmlEscape(toBRL(prevWeek.movimentos.liquido))} → ${htmlEscape(toBRL(week.movimentos.liquido))}).</p></div></div>
          <div class="summary-item"><div class="outline-icon orange">🏗️</div><div><h3>Baixa por saídas</h3><p>Variação de ${htmlEscape(toPct(pctSaidas))} nas saídas da semana (${htmlEscape(toBRL(prevWeek.movimentos.saidas))} → ${htmlEscape(toBRL(week.movimentos.saidas))}).</p></div></div>
          <div class="summary-item"><div class="outline-icon blue">👥</div><div><h3>Empresas ativas</h3><p>${htmlEscape(String(empresasAtivasSemana))} empresas tiveram movimentações financeiras na semana.</p></div></div>
        </div>
      </section>

      <section class="card panel">
        <h2>Desempenho por Empresa</h2>
        <table>
          <thead><tr><th>Empresa</th><th>Movimentos</th><th>Variação entradas</th><th>Variação saídas</th><th>Variação fluxo</th></tr></thead>
          <tbody>
            ${topRows.map(tr).join('')}
            ${tr(totalRow)}
          </tbody>
        </table>
      </section>

      <section class="bottom-grid">
        <div class="card panel"><h2>Destaques da Semana</h2><ul><li>Entradas: ${htmlEscape(toBRL(week.movimentos.entradas))}.</li><li>Saídas: ${htmlEscape(toBRL(week.movimentos.saidas))}.</li><li>IDs duplicados detectados (mov/desp/títulos): ${htmlEscape(String(snapshotNow.duplicidades.movimentosIdDuplicado))}/${htmlEscape(String(snapshotNow.duplicidades.despesasIdDuplicado))}/${htmlEscape(String(snapshotNow.duplicidades.titulosReceberIdDuplicado))}.</li></ul></div>
        <div class="card panel"><h2>Próximas Ações</h2><ul><li>Revisar movimentações com maiores variações na semana.</li><li>Acompanhar contas com maior volume de saídas.</li><li>Tratar possíveis duplicidades identificadas.</li></ul></div>
      </section>
    </div>

    <footer>
      <span>📅 Relatório gerado em: ${htmlEscape(runDateIso)}</span>
      ${logoDataUri ? `<img src="${logoDataUri}" alt="Dinâmica Empreendimentos" />` : ''}
    </footer>
  </main>
</body>
</html>`;
}

function main() {
  if (!fs.existsSync(dataFile)) {
    throw new Error(`Arquivo nao encontrado: ${dataFile}`);
  }

  ensureDir(snapshotsDir);
  ensureDir(weeklyDir);

  const data = safeReadJson(dataFile);

  const args = process.argv.slice(2);
  const dateArgIndex = args.findIndex((a) => a === '--date');
  const runDate = dateArgIndex >= 0 ? parseIsoDate(args[dateArgIndex + 1]) : null;
  const nowUtc = runDate || new Date();
  const runDateIso = isoDateUtc(nowUtc instanceof Date ? nowUtc : new Date());

  // Semana fechada: segunda a domingo anterior.
  const thisWeekStart = startOfIsoWeekUtc(nowUtc);
  const lastWeekStart = addDaysUtc(thisWeekStart, -7);
  const lastWeekEnd = addDaysUtc(thisWeekStart, -1);
  const prevWeekStart = addDaysUtc(thisWeekStart, -14);
  const prevWeekEnd = addDaysUtc(thisWeekStart, -8);

  const week = buildWeekMetrics(data, lastWeekStart, lastWeekEnd);
  const prevWeek = buildWeekMetrics(data, prevWeekStart, prevWeekEnd);

  const snapshotNow = buildSnapshotSummary(data);
  const prevSnapshotPath = latestSnapshotPathBefore(runDateIso);
  const snapshotPrev = prevSnapshotPath ? buildSnapshotSummary(safeReadJson(prevSnapshotPath)) : null;

  const snapshotFile = path.join(snapshotsDir, `dashboard_${runDateIso}.json`);
  fs.writeFileSync(snapshotFile, JSON.stringify(data));

  const reportContext = {
    runDateIso,
    week,
    prevWeek,
    snapshotNow,
    snapshotPrev,
  };

  const html = buildHtmlReport({ ...reportContext, data });
  const outBase = `weekly_report_${runDateIso}`;
  const htmlPath = path.join(weeklyDir, `${outBase}.html`);
  const jsonPath = path.join(weeklyDir, `${outBase}.json`);
  const pdfPath = path.join(weeklyDir, `${outBase}.pdf`);

  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(reportContext, null, 2), 'utf8');

  // Gera PDF a partir do HTML via Edge headless
  renderPdfWithEdge({ htmlPath, pdfPath });

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        runDate: runDateIso,
        reportHtml: htmlPath,
        reportPdf: pdfPath,
        reportJson: jsonPath,
        snapshot: snapshotFile,
        week: week.range,
        prevWeek: prevWeek.range,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error?.stack || error?.message || error) + '\n');
  process.exitCode = 1;
}
