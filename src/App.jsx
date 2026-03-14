import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://jdbrruuzberopdrlxwvn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkYnJydXV6YmVyb3Bkcmx4d3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NjY5ODcsImV4cCI6MjA4ODM0Mjk4N30.A-fK5M_uh5WsPaRdSyQAfqHLY-Gm0v-KPP6aDyKp1mI";
const ADMIN_PASSWORD = "f1spina";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── GOOGLE SHEET CONFIG ───────────────────────────────────────────────────────
// Published CSV URL for the "Results" tab — update if the sheet URL ever changes
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS09py3RUvDHefcT4J5ZVCjW5UVi-qsSA5Nyo6pJ8pKM2gqn6bTJd5RU3UKNNhTnTNcm517OBXIsjx9/pub?gid=1316044119&single=true&output=csv";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const F1_DRIVER_MAP = {
  VER: "Max Verstappen",    NOR: "Lando Norris",      LEC: "Charles Leclerc",
  PIA: "Oscar Piastri",     SAI: "Carlos Sainz",      RUS: "George Russell",
  HAM: "Lewis Hamilton",    ANT: "Kimi Antonelli",    ALB: "Alexander Albon",
  OCO: "Esteban Ocon",      GAS: "Pierre Gasly",      LAW: "Liam Lawson",
  HAD: "Isack Hadjar",      BEA: "Oliver Bearman",    BOR: "Gabriel Bortoleto",
  HUL: "Nico Hulkenberg",   BOT: "Valtteri Bottas",   STR: "Lance Stroll",
  ALO: "Fernando Alonso",   COL: "Franco Colapinto",  PER: "Sergio Perez",
  LIN: "Arvid Lindblad",    TSU: "Yuki Tsunoda",      DOO: "Jack Doohan",
};

const DRIVER_ORDER_2026 = [
  "NOR","VER","SAI","BOR","LAW",
  "RUS","PIA","HAM","OCO","ALB",
  "LEC","ANT","HAD","BEA","GAS",
  "HUL","BOT","STR","ALO","COL","PER","LIN",
];
const DRIVER_ORDER_2025 = [
  "NOR","HAM","ANT","ALB","TSU","HUL",
  "PIA","RUS","LAW","BEA","ALO","HAD",
  "VER","LEC","SAI","GAS","OCO","STR",
  "BOR","DOO","COL",
];

const TEAM_COLORS = {
  NoCal:        { accent: "#1E90FF", bg: "#07111F" },
  SoCal:        { accent: "#FF6B00", bg: "#1F0D00" },
  Cuz:          { accent: "#9B30FF", bg: "#0F071F" },
  "Free Agent": { accent: "#777",    bg: "#0D0D0D" },
};

const VALID_TEAMS = ["NoCal", "SoCal", "Cuz", "Free Agent"];
const ALL_ROUNDS  = Array.from({ length: 24 }, (_, i) => String(i + 1));
const TEAMS       = ["NoCal", "SoCal", "Cuz"];

// ── 2025 STATIC LINEUP ────────────────────────────────────────────────────────

function makeLineup(defaultMap) {
  return Object.fromEntries(
    Object.entries(defaultMap).map(([d, t]) => [d, Object.fromEntries(ALL_ROUNDS.map(r => [r, t]))])
  );
}

const LINEUP_2025 = makeLineup({
  NOR:"SoCal", HAM:"SoCal", ANT:"SoCal", ALB:"SoCal", TSU:"SoCal", HUL:"SoCal",
  PIA:"Cuz",   RUS:"Cuz",   LAW:"Cuz",   BEA:"Cuz",   ALO:"Cuz",   HAD:"Cuz",
  VER:"NoCal", LEC:"NoCal", SAI:"NoCal", GAS:"NoCal", OCO:"NoCal", STR:"NoCal",
  BOR:"Free Agent", DOO:"Free Agent", COL:"Free Agent",
});
["12","18","19","20","21","22","23","24"].forEach(r => { LINEUP_2025.GAS[r] = "Free Agent"; });
["12","18","19","20","21","22","23","24"].forEach(r => { LINEUP_2025.BOR[r] = "NoCal"; });

// ── 2026 DEFAULT LINEUP ───────────────────────────────────────────────────────

const DEFAULT_LINEUP_2026 = makeLineup({
  NOR:"SoCal", VER:"SoCal", SAI:"SoCal", BOR:"SoCal", LAW:"SoCal",
  RUS:"NoCal", PIA:"NoCal", HAM:"NoCal", OCO:"NoCal", ALB:"NoCal",
  LEC:"Cuz",   ANT:"Cuz",   HAD:"Cuz",   BEA:"Cuz",   GAS:"Cuz",
  HUL:"Free Agent", BOT:"Free Agent", STR:"Free Agent",
  ALO:"Free Agent", COL:"Free Agent", PER:"Free Agent", LIN:"Free Agent",
});

// ── SEASON CONFIG ─────────────────────────────────────────────────────────────

const SEASON_CONFIG = {
  2025: { firstPlacePoints: 20, totalDrivers: 20, readOnly: true },
  2026: { firstPlacePoints: 22, totalDrivers: 22, readOnly: false },
};

// ── SCORING HELPERS ───────────────────────────────────────────────────────────

function getRacePoints(position, year) {
  const { firstPlacePoints, totalDrivers } = SEASON_CONFIG[year];
  if (!position || position < 1 || position > totalDrivers) return 0;
  return firstPlacePoints - (position - 1);
}

function getSprintPoints(pos) { return [8,7,6,5,4,3,2,1][pos-1] || 0; }

function applyDNFPenalties(dnfs) {
  // Rank by laps completed descending; ties share the same penalty rank
  const sorted = [...dnfs].sort((a, b) => b.lapsCompleted - a.lapsCompleted);
  const result = [];
  let rank = 1;
  for (let i = 0; i < sorted.length;) {
    const laps = sorted[i].lapsCompleted;
    let j = i;
    while (j < sorted.length && sorted[j].lapsCompleted === laps) j++;
    for (let k = i; k < j; k++) result.push({ ...sorted[k], points: -rank });
    rank += (j - i);
    i = j;
  }
  return result;
}

function getOwnershipAtRound(lineup, round) {
  const ownership = {};
  Object.entries(lineup).forEach(([driver, rounds]) => {
    const team = rounds[String(round)];
    ownership[driver] = (team && team !== "Free Agent") ? team : null;
  });
  return ownership;
}

// ── GOOGLE SHEET CSV PARSER ───────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  // Normalise headers: lowercase, "/" → "_"
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\//g, "_"));
  return lines.slice(1).map(line => {
    const cols = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
  });
}

