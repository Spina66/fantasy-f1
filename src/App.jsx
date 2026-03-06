import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ── CONFIG — fill these in after Supabase setup ───────────────────────────────
const SUPABASE_URL = "https://jdbrruuzberopdrlxwvn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkYnJydXV6YmVyb3Bkcmx4d3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NjY5ODcsImV4cCI6MjA4ODM0Mjk4N30.A-fK5M_uh5WsPaRdSyQAfqHLY-Gm0v-KPP6aDyKp1mI";
const ADMIN_PASSWORD = "f1spina";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

// Starting rosters at Round 1 — these are the initial ownership records.
// Do NOT change these after the season starts; use admin roster moves instead.
const INITIAL_ROSTERS = {
  NoCal: ["RUS", "PIA", "HAM", "OCO", "ALB"],
  SoCal: ["NOR", "VER", "SAI", "BOR", "LAW"],
  Cuz:   ["LEC", "ANT", "HAD", "BEA", "GAS"],
};

const TEAM_COLORS = {
  NoCal: { accent: "#1E90FF" },
  SoCal: { accent: "#FF6B00" },
  Cuz:   { accent: "#9B30FF" },
};

const TEAMS = Object.keys(INITIAL_ROSTERS);

const F1_DRIVER_MAP = {
  VER: "Max Verstappen",     NOR: "Lando Norris",      LEC: "Charles Leclerc",
  PIA: "Oscar Piastri",      SAI: "Carlos Sainz",      RUS: "George Russell",
  HAM: "Lewis Hamilton",     ANT: "Kimi Antonelli",    ALB: "Alexander Albon",
  OCO: "Esteban Ocon",       GAS: "Pierre Gasly",      LAW: "Liam Lawson",
  HAD: "Isack Hadjar",       BEA: "Oliver Bearman",    BOR: "Gabriel Bortoleto",
  HUL: "Nico Hulkenberg",    TSU: "Yuki Tsunoda",      STR: "Lance Stroll",
  ALO: "Fernando Alonso",    COL: "Franco Colapinto",
};

// ── SCORING ───────────────────────────────────────────────────────────────────

function getRacePoints(position) {
  if (!position || position < 1 || position > 22) return 0;
  return 23 - position;
}

function getSprintPoints(position) {
  const pts = [8, 7, 6, 5, 4, 3, 2, 1];
  if (!position || position < 1 || position > 8) return 0;
  return pts[position - 1];
}

function applyDNFPenalties(dnfs) {
  const sorted = [...dnfs].sort((a, b) => b.lapsCompleted - a.lapsCompleted);
  return sorted.map((d, i) => ({ ...d, points: -(i + 1) }));
}

function scoreRace(raceResult) {
  if (!raceResult?.Results) return {};
  const scores = {};
  const dnfs = [];
  raceResult.Results.forEach((r) => {
    const code = r.Driver.code;
    const finished = ["Finished","+1 Lap","+2 Laps","+3 Laps","+4 Laps",
                      "+5 Laps","+6 Laps","+7 Laps","+8 Laps","+9 Laps","+10 Laps"].includes(r.status);
    if (!finished) {
      dnfs.push({ code, lapsCompleted: parseInt(r.laps) || 0 });
    } else {
      scores[code] = { race: getRacePoints(parseInt(r.position)), dnf: false };
    }
  });
  applyDNFPenalties(dnfs).forEach(({ code, points }) => {
    scores[code] = { race: points, dnf: true };
  });
  return scores;
}

function scoreSprint(sprintResult) {
  if (!sprintResult?.SprintResults) return {};
  const scores = {};
  sprintResult.SprintResults.forEach((r) => {
    scores[r.Driver.code] = { sprint: getSprintPoints(parseInt(r.position)) };
  });
  return scores;
}

// ── ROSTER HISTORY ENGINE ─────────────────────────────────────────────────────

