# Agent Communication Protocol

## Agents
| Agent | Role | Strengths |
|-------|------|-----------|
| **Skynet** (lead) | Infrastructure, DevOps, coding, orchestration | SSH, deployment, subagent spawn, system monitoring, code review |
| **Atlas** | Marketing, sales, content, client projects | Marketing MCP, content creation, product knowledge, client briefs |

## Communication Channels

### 1. Agent Comms Bus (PRIMARY)
- **URL:** `http://localhost:3946/api`
- **Use for:** Task delegation, status updates, shared context, async coordination
- **Protocol:** REST API with JSON payloads

### 2. Telegram Group "BOTS" (SECONDARY)
- **Chat ID:** -5233449594
- **Use for:** Human-visible discussions, updates Ewan should see, urgent alerts

### 3. Shared Workspace Files (REFERENCE)
- Atlas workspace: `/Users/noc/clawd-lc/`
- Skynet workspace: `/Users/noc/clawd/`
- Comms repo: `/Users/noc/operations/agent-comms/`

## Message Types
- `message` — general communication
- `task` — delegated work item (via `/api/delegate`)
- `status` — project/task status update
- `alert` — urgent, needs immediate attention
- `briefing` — context dump for the other agent

## Shared Context Keys (conventions)
```
project.<slug>.status       — current status of a project
project.<slug>.priority     — priority level
project.<slug>.blockers     — what's blocking progress
client.<name>.status        — client relationship status
decision.<topic>            — recorded decisions with rationale
capability.<name>           — what each agent can do
```

## Evolution Log
Track what works and what doesn't. Both agents update this.

### v1.0 — Initial (2026-03-23)
- REST API with messages, threads, tasks, shared context
- CLI tool at `comms.sh`
- Both agents briefed on protocol

### Planned Improvements
- [ ] Webhook notifications (so neither agent needs to poll)
- [ ] Priority escalation (high-priority messages trigger Telegram alert)
- [ ] Structured task responses (accept/reject/complete/blocked)
- [ ] Capability discovery (agents advertise what they can do)
- [ ] Message compression (summarise long threads)
- [ ] Shared memory sync (both agents' MEMORY.md stays in sync)

## Rules
1. **Skynet leads** — coordinates, delegates, reviews
2. **Atlas executes** on marketing/content/client work
3. **Shared context** is the source of truth for project state
4. **Threads** keep conversations organised — don't start new threads for existing topics
5. **Both agents** commit findings to this repo
6. **Efficiency first** — minimise token waste, be concise in messages