// ── SHEET ROW CLASSIFIER ──────────────────────────────────────────────────────
//
// PENALTY if ANY of:
//   • position  === "NC"   (not classified — includes lapped Stroll case)
//   • position  === "DQ"   (disqualified variant)
//   • time_retired === "DNF"  (retired but may still have numeric position — NOR R15)
//   • time_retired === "DNS"  (did not start)
//   • time_retired === "DSQ"  (disqualified)
//
// FINISHER otherwise (numeric position AND time_retired is a time string)
//
// DNF LABEL for badge:
//   "DSQ"  if position="DQ"  OR time_retired="DSQ"          → laps forced 0
//   "DNS"  if time_retired="DNS"                             → laps forced 0
//   "NC"   if position="NC"  AND time_retired is NOT DNF/DNS/DSQ
//          (ran but not classified — e.g. Stroll "+15 laps")
//   "DNF"  everything else that is a penalty

function classifySheetRow(row) {
  const code    = (row.driver_code || "").trim().toUpperCase();
  const posRaw  = (row.position    || "").trim().toUpperCase();
  const trRaw   = (row["time_retired"] || row["time/retired"] || "").trim().toUpperCase();
  const lapsRaw = parseInt(row.laps) || 0;

  const posIsNC  = posRaw === "NC";
  const posIsDQ  = posRaw === "DQ";
  const trIsDNF  = trRaw  === "DNF";
  const trIsDNS  = trRaw  === "DNS";
  const trIsDSQ  = trRaw  === "DSQ";

  const isPenalty  = posIsNC || posIsDQ || trIsDNF || trIsDNS || trIsDSQ;
  const isFinisher = !isPenalty;

  let dnfLabel = null;
  if (isPenalty) {
    if      (posIsDQ || trIsDSQ)       dnfLabel = "DSQ";
    else if (trIsDNS)                  dnfLabel = "DNS";
    else if (posIsNC && !trIsDNF)      dnfLabel = "NC";   // ran, but not classified
    else                               dnfLabel = "DNF";  // trIsDNF or any remaining case
  }

  // DSQ and DNS always rank worst (0 laps); everything else uses the sheet value
  const lapsCompleted = (dnfLabel === "DSQ" || dnfLabel === "DNS") ? 0 : lapsRaw;

  // Finishing position only meaningful for classified finishers
  const position = isFinisher ? (parseInt(posRaw) || 0) : 0;

  return { code, isFinisher, position, lapsCompleted, dnfLabel };
}

// ── SHEET-BASED RACE SCORER ───────────────────────────────────────────────────

function scoreRaceFromSheet(rows, year) {
  if (!rows?.length) return { scores: {}, driverList: [] };
  const scores     = {};
  const dnfs       = [];
  const driverList = []; // used by the Race Detail view

  rows.forEach(row => {
    const { code, isFinisher, position, lapsCompleted, dnfLabel } = classifySheetRow(row);
    if (!code) return;

    driverList.push({
      code,
      positionDisplay: (row.position || "").trim().toUpperCase(),
      lapsCompleted,
      dnfLabel,
    });

    if (isFinisher) {
      scores[code] = { race: getRacePoints(position, year), dnf: false, dnfLabel: null };
    } else {
      dnfs.push({ code, lapsCompleted, dnfLabel });
    }
  });

  applyDNFPenalties(dnfs).forEach(({ code, points, lapsCompleted, dnfLabel }) => {
    scores[code] = { race: points, dnf: true, dnfLabel, lapsCompleted };
  });

  return { scores, driverList };
}

// ── SHEET-BASED SPRINT SCORER ─────────────────────────────────────────────────
// Sprint: numeric position → sprint points; non-finishers get 0 (no penalty).

function scoreSprintFromSheet(rows) {
  if (!rows?.length) return {};
  const scores = {};
  rows.forEach(row => {
    const code = (row.driver_code || "").trim().toUpperCase();
    const pos  = parseInt((row.position || "").trim());
    if (code) scores[code] = { sprint: isNaN(pos) ? 0 : getSprintPoints(pos) };
  });
  return scores;
}

// ── SHEET DATA LOADER ─────────────────────────────────────────────────────────
// One fetch, all seasons:  sheetData[season][round] = { race: rows[], sprint: rows[] }

async function fetchSheetData() {
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  const text    = await res.text();
  const rows    = parseCSV(text);
  const grouped = {};

  for (const row of rows) {
    const season  = parseInt(row.season);
    const round   = String(parseInt(row.round));
    const session = (row.session || "").trim().toLowerCase();
    if (!season || isNaN(parseInt(row.round)) || !session) continue;
    if (!grouped[season])        grouped[season] = {};
    if (!grouped[season][round]) grouped[season][round] = { race: [], sprint: [] };
    if (session === "race")      grouped[season][round].race.push(row);
    if (session === "sprint")    grouped[season][round].sprint.push(row);
  }
  return grouped;
}

// ── JOLPICA — schedule only ───────────────────────────────────────────────────

const BASE = "https://api.jolpi.ca/ergast/f1";
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchSchedule(year) {
  const d = await fetchJSON(`${BASE}/${year}/races.json?limit=30`);
  return d.MRData.RaceTable.Races;
}

// ── APP ───────────────────────────────────────────────────────────────────────

