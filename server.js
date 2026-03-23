import Database from 'better-sqlite3'
import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.join(__dirname, 'comms.db'))
const PORT = process.env.PORT || 3946

// Telegram bot tokens for push notifications
const AGENT_BOTS = {
  atlas: { token: '8624575269:AAEUwq9tBoRR5UVc9XL4VX6jpxvtHfcaeVE', chatId: '614811138' },
  // skynet doesn't need push — it checks inbox via heartbeat
}

async function pushToTelegram(toAgent, message) {
  const bot = AGENT_BOTS[toAgent]
  if (!bot) return
  try {
    const preview = message.body?.slice(0, 500) || ''
    const text = `📬 Comms from ${message.from_agent}:\n${message.subject ? `📋 ${message.subject}\n\n` : ''}${preview}${message.body?.length > 500 ? '...\n\n[Full message in comms bus]' : ''}`
    await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: bot.chatId, text })
    })
  } catch (e) { console.error('Push notification failed:', e.message) }
}

// WAL mode for concurrent access
db.pragma('journal_mode = WAL')

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'message',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'unread',
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT,
    replied_to TEXT
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    capabilities TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'online',
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    config TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    participants TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shared_context (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    set_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_msg_to ON messages(to_agent, status);
  CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at);
`)

// Seed agents
const upsertAgent = db.prepare(`INSERT INTO agents (id, name, role, capabilities) VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, capabilities=excluded.capabilities`)
upsertAgent.run('skynet', 'Skynet', 'Infrastructure, DevOps, coding, orchestration',
  JSON.stringify(['coding', 'ssh', 'deployment', 'monitoring', 'subagent-spawn']))
upsertAgent.run('atlas', 'Atlas', 'Marketing, sales, content, client projects',
  JSON.stringify(['marketing-mcp', 'content-creation', 'product-knowledge', 'client-management']))

const app = express()
app.use(cors())
app.use(express.json())

// ── Send a message ──────────────────────────────────────
app.post('/api/send', (req, res) => {
  const { from, to, body, subject, type, priority, thread_id, metadata, replied_to } = req.body
  if (!from || !to || !body) return res.status(400).json({ error: 'from, to, body required' })

  const id = randomUUID()
  const tid = thread_id || randomUUID()

  // Auto-create thread if new
  const existingThread = db.prepare('SELECT id FROM threads WHERE id = ?').get(tid)
  if (!existingThread) {
    db.prepare('INSERT INTO threads (id, subject, participants) VALUES (?, ?, ?)')
      .run(tid, subject || body.slice(0, 80), JSON.stringify([from, to]))
  } else {
    db.prepare("UPDATE threads SET updated_at = datetime('now') WHERE id = ?").run(tid)
  }

  db.prepare(`INSERT INTO messages (id, thread_id, from_agent, to_agent, type, subject, body, metadata, priority, replied_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, tid, from, to, type || 'message', subject || '', body,
      JSON.stringify(metadata || {}), priority || 'normal', replied_to || null)

  // Update agent last_seen
  db.prepare("UPDATE agents SET last_seen = datetime('now'), status = 'online' WHERE id = ?").run(from)

  // Push notification to recipient
  pushToTelegram(to, { from_agent: from, subject: subject || '', body })

  res.json({ id, thread_id: tid, status: 'sent' })
})

// ── Get inbox (unread messages for an agent) ────────────
app.get('/api/inbox/:agent', (req, res) => {
  const { agent } = req.params
  const { status, limit, since } = req.query

  let sql = 'SELECT * FROM messages WHERE to_agent = ?'
  const params = [agent]

  if (status) { sql += ' AND status = ?'; params.push(status) }
  else { sql += " AND status = 'unread'" }
  if (since) { sql += ' AND created_at > ?'; params.push(since) }
  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(parseInt(limit) || 50)

  const messages = db.prepare(sql).all(...params).map(m => ({
    ...m, metadata: JSON.parse(m.metadata)
  }))

  res.json({ count: messages.length, messages })
})

// ── Mark messages as read ───────────────────────────────
app.post('/api/read/:agent', (req, res) => {
  const { agent } = req.params
  const { ids } = req.body // optional: specific message ids

  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`UPDATE messages SET status = 'read', read_at = datetime('now')
      WHERE id IN (${placeholders}) AND to_agent = ?`).run(...ids, agent)
  } else {
    db.prepare("UPDATE messages SET status = 'read', read_at = datetime('now') WHERE to_agent = ? AND status = 'unread'")
      .run(agent)
  }

  res.json({ ok: true })
})

// ── Get thread history ──────────────────────────────────
app.get('/api/thread/:threadId', (req, res) => {
  const messages = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC')
    .all(req.params.threadId)
    .map(m => ({ ...m, metadata: JSON.parse(m.metadata) }))
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.threadId)
  res.json({ thread, messages })
})

