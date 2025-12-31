BEGIN { OFS=" " }
# Extract simple JSON fields (string/number) by regex; tolerant to spacing.
function json_get(s, key,   pat, s2) {
  pat="\"" key "\"[[:space:]]*:[[:space:]]*"
  if (match(s, pat)) {
    s2=substr(s, RSTART+RLENGTH)
    if (key=="ts" && match(s2, /^-?[0-9]+/)) return substr(s2, RSTART, RLENGTH)
    if (match(s2, /^\"([^\"\\]|\\.)*\"/))    return substr(s2, RSTART+1, RLENGTH-2)
  }
  return ""
}
# Detect meta.admin=true without parsing whole JSON.
function has_admin_true(s,    pat) {
  pat="\"meta\"[[:space:]]*:[[:space:]]*\\{[^}]*\"admin\"[[:space:]]*:[[:space:]]*true"
  return (s ~ pat)
}
# ISO8601 UTC using awk's strftime()
function iso8601(ms,    sec){ sec=ms/1000; return strftime("%Y-%m-%dT%H:%M:%SZ", sec, 1) }

# Purge sessions older than now-10s for a given user; return remaining distinct count.
function purge_old(user, now,   k, ts, idx, cnt) {
  cnt=0
  for (k in last_seen) {
    if (split(k, idx, SUBSEP)==2 && idx[1]==user) {
      ts = last_seen[k]
      if (ts < now-10000) delete last_seen[k]
    }
  }
  for (k in last_seen) if (split(k, idx, SUBSEP)==2 && idx[1]==user) cnt++
  return cnt
}

# Process only brace-delimited lines; malformed lines are ignored safely.
# Input must be: cat pipe/events.fifo | awk -f consumer.awk
/^\{.*\}$/ {
  if (!has_admin_true($0)) next
  ts  = json_get($0, "ts") + 0
  usr = json_get($0, "user")
  ses = json_get($0, "session")
  if (ts==0 || usr=="" || ses=="") next

  oldc = purge_old(usr, ts)
  last_seen[usr SUBSEP ses] = ts

  newc = 0
  for (k in last_seen) if (split(k, idx, SUBSEP)==2 && idx[1]==usr) newc++

  # Emit ONE alert on threshold crossing (<3 → ≥3) with 3s per-user cooldown
  sec = int(ts/1000)
  if (oldc < 3 && newc >= 3) {
    if (!(usr in last_alert_sec) || sec - last_alert_sec[usr] >= 3) {
      print "ALERT", usr, newc, "admin-sessions in 10s at", iso8601(ts) >> "alerts.txt"
      fflush("alerts.txt")
      last_alert_sec[usr] = sec
    }
  }
}
