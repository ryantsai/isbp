#!/usr/bin/env bash
# The flow simulator's own stack: the API and the worker from the production build (apps/api/dist), on their own
# database, Redis index, ports and integration stand-ins, so a simulation never touches the demo stack.
#
#   pnpm sim:stack                 start (creates, migrates and seeds the database the first time)
#   pnpm sim:stack --reset         drop and recreate the database, migrate, seed, then start
#   pnpm sim:stack stop | status | env
#
# Build the API first (`pnpm turbo run build --filter=@isbp/api`), and don't rebuild while a simulation runs.
# Everything is overridable by environment variables (defaults below). Logs, pids, uploaded files and the seed's output
# go to $SIM_DIR. The seed's output contains the demo passwords: it is written to seed.log and never printed.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SIM_DIR="${SIM_DIR:-$REPO/tooling/flow-sim/.state/stack}"
SIM_DB_NAME="${SIM_DB_NAME:-isbp_sim}"
SIM_PG="${SIM_PG:-postgres://isbp:isbp@localhost:5432}"
SIM_REDIS_URL="${SIM_REDIS_URL:-redis://localhost:6379/12}"
SIM_API_PORT="${SIM_API_PORT:-4010}"
SIM_API_METRICS_PORT="${SIM_API_METRICS_PORT:-9474}"
SIM_WORKER_METRICS_PORT="${SIM_WORKER_METRICS_PORT:-9475}"
# The integration stand-ins: by default the stack runs its own on SIM_MOCKS_PORT (the seed resets the stand-ins'
# state and registers webhooks, so sharing the dev stack's would disturb it). Set SIM_MOCKS_URL to use running ones.
SIM_MOCKS_PORT="${SIM_MOCKS_PORT:-4110}"
SIM_MOCKS_URL="${SIM_MOCKS_URL:-}"
SIM_LOG_LEVEL="${SIM_LOG_LEVEL:-info}"

DATABASE_URL="$SIM_PG/$SIM_DB_NAME"
API_URL="http://127.0.0.1:$SIM_API_PORT"
TSX="$REPO/node_modules/.bin/tsx"
API_DIR="$REPO/apps/api"
OWN_MOCKS=0
if [[ -z "$SIM_MOCKS_URL" ]]; then
  OWN_MOCKS=1
  SIM_MOCKS_URL="http://127.0.0.1:$SIM_MOCKS_PORT"
fi

die() {
  echo "sim:stack: $*" >&2
  exit 1
}
masked() { sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#' <<<"$1"; }

redis_db="${SIM_REDIS_URL##*/}"
[[ "$redis_db" =~ ^[0-9]+$ && "$redis_db" != "0" ]] ||
  die "SIM_REDIS_URL must name a Redis database index other than 0 (the dev stack's), e.g. redis://localhost:6379/12"
[[ -f "$API_DIR/dist/main.js" ]] || die "no API build: run pnpm turbo run build --filter=@isbp/api"
mkdir -p "$SIM_DIR/files"

stack_env=(
  "DATABASE_URL=$DATABASE_URL"
  "REDIS_URL=$SIM_REDIS_URL"
  "HOST=127.0.0.1"
  "PORT=$SIM_API_PORT"
  "PUBLIC_URL=$API_URL"
  "RATE_LIMIT_MAX=100000"
  "RATE_LIMIT_ROUTE_SCALE=1000"
  "LOGIN_MAX_ATTEMPTS=1000"
  "ISBP_ALLOW_PRIVATE_WEBHOOKS=true"
  "FILES_DIR=$SIM_DIR/files"
  "INTEGRATION_MOCKS_URL=$SIM_MOCKS_URL"
  "LOG_LEVEL=$SIM_LOG_LEVEL"
  "LOG_PRETTY=false"
)

marker_of() {
  case "$1" in
    api) echo "dist/main.js" ;;
    worker) echo "dist/worker.js" ;;
    mocks) echo "integration-mocks/src/main.ts" ;;
  esac
}