// ── List threads ────────────────────────────────────────
app.get('/api/threads', (req, res) => {
  const { agent, status } = req.query
  let sql = 'SELECT * FROM threads'
  const params = []

  if (agent) {
    sql += " WHERE participants LIKE ?"
    params.push(`%${agent}%`)
  }
  if (status) {
    sql += (params.length ? ' AND' : ' WHERE') + ' status = ?'
    params.push(status)
  }
  sql += ' ORDER BY updated_at DESC LIMIT 50'

  res.json(db.prepare(sql).all(...params).map(t => ({
    ...t, participants: JSON.parse(t.participants)
  })))
})

// ── Shared context (key-value store both agents can use) ─
app.get('/api/context', (req, res) => {
  const { key, prefix } = req.query
  if (key) {
    const row = db.prepare('SELECT * FROM shared_context WHERE key = ?').get(key)
    return res.json(row || { error: 'not found' })
  }
  if (prefix) {
    return res.json(db.prepare('SELECT * FROM shared_context WHERE key LIKE ? ORDER BY key')
      .all(`${prefix}%`))
  }
  res.json(db.prepare('SELECT * FROM shared_context ORDER BY updated_at DESC LIMIT 100').all())
})

app.put('/api/context', (req, res) => {
  const { key, value, agent } = req.body
  if (!key || value === undefined || !agent) return res.status(400).json({ error: 'key, value, agent required' })

  db.prepare(`INSERT INTO shared_context (key, value, set_by) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, set_by=excluded.set_by, updated_at=datetime('now')`)
    .run(key, typeof value === 'string' ? value : JSON.stringify(value), agent)

  res.json({ ok: true, key })
})

// ── Agent status ────────────────────────────────────────
app.get('/api/agents', (req, res) => {
  res.json(db.prepare('SELECT * FROM agents ORDER BY name').all().map(a => ({
    ...a, capabilities: JSON.parse(a.capabilities), config: JSON.parse(a.config)
  })))
})

app.post('/api/agents/:id/heartbeat', (req, res) => {
  db.prepare("UPDATE agents SET last_seen = datetime('now'), status = 'online' WHERE id = ?")
    .run(req.params.id)
  // Return unread count
  const unread = db.prepare("SELECT COUNT(*) as count FROM messages WHERE to_agent = ? AND status = 'unread'")
    .get(req.params.id)
  res.json({ ok: true, unread: unread.count })
})

// ── Task delegation ─────────────────────────────────────
app.post('/api/delegate', (req, res) => {
  const { from, to, task, context, priority, deadline } = req.body
  if (!from || !to || !task) return res.status(400).json({ error: 'from, to, task required' })

  const id = randomUUID()
  const tid = randomUUID()

  db.prepare('INSERT INTO threads (id, subject, participants, status) VALUES (?, ?, ?, ?)')
    .run(tid, `Task: ${task.slice(0, 80)}`, JSON.stringify([from, to]), 'task')

  db.prepare(`INSERT INTO messages (id, thread_id, from_agent, to_agent, type, subject, body, metadata, priority)
    VALUES (?, ?, ?, ?, 'task', ?, ?, ?, ?)`)
    .run(id, tid, from, to, `Task: ${task.slice(0, 80)}`, task,
      JSON.stringify({ context, deadline, status: 'pending' }), priority || 'normal')

  // Push task notification
  pushToTelegram(to, { from_agent: from, subject: `Task: ${task.slice(0, 80)}`, body: task })

  res.json({ id, thread_id: tid, status: 'delegated' })
})

// ── Stats ───────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM messages').get()
  const unread_skynet = db.prepare("SELECT COUNT(*) as count FROM messages WHERE to_agent='skynet' AND status='unread'").get()
  const unread_atlas = db.prepare("SELECT COUNT(*) as count FROM messages WHERE to_agent='atlas' AND status='unread'").get()
  const threads = db.prepare('SELECT COUNT(*) as count FROM threads').get()
  const context_keys = db.prepare('SELECT COUNT(*) as count FROM shared_context').get()

  res.json({
    total_messages: total.count,
    unread: { skynet: unread_skynet.count, atlas: unread_atlas.count },
    threads: threads.count,
    shared_context_keys: context_keys.count
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔗 Agent Comms Bus running on http://localhost:${PORT}`)
  console.log(`   POST /api/send          — send a message`)
  console.log(`   GET  /api/inbox/:agent   — check inbox`)
  console.log(`   POST /api/delegate       — delegate a task`)
  console.log(`   GET  /api/context        — shared key-value store`)
  console.log(`   GET  /api/stats          — overview`)
})
