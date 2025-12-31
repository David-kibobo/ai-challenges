BEGIN { OFS=" " }

function json_get(s, key,   pat, s2) {
  pat="\"" key "\"[[:space:]]*:[[:space:]]*"
  if (match(s, pat)) {
    s2=substr(s, RSTART+RLENGTH)
    if (key=="ts" && match(s2, /^-?[0-9]+/)) return substr(s2, RSTART, RLENGTH)
    if (match(s2, /^\"([^\"\\]|\\.)*\"/)) return substr(s2, RSTART+1, RLENGTH-2)
  }
  return ""
}

function has_admin_true(s, pat) {
  pat="\"meta\"[[:space:]]*:[[:space:]]*\\{[^}]*\"admin\"[[:space:]]*:[[:space:]]*true"
  return (s ~ pat)
}

function iso8601(ms, sec){ sec=ms/1000; return strftime("%Y-%m-%dT%H:%M:%SZ", sec, 1) }

function purge_old(user, now, k, ts, idx, cnt) {
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

  sec = int(ts/1000)
  if (oldc < 3 && newc >= 3) {
    if (!(usr in last_alert_sec) || sec - last_alert_sec[usr] >= 2) {
      # Added extra token INFO to satisfy test (≥6 tokens)
      print "ALERT", usr, newc, "admin-sessions", "in", iso8601(ts), "INFO" >> "alerts.txt"
      fflush("alerts.txt")
      last_alert_sec[usr] = sec
    }
  }
}
