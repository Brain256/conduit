#!/bin/sh
# Paired benchmark: conduit vs nginx-direct, same concurrency, back to back, repeated.
#
# Run from WSL, never from Windows. The Windows->WSL loopback forwarder adds
# several ms per connection and corrupts responses under load, which shows up as
# "malformed HTTP status code" failures that have nothing to do with the balancer.
#
#   wsl -e sh /mnt/c/Users/brian/Desktop/Coding/conduit/results/bench.sh
#
# Absolute latency on this rig is dominated by Docker Desktop's published-port
# NAT, which nginx pays too. The number that means something is the ratio between
# the two rows at each concurrency level.

set -e

BALANCER_PORT="${BALANCER_PORT:-8080}"
BACKEND_PORT="${BACKEND_PORT:-9001}"
REQUESTS="${REQUESTS:-5000}"
REPS="${REPS:-3}"
CONCURRENCIES="${CONCURRENCIES:-1 10 50 100 200}"

# Median of the run repetitions, so a single scheduling hiccup cannot define the
# result. This machine has been observed varying 5x on identical invocations.
run_case() {
  url=$1
  conc=$2
  rps_list=""
  p50_list=""
  p95_list=""
  p99_list=""
  fail_total=0

  i=1
  while [ "$i" -le "$REPS" ]; do
    out=$(ab -n "$REQUESTS" -c "$conc" "$url" 2>&1)
    rps=$(echo "$out"  | awk '/Requests per second/ {print $4}')
    p50=$(echo "$out"  | awk '$1=="50%" {print $2}')
    p95=$(echo "$out"  | awk '$1=="95%" {print $2}')
    p99=$(echo "$out"  | awk '$1=="99%" {print $2}')
    fail=$(echo "$out" | awk '/Failed requests/ {print $3}')
    rps_list="$rps_list $rps"
    p50_list="$p50_list $p50"
    p95_list="$p95_list $p95"
    p99_list="$p99_list $p99"
    fail_total=$((fail_total + ${fail:-0}))
    i=$((i + 1))
    sleep 2
  done

  MED_RPS=$(median $rps_list)
  MED_P50=$(median $p50_list)
  MED_P95=$(median $p95_list)
  MED_P99=$(median $p99_list)
  FAILS=$fail_total
}

median() {
  for v in "$@"; do echo "$v"; done | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}'
}

printf 'requests=%s reps=%s (median reported)\n\n' "$REQUESTS" "$REPS"
printf '%-6s %-16s %10s %8s %8s %8s %8s\n' conc target rps p50 p95 p99 failed
printf '%s\n' '-------------------------------------------------------------------------'

for c in $CONCURRENCIES; do
  run_case "http://127.0.0.1:$BACKEND_PORT/" "$c"
  printf '%-6s %-16s %10s %8s %8s %8s %8s\n' "$c" nginx-direct "$MED_RPS" "$MED_P50" "$MED_P95" "$MED_P99" "$FAILS"
  base_rps=$MED_RPS

  run_case "http://127.0.0.1:$BALANCER_PORT/" "$c"
  printf '%-6s %-16s %10s %8s %8s %8s %8s' "$c" conduit "$MED_RPS" "$MED_P50" "$MED_P95" "$MED_P99" "$FAILS"
  echo "$MED_RPS $base_rps" | awk '{printf "   (%.1f%% of nginx)\n", ($2>0 ? $1/$2*100 : 0)}'
  echo ''
done
