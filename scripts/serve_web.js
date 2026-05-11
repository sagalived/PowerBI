const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const defaultPort = 8000;
const maxLogLength = 20000;

function argValue(names) {
  for (const name of names) {
    const index = process.argv.indexOf(name);
    if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  }
  return '';
}

const port = Number(process.env.PORT || argValue(['--port', '-p']) || defaultPort);
let updatePromise = null;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function trimLog(value) {
  const text = String(value || '');
  return text.length > maxLogLength ? text.slice(text.length - maxLogLength) : text;
}

function powershellPath() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const windowsPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(windowsPowerShell) ? windowsPowerShell : 'powershell';
}

function runCommand(label, command, args) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
    });

    let output = '';
    const append = (chunk) => {
      output = trimLog(output + chunk.toString());
    };

    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
      error.output = output;
      reject(error);
    });
    child.on('close', (code) => {
      const finishedAt = new Date().toISOString();
      const step = { label, code, startedAt, finishedAt, output: trimLog(output) };
      if (code === 0) {
        resolve(step);
        return;
      }

      const error = new Error(`${label} falhou com codigo ${code}`);
      error.step = step;
      error.output = output;
      reject(error);
    });
  });
}

async function runSiengeUpdate() {
  const startedAt = new Date().toISOString();
  const steps = [];
  const ps = powershellPath();

  steps.push(
    await runCommand('Baixar dados Sienge REST', ps, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'scripts', 'download_sienge_financeiro_rest.ps1'),
    ])
  );

  steps.push(
    await runCommand('Normalizar dados Sienge', ps, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'scripts', 'normalize_dados_sienge.ps1'),
    ])
  );

  steps.push(
    await runCommand('Gerar dados do dashboard web', process.execPath, [
      path.join(root, 'scripts', 'build_web_dashboard_data.js'),
    ])
  );

  return {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
  };
}

async function handleUpdate(req, res) {
  req.resume();
  if (updatePromise) {
    sendJson(res, 409, { ok: false, error: 'Atualizacao Sienge ja esta em andamento.' });
    return;
  }

  updatePromise = runSiengeUpdate();
  try {
    const result = await updatePromise;
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message || 'Falha ao atualizar Sienge.',
      step: error.step || null,
      output: trimLog(error.output || error.step?.output || ''),
    });
  } finally {
    updatePromise = null;
  }
}

function resolveStaticPath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const relative = path.normalize(decoded).replace(/^([/\\])+/, '');
  const filePath = path.resolve(root, relative || path.join('web', 'index.html'));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (filePath !== root && !filePath.startsWith(rootWithSep)) {
    return null;
  }
  return filePath;
}

async function serveStatic(req, res, url) {
  if (url.pathname === '/') {
    res.writeHead(302, { location: '/web/index.html' });
    res.end();
    return;
  }

  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    sendText(res, 403, 'Acesso negado.');
    return;
  }

  try {
    let stat = await fsp.stat(filePath);
    let targetPath = filePath;
    if (stat.isDirectory()) {
      targetPath = path.join(filePath, 'index.html');
      stat = await fsp.stat(targetPath);
    }
    if (!stat.isFile()) {
      sendText(res, 404, 'Arquivo nao encontrado.');
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    res.writeHead(200, {
      'content-type': mimeTypes[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store',
    });
    fs.createReadStream(targetPath).pipe(res);
  } catch {
    sendText(res, 404, 'Arquivo nao encontrado.');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/atualizar-sienge') {
    void handleUpdate(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'Metodo nao permitido.' });
    return;
  }

  void serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`Servindo ${root} em http://localhost:${port}`);
  console.log(`Abra http://localhost:${port}/web/index.html`);
  console.log('API: POST /api/atualizar-sienge');
});
