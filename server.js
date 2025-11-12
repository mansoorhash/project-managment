// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const PORT = 5992;

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '1mb' }));

const DATA_PATH = path.join(__dirname, 'src', 'data', 'taskData.json');
const USER_PATH = path.join(__dirname, 'src', 'data', 'user.json');

async function ensureDir(p) {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

function arrayFromleadKeyed(obj) {
  // { "lead A": [..], "lead B": [..] } -> flat array with lead injected
  const out = [];
  for (const [lead, arr] of Object.entries(obj || {})) {
    if (Array.isArray(arr)) out.push(...arr.map(t => ({ ...t, lead })));
  }
  return out;
}

function arrayFromArrayish(obj) {
  // { "0": {...}, "1": {...}, "id": "xxx" } -> [ {...}, {...} ]
  const keys = Object.keys(obj || {}).filter(k => /^\d+$/.test(k)).sort((a,b)=>a-b);
  return keys.map(k => obj[k]);
}

function coerceToArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const leadFlat = arrayFromleadKeyed(data);
    if (leadFlat.length) return leadFlat;
    const arrish = arrayFromArrayish(data);
    if (arrish.length) return arrish;
  }
  return [];
}

async function readTasks() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const data = JSON.parse(raw);
    return coerceToArray(data);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeTasks(tasks) {
  await ensureDir(DATA_PATH);
  const tmp = DATA_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2), 'utf8');
  await fs.rename(tmp, DATA_PATH);
}

function upsertById(existing, changes) {
  const byId = new Map(existing.map(t => [t.id, t]));
  for (const c of changes) {
    if (!c || !c.id) continue;
    const prev = byId.get(c.id) || {};
    byId.set(c.id, { ...prev, ...c });
  }
  return Array.from(byId.values());
}

const VALID_ROLES = new Set(['admin', 'lead', 'assignee']);

function emptyBuckets() {
  return { admin: [], lead: [], assignee: [] };
}

function sanitizeName(name) {
  return String(name || '').trim();
}

function sanitizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return VALID_ROLES.has(r) ? r : null;
}

async function ensureUsersFile() {
  try {
    await fs.readFile(USER_PATH, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      await ensureDir(USER_PATH);
      await fs.writeFile(USER_PATH, JSON.stringify(emptyBuckets(), null, 2), 'utf8');
    } else {
      throw e;
    }
  }
}

async function readUsersNames() {
  await ensureUsersFile();
  const raw = await fs.readFile(USER_PATH, 'utf8');
  const data = JSON.parse(raw || '{}');

  const out = emptyBuckets();
  for (const r of Object.keys(out)) {
    const arr = Array.isArray(data?.[r]) ? data[r] : [];
    out[r] = arr.map(sanitizeName).filter(Boolean);
  }
  return out;
}

async function writeUsersNames(buckets) {
  await ensureDir(USER_PATH);
  const tmp = USER_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(buckets, null, 2), 'utf8');
  await fs.rename(tmp, USER_PATH);
}

function removeFromAll(buckets, name) {
  const needle = name.toLowerCase();
  for (const r of Object.keys(buckets)) {
    buckets[r] = buckets[r].filter(n => n.toLowerCase() !== needle);
  }
}

// ---------------- TASK routes ----------------

// GET: always return a flat array; if file was object-ish, heal it back to array
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await readTasks();

    // If file on disk wasn’t a clean array, rewrite it healed.
    const raw = await fs.readFile(DATA_PATH, 'utf8').catch(() => null);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        await writeTasks(tasks);
      }
    }

    res.json(tasks);
  } catch (err) {
    console.error('GET /api/tasks failed:', err);
    res.status(500).json({ error: 'Failed to read tasks' });
  }
});

// POST: replace entire dataset
// To prevent accidental wipes, require either a non-empty array OR ?allowEmpty=1
app.post('/api/tasks', async (req, res) => {
  try {
    let incoming = coerceToArray(req.body);
    const allowEmpty = String(req.query.allowEmpty || '0') === '1';

    if (!incoming.length && !allowEmpty) {
      return res.status(400).json({
        error: 'Refusing to overwrite with empty list. Pass ?allowEmpty=1 to force.',
      });
    }

    await writeTasks(incoming);
    res.json({ ok: true, count: incoming.length });
  } catch (err) {
    console.error('POST /api/tasks failed:', err);
    res.status(500).json({ error: 'Failed to write tasks' });
  }
});

// PUT: bulk upsert by projectId (body = array OR array-ish of tasks)
app.put('/api/tasks/:projectId', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    let changes = coerceToArray(req.body);

    // Filter only tasks that belong to this projectId if provided
    if (projectId) {
      changes = changes.filter(t => t && t.projectId === projectId);
    }

    if (!changes.length) {
      return res.json({ ok: true, updated: 0, total: (await readTasks()).length });
    }

    const existing = await readTasks();
    const merged = upsertById(existing, changes);
    await writeTasks(merged);

    res.json({ ok: true, updated: changes.length, total: merged.length });
  } catch (err) {
    console.error('PUT /api/tasks/:projectId failed:', err);
    res.status(500).json({ error: 'Failed to upsert tasks' });
  }
});