function getRosterAtRound(moves, round) {
  const ownership = {};
  Object.entries(INITIAL_ROSTERS).forEach(([team, drivers]) => {
    drivers.forEach(d => { ownership[d] = team; });
  });
  [...moves]
    .filter(m => parseInt(m.fromRound) <= parseInt(round))
    .sort((a, b) => parseInt(a.fromRound) - parseInt(b.fromRound))
    .forEach(({ driver, toTeam }) => {
      ownership[driver] = toTeam || null;
    });
  return ownership;
}

// ── F1 API ────────────────────────────────────────────────────────────────────

const ERGAST_BASE = "https://api.jolpi.ca/ergast/f1";

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetch2025Schedule() {
  const data = await fetchJSON(`${ERGAST_BASE}/2025/races.json?limit=30`);
  return data.MRData.RaceTable.Races;
}

async function fetchRaceResult(round) {
  const data = await fetchJSON(`${ERGAST_BASE}/2025/${round}/results.json`);
  return data.MRData.RaceTable.Races[0];
}

async function fetchSprintResult(round) {
  try {
    const data = await fetchJSON(`${ERGAST_BASE}/2025/${round}/sprint.json`);
    return data.MRData.RaceTable.Races[0];
  } catch { return null; }
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function FantasyF1App() {
  const [tab, setTab] = useState("standings");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  const [schedule, setSchedule] = useState([]);
  const [results, setResults] = useState({});
  const [moves, setMoves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingRace, setLoadingRace] = useState(null);
  const [error, setError] = useState(null);
  const [selectedRace, setSelectedRace] = useState(null);

  const [moveDriver, setMoveDriver] = useState("");
  const [moveTeam, setMoveTeam] = useState("");
  const [moveRound, setMoveRound] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveSuccess, setMoveSuccess] = useState(false);

  // ── SUPABASE ────────────────────────────────────────────────────────────────

  const loadMoves = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("roster_moves")
        .select("*")
        .order("fromRound", { ascending: true });
      if (error) throw error;
      setMoves(data || []);
    } catch (e) {
      console.warn("Supabase not configured yet:", e.message);
    }
  }, []);

  const saveMove = async () => {
    if (!moveDriver || !moveRound) return;
    setMoveSaving(true);
    try {
      const { error } = await supabase.from("roster_moves").insert([{
        driver: moveDriver.toUpperCase(),
        toTeam: moveTeam || null,
        fromRound: parseInt(moveRound),
        createdAt: new Date().toISOString(),
      }]);
      if (error) throw error;
      await loadMoves();
      setMoveDriver(""); setMoveTeam(""); setMoveRound("");
      setMoveSuccess(true);
      setTimeout(() => setMoveSuccess(false), 2500);
    } catch (e) {
      alert("Error saving move: " + e.message);
    } finally {
      setMoveSaving(false);
    }
  };

  const deleteMove = async (id) => {
    if (!window.confirm("Delete this roster move?")) return;
    await supabase.from("roster_moves").delete().eq("id", id);
    await loadMoves();
  };

  // ── F1 DATA ─────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const races = await fetch2025Schedule();
      setSchedule(races);
      const today = new Date();
      const completed = races.filter(r => new Date(r.date) < today);
      const newResults = {};
      for (const race of completed) {
        setLoadingRace(race.raceName);
        const [raceRes, sprintRes] = await Promise.all([
          fetchRaceResult(race.round).catch(() => null),
          fetchSprintResult(race.round).catch(() => null),
        ]);
        newResults[race.round] = {
          race: raceRes ? scoreRace(raceRes) : {},
          sprint: sprintRes ? scoreSprint(sprintRes) : {},
          raceName: race.raceName,
          date: race.date,
          rawRace: raceRes,
        };
      }
      setResults(newResults);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false); setLoadingRace(null);
    }
  }, []);

  useEffect(() => { loadData(); loadMoves(); }, [loadData, loadMoves]);

  // ── COMPUTED ─────────────────────────────────────────────────────────────────

  const raceByRace = useCallback(() => {
    return Object.entries(results)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([round, data]) => {
        const ownership = getRosterAtRound(moves, round);
        const teamPts = Object.fromEntries(TEAMS.map(t => [t, 0]));
        Object.entries(data.race).forEach(([code, s]) => {
          const team = ownership[code];
          if (team && teamPts[team] !== undefined) teamPts[team] += s.race;
        });
        Object.entries(data.sprint).forEach(([code, s]) => {
          const team = ownership[code];
          if (team && teamPts[team] !== undefined) teamPts[team] += s.sprint;
        });
        return { round, ...data, teamPts, ownership };
      });
  }, [results, moves]);

  const teamTotals = useCallback(() => {
    const totals = Object.fromEntries(TEAMS.map(t => [t, 0]));
    raceByRace().forEach(r => {
      TEAMS.forEach(t => { totals[t] += r.teamPts[t] || 0; });
    });
    return totals;
  }, [raceByRace]);

  const currentRosters = useCallback(() => {
    const lastRound = Math.max(0, ...Object.keys(results).map(Number));
    return getRosterAtRound(moves, lastRound || 999);
  }, [results, moves]);

  const freeAgents = useCallback(() => {
    const cr = currentRosters();
    return Object.keys(F1_DRIVER_MAP).filter(d => !cr[d]);
  }, [currentRosters]);

  // Per-driver totals with team attribution
  const driverTeamScores = useCallback(() => {
    const scores = {}; // { team: { driver: { total, current } } }
    TEAMS.forEach(t => { scores[t] = {}; });
    raceByRace().forEach(({ race, sprint, ownership }) => {
      Object.keys(F1_DRIVER_MAP).forEach(code => {
        const team = ownership[code];
        if (!team) return;
        const pts = (race[code]?.race || 0) + (sprint[code]?.sprint || 0);
        if (!scores[team][code]) scores[team][code] = { total: 0 };
        scores[team][code].total += pts;
      });
    });
    return scores;
  }, [raceByRace]);

  // ── AUTH ─────────────────────────────────────────────────────────────────────

  const handleLogin = () => {
    if (pwInput === ADMIN_PASSWORD) {
      setIsAdmin(true); setShowLogin(false); setPwError(false); setTab("admin");
    } else {
      setPwError(true);
    }
  };

  // ── RENDER ───────────────────────────────────────────────────────────────────

  const tt = teamTotals();
  const sorted = TEAMS.slice().sort((a, b) => tt[b] - tt[a]);
  const rbr = raceByRace();
  const cr = currentRosters();
  const dts = driverTeamScores();

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0F", color: "#E8E8F0", fontFamily: "'Rajdhani', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Orbitron:wght@700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #0A0A0F; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        .tab-btn { background: none; border: none; cursor: pointer; font-family: 'Rajdhani',sans-serif; font-weight: 600; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; padding: 10px 18px; color: #555; transition: all 0.2s; border-bottom: 2px solid transparent; }
        .tab-btn.active { color: #E8003D; border-bottom-color: #E8003D; }
        .tab-btn:hover:not(.active) { color: #aaa; }
        .card { background: #13131A; border: 1px solid #222; border-radius: 4px; overflow: hidden; margin-bottom: 16px; }
        .card-header { padding: 13px 20px; border-bottom: 1px solid #222; display: flex; align-items: center; justify-content: space-between; }
        .driver-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid #1A1A24; font-size: 14px; }
        .driver-row:last-child { border-bottom: none; } .driver-row:hover { background: #1A1A26; }
        .pts-badge { font-family: 'Orbitron',sans-serif; font-size: 13px; font-weight: 700; }
        .refresh-btn { background: #E8003D; color: white; border: none; font-family: 'Rajdhani',sans-serif; font-weight: 700; letter-spacing: 2px; font-size: 12px; cursor: pointer; padding: 8px 18px; border-radius: 3px; text-transform: uppercase; }
        .refresh-btn:hover { background: #ff1a52; } .refresh-btn:disabled { background: #444; cursor: default; }
        .action-btn { background: #1E1E2A; color: #aaa; border: 1px solid #333; font-family: 'Rajdhani',sans-serif; font-weight: 600; letter-spacing: 1px; font-size: 11px; cursor: pointer; padding: 5px 12px; border-radius: 2px; text-transform: uppercase; transition: all 0.2s; }
        .action-btn:hover { border-color: #E8003D; color: #E8003D; }
        .save-btn { background: #E8003D; color: white; border: none; font-family: 'Rajdhani',sans-serif; font-weight: 700; letter-spacing: 1px; font-size: 13px; cursor: pointer; padding: 9px 22px; border-radius: 3px; text-transform: uppercase; }
        .save-btn:disabled { background: #555; cursor: default; }
        .delete-btn { background: none; border: 1px solid #3A1A1A; color: #FF4444; font-family: 'Rajdhani',sans-serif; font-size: 11px; cursor: pointer; padding: 3px 10px; border-radius: 2px; letter-spacing: 1px; }
        .delete-btn:hover { background: #3A1A1A; }
        select, input[type="text"], input[type="password"], input[type="number"] { background: #0A0A0F; border: 1px solid #333; color: #E8E8F0; font-family: 'Rajdhani',sans-serif; font-size: 14px; padding: 8px 12px; border-radius: 3px; outline: none; }
        select:focus, input:focus { border-color: #E8003D; }
        select option { background: #13131A; }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 11px; letter-spacing: 1px; color: #555; text-transform: uppercase; padding: 10px 14px; text-align: left; border-bottom: 1px solid #1E1E28; }
        td { padding: 9px 14px; border-bottom: 1px solid #181820; font-size: 14px; }
        tr:last-child td { border-bottom: none; } tr:hover td { background: #16161E; }
        .dnf-badge { font-size: 10px; letter-spacing: 1px; background: #3A0A0A; color: #FF4444; padding: 1px 6px; border-radius: 2px; border: 1px solid #FF444433; }
        .fa-badge { font-size: 10px; background: #1A1A1A; color: #666; padding: 1px 6px; border-radius: 2px; letter-spacing: 1px; }
        .success-msg { background: #0A2A0A; border: 1px solid #2A6A2A; color: #4CAF50; padding: 10px 16px; border-radius: 3px; font-size: 13px; letter-spacing: 1px; }
        .ticker { background: #E8003D; padding: 5px 0; font-family: 'Rajdhani',sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 2px; white-space: nowrap; overflow: hidden; }
        .ticker-inner { display: inline-block; animation: ticker 30s linear infinite; }
        @keyframes ticker { 0% { transform: translateX(100vw); } 100% { transform: translateX(-100%); } }
        .loading-pulse { animation: pulse 1.5s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .modal { background: #13131A; border: 1px solid #333; border-radius: 6px; padding: 28px; width: 380px; max-width: 95vw; }
        .standing-pos { font-family: 'Orbitron',sans-serif; font-size: 22px; font-weight: 900; width: 44px; text-align: center; }
        .pos-1{color:#FFD700} .pos-2{color:#C0C0C0} .pos-3{color:#CD7F32}
        .form-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 14px; }
        .form-field { display: flex; flex-direction: column; gap: 5px; }
        .form-label { font-size: 11px; letter-spacing: 2px; color: #666; text-transform: uppercase; }
        .admin-warning { background: #1A1000; border: 1px solid #E8003D33; border-radius: 4px; padding: 10px 16px; font-size: 12px; color: #FF8800; letter-spacing: 1px; margin-bottom: 20px; }
      `}</style>

      {/* HEADER */}
      <div style={{ background: "#0D0D14", borderBottom: "1px solid #1A1A24" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 4, height: 36, background: "#E8003D", borderRadius: 2 }} />
            <div>
              <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 20, fontWeight: 900, color: "#E8003D", letterSpacing: 3 }}>FANTASY F1</div>
              <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", marginTop: 1 }}>2025 SEASON LEAGUE</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="refresh-btn" onClick={loadData} disabled={loading}>{loading ? "LOADING..." : "↻ REFRESH"}</button>
            {isAdmin
              ? <button className="action-btn" style={{ color: "#E8003D", borderColor: "#E8003D55" }} onClick={() => { setIsAdmin(false); setTab("standings"); }}>⬡ ADMIN ON</button>
              : <button className="action-btn" onClick={() => setShowLogin(true)}>ADMIN</button>
            }
          </div>
        </div>
        {!loading && sorted.length > 0 && (
          <div className="ticker">
            <span className="ticker-inner">
              {sorted.map((t, i) => <span key={t} style={{ marginRight: 60 }}>P{i+1} {t}: {tt[t]} PTS</span>)}
              &nbsp;&nbsp;&nbsp;
            </span>
          </div>
        )}
      </div>

      {/* NAV */}
      <div style={{ background: "#0D0D14", borderBottom: "1px solid #1A1A24" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", paddingLeft: 16, display: "flex", flexWrap: "wrap" }}>
          {[
            { key: "standings", label: "Standings" },
            { key: "drivers", label: "Driver Points" },
            { key: "history", label: "Race History" },
            ...(isAdmin ? [{ key: "admin", label: "⬡ Admin" }] : []),
          ].map(t => (
            <button key={t.key} className={`tab-btn${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* MAIN */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "80px 20px" }}>
            <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 13, letterSpacing: 3, color: "#E8003D" }} className="loading-pulse">
              {loadingRace ? `LOADING ${loadingRace.toUpperCase()}...` : "CONNECTING TO F1 DATA..."}
            </div>
          </div>
        )}
        {error && <div style={{ background: "#1A0A0A", border: "1px solid #FF444433", borderRadius: 4, padding: 16, color: "#FF6666", marginBottom: 20, fontSize: 13 }}>⚠ {error}</div>}

        {!loading && (
          <>
            {/* ── STANDINGS ── */}
            {tab === "standings" && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", textTransform: "uppercase", marginBottom: 20 }}>
                  Championship Standings · {Object.keys(results).length} Races Complete
                </div>
                {sorted.map((team, i) => {
                  const c = TEAM_COLORS[team];
                  const posClass = ["pos-1","pos-2","pos-3"][i] || "";
                  const myDrivers = Object.entries(cr).filter(([,t]) => t === team).map(([d]) => d);
                  return (
                    <div key={team} className="card" style={{ borderLeft: `3px solid ${c.accent}` }}>
                      <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: 20 }}>
                        <div className={`standing-pos ${posClass}`}>{i+1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                            <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 18, fontWeight: 700, color: c.accent }}>{team}</div>
                            {i === 0 && <span style={{ fontSize: 10, background: "#E8003D", color: "white", padding: "2px 8px", letterSpacing: 2, fontWeight: 700 }}>LEADER</span>}
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {myDrivers.map(d => (
                              <span key={d} style={{ fontSize: 12, background: "#1A1A26", padding: "3px 10px", borderRadius: 2, color: "#aaa", border: "1px solid #252530" }}>
                                {d} <span style={{ color: c.accent, fontWeight: 600 }}>{dts[team]?.[d]?.total || 0}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="pts-badge" style={{ fontSize: 32, color: c.accent }}>{tt[team]}</div>
                          <div style={{ fontSize: 10, letterSpacing: 2, color: "#555" }}>PTS</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {sorted.length >= 2 && (
                  <div style={{ padding: "12px 20px", background: "#13131A", border: "1px solid #1E1E28", borderRadius: 4, display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, marginBottom: 16 }}>
                    {sorted.slice(1).map(t => (
                      <span key={t} style={{ color: "#666" }}>{t} <span style={{ color: "#E8003D" }}>-{tt[sorted[0]] - tt[t]}</span> behind {sorted[0]}</span>
                    ))}
                  </div>
                )}
                {(() => {
                  const today = new Date();
                  const next = schedule.find(r => new Date(r.date) >= today);
                  if (!next) return null;
                  return (
                    <div className="card" style={{ borderLeft: "3px solid #E8003D" }}>
                      <div style={{ padding: "16px 24px" }}>
                        <div style={{ fontSize: 10, letterSpacing: 3, color: "#E8003D", marginBottom: 4 }}>NEXT RACE</div>
                        <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 16, fontWeight: 700 }}>{next.raceName}</div>
                        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>{next.Circuit.circuitName} · {new Date(next.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── DRIVER POINTS ── */}
            {tab === "drivers" && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", textTransform: "uppercase", marginBottom: 20 }}>Driver Points — credited to owning team at time of each race</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: 16 }}>
                  {TEAMS.map(team => {
                    const c = TEAM_COLORS[team];
                    const rows = Object.entries(dts[team] || {}).sort((a,b) => b[1].total - a[1].total);
                    return (
                      <div key={team} className="card">
                        <div className="card-header" style={{ borderLeft: `3px solid ${c.accent}` }}>
                          <span style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 14, fontWeight: 700, color: c.accent }}>{team}</span>
                          <span className="pts-badge" style={{ color: c.accent }}>{tt[team]} PTS</span>
                        </div>
                        {rows.map(([code, info], idx) => {
                          const isCurrent = cr[code] === team;
                          return (
                            <div key={code} className="driver-row">
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ width: 18, textAlign: "center", fontSize: 11, color: "#555" }}>{idx+1}</span>
                                <div>
                                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                                    {code}
                                    {!isCurrent && <span className="fa-badge">FORMER</span>}
                                  </div>
                                  <div style={{ fontSize: 11, color: "#555" }}>{F1_DRIVER_MAP[code]}</div>
                                </div>
                              </div>
                              <div className="pts-badge" style={{ color: isCurrent ? c.accent : "#555" }}>{info.total}</div>
                            </div>
                          );
                        })}
                        {rows.length === 0 && <div style={{ padding: "14px 16px", color: "#444", fontSize: 13 }}>No races scored yet</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── RACE HISTORY ── */}
            {tab === "history" && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", textTransform: "uppercase", marginBottom: 20 }}>Race-by-Race History · click a row for driver detail</div>
                {rbr.length === 0 && <div style={{ color: "#555", fontSize: 14 }}>No completed races yet.</div>}
                {rbr.length > 0 && (
                  <div className="card">
                    <div className="card-header"><span style={{ fontSize: 12, letterSpacing: 2, color: "#888" }}>TEAM POINTS BY RACE</span></div>
                    <div style={{ overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Race</th>
                            {TEAMS.map(t => <th key={t} style={{ color: TEAM_COLORS[t].accent }}>{t}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {rbr.map(r => (
                            <tr key={r.round} style={{ cursor: "pointer" }} onClick={() => setSelectedRace(selectedRace === r.round ? null : r.round)}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{r.raceName?.replace(" Grand Prix"," GP")}</div>
                                <div style={{ fontSize: 11, color: "#555" }}>{new Date(r.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                              </td>
                              {TEAMS.map(t => <td key={t} className="pts-badge" style={{ color: TEAM_COLORS[t].accent }}>{r.teamPts[t] || 0}</td>)}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#0D0D14" }}>
                            <td style={{ fontWeight: 700, fontSize: 12, letterSpacing: 1, color: "#888" }}>TOTAL</td>
                            {TEAMS.map(t => <td key={t} className="pts-badge" style={{ color: TEAM_COLORS[t].accent, fontSize: 16 }}>{tt[t]}</td>)}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {selectedRace && results[selectedRace] && (() => {
                  const r = results[selectedRace];
                  const { ownership } = rbr.find(x => x.round === selectedRace) || {};
                  return (
                    <div className="card">
                      <div className="card-header">
                        <span style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 14, fontWeight: 700 }}>{r.raceName} — Driver Detail</span>
                        <button className="action-btn" onClick={() => setSelectedRace(null)}>✕ Close</button>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table>
                          <thead><tr><th>Pos</th><th>Driver</th><th>Fantasy Team</th><th>Status</th><th>Race Pts</th><th>Sprint Pts</th><th>Total</th></tr></thead>
                          <tbody>
                            {(r.rawRace?.Results || []).map(row => {
                              const code = row.Driver.code;
                              const fantasyTeam = ownership?.[code];
                              const rPts = r.race[code]?.race ?? 0;
                              const sPts = r.sprint[code]?.sprint ?? 0;
                              const isDNF = r.race[code]?.dnf;
                              return (
                                <tr key={code}>
                                  <td style={{ color: "#888" }}>{row.position}</td>
                                  <td><span style={{ fontWeight: 600 }}>{code}</span> <span style={{ fontSize: 11, color: "#555" }}>{F1_DRIVER_MAP[code]}</span></td>
                                  <td>
                                    {fantasyTeam
                                      ? <span style={{ fontSize: 12, background: TEAM_COLORS[fantasyTeam].accent+"22", color: TEAM_COLORS[fantasyTeam].accent, padding:"2px 8px", borderRadius:2 }}>{fantasyTeam}</span>
                                      : <span style={{ color:"#444", fontSize:12 }}>Free Agent</span>}
                                  </td>
                                  <td>{isDNF ? <span className="dnf-badge">DNF</span> : <span style={{ color:"#4CAF50",fontSize:12 }}>✓</span>}</td>
                                  <td className="pts-badge" style={{ color: isDNF?"#FF4444":"#E8E8F0" }}>{rPts}</td>
                                  <td className="pts-badge" style={{ color: sPts>0?"#FFD700":"#444" }}>{sPts||"—"}</td>
                                  <td className="pts-badge" style={{ color: rPts+sPts>0?"#E8003D":"#666" }}>{rPts+sPts}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── ADMIN ── */}
            {tab === "admin" && isAdmin && (
              <div>
                <div className="admin-warning">⬡ ADMIN MODE — changes save to Supabase and immediately affect all standings</div>

                <div className="card">
                  <div className="card-header"><span style={{ fontSize: 12, letterSpacing: 2, color: "#E8003D" }}>RECORD ROSTER MOVE</span></div>
                  <div style={{ padding: "18px 20px" }}>
                    <div className="form-row">
                      <div className="form-field">
                        <label className="form-label">Driver</label>
                        <select value={moveDriver} onChange={e => setMoveDriver(e.target.value)} style={{ width: 200 }}>
                          <option value="">— Select driver —</option>
                          {Object.entries(F1_DRIVER_MAP).map(([code, name]) => (
                            <option key={code} value={code}>{code} – {name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-field">
                        <label className="form-label">New Team</label>
                        <select value={moveTeam} onChange={e => setMoveTeam(e.target.value)} style={{ width: 180 }}>
                          <option value="">— Free Agent —</option>
                          {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="form-field">
                        <label className="form-label">Effective From Round #</label>
                        <input type="number" value={moveRound} onChange={e => setMoveRound(e.target.value)} placeholder="e.g. 5" style={{ width: 130 }} min="1" max="24" />
                      </div>
                      <div className="form-field" style={{ justifyContent: "flex-end" }}>
                        <button className="save-btn" onClick={saveMove} disabled={moveSaving || !moveDriver || !moveRound}>
                          {moveSaving ? "SAVING..." : "SAVE MOVE"}
                        </button>
                      </div>
                    </div>
                    {moveSuccess && <div className="success-msg">✓ Roster move saved — standings recalculated</div>}
                    <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                      Leave "New Team" blank to release driver to free agency. Points earned before this round stay with their previous team.
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header"><span style={{ fontSize: 12, letterSpacing: 2, color: "#888" }}>ROSTER MOVE LOG</span></div>
                  {moves.length === 0
                    ? <div style={{ padding: "16px 20px", color: "#444", fontSize: 13 }}>No moves recorded yet. Initial rosters apply from Round 1.</div>
                    : (
                      <table>
                        <thead><tr><th>Round</th><th>Driver</th><th>New Team</th><th>Recorded</th><th></th></tr></thead>
                        <tbody>
                          {[...moves].sort((a,b) => parseInt(a.fromRound)-parseInt(b.fromRound)).map(m => (
                            <tr key={m.id}>
                              <td style={{ color: "#E8003D", fontWeight: 700, fontFamily: "'Orbitron',sans-serif", fontSize: 13 }}>R{m.fromRound}</td>
                              <td><span style={{ fontWeight: 600 }}>{m.driver}</span> <span style={{ fontSize: 11, color: "#555" }}>{F1_DRIVER_MAP[m.driver]}</span></td>
                              <td>{m.toTeam ? <span style={{ color: TEAM_COLORS[m.toTeam]?.accent || "#fff" }}>{m.toTeam}</span> : <span className="fa-badge">FREE AGENT</span>}</td>
                              <td style={{ color: "#555", fontSize: 12 }}>{new Date(m.createdAt).toLocaleDateString()}</td>
                              <td><button className="delete-btn" onClick={() => deleteMove(m.id)}>✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  }
                </div>

                <div className="card">
                  <div className="card-header"><span style={{ fontSize: 12, letterSpacing: 2, color: "#888" }}>CURRENT ROSTERS (as of latest race)</span></div>
                  <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 20 }}>
                    {TEAMS.map(team => {
                      const c = TEAM_COLORS[team];
                      const myDrivers = Object.entries(cr).filter(([,t]) => t===team).map(([d]) => d);
                      return (
                        <div key={team}>
                          <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 13, color: c.accent, marginBottom: 8, fontWeight: 700 }}>{team}</div>
                          {myDrivers.map(d => <div key={d} style={{ fontSize: 13, padding: "3px 0", color: "#ccc" }}>{d} <span style={{ color: "#555" }}>– {F1_DRIVER_MAP[d]}</span></div>)}
                        </div>
                      );
                    })}
                    <div>
                      <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 13, color: "#555", marginBottom: 8, fontWeight: 700 }}>FREE AGENTS</div>
                      {freeAgents().map(d => <div key={d} style={{ fontSize: 13, padding: "3px 0", color: "#555" }}>{d} <span style={{ color: "#444" }}>– {F1_DRIVER_MAP[d]}</span></div>)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* LOGIN MODAL */}
      {showLogin && (
        <div className="modal-overlay" onClick={() => { setShowLogin(false); setPwError(false); setPwInput(""); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 16, color: "#E8003D", marginBottom: 20 }}>Admin Access</div>
            <div className="form-field" style={{ marginBottom: 14, width: "100%" }}>
              <label className="form-label">Password</label>
              <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)}
                onKeyDown={e => e.key==="Enter" && handleLogin()} style={{ width: "100%" }} placeholder="Enter admin password" autoFocus />
            </div>
            {pwError && <div style={{ color: "#FF4444", fontSize: 13, marginBottom: 12 }}>✕ Incorrect password</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="save-btn" onClick={handleLogin}>LOGIN</button>
              <button className="action-btn" onClick={() => { setShowLogin(false); setPwError(false); setPwInput(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
