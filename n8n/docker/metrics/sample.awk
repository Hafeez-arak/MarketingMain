# Logs CPU and memory for the marketing containers, one row per container per
# minute, so "how much does this use, at peak and on average" has an answer
# that goes back further than the last container restart.
#
# Reads the kernel's own counters for each container every SAMPLE_SECONDS
# (default 5) and writes, each minute, to $METRICS_DIR/YYYY-MM.csv:
#
#   time,epoch,container,cpu_avg_pct,cpu_peak_pct,mem_avg_mib,mem_peak_mib
#
# cpu_avg_pct is the true average over the minute (from the cumulative CPU-time
# counter, so nothing between samples is missed); cpu_peak_pct is the busiest
# single sample interval in it. Both are % of ONE core, as `docker stats`
# reports them: 100 = one core flat out. Memory is what `docker stats` shows
# (usage minus reclaimable page cache), averaged and maxed over the samples.
#
# The row named "wsl-vm" is the whole machine the containers run in: every
# container (ORAI's too) plus WSL itself.
#
# Why sample instead of reading the lifetime counters later: those reset each
# time a container is recreated, and auto-deploy recreates them on every
# change, so they never cover more than a few days.

function readline(f,   v) { v = ""; if ((getline v < f) <= 0) v = ""; close(f); return v }

function statval(f, key,   line, a, v) {
  v = ""
  while ((getline line < f) > 0) { split(line, a, " "); if (a[1] == key) { v = a[2]; break } }
  close(f)
  return v
}

function uptime(   a) { split(readline("/proc/uptime"), a, " "); return a[1] + 0 }

function resolve(name,   cmd, id) {
  id = ""
  cmd = "docker inspect -f '{{.Id}}' " name " 2>/dev/null"
  cmd | getline id
  close(cmd)
  return id
}

# Sets CPU (ns used so far) and MEM (bytes now) for a container id. 0 if gone.
function readcg(id,   d, u, m) {
  # cgroup v1, what this box runs.
  u = readline(CG "/cpuacct/docker/" id "/cpuacct.usage")
  if (u != "") {
    d = CG "/memory/docker/" id
    CPU = u + 0
    MEM = readline(d "/memory.usage_in_bytes") - statval(d "/memory.stat", "total_inactive_file")
    return 1
  }
  # cgroup v2, for a move to a newer machine: the cgroupfs driver puts
  # containers under docker/, the systemd driver under system.slice/.
  d = CG "/docker/" id
  if (readline(d "/memory.current") == "") d = CG "/system.slice/docker-" id ".scope"
  m = readline(d "/memory.current")
  if (m == "") return 0
  CPU = statval(d "/cpu.stat", "usage_usec") * 1000
  MEM = m - statval(d "/memory.stat", "inactive_file")
  return 1
}

# The same two numbers for the whole VM. /proc is the VM's, not the
# container's: Docker does not virtualise /proc/stat or /proc/meminfo.
function readvm(   a, i, total) {
  split(readline("/proc/stat"), a, " ")
  total = 0
  for (i = 2; i <= 9; i++) total += a[i]
  CPU = (total - a[5] - a[6]) * 1e7   # busy jiffies (USER_HZ 100) as ns
  MEM = (statval("/proc/meminfo", "MemTotal:") - statval("/proc/meminfo", "MemAvailable:")) * 1024
  return 1
}

function sample(i, t,   ok, d, dt, pct) {
  if (names[i] == "wsl-vm") ok = readvm()
  else ok = ids[i] != "" && readcg(ids[i])
  if (!ok) { seen[i] = 0; return }

  # A smaller counter than last time means the container restarted between
  # samples: start a new baseline rather than log a negative.
  if (seen[i] && CPU >= lastcpu[i] && t > lastt[i]) {
    d = CPU - lastcpu[i]; dt = t - lastt[i]
    busy[i] += d; span[i] += dt
    pct = d / dt / 1e7
    if (pct > cpupeak[i]) cpupeak[i] = pct
  }
  seen[i] = 1; lastcpu[i] = CPU; lastt[i] = t
  memsum[i] += MEM; n[i]++
  if (MEM > mempeak[i]) mempeak[i] = MEM
}

function flush(minute,   at, file, i, avg) {
  at = minute * 60
  file = DIR "/" strftime("%Y-%m", at) ".csv"
  if (readline(file) == "")
    print "time,epoch,container,cpu_avg_pct,cpu_peak_pct,mem_avg_mib,mem_peak_mib" > file
  for (i = 1; i <= count; i++) {
    if (n[i] == 0) continue
    avg = span[i] > 0 ? sprintf("%.2f", busy[i] / span[i] / 1e7) : ""
    printf "%s,%d,%s,%s,%.2f,%.0f,%.0f\n", strftime("%Y-%m-%d %H:%M", at), at, names[i],
      avg, cpupeak[i], memsum[i] / n[i] / 1048576, mempeak[i] / 1048576 >> file
  }
  close(file)
}

BEGIN {
  CG = ENVIRON["HOST_CGROUP"] ? ENVIRON["HOST_CGROUP"] : "/host/cgroup"
  DIR = ENVIRON["METRICS_DIR"] ? ENVIRON["METRICS_DIR"] : "/data"
  every = ENVIRON["SAMPLE_SECONDS"] ? ENVIRON["SAMPLE_SECONDS"] : 5
  count = split(ENVIRON["METRICS_CONTAINERS"], names, " ")
  names[++count] = "wsl-vm"

  current = -1
  while (1) {
    minute = int(systime() / 60)
    if (minute != current) {
      if (current >= 0) flush(current)
      current = minute
      for (i = 1; i <= count; i++) {
        busy[i] = span[i] = cpupeak[i] = memsum[i] = n[i] = mempeak[i] = 0
        # Looked up every minute: a redeploy gives the container a new id.
        if (names[i] != "wsl-vm") {
          id = resolve(names[i])
          if (id != ids[i]) seen[i] = 0
          ids[i] = id
        }
      }
    }
    t = uptime()
    for (i = 1; i <= count; i++) sample(i, t)
    system("sleep " every)
  }
}