export default function FantasyF1App() {
  const [season, setSeason]             = useState(2026);
  const [tab, setTab]                   = useState("standings");
  const [isAdmin, setIsAdmin]           = useState(false);
  const [showLogin, setShowLogin]       = useState(false);
  const [pwInput, setPwInput]           = useState("");
  const [pwError, setPwError]           = useState(false);
  const [schedule, setSchedule]         = useState([]);
  const [results, setResults]           = useState({});
  const [lineup2026, setLineup2026]     = useState(DEFAULT_LINEUP_2026);
  const [loading, setLoading]           = useState(true);
  const [loadingMsg, setLoadingMsg]     = useState("");
  const [error, setError]               = useState(null);
  const [selectedRace, setSelectedRace] = useState(null);
  const [editCell, setEditCell]         = useState(null);
  const [editValue, setEditValue]       = useState("");
  const [editSaving, setEditSaving]     = useState(false);
  const editRef   = useRef(null);
  const detailRef = useRef(null);

  const cfg          = SEASON_CONFIG[season];
  const activeLineup = season === 2025 ? LINEUP_2025 : lineup2026;
  const driverOrder  = season === 2025 ? DRIVER_ORDER_2025 : DRIVER_ORDER_2026;

  // ── Supabase ──────────────────────────────────────────────────────────────

  const loadLineup = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("lineup_2026").select("*");
      if (error) throw error;
      if (data?.length) {
        const grid = JSON.parse(JSON.stringify(DEFAULT_LINEUP_2026));
        data.forEach(({ driver, round, team }) => {
          if (grid[driver]) grid[driver][String(round)] = team;
        });
        setLineup2026(grid);
      }
    } catch(e) { console.warn("Supabase not ready:", e.message); }
  }, []);

  const saveCell = async (driver, fromRound, newTeam) => {
    setEditSaving(true);
    try {
      const rn = parseInt(fromRound);
      const updated = JSON.parse(JSON.stringify(lineup2026));
      const rows = [];
      for (let r = rn; r <= 24; r++) {
        updated[driver][String(r)] = newTeam;
        rows.push({ driver, round: r, team: newTeam });
      }
      const { error } = await supabase
        .from("lineup_2026")
        .upsert(rows, { onConflict: "driver,round" });
      if (error) throw error;
      setLineup2026(updated);
      setEditCell(null);
    } catch(e) { alert("Save error: " + e.message); }
    finally { setEditSaving(false); }
  };

  // ── Main data loader ──────────────────────────────────────────────────────
  //
  // 1. Fetch race schedule from Jolpica  (names, dates, circuit info)
  // 2. Fetch all results from Google Sheet  (primary / only scoring source)
  // 3. Build per-round result objects:
  //      sprintOnly = sheet has sprint rows but NO race rows yet
  //      full       = sheet has race rows (± sprint rows)

  const loadData = useCallback(async () => {
    setLoading(true); setError(null); setResults({});
    setSchedule([]); setSelectedRace(null);
    try {
      setLoadingMsg("Loading schedule...");
      const races = await fetchSchedule(season).catch(() => []);
      setSchedule(races);

      setLoadingMsg("Loading results from Google Sheet...");
      const sheetData  = await fetchSheetData();
      const seasonData = sheetData[season] || {};

      const nr = {};
      for (const [round, sessions] of Object.entries(seasonData)) {
        const hasRace   = sessions.race.length   > 0;
        const hasSprint = sessions.sprint.length > 0;
        if (!hasRace && !hasSprint) continue;

        // Match schedule entry for race name + date
        const schedRace = races.find(
          r => String(parseInt(r.round)) === String(parseInt(round))
        );
        const raceName = schedRace?.raceName || `Round ${round}`;
        const date     = schedRace?.date     || "";

        const { scores: raceScores, driverList } = hasRace
          ? scoreRaceFromSheet(sessions.race, season)
          : { scores: {}, driverList: [] };

        const sprintScores = hasSprint
          ? scoreSprintFromSheet(sessions.sprint)
          : {};

        nr[round] = {
          race:       raceScores,
          sprint:     sprintScores,
          raceName,
          date,
          driverList,              // for Race Detail panel
          sprintRows: sessions.sprint, // for Sprint-Only Detail panel
          sprintOnly: !hasRace && hasSprint,
        };
      }

      setResults(nr);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); setLoadingMsg(""); }
  }, [season]);

  useEffect(() => { loadData(); },   [loadData]);
  useEffect(() => { loadLineup(); }, [loadLineup]);
  useEffect(() => {
    if (editCell && editRef.current) editRef.current.focus();
  }, [editCell]);
  useEffect(() => {
    if (selectedRace && detailRef.current) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 60);
    }
  }, [selectedRace]);

  const handleSeasonChange = (yr) => {
    setSeason(parseInt(yr));
    setTab("standings");
    if (SEASON_CONFIG[yr].readOnly) setIsAdmin(false);
  };

  // ── Computed ──────────────────────────────────────────────────────────────

  const raceByRace = useCallback(() =>
    Object.entries(results)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([round, data]) => {
        const ownership = getOwnershipAtRound(activeLineup, round);
        const teamPts   = Object.fromEntries(TEAMS.map(t => [t, 0]));
        Object.entries(data.race).forEach(([code, s]) => {
          const t = ownership[code]; if (t) teamPts[t] += s.race;
        });
        Object.entries(data.sprint).forEach(([code, s]) => {
          const t = ownership[code]; if (t) teamPts[t] += s.sprint;
        });
        return { round, ...data, teamPts, ownership };
      })
  , [results, activeLineup]);

  const teamTotals = useCallback(() => {
    const totals = Object.fromEntries(TEAMS.map(t => [t, 0]));
    raceByRace().forEach(r => TEAMS.forEach(t => { totals[t] += r.teamPts[t] || 0; }));
    return totals;
  }, [raceByRace]);

  const currentOwnership = useCallback(() => {
    const last = Math.max(1, ...Object.keys(results).map(Number));
    return getOwnershipAtRound(activeLineup, last);
  }, [results, activeLineup]);

  const driverTeamScores = useCallback(() => {
    const scores = {}; TEAMS.forEach(t => { scores[t] = {}; });
    raceByRace().forEach(({ race, sprint, ownership }) => {
      Object.keys(F1_DRIVER_MAP).forEach(code => {
        const team = ownership[code]; if (!team) return;
        const pts  = (race[code]?.race || 0) + (sprint[code]?.sprint || 0);
        if (!scores[team][code]) scores[team][code] = { total: 0 };
        scores[team][code].total += pts;
      });
    });
    return scores;
  }, [raceByRace]);

  const visibleRounds = useCallback(() => {
    const doneRounds = Object.keys(results).map(Number);
    const maxDone    = doneRounds.length ? Math.max(...doneRounds) : 0;
    const upTo       = Math.min(24, maxDone + 3);
    return Array.from({ length: Math.max(upTo, 3) }, (_, i) => String(i + 1));
  }, [results]);

  const handleLogin = () => {
    if (pwInput === ADMIN_PASSWORD) {
      setIsAdmin(true); setShowLogin(false); setPwError(false); setTab("admin-lineup");
    } else setPwError(true);
  };

  // ── Status badge helper ───────────────────────────────────────────────────

  const StatusBadge = ({ dnfLabel, lapsCompleted }) => {
    if (!dnfLabel) {
      return <span style={{ color:"#4CAF50", fontSize:13, fontWeight:700 }}>✓ Finished</span>;
    }
    const lapsStr = lapsCompleted === 0 ? "0 laps"
                  : lapsCompleted != null ? `${lapsCompleted} laps`
                  : "";
    return (
      <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:3 }}>
        {dnfLabel === "DSQ" && <span className="badge-dsq">DSQ</span>}
        {dnfLabel === "DNS" && <span className="badge-dns">DNS</span>}
        {dnfLabel === "DNF" && <span className="badge-dnf">DNF</span>}
        {dnfLabel === "NC"  && <span className="badge-nc">NC</span>}
        {lapsStr && (
          <span style={{ fontSize:12, color:"#AAA", fontWeight:600, marginLeft:2 }}>{lapsStr}</span>
        )}
      </div>
    );
  };

  // ── Lineup table ──────────────────────────────────────────────────────────

  const LineupTable = ({ lineup, editable, rounds }) => {
    const drivers = driverOrder.filter(d => lineup[d]);
    const groupOf = code => {
      const t = lineup[code]?.["1"] || "Free Agent";
      return t === "Free Agent" ? "Free Agent" : t;
    };
    return (
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"auto" }}>
          <thead>
            <tr>
              <th style={{ position:"sticky", left:0, background:"#0D0D14", zIndex:2, minWidth:120, textAlign:"left", padding:"10px 14px" }}>Driver</th>
              {rounds.map(r => {
                const raceInfo = schedule.find(s => String(parseInt(s.round)) === String(parseInt(r)));
                const isDone   = results[r] !== undefined;
                return (
                  <th key={r} style={{ minWidth:66, textAlign:"center", padding:"8px 4px", color: isDone ? "#CCC" : "#888" }}>
                    R{r}
                    {raceInfo && (
                      <div style={{ fontSize:9, color:"#888", fontWeight:400, marginTop:2 }}>
                        {raceInfo.raceName?.replace(" Grand Prix","").slice(0,7)}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {drivers.map((code, idx) => {
              const prevGroup   = idx > 0 ? groupOf(drivers[idx-1]) : null;
              const currGroup   = groupOf(code);
              const showDivider = prevGroup && prevGroup !== currGroup;
              return (
                <>
                  {showDivider && (
                    <tr key={`div-${code}`}>
                      <td colSpan={rounds.length+1} style={{ padding:"2px 0", background:"#0A0A0F", borderBottom:"1px solid #1E1E28" }} />
                    </tr>
                  )}
                  <tr key={code}>
                    <td style={{ position:"sticky", left:0, background:"#0D0D14", zIndex:1, padding:"5px 14px", borderBottom:"1px solid #181820" }}>
                      <div style={{ fontWeight:700, fontSize:14 }}>{code}</div>
                      <div style={{ fontSize:12, color:"#CCC", fontWeight:600 }}>{F1_DRIVER_MAP[code]}</div>
                    </td>
                    {rounds.map(r => {
                      const team      = lineup[code]?.[r] || "Free Agent";
                      const tc        = TEAM_COLORS[team] || TEAM_COLORS["Free Agent"];
                      const isEditing = editable && editCell?.driver === code && editCell?.round === r;
                      return (
                        <td key={r} style={{ textAlign:"center", padding:"3px 2px", borderBottom:"1px solid #141418", background: isEditing ? "#1A1A2A" : tc.bg }}>
                          {isEditing ? (
                            <select
                              ref={editRef}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => { if (editValue !== team) saveCell(code, r, editValue); else setEditCell(null); }}
                              onKeyDown={e => {
                                if (e.key==="Enter")  { if (editValue !== team) saveCell(code, r, editValue); else setEditCell(null); }
                                if (e.key==="Escape") setEditCell(null);
                              }}
                              style={{ background:"#13131A", border:"1px solid #E8003D", color:"#E8E8F0", fontSize:11, padding:"2px 3px", borderRadius:2, width:62, fontFamily:"'Rajdhani',sans-serif" }}
                            >
                              {VALID_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          ) : (
                            <div
                              onClick={() => { if (!editable) return; setEditCell({ driver:code, round:r }); setEditValue(team); }}
                              style={{ display:"inline-block", fontSize:11, fontWeight:700, color: team==="Free Agent" ? "#555" : tc.accent, padding:"2px 4px", borderRadius:2, minWidth:54, cursor: editable ? "pointer" : "default", border:"1px solid transparent", transition:"border-color 0.1s" }}
                              onMouseEnter={e => { if (editable) e.currentTarget.style.borderColor="#2A2A3A"; }}
                              onMouseLeave={e => { if (editable) e.currentTarget.style.borderColor="transparent"; }}
                            >
                              {team === "Free Agent" ? "FA" : team}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const tt      = teamTotals();
  const sorted  = TEAMS.slice().sort((a, b) => tt[b] - tt[a]);
  const rbr     = raceByRace();
  const cr      = currentOwnership();
  const dts     = driverTeamScores();
  const vRounds = visibleRounds();

  const navTabs = [
    { key:"standings",   label:"Standings"     },
    { key:"drivers",     label:"Driver Points" },
    { key:"history",     label:"Race History"  },
    { key:"lineups",     label:"Lineups"       },
    ...(isAdmin && !cfg.readOnly ? [{ key:"admin-lineup", label:"⬡ Edit Lineup" }] : []),
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#0A0A0F", color:"#E8E8F0", fontFamily:"'Rajdhani',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Orbitron:wght@700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:#0A0A0F}
        ::-webkit-scrollbar-thumb{background:#333;border-radius:3px}
        .tab-btn{background:none;border:none;cursor:pointer;font-family:'Rajdhani',sans-serif;font-weight:600;font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:10px 16px;color:#AAA;transition:all .2s;border-bottom:2px solid transparent;white-space:nowrap}
        .tab-btn.active{color:#E8003D;border-bottom-color:#E8003D}
        .tab-btn:hover:not(.active){color:#DDD}
        .card{background:#13131A;border:1px solid #222;border-radius:4px;overflow:hidden;margin-bottom:16px}
        .card-header{padding:13px 20px;border-bottom:1px solid #222;display:flex;align-items:center;justify-content:space-between}
        .pts-badge{font-family:'Orbitron',sans-serif;font-size:13px;font-weight:700}
        .refresh-btn{background:#E8003D;color:white;border:none;font-family:'Rajdhani',sans-serif;font-weight:700;letter-spacing:2px;font-size:12px;cursor:pointer;padding:8px 18px;border-radius:3px;text-transform:uppercase}
        .refresh-btn:hover{background:#ff1a52}
        .refresh-btn:disabled{background:#888;cursor:default}
        .action-btn{background:#1E1E2A;color:#CCC;border:1px solid #444;font-family:'Rajdhani',sans-serif;font-weight:600;letter-spacing:1px;font-size:11px;cursor:pointer;padding:5px 12px;border-radius:2px;text-transform:uppercase;transition:all .2s}
        .action-btn:hover{border-color:#E8003D;color:#E8003D}
        .save-btn{background:#E8003D;color:white;border:none;font-family:'Rajdhani',sans-serif;font-weight:700;letter-spacing:1px;font-size:13px;cursor:pointer;padding:9px 22px;border-radius:3px;text-transform:uppercase}
        table{width:100%;border-collapse:collapse}
        th{font-size:12px;letter-spacing:1px;color:#CCC;text-transform:uppercase;padding:10px 14px;text-align:left;border-bottom:1px solid #1E1E28;font-weight:700}
        td{padding:9px 14px;border-bottom:1px solid #181820;font-size:14px}
        tr:last-child td{border-bottom:none}
        tr:hover td{background:#16161E}
        .badge-dnf{font-size:10px;letter-spacing:1px;background:#3A0A0A;color:#FF5555;padding:1px 6px;border-radius:2px;border:1px solid #FF444433;font-weight:700}
        .badge-dsq{font-size:10px;letter-spacing:1px;background:#2A0A2A;color:#FF55FF;padding:1px 6px;border-radius:2px;border:1px solid #FF44FF33;font-weight:700}
        .badge-dns{font-size:10px;letter-spacing:1px;background:#1A1A00;color:#FFCC00;padding:1px 6px;border-radius:2px;border:1px solid #FFCC0033;font-weight:700}
        .badge-nc{font-size:10px;letter-spacing:1px;background:#1A1A2A;color:#FF9955;padding:1px 6px;border-radius:2px;border:1px solid #FF884433;font-weight:700}
        .badge-former{font-size:10px;background:#1A1A1A;color:#888;padding:1px 6px;border-radius:2px;letter-spacing:1px;border:1px solid #333}
        .badge-sprint-only{font-size:10px;letter-spacing:1px;background:#1A1400;color:#FFD700;padding:1px 8px;border-radius:2px;border:1px solid #FFD70044;font-weight:700}
        .badge-source{font-size:10px;letter-spacing:1px;background:#0A1A0A;color:#44AA44;padding:1px 8px;border-radius:2px;border:1px solid #44AA4433;font-weight:700}
        .ticker{background:#E8003D;padding:5px 0;font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;white-space:nowrap;overflow:hidden}
        .ticker-inner{display:inline-block;animation:ticker 30s linear infinite}
        @keyframes ticker{0%{transform:translateX(100vw)}100%{transform:translateX(-100%)}}
        .loading-pulse{animation:pulse 1.5s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:100}
        .modal{background:#13131A;border:1px solid #333;border-radius:6px;padding:28px;width:380px;max-width:95vw}
        .standing-pos{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:900;width:44px;text-align:center}
        .pos-1{color:#FFD700}.pos-2{color:#C0C0C0}.pos-3{color:#CD7F32}
        .season-select{background:#1A1A26;border:1px solid #333;color:#E8E8F0;font-family:'Orbitron',sans-serif;font-size:12px;font-weight:700;padding:6px 12px;border-radius:3px;cursor:pointer;letter-spacing:1px;outline:none}
        .season-select:focus{border-color:#E8003D}
        select option{background:#13131A}
        input[type="password"]{background:#0A0A0F;border:1px solid #333;color:#E8E8F0;font-family:'Rajdhani',sans-serif;font-size:14px;padding:8px 12px;border-radius:3px;outline:none;width:100%}
        input[type="password"]:focus{border-color:#E8003D}
        .form-label{font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;display:block;margin-bottom:6px}
        .admin-warning{background:#1A1000;border:1px solid #E8003D33;border-radius:4px;padding:10px 16px;font-size:12px;color:#FF8800;letter-spacing:1px;margin-bottom:16px}
        .history-row-selected td{background:#1E1A10 !important}
        .history-row-sprint td{background:#13120A !important}
        .detail-flash{animation:flash 0.7s ease-out}
        @keyframes flash{0%{box-shadow:0 0 0 3px #E8003D88}100%{box-shadow:none}}
        .tab-subheading{font-size:13px;letter-spacing:2px;color:#CCC;text-transform:uppercase;font-weight:700;margin-bottom:16px}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background:"#0D0D14", borderBottom:"1px solid #1A1A24" }}>
        <div style={{ maxWidth:1200, margin:"0 auto", padding:"18px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:4, height:36, background:"#E8003D", borderRadius:2 }} />
            <div>
              <div style={{ fontFamily:"'Orbitron',sans-serif", fontSize:20, fontWeight:900, color:"#E8003D", letterSpacing:3 }}>FANTASY F1</div>
              <div style={{ fontSize:12, letterSpacing:3, color:"#CCC", marginTop:1 }}>LEAGUE STANDINGS</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:11, letterSpacing:2, color:"#AAA", textTransform:"uppercase" }}>Season</span>
              <select className="season-select" value={season} onChange={e => handleSeasonChange(e.target.value)}>
                <option value={2026}>2026 — Current</option>
                <option value={2025}>2025 — Archive</option>
              </select>
            </div>
            <button className="refresh-btn" onClick={loadData} disabled={loading}>
              {loading ? "LOADING..." : "↻ REFRESH"}
            </button>
            {!cfg.readOnly && (isAdmin
              ? <button className="action-btn" style={{ color:"#E8003D", borderColor:"#E8003D55" }} onClick={() => { setIsAdmin(false); setTab("standings"); }}>⬡ ADMIN ON</button>
              : <button className="action-btn" onClick={() => setShowLogin(true)}>ADMIN</button>
            )}
          </div>
        </div>
        {!loading && sorted.length > 0 && (
          <div className="ticker">
            <span className="ticker-inner">
              {sorted.map((t,i) => <span key={t} style={{ marginRight:60 }}>P{i+1} {t}: {tt[t]} PTS</span>)}
              &nbsp;&nbsp;&nbsp;
            </span>
          </div>
        )}
      </div>

      {/* ── NAV ── */}
      <div style={{ background:"#0D0D14", borderBottom:"1px solid #1A1A24", overflowX:"auto" }}>
        <div style={{ maxWidth:1200, margin:"0 auto", paddingLeft:16, display:"flex" }}>
          {navTabs.map(t => (
            <button key={t.key} className={`tab-btn${tab===t.key?" active":""}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth:1200, margin:"0 auto", padding:"24px 20px" }}>

        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20, flexWrap:"wrap" }}>
          <span style={{ fontFamily:"'Orbitron',sans-serif", fontSize:12, fontWeight:700, letterSpacing:2, color: season===2025 ? "#FFD700" : "#E8003D" }}>
            {season} SEASON
          </span>
          {cfg.readOnly && <span style={{ fontSize:13, fontWeight:600, color:"#CCC" }}>· ARCHIVE</span>}
          <span style={{ fontSize:13, fontWeight:600, color:"#CCC" }}>· {Object.keys(results).length} races complete</span>
          <span className="badge-source">● GOOGLE SHEET</span>
        </div>

        {loading && (
          <div style={{ textAlign:"center", padding:"80px 20px" }}>
            <div style={{ fontFamily:"'Orbitron',sans-serif", fontSize:13, letterSpacing:3, color:"#E8003D" }} className="loading-pulse">
              {loadingMsg ? loadingMsg.toUpperCase() : "CONNECTING TO DATA..."}
            </div>
          </div>
        )}

        {error && (
          <div style={{ background:"#1A0A0A", border:"1px solid #FF444433", borderRadius:4, padding:16, color:"#FF6666", marginBottom:20, fontSize:13 }}>
            ⚠ {error}
            <div style={{ marginTop:8, fontSize:12, color:"#FF9999" }}>
              Check that the Google Sheet is published and accessible, then click Refresh.
            </div>
          </div>
        )}

        {!loading && <>

          {/* ══ STANDINGS ══ */}
          {tab === "standings" && <>
            {sorted.map((team, i) => {
              const c             = TEAM_COLORS[team];
              const activeDrivers = Object.entries(cr).filter(([,t]) => t === team).map(([d]) => d);
              const formerDrivers = Object.keys(dts[team] || {}).filter(d => !activeDrivers.includes(d));
              return (
                <div key={team} className="card" style={{ borderLeft:`3px solid ${c.accent}` }}>
                  <div style={{ padding:"20px 24px", display:"flex", alignItems:"center", gap:20 }}>
                    <div className={`standing-pos ${["pos-1","pos-2","pos-3"][i]||""}`}>{i+1}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                        <div style={{ fontFamily:"'Orbitron',sans-serif", fontSize:18, fontWeight:700, color:c.accent }}>{team}</div>
                        {i===0 && <span style={{ fontSize:10, background:"#E8003D", color:"white", padding:"2px 8px", letterSpacing:2, fontWeight:700 }}>LEADER</span>}
                      </div>
                      <div style={{ fontSize:11, letterSpacing:1, color:"#AAA", textTransform:"uppercase", marginBottom:5, fontWeight:700 }}>Active</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom: formerDrivers.length ? 10 : 0 }}>
                        {activeDrivers.map(d => (
                          <span key={d} style={{ fontSize:13, background:c.bg, padding:"4px 12px", borderRadius:2, color:"#E8E8F0", fontWeight:700, border:`1px solid ${c.accent}44` }}>
                            {d} <span style={{ color:c.accent }}>{dts[team]?.[d]?.total || 0}</span>
                          </span>
                        ))}
                        {activeDrivers.length === 0 && <span style={{ color:"#666", fontSize:12 }}>None</span>}
                      </div>
                      {formerDrivers.length > 0 && <>
                        <div style={{ fontSize:11, letterSpacing:1, color:"#666", textTransform:"uppercase", marginBottom:5, fontWeight:700 }}>Former</div>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {formerDrivers.map(d => (
                            <span key={d} style={{ fontSize:12, background:"#1A1A1A", padding:"3px 10px", borderRadius:2, color:"#888", fontWeight:600, border:"1px solid #2A2A2A" }}>
                              {d} <span style={{ color:"#777" }}>{dts[team]?.[d]?.total || 0}</span>
                            </span>
                          ))}
                        </div>
                      </>}
                    </div>
                    <div style={{ textAlign:"right", minWidth:90 }}>
                      <div className="pts-badge" style={{ fontSize:32, color:c.accent }}>{tt[team]}</div>
                      <div style={{ fontSize:10, letterSpacing:2, color:"#AAA", marginBottom:6 }}>PTS</div>
                      {i > 0 && (
                        <div style={{ fontSize:12, fontWeight:700, color:"#E8003D", background:"#1A0A0A", padding:"3px 8px", borderRadius:3, border:"1px solid #E8003D33", whiteSpace:"nowrap" }}>
                          –{tt[sorted[0]] - tt[team]} pts
                        </div>
                      )}
                      {i === 0 && sorted.length > 1 && (
                        <div style={{ fontSize:11, fontWeight:700, color:"#FFD700", background:"#1A1500", padding:"3px 8px", borderRadius:3, border:"1px solid #FFD70033", whiteSpace:"nowrap" }}>
                          +{tt[sorted[0]] - tt[sorted[1]]} lead
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {!cfg.readOnly && (() => {
              const next = schedule.find(r => new Date(r.date) >= new Date());
              if (!next) return null;
              return (
                <div className="card" style={{ borderLeft:"3px solid #E8003D" }}>
                  <div style={{ padding:"16px 24px" }}>
                    <div style={{ fontSize:10, letterSpacing:3, color:"#E8003D", marginBottom:4 }}>NEXT RACE</div>
                    <div style={{ fontFamily:"'Orbitron',sans-serif", fontSize:16, fontWeight:700 }}>{next.raceName}</div>
                    <div style={{ fontSize:13, color:"#AAA", marginTop:4 }}>
                      {next.Circuit.circuitName} · {new Date(next.date).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
                    </div>
                  </div>
                </div>
              );
            })()}
          </>}

          {/* ══ DRIVER POINTS ══ */}
          {tab === "drivers" && <>
            <div className="tab-subheading">Points credited to team owning driver at time of each race</div>
            {rbr.length === 0 && <div style={{ color:"#AAA", fontSize:14 }}>No completed races yet.</div>}
            {TEAMS.map(team => {
              const c           = TEAM_COLORS[team];
              const teamDrivers = Object.keys(dts[team] || {});
              if (teamDrivers.length === 0) return null;
              const activeD = teamDrivers.filter(d => cr[d] === team).sort((a,b) => (dts[team][b]?.total||0) - (dts[team][a]?.total||0));
              const formerD = teamDrivers.filter(d => cr[d] !== team).sort((a,b) => (dts[team][b]?.total||0) - (dts[team][a]?.total||0));
              const allD    = [...activeD, ...formerD];
              return (
                <div key={team} className="card" style={{ marginBottom:24 }}>
                  <div className="card-header" style={{ borderLeft:`3px solid ${c.accent}` }}>
                    <span style={{ fontFamily:"'Orbitron',sans-serif", fontSize:14, fontWeight:700, color:c.accent }}>{team}</span>
                    <span className="pts-badge" style={{ color:c.accent }}>{tt[team]} PTS</span>
                  </div>
                  <div style={{ overflowX:"auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ minWidth:130, position:"sticky", left:0, background:"#13131A", zIndex:2 }}>Driver</th>
                          {rbr.map(r => (
                            <th key={r.round} style={{ minWidth:72, textAlign:"center" }}>
                              <div>
                                {r.raceName?.replace(" Grand Prix","").replace(" GP","").slice(0,9)}
                                {r.sprintOnly && <span style={{ marginLeft:4, fontSize:9, color:"#FFD700" }}>⚡SP</span>}
                              </div>
                              <div style={{ fontSize:10, color:"#999", fontWeight:400, marginTop:1 }}>
                                {r.date ? new Date(r.date).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : `R${r.round}`}
                              </div>
                            </th>
                          ))}
                          <th style={{ minWidth:72, textAlign:"center", color:c.accent }}>TOTAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allD.map((code, idx) => {
                          const isCurrent         = cr[code] === team;
                          const showFormerDivider = idx === activeD.length && formerD.length > 0;
                          return (
                            <>
                              {showFormerDivider && (
                                <tr key={`div-${team}-former`}>
                                  <td colSpan={rbr.length+2} style={{ background:"#0D0D14", padding:"4px 14px", fontSize:10, color:"#666", letterSpacing:2, textTransform:"uppercase", fontWeight:700, borderTop:"1px solid #252530" }}>
                                    ↓ Former drivers
                                  </td>
                                </tr>
                              )}
                              <tr key={code} style={{ opacity: isCurrent ? 1 : 0.65 }}>
                                <td style={{ position:"sticky", left:0, background:"#13131A", zIndex:1 }}>
                                  <div style={{ fontWeight:700, fontSize:14, display:"flex", alignItems:"center", gap:6 }}>
                                    {code}
                                    {!isCurrent && <span className="badge-former">FORMER</span>}
                                  </div>
                                  <div style={{ fontSize:12, color:"#CCC", fontWeight:600 }}>{F1_DRIVER_MAP[code]}</div>
                                </td>
                                {rbr.map(r => {
                                  const owned   = r.ownership?.[code] === team;
                                  const racePts = owned ? (r.race[code]?.race    ?? 0) : null;
                                  const spPts   = owned ? (r.sprint[code]?.sprint || 0) : null;
                                  const isDnf   = owned && r.race[code]?.dnf;
                                  return (
                                    <td key={r.round} style={{ textAlign:"center", padding:"7px 8px", background: r.sprintOnly ? "#13120A" : "transparent" }}>
                                      {owned ? (
                                        <>
                                          {!r.sprintOnly && (
                                            <span className="pts-badge" style={{ fontSize:13, color: isDnf ? "#FF6666" : (racePts||0) > 0 ? "#E8E8F0" : "#888" }}>
                                              {racePts}
                                            </span>
                                          )}
                                          {spPts > 0 && <div style={{ fontSize:10, color:"#FFD700", marginTop:1 }}>+{spPts} SP</div>}
                                          {r.sprintOnly && (!spPts || spPts === 0) && <span style={{ color:"#555", fontSize:12 }}>—</span>}
                                        </>
                                      ) : (
                                        <span style={{ color:"#333", fontSize:12 }}>—</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td style={{ textAlign:"center" }}>
                                  <span className="pts-badge" style={{ fontSize:15, color: isCurrent ? c.accent : "#777" }}>
                                    {dts[team]?.[code]?.total || 0}
                                  </span>
                                </td>
                              </tr>
                            </>
                          );
                        })}
                        <tr style={{ background:"#0D0D14", borderTop:"2px solid #252530" }}>
                          <td style={{ position:"sticky", left:0, background:"#0D0D14", fontWeight:800, fontSize:12, color:"#CCC", letterSpacing:1, textTransform:"uppercase", zIndex:1 }}>Team Total</td>
                          {rbr.map(r => (
                            <td key={r.round} style={{ textAlign:"center", background: r.sprintOnly ? "#13120A" : "transparent" }}>
                              <span className="pts-badge" style={{ color:c.accent, fontSize:14 }}>{r.teamPts[team] || 0}</span>
                            </td>
                          ))}
                          <td style={{ textAlign:"center" }}>
                            <span className="pts-badge" style={{ color:c.accent, fontSize:18 }}>{tt[team]}</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </>}

          {/* ══ RACE HISTORY ══ */}
          {tab === "history" && <>
            {rbr.length === 0 && <div style={{ color:"#AAA", fontSize:14 }}>No completed races yet.</div>}
            {rbr.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <span style={{ fontSize:13, letterSpacing:2, color:"#CCC", fontWeight:700 }}>TEAM POINTS BY RACE</span>
                  <span style={{ fontSize:12, color:"#AAA", fontWeight:600 }}>Click a row to see driver detail ↓</span>
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Race</th>
                        {TEAMS.map(t => <th key={t} style={{ color:TEAM_COLORS[t].accent }}>{t}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rbr.map(r => (
                        <tr
                          key={r.round}
                          style={{ cursor:"pointer" }}
                          className={[
                            selectedRace === r.round ? "history-row-selected" : "",
                            r.sprintOnly            ? "history-row-sprint"   : "",
                          ].join(" ").trim()}
                          onClick={() => setSelectedRace(selectedRace === r.round ? null : r.round)}
                        >
                          <td>
                            <div style={{ fontWeight:700, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                              {r.raceName?.replace(" Grand Prix"," GP")}
                              {r.sprintOnly && <span className="badge-sprint-only">⚡ SPRINT ONLY</span>}
                              {selectedRace === r.round && <span style={{ fontSize:10, color:"#E8003D", letterSpacing:1, fontWeight:700 }}>▼ DETAIL</span>}
                            </div>
                            <div style={{ fontSize:13, fontWeight:600, color:"#CCC" }}>
                              {r.date ? new Date(r.date).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : `Round ${r.round}`}
                              {r.sprintOnly && <span style={{ marginLeft:8, fontSize:11, color:"#888" }}>GP pending</span>}
                            </div>
                          </td>
                          {TEAMS.map(t => (
                            <td key={t} className="pts-badge" style={{ color:TEAM_COLORS[t].accent }}>
                              {r.teamPts[t] || 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background:"#0D0D14" }}>
                        <td style={{ fontWeight:700, fontSize:12, color:"#CCC" }}>TOTAL</td>
                        {TEAMS.map(t => (
                          <td key={t} className="pts-badge" style={{ color:TEAM_COLORS[t].accent, fontSize:16 }}>{tt[t]}</td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* ── Detail panel ── */}
            {selectedRace && results[selectedRace] && (() => {
              const r           = results[selectedRace];
              const { ownership } = rbr.find(x => x.round === selectedRace) || {};

              // ── Sprint-only detail ────────────────────────────────────
              if (r.sprintOnly) {
                const sprintEntries = (r.sprintRows || []).map(row => ({
                  code:      (row.driver_code || "").trim().toUpperCase(),
                  position:  (row.position    || "").trim(),
                  sprintPts: r.sprint[(row.driver_code || "").trim().toUpperCase()]?.sprint || 0,
                }));
                return (
                  <div ref={detailRef} className="card detail-flash">
                    <div className="card-header">
                      <span style={{ fontFamily:"'Orbitron',sans-serif", fontSize:14, fontWeight:700 }}>
                        {r.raceName} — Sprint Results
                        <span className="badge-sprint-only" style={{ marginLeft:10 }}>⚡ SPRINT ONLY · GP PENDING</span>
                      </span>
                      <button className="action-btn" onClick={() => setSelectedRace(null)}>✕ Close</button>
                    </div>
                    <div style={{ padding:"10px 20px 6px", fontSize:12, color:"#888", letterSpacing:1 }}>
                      Main GP has not yet been entered. Sprint points are included in team totals.
                    </div>
                    <div style={{ overflowX:"auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width:60 }}>Pos</th>
                            <th>Driver</th>
                            <th>Fantasy Team</th>
                            <th style={{ textAlign:"center", color:"#FFD700" }}>Sprint Pts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sprintEntries.map(({ code, position, sprintPts }) => {
                            const ft = ownership?.[code];
                            return (
                              <tr key={code}>
                                <td style={{ color:"#AAA", fontSize:13 }}>{position}</td>
                                <td>
                                  <span style={{ fontWeight:700, fontSize:14 }}>{code}</span>{" "}
                                  <span style={{ fontSize:12, color:"#CCC", fontWeight:600 }}>{F1_DRIVER_MAP[code]}</span>
                                </td>
                                <td>
                                  {ft
                                    ? <span style={{ fontSize:13, fontWeight:700, background:TEAM_COLORS[ft]?.accent+"22", color:TEAM_COLORS[ft]?.accent, padding:"3px 10px", borderRadius:2 }}>{ft}</span>
                                    : <span style={{ color:"#888", fontSize:13, fontWeight:600 }}>Free Agent</span>
                                  }
                                </td>
                                <td style={{ textAlign:"center" }}>
                                  <span className="pts-badge" style={{ color: sprintPts > 0 ? "#FFD700" : "#666", fontSize:14 }}>
                                    {sprintPts || "—"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              }

              // ── Full weekend detail ───────────────────────────────────
              return (
                <div ref={detailRef} className="card detail-flash">
                  <div className="card-header">
                    <span style={{ fontFamily:"'Orbitron',sans-serif", fontSize:14, fontWeight:700 }}>
                      {r.raceName} — Driver Detail
                    </span>
                    <button className="action-btn" onClick={() => setSelectedRace(null)}>✕ Close</button>
                  </div>
                  <div style={{ overflowX:"auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width:60 }}>Pos</th>
                          <th>Driver</th>
                          <th>Fantasy Team</th>
                          <th>Status</th>
                          <th style={{ textAlign:"center" }}>Race Pts</th>
                          <th style={{ textAlign:"center" }}>Sprint Pts</th>
                          <th style={{ textAlign:"center" }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(r.driverList || []).map(({ code, positionDisplay, lapsCompleted, dnfLabel }) => {
                          const ft  = ownership?.[code];
                          const rP  = r.race[code]?.race     ?? 0;
                          const sP  = r.sprint[code]?.sprint  ?? 0;
                          const dnf = r.race[code]?.dnf;
                          return (
                            <tr key={code}>
                              <td style={{ color:"#AAA", fontSize:13 }}>{positionDisplay}</td>
                              <td>
                                <span style={{ fontWeight:700, fontSize:14 }}>{code}</span>{" "}
                                <span style={{ fontSize:12, color:"#CCC", fontWeight:600 }}>{F1_DRIVER_MAP[code]}</span>
                              </td>
                              <td>
                                {ft
                                  ? <span style={{ fontSize:13, fontWeight:700, background:TEAM_COLORS[ft]?.accent+"22", color:TEAM_COLORS[ft]?.accent, padding:"3px 10px", borderRadius:2 }}>{ft}</span>
                                  : <span style={{ color:"#888", fontSize:13, fontWeight:600 }}>Free Agent</span>
                                }
                              </td>
                              <td><StatusBadge dnfLabel={dnfLabel} lapsCompleted={lapsCompleted} /></td>
                              <td className="pts-badge" style={{ textAlign:"center", color: dnf ? "#FF5555" : "#E8E8F0" }}>{rP}</td>
                              <td className="pts-badge" style={{ textAlign:"center", color: sP > 0 ? "#FFD700" : "#888" }}>{sP || "—"}</td>
                              <td className="pts-badge" style={{ textAlign:"center", color: rP+sP > 0 ? "#E8003D" : "#999" }}>{rP+sP}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </>}

          {/* ══ LINEUPS ══ */}
          {tab === "lineups" && <>
            <div className="tab-subheading">{season} Driver–Team Assignments by Round</div>
            <div style={{ fontSize:13, color:"#CCC", fontWeight:600, marginBottom:14 }}>
              Showing completed rounds + next 3 · FA = Free Agent
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
              {TEAMS.map(t => (
                <span key={t} style={{ fontSize:13, fontWeight:700, color:TEAM_COLORS[t].accent, background:TEAM_COLORS[t].bg, padding:"3px 12px", borderRadius:2, border:`1px solid ${TEAM_COLORS[t].accent}44` }}>{t}</span>
              ))}
              <span style={{ fontSize:13, color:"#CCC", fontWeight:600, background:"#111", padding:"3px 12px", borderRadius:2, border:"1px solid #333" }}>FA = Free Agent</span>
            </div>
            <div className="card">
              <LineupTable lineup={activeLineup} editable={false} rounds={vRounds} />
            </div>
          </>}

          {/* ══ ADMIN LINEUP EDITOR ══ */}
          {tab === "admin-lineup" && isAdmin && !cfg.readOnly && <>
            <div className="admin-warning">⬡ ADMIN — Click any cell to change a driver's team for that round. The change propagates forward to all remaining rounds. Saves to Supabase instantly.</div>
            <div style={{ fontSize:12, color:"#AAA", marginBottom:14 }}>
              Click a cell → choose team from dropdown → press Enter or click away to save.
              {editSaving && <span style={{ color:"#E8003D", marginLeft:12, fontWeight:700 }}>Saving...</span>}
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
              {TEAMS.map(t => (
                <span key={t} style={{ fontSize:12, color:TEAM_COLORS[t].accent, background:TEAM_COLORS[t].bg, padding:"3px 12px", borderRadius:2, border:`1px solid ${TEAM_COLORS[t].accent}44` }}>{t}</span>
              ))}
              <span style={{ fontSize:12, color:"#AAA", background:"#111", padding:"3px 12px", borderRadius:2, border:"1px solid #222" }}>FA = Free Agent</span>
            </div>
            <div className="card">
              <LineupTable lineup={lineup2026} editable={true} rounds={vRounds} />
            </div>
          </>}

        </>}
      </div>

      {/* ── LOGIN MODAL ── */}
      {showLogin && (
        <div className="modal-overlay" onClick={() => { setShowLogin(false); setPwError(false); setPwInput(""); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:"'Orbitron',sans-serif", fontSize:16, color:"#E8003D", marginBottom:20 }}>Admin Access</div>
            <label className="form-label">Password</label>
            <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)}
              onKeyDown={e => e.key==="Enter" && handleLogin()}
              placeholder="Enter admin password" autoFocus style={{ marginBottom:12 }} />
            {pwError && <div style={{ color:"#FF4444", fontSize:13, marginBottom:12 }}>✕ Incorrect password</div>}
            <div style={{ display:"flex", gap:10, marginTop:4 }}>
              <button className="save-btn" onClick={handleLogin}>LOGIN</button>
              <button className="action-btn" onClick={() => { setShowLogin(false); setPwError(false); setPwInput(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
