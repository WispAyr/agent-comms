#!/bin/bash
# Agent Comms CLI — usage: comms.sh <command> [args]
# Examples:
#   comms.sh send skynet atlas "Deploy WPG to staging"
#   comms.sh inbox skynet
#   comms.sh delegate skynet atlas "Build Deal Score algorithm" "Need 0-100 composite"
#   comms.sh context get project.wpg.status
#   comms.sh context set project.wpg.status "in-progress" skynet
#   comms.sh stats

BASE="http://localhost:3946/api"

case "$1" in
  send)
    FROM="$2"; TO="$3"; BODY="$4"; SUBJECT="${5:-}"
    curl -sf -X POST "$BASE/send" -H "Content-Type: application/json" \
      -d "{\"from\":\"$FROM\",\"to\":\"$TO\",\"body\":$(echo "$BODY" | jq -Rs .),\"subject\":\"$SUBJECT\"}" | jq .
    ;;
  inbox)
    AGENT="$2"; STATUS="${3:-unread}"
    curl -sf "$BASE/inbox/$AGENT?status=$STATUS" | jq .
    ;;
  read)
    AGENT="$2"
    curl -sf -X POST "$BASE/read/$AGENT" -H "Content-Type: application/json" -d '{}' | jq .
    ;;
  thread)
    curl -sf "$BASE/thread/$2" | jq .
    ;;
  threads)
    curl -sf "$BASE/threads?agent=${2:-}" | jq .
    ;;
  delegate)
    FROM="$2"; TO="$3"; TASK="$4"; CONTEXT="${5:-}"
    curl -sf -X POST "$BASE/delegate" -H "Content-Type: application/json" \
      -d "{\"from\":\"$FROM\",\"to\":\"$TO\",\"task\":$(echo "$TASK" | jq -Rs .),\"context\":\"$CONTEXT\"}" | jq .
    ;;
  context)
    case "$2" in
      get) curl -sf "$BASE/context?key=$3" | jq . ;;
      set) curl -sf -X PUT "$BASE/context" -H "Content-Type: application/json" \
            -d "{\"key\":\"$3\",\"value\":$(echo "$4" | jq -Rs .),\"agent\":\"$5\"}" | jq . ;;
      list) curl -sf "$BASE/context?prefix=${3:-}" | jq . ;;
    esac
    ;;
  heartbeat)
    curl -sf -X POST "$BASE/agents/$2/heartbeat" | jq .
    ;;
  stats)
    curl -sf "$BASE/stats" | jq .
    ;;
  *)
    echo "Usage: comms.sh <send|inbox|read|thread|threads|delegate|context|heartbeat|stats> [args]"
    echo ""
    echo "Commands:"
    echo "  send <from> <to> <body> [subject]     Send a message"
    echo "  inbox <agent> [status]                 Check inbox (default: unread)"
    echo "  read <agent>                           Mark all as read"
    echo "  thread <thread_id>                     View thread history"
    echo "  threads [agent]                        List threads"
    echo "  delegate <from> <to> <task> [context]  Delegate a task"
    echo "  context get <key>                      Get shared context"
    echo "  context set <key> <value> <agent>      Set shared context"
    echo "  context list [prefix]                  List context keys"
    echo "  heartbeat <agent>                      Send heartbeat"
    echo "  stats                                  Overview"
    ;;
esac