pid_of() {
  local file="$SIM_DIR/$1.pid"
  [[ -f "$file" ]] || return 1
  local pid
  pid="$(cat "$file")"
  [[ -n "$pid" ]] && ps -p "$pid" -o command= 2>/dev/null | grep -q "$(marker_of "$1")" && echo "$pid"
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

wait_ready() {
  local name=$1 url=$2
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "$url"; then
      echo "  ✓ $name ready ($url)"
      return 0
    fi
    pid_of "$name" >/dev/null || die "$name exited during start-up: see $SIM_DIR/$name.log"
    sleep 0.5
  done
  die "$name not ready after 60 s: see $SIM_DIR/$name.log"
}

launch() {
  local name=$1 dir=$2
  shift 2
  if pid="$(pid_of "$name")"; then
    echo "  · $name already running (pid $pid)"
    return 0
  fi
  [[ -f "$SIM_DIR/$name.log" ]] && mv -f "$SIM_DIR/$name.log" "$SIM_DIR/$name.log.1"
  # `exec` all the way down, so the pid is the process itself (and nothing keeps this script's output open).
  (cd "$dir" && exec nohup env "$@" >>"$SIM_DIR/$name.log" 2>&1 </dev/null) &
  echo $! >"$SIM_DIR/$name.pid"
}

start_mocks() {
  [[ $OWN_MOCKS == 1 ]] || return 0
  if ! pid_of mocks >/dev/null; then
    port_busy "$SIM_MOCKS_PORT" && die "port $SIM_MOCKS_PORT is in use (set SIM_MOCKS_PORT or SIM_MOCKS_URL)"
    launch mocks "$REPO" "DEV_MOCKS_PORT=$SIM_MOCKS_PORT" "MOCKS_DATA_FILE=$SIM_DIR/integration-mocks.json" \
      "$TSX" tooling/integration-mocks/src/main.ts
  fi
  wait_ready mocks "$SIM_MOCKS_URL/_mock/health"
}

start_app() {
  if ! pid_of api >/dev/null; then
    for p in "$SIM_API_PORT" "$SIM_API_METRICS_PORT"; do
      port_busy "$p" && die "port $p is in use by another process (set SIM_API_PORT / SIM_API_METRICS_PORT)"
    done
  fi
  if ! pid_of worker >/dev/null && port_busy "$SIM_WORKER_METRICS_PORT"; then
    die "port $SIM_WORKER_METRICS_PORT is in use by another process (set SIM_WORKER_METRICS_PORT)"
  fi
  launch api "$API_DIR" "${stack_env[@]}" "METRICS_PORT=$SIM_API_METRICS_PORT" \
    node --import ./dist/telemetry.js dist/main.js
  wait_ready api "$API_URL/readyz"
  launch worker "$API_DIR" "${stack_env[@]}" "METRICS_PORT=$SIM_WORKER_METRICS_PORT" \
    node --import ./dist/telemetry.js dist/worker.js
  wait_ready worker "http://127.0.0.1:$SIM_WORKER_METRICS_PORT/readyz"
}

stop_one() {
  local name=$1 pid
  if pid="$(pid_of "$name")"; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      ps -p "$pid" >/dev/null 2>&1 || break
      sleep 0.5
    done
    ps -p "$pid" >/dev/null 2>&1 && kill -9 "$pid" 2>/dev/null || true
    echo "  ✓ $name stopped"
  fi
  rm -f "$SIM_DIR/$name.pid"
}

migrate_and_seed() {
  local reset_flag=${1:-}
  echo "  · migrating $SIM_DB_NAME"
  (cd "$API_DIR" && env "${stack_env[@]}" node dist/migrate.js $reset_flag >>"$SIM_DIR/migrate.log" 2>&1) ||
    die "migration failed: see $SIM_DIR/migrate.log"
  echo "  · seeding $SIM_DB_NAME (output in $SIM_DIR/seed.log)"
  (cd "$API_DIR" && env "${stack_env[@]}" node dist/seed.js >"$SIM_DIR/seed.log" 2>&1) ||
    die "seed failed: see $SIM_DIR/seed.log"
}

cmd_start() {
  local reset=$1
  if [[ $reset == 1 ]]; then
    stop_one worker
    stop_one api
    stop_one mocks
    rm -f "$SIM_DIR/integration-mocks.json"
    rm -rf "$SIM_DIR/files" && mkdir -p "$SIM_DIR/files"
    "$TSX" "$REPO/tooling/flow-sim/src/stack/db.ts" drop "$DATABASE_URL" >/dev/null
  fi
  local created
  created="$("$TSX" "$REPO/tooling/flow-sim/src/stack/db.ts" ensure "$DATABASE_URL")"
  start_mocks
  if [[ $reset == 1 ]]; then
    # --reset also empties the stack's Redis database (queues, sessions, caches).
    migrate_and_seed --reset
  elif [[ $created == created ]]; then
    migrate_and_seed
  fi
  start_app
  # The personas the simulator signed in as belonged to the old database.
  [[ $reset == 1 ]] && rm -f "$REPO/tooling/flow-sim/.state/personas-127.0.0.1-$SIM_API_PORT.json"
  cmd_env
}

cmd_status() {
  for name in mocks api worker; do
    if pid="$(pid_of "$name")"; then echo "  $name: running (pid $pid)"; else echo "  $name: stopped"; fi
  done
}

cmd_env() {
  echo "  API      $API_URL"
  echo "  database $(masked "$DATABASE_URL")"
  echo "  redis    $SIM_REDIS_URL"
  echo "  worker   http://127.0.0.1:$SIM_WORKER_METRICS_PORT/metrics"
  echo "  logs     $SIM_DIR/api.log, $SIM_DIR/worker.log"
  echo "  run      pnpm sim --api $API_URL --logs $SIM_DIR"
}

reset=0
command=start
for arg in "$@"; do
  case "$arg" in
    --reset) reset=1 ;;
    start | stop | status | env | restart) command=$arg ;;
    *) die "unknown argument $arg (start|stop|status|env|restart, --reset)" ;;
  esac
done

case "$command" in
  start) cmd_start "$reset" ;;
  restart)
    stop_one worker
    stop_one api
    cmd_start "$reset"
    ;;
  stop)
    stop_one worker
    stop_one api
    stop_one mocks
    ;;
  status) cmd_status ;;
  env) cmd_env ;;
esac