// ---------------- USERS routes (names only + drag & drop) ----------------

// GET roles -> { assignee:[string], lead:[string], admin:[string] }
app.get('/api/users', async (_req, res) => {
  try {
    const data = await readUsersNames();
    res.json(data);
  } catch (err) {
    console.error('GET /api/users failed:', err);
    res.status(500).json({ error: 'Failed to read users' });
  }
});

// POST add -> body { name, role }
app.post('/api/users', async (req, res) => {
  try {
    const name = sanitizeName(req.body?.name);
    const role = sanitizeRole(req.body?.role) || 'assignee';
    if (!name) return res.status(400).json({ error: 'name required' });

    const data = await readUsersNames();

    // no duplicates across any role (case-insensitive)
    removeFromAll(data, name);

    if (!data[role].some(n => n.toLowerCase() === name.toLowerCase())) {
      data[role].push(name);
    }
    await writeUsersNames(data);
    res.status(201).json({ ok: true, users: data });
  } catch (err) {
    console.error('POST /api/users failed:', err);
    res.status(500).json({ error: 'Failed to add user' });
  }
});

// PUT move/rename/position -> params :name, body { role?, newName?, index? }
app.put('/api/users/:name', async (req, res) => {
  try {
    const current = sanitizeName(req.params.name);
    if (!current) return res.status(400).json({ error: 'name param required' });

    const nextRole = sanitizeRole(req.body?.role);
    const newName = req.body?.newName !== undefined ? sanitizeName(req.body.newName) : null;
    const indexRaw = req.body?.index;
    const index = Number.isInteger(indexRaw) ? indexRaw : null;

    const data = await readUsersNames();

    // find original role
    const lower = current.toLowerCase();
    const roles = ['admin', 'lead', 'assignee'];
    let originalRole = roles.find(r => data[r].some(n => n.toLowerCase() === lower));
    if (!originalRole) return res.status(404).json({ error: 'user not found' });

    const roleToUse = nextRole || originalRole;
    const finalName = newName || current;

    // remove both current and (potential) final name to avoid duplicates
    removeFromAll(data, current);
    removeFromAll(data, finalName);

    const arr = data[roleToUse];
    const insertAt = typeof index === 'number' ? Math.max(0, Math.min(index, arr.length)) : arr.length;
    arr.splice(insertAt, 0, finalName);

    await writeUsersNames(data);
    res.json({ ok: true, users: data });
  } catch (err) {
    console.error('PUT /api/users/:name failed:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// PATCH reorder a whole role -> body { role, names: [string, ...] }
app.patch('/api/users/reorder', async (req, res) => {
  try {
    const role = sanitizeRole(req.body?.role);
    const names = Array.isArray(req.body?.names) ? req.body.names.map(sanitizeName).filter(Boolean) : null;
    if (!role) return res.status(400).json({ error: 'role must be assignee|lead|admin' });
    if (!names) return res.status(400).json({ error: 'names[] required' });

    const data = await readUsersNames();

    // include only those that belong to this role; keep omitted ones at end
    const belongSet = new Set(data[role].map(n => n.toLowerCase()));
    const seen = new Set();
    const ordered = [];
    for (const n of names) {
      const l = n.toLowerCase();
      if (belongSet.has(l) && !seen.has(l)) {
        seen.add(l);
        ordered.push(n);
      }
    }
    // append any leftover names not mentioned
    for (const n of data[role]) {
      const l = n.toLowerCase();
      if (!seen.has(l)) ordered.push(n);
    }

    data[role] = ordered;
    await writeUsersNames(data);
    res.json({ ok: true, users: data });
  } catch (err) {
    console.error('PATCH /api/users/reorder failed:', err);
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

// DELETE remove by name -> params :name
app.delete('/api/users/:name', async (req, res) => {
  try {
    const name = sanitizeName(req.params.name);
    if (!name) return res.status(400).json({ error: 'name param required' });

    const data = await readUsersNames();
    const before = data.admin.length + data.lead.length + data.assignee.length;
    removeFromAll(data, name);
    const after = data.admin.length + data.lead.length + data.assignee.length;

    if (after === before) return res.status(404).json({ error: 'user not found' });

    await writeUsersNames(data);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/users/:name failed:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});


app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id param required' });

    const existing = await readTasks();
    const before = existing.length;
    const remaining = existing.filter(t => String(t.id) !== id);

    if (remaining.length === before) {
      return res.status(404).json({ error: 'task not found' });
    }

    await writeTasks(remaining);
    res.json({ ok: true, deleted: 1, total: remaining.length });
  } catch (err) {
    console.error('DELETE /api/tasks/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
