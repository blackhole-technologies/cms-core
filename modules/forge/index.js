/**
 * forge/index.js — Project Orchestration Module
 *
 * Brings ForgeUI's capabilities into CMS-Core as a native module:
 * - Project management (CRUD with phases & features)
 * - Template browser (directory tree, file editing)
 * - Handoff documents (auto-generated project state snapshots)
 * - AutoForge integration (proxy, agent control, feature sync)
 * - Process management (spawn/manage child services)
 * - Git workflow (status, stage, commit, push)
 *
 * Data stored in CMS-Core's content system (flat-file JSON).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';

// --- Process Manager (embedded) ---
const managedServices = new Map();

function registerService(name, config) {
  managedServices.set(name, {
    name, config, process: null, status: 'stopped',
    pid: null, logs: [], maxLogs: 500, restartCount: 0, lastError: null
  });
}

function getServiceStatus(name) {
  const svc = managedServices.get(name);
  if (!svc) return null;
  return { name, status: svc.status, pid: svc.pid, port: svc.config.port, lastError: svc.lastError };
}

function getAllServices() {
  const result = {};
  for (const [name, svc] of managedServices) {
    result[name] = { name, status: svc.status, pid: svc.pid, port: svc.config.port };
  }
  return result;
}

function getServiceLogs(name, tail = 100) {
  const svc = managedServices.get(name);
  return svc ? svc.logs.slice(-tail) : [];
}

async function startService(name) {
  const svc = managedServices.get(name);
  if (!svc || svc.status === 'running') return;

  // Check if already running externally
  if (svc.config.healthUrl) {
    try {
      const res = await fetch(svc.config.healthUrl);
      if (res.ok) { svc.status = 'running'; return; }
    } catch (e) { /* not running */ }
  }

  svc.status = 'starting';
  const child = spawn(svc.config.command, svc.config.args || [], {
    cwd: svc.config.cwd,
    env: { ...process.env, ...(svc.config.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'], detached: false
  });

  svc.process = child;
  svc.pid = child.pid;

  const addLog = (stream, data) => {
    for (const line of data.toString().split('\n').filter(l => l.trim())) {
      svc.logs.push({ ts: Date.now(), stream, text: line });
      if (svc.logs.length > svc.maxLogs) svc.logs.shift();
    }
  };
  child.stdout.on('data', d => addLog('stdout', d));
  child.stderr.on('data', d => addLog('stderr', d));
  child.on('exit', () => { svc.status = 'stopped'; svc.pid = null; svc.process = null; });

  // Wait for health
  if (svc.config.healthUrl) {
    const start = Date.now();
    while (Date.now() - start < 30000) {
      try { const r = await fetch(svc.config.healthUrl); if (r.ok) { svc.status = 'running'; return; } } catch (e) {}
      await new Promise(r => setTimeout(r, 1000));
    }
    svc.status = 'error'; svc.lastError = 'Health check timeout';
  } else {
    await new Promise(r => setTimeout(r, 1000));
    if (svc.process && !svc.process.killed) svc.status = 'running';
  }
}

function stopService(name) {
  const svc = managedServices.get(name);
  if (svc?.process) svc.process.kill('SIGTERM');
}

// --- Directory Tree Builder ---
function buildTree(dirPath, basePath, maxDepth = 5) {
  if (maxDepth <= 0 || !existsSync(dirPath)) return [];
  const entries = [];
  try {
    for (const name of readdirSync(dirPath).sort()) {
      if (['node_modules', '.git', '__pycache__', 'venv'].includes(name)) continue;
      const full = join(dirPath, name);
      const rel = basePath ? `${basePath}/${name}` : name;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        entries.push({ name, path: rel, type: 'dir', children: buildTree(full, rel, maxDepth - 1) });
      } else {
        entries.push({ name, path: rel, type: 'file', size: stat.size });
      }
    }
  } catch (e) {}
  return entries;
}

// --- AutoForge Proxy Helper ---
function proxyToAutoForge(req, res, targetPath, port = 8888) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1', port, path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${port}` }
    };
    const proxyReq = httpRequest(options, (proxyRes) => {
      let body = '';
      proxyRes.on('data', c => body += c);
      proxyRes.on('end', () => resolve({ status: proxyRes.statusCode, body }));
    });
    proxyReq.on('error', reject);
    if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const data = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(data));
      proxyReq.write(data);
    }
    proxyReq.end();
  });
}

// =====================
// HOOKS
// =====================

