#!/bin/sh
# Average and peak CPU and memory per container over the last N days (default
# 7), from the rows sample.awk logs. Run on the n8n box:
#
#   docker exec arak-marketing-metrics report 30
#
# "Minutes logged" against the window tells you how much of it was covered;
# the gaps are the machine asleep or off.
days=${1:-7}
since=$(( $(date +%s) - days * 86400 ))
cat "${METRICS_DIR:-/data}"/*.csv 2>/dev/null | awk -F, -v since="$since" -v days="$days" -v cores="$(nproc)" '
$1 == "time" || $2 < since { next }
{
  c = $3
  if (!(c in rows)) order[++k] = c
  rows[c]++
  if ($4 != "") { cpu[c] += $4; cpun[c]++ }
  mem[c] += $6
  if ($5 + 0 > cpupk[c]) { cpupk[c] = $5 + 0; cpuat[c] = $1 }
  if ($7 + 0 > mempk[c]) { mempk[c] = $7 + 0; memat[c] = $1 }
  if (first == "" || $1 < first) first = $1
  if ($1 > last) last = $1
}
END {
  if (!k) { print "No rows in the last " days " day(s) yet."; exit }
  printf "Last %d day(s): %s to %s\n\n", days, first, last
  printf "%-22s %8s  %-24s  %10s  %-27s  %7s\n", "", "avg CPU", "peak CPU (when)", "avg mem", "peak mem (when)", "minutes"
  for (i = 1; i <= k; i++) {
    c = order[i]
    printf "%-22s %7.2f%%  %6.1f%% %-16s  %6.0f MiB  %6.0f MiB %-16s  %7d\n", c,
      cpun[c] ? cpu[c] / cpun[c] : 0, cpupk[c], cpuat[c], mem[c] / rows[c], mempk[c], memat[c], rows[c]
  }
  printf "\nCPU is %% of one core (this machine has %d). Peak CPU is the busiest 5 seconds.\n", cores
  printf "wsl-vm is the whole VM: every container, ORAI'"'"'s too, plus WSL itself.\n"
}'