export async function hook_boot(context) {
  console.log('[forge] Initializing project orchestration module');

  // Register AutoForge service
  const autoforgeDir = process.env.AUTOFORGE_PATH || '/Users/Alchemy/Projects/experiments/autoforge-cli';
  if (existsSync(autoforgeDir)) {
    registerService('autoforge', {
      command: join(autoforgeDir, 'venv', 'bin', 'python3'),
      args: [join(autoforgeDir, 'start_ui.py')],
      cwd: autoforgeDir,
      port: 8888,
      healthUrl: 'http://127.0.0.1:8888/api/projects'
    });

    // Auto-detect if already running
    try {
      const res = await fetch('http://127.0.0.1:8888/api/projects');
      if (res.ok) {
        managedServices.get('autoforge').status = 'running';
        console.log('[forge] AutoForge already running on port 8888');
      }
    } catch (e) {
      console.log('[forge] AutoForge not running — use forge:autoforge:start to launch');
    }
  }
}

export async function hook_ready(context) {
  console.log('[forge] Project orchestration ready');
}

export function hook_cli(register, context) {
  const content = context.services.get('content');

  // --- Project Management ---
  register('forge:projects', async (args) => {
    const result = content.list('forge_project', { limit: 100 });
    const projects = result.items || result.data || [];
    if (!projects.length) { console.log('No projects. Use forge:create <name> <path>'); return; }
    for (const p of projects) {
      console.log(`  ${p.name} — ${p.path} [${p.status || 'planning'}]`);
    }
  }, 'List all forge projects');

  register('forge:create', async (args) => {
    const [name, projectPath] = args;
    if (!name || !projectPath) { console.log('Usage: forge:create <name> <path>'); return; }
    const project = await content.create('forge_project', { name, path: resolve(projectPath), status: 'planning', description: '' });
    console.log(`Created project: ${project.name} (${project.id})`);
  }, 'Create a new forge project');

  register('forge:status', async (args) => {
    const [name] = args;
    if (!name) { console.log('Usage: forge:status <project-name>'); return; }
    const result = content.list('forge_project', { limit: 100 });
    const projects = (result.items || result.data || []).filter(p => p.name === name);
    if (!projects.length) { console.log(`Project '${name}' not found`); return; }
    const project = projects[0];
    console.log(`\nProject: ${project.name}`);
    console.log(`Path: ${project.path}`);
    console.log(`Status: ${project.status}`);

    // Try AutoForge stats
    try {
      const res = await fetch(`http://127.0.0.1:8888/api/projects/${name}/features`);
      if (res.ok) {
        const data = await res.json();
        const done = (data.done || []).length;
        const inProg = (data.in_progress || []).length;
        const pending = (data.pending || []).length;
        const total = done + inProg + pending;
        console.log(`AutoForge: ${done}/${total} features (${Math.round(done/total*100)}%)`);
        if (inProg) console.log(`Building: ${inProg} features`);
      }
    } catch (e) {}
  }, 'Show project status');

  // --- AutoForge Control ---
  register('forge:autoforge:start', async () => {
    console.log('Starting AutoForge...');
    await startService('autoforge');
    console.log(`AutoForge: ${getServiceStatus('autoforge')?.status}`);
  }, 'Start AutoForge service');

  register('forge:autoforge:stop', async () => {
    stopService('autoforge');
    console.log('AutoForge stopped');
  }, 'Stop AutoForge service');

  register('forge:autoforge:status', async () => {
    const s = getServiceStatus('autoforge');
    console.log(s ? `AutoForge: ${s.status} (port ${s.port})` : 'AutoForge not registered');
  }, 'Show AutoForge status');

  register('forge:services', async () => {
    const all = getAllServices();
    for (const [name, svc] of Object.entries(all)) {
      console.log(`  ${name}: ${svc.status} (port ${svc.port})`);
    }
  }, 'List all managed services');
}

export function hook_routes(register, context) {
  const server = context.services.get('server');
  const content = context.services.get('content');

  // --- Projects API ---
  register('GET', '/api/forge/projects', async (req, res) => {
    const result = content.list('forge_project', { limit: 100 });
    server.json(res, result.items || result.data || []);
  }, 'List forge projects');

  register('POST', '/api/forge/projects', async (req, res, params, ctx) => {
    const body = await server.parseBody(req);
    const project = content.create('forge_project', body);
    server.json(res, project, 201);
  }, 'Create forge project');

  register('GET', '/api/forge/projects/:id', async (req, res, params) => {
    const project = content.get('forge_project', params.id);
    if (!project) { server.json(res, { error: 'Not found' }, 404); return; }
    server.json(res, project);
  }, 'Get forge project');

  // --- Services API ---
  register('GET', '/api/forge/services', async (req, res) => {
    server.json(res, getAllServices());
  }, 'List managed services');

  register('GET', '/api/forge/services/:name', async (req, res, params) => {
    const s = getServiceStatus(params.name);
    if (!s) { server.json(res, { error: 'Not found' }, 404); return; }
    server.json(res, s);
  }, 'Get service status');

  register('POST', '/api/forge/services/:name/start', async (req, res, params) => {
    await startService(params.name);
    server.json(res, getServiceStatus(params.name));
  }, 'Start a service');

  register('POST', '/api/forge/services/:name/stop', async (req, res, params) => {
    stopService(params.name);
    server.json(res, getServiceStatus(params.name));
  }, 'Stop a service');

  register('GET', '/api/forge/services/:name/logs', async (req, res, params) => {
    const url = new URL(req.url, 'http://localhost');
    const tail = parseInt(url.searchParams.get('tail')) || 100;
    server.json(res, getServiceLogs(params.name, tail));
  }, 'Get service logs');

  // --- Template Browser API ---
  register('GET', '/api/forge/templates/:projectId/tree', async (req, res, params) => {
    const project = content.get('forge_project', params.projectId);
    if (!project) { server.json(res, { error: 'Not found' }, 404); return; }

    const dir = project.path;
    const tree = [];

    // Root files
    const rootFiles = ['app_spec.txt', 'CLAUDE.md', 'README.md', 'package.json', 'pyproject.toml']
      .filter(f => existsSync(join(dir, f)))
      .map(f => ({ name: f, path: f, type: 'file', size: statSync(join(dir, f)).size }));
    if (rootFiles.length) tree.push({ name: '/', path: '', type: 'dir', children: rootFiles, expanded: true });

    for (const sub of ['.autoforge', '.claude']) {
      const subDir = join(dir, sub);
      if (existsSync(subDir)) {
        tree.push({ name: sub, path: sub, type: 'dir', children: buildTree(subDir, sub, 3), expanded: true });
      }
    }
    server.json(res, tree);
  }, 'Get template file tree');

  register('GET', '/api/forge/templates/:projectId/file', async (req, res, params) => {
    const project = content.get('forge_project', params.projectId);
    if (!project) { server.json(res, { error: 'Not found' }, 404); return; }

    const url = new URL(req.url, 'http://localhost');
    const filePath = url.searchParams.get('path');
    if (!filePath) { server.json(res, { error: 'path required' }, 400); return; }

    const fullPath = join(project.path, filePath);
    if (!fullPath.startsWith(project.path)) { server.json(res, { error: 'Blocked' }, 403); return; }
    if (!existsSync(fullPath)) { server.json(res, { error: 'File not found' }, 404); return; }

    try {
      const content_ = readFileSync(fullPath, 'utf8');
      server.json(res, { path: filePath, content: content_, size: content_.length });
    } catch (e) {
      server.json(res, { error: 'Cannot read file' }, 500);
    }
  }, 'Read template file');

  register('PUT', '/api/forge/templates/:projectId/file', async (req, res, params) => {
    const project = content.get('forge_project', params.projectId);
    if (!project) { server.json(res, { error: 'Not found' }, 404); return; }

    const body = await server.parseBody(req);
    const { path: filePath, content: fileContent } = body;
    if (!filePath || fileContent == null) { server.json(res, { error: 'path and content required' }, 400); return; }

    const fullPath = join(project.path, filePath);
    if (!fullPath.startsWith(project.path)) { server.json(res, { error: 'Blocked' }, 403); return; }

    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, fileContent, 'utf8');
    server.json(res, { ok: true, path: filePath });
  }, 'Save template file');

  // --- AutoForge Proxy ---
  register('ALL', '/api/forge/autoforge/*', async (req, res, params) => {
    const targetPath = '/api' + req.url.replace('/api/forge/autoforge', '');
    try {
      const result = await proxyToAutoForge(req, res, targetPath);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      server.json(res, { error: 'AutoForge unavailable', detail: e.message }, 502);
    }
  }, 'Proxy to AutoForge');
}

export function hook_content(register, context) {
  register('forge_project', {
    name: { type: 'string', required: true },
    path: { type: 'string', required: true },
    description: { type: 'string' },
    template: { type: 'string' },
    status: { type: 'string' }  // planning, building, testing, deployed
  });
}
