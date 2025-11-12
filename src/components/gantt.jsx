import React, { useEffect, useMemo, useRef, useState } from "react";
import "./gantt.css";

const API_BASE = process.env.SERVER_API || "";

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.max(0, Math.round((end - start) / ms));
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

function normalizeTasks(payload) {
  const toArray = (data) =>
    Array.isArray(data)
      ? data
      : data && typeof data === "object"
      ? Object.values(data).flatMap((v) => (Array.isArray(v) ? v : []))
      : [];

  const toDeps = (value) => {
    if (!value) return [];
    if (Array.isArray(value) && value.every((d) => d && typeof d === "object")) {
      return value
        .map((d) => ({ id: d.id ?? d.taskId ?? d.ref ?? String(d), type: String(d.type || "FS").toUpperCase() }))
        .filter((d) => d.id);
    }
    if (Array.isArray(value)) {
      return value
        .map(String)
        .map((s) => { const [id, ty] = s.split(":"); return { id: id?.trim(), type: String(ty || "FS").toUpperCase() }; })
        .filter((d) => d.id);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => { const [id, ty] = s.split(":"); return { id: id?.trim(), type: String(ty || "FS").toUpperCase() }; });
    }
    return [];
  };

  return toArray(payload)
    .map((t, i) => {
      const id = t.id ?? t._id ?? `t-${i}`;
      const title = t.title || t.task || t.name || "Untitled";

      const startRaw = t.startDate || t.started || t.start || t.from || t.date;
      const endRaw   = t.dueDate   || t.due     || t.end   || t.to   || t.finish || startRaw;
      if (!startRaw || Number.isNaN(Date.parse(startRaw))) return null;

      const s = new Date(startRaw);
      let e = endRaw && !Number.isNaN(Date.parse(endRaw)) ? new Date(endRaw) : new Date(startRaw);
      if (e < s) e = s;

      const status = String(t.status || "IN_PROGRESS").replace(/\s+/g, "_").toUpperCase();
      const dependsOn = toDeps(t.dependsOn) || [];

      return {
        id,
        title,
        start: s,
        end: e,
        status,
        dependsOn,
        project: t.project ?? "",
        projectId: t.projectId ?? "",
        assigned: t.assigned ?? "",
      };
    })
    .filter(Boolean);
}

function buildDayScale(from, to) {
  const total = daysBetween(from, to);
  const parts = [];
  for (let i = 0; i <= total; i++) parts.push(addDays(from, i));
  return parts;
}
function dateToPct(d, from, to) {
  const span = Math.max(1, daysBetween(from, to));
  const offset = clamp(daysBetween(from, d), 0, span);
  return (offset / span) * 100;
}
function anchorByType(type, from, to) {
  const ty = String(type || "FS").toUpperCase();
  const fromStart = from.leftPct;
  const fromFinish = from.rightPct;
  const toStart = to.leftPct;
  const toFinish = to.rightPct;

  switch (ty) {
    case "SS": return { fromPct: fromStart, toPct: toStart };
    case "FF": return { fromPct: fromFinish, toPct: toFinish };
    case "SF": return { fromPct: fromStart, toPct: toFinish };
    case "FS":
    default:   return { fromPct: fromFinish, toPct: toStart };
  }
}

export default function Gantt() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errText, setErrText] = useState("");
  const role = localStorage.getItem("role");

  // Filters
  const [filters, setFilters] = useState({
    project: "all",
    assigned: "all",
    status: "all",
  });

  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const cursor = useMemo(() => ({
    from: startOfMonth(monthCursor),
    to: endOfMonth(monthCursor),
  }), [monthCursor]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErrText("");
      try {
        const resp = await fetch(`${API_BASE}/api/tasks`, { credentials: "include" });
        if (!resp.ok) throw new Error(`GET /api/tasks ${resp.status}`);
        const raw = await resp.json();
        const normalized = normalizeTasks(raw).sort((a, b) => a.start - b.start || a.end - b.end);
        if (!alive) return;
        setTasks(normalized);
      } catch (e) {
        if (!alive) return;
        setErrText(e?.message || "Failed to load tasks.");
        setTasks([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Derived filter lists
  const allProjects = useMemo(() => {
    const s = new Set();
    tasks.forEach(t => { if (t.project) s.add(t.project); });
    return ["all", ...Array.from(s).sort((a,b)=>a.localeCompare(b))];
  }, [tasks]);

  const allAssigned = useMemo(() => {
    const s = new Set();
    tasks.forEach(t => { if (t.assigned) s.add(t.assigned); });
    return ["all", ...Array.from(s).sort((a,b)=>a.localeCompare(b))];
  }, [tasks]);

  const allStatuses = ["all", "PLANNED", "IN_PROGRESS", "BLOCKED", "DONE", "COMPLETED"];

  const visible = useMemo(() => {
    return tasks.filter(t => {
      const overlaps = !(t.end < cursor.from || t.start > cursor.to);
      if (!overlaps) return false;

      if (filters.project !== "all" && t.project !== filters.project) return false;
      if (filters.assigned !== "all" && t.assigned !== filters.assigned) return false;
      if (filters.status !== "all" && t.status !== filters.status) return false;
      return true;
    });
  }, [tasks, cursor, filters]);

  const rows = useMemo(() => visible.map(t => [t]), [visible]);

  const layoutInfo = useMemo(() => {
    const map = new Map();
    rows.forEach((row, rIdx) => {
      const t = row[0];
      const leftPct = dateToPct(t.start, cursor.from, cursor.to);
      const rightPct = dateToPct(t.end, cursor.from, cursor.to);
      map.set(t.id, { row: rIdx, leftPct, rightPct });
    });
    return map;
  }, [rows, cursor]);

  const links = useMemo(() => {
    const out = [];
    for (const t of visible) {
      const toPos = layoutInfo.get(t.id);
      if (!toPos) continue;
      const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
      for (const dep of deps) {
        const fromId = typeof dep === "string" ? dep : dep.id;
        const type = typeof dep === "string" ? "FS" : dep.type || "FS";
        const fromPos = layoutInfo.get(fromId);
        if (!fromPos) continue;
        out.push({ fromId, toId: t.id, type: String(type).toUpperCase(), from: fromPos, to: toPos });
      }
    }
    return out;
  }, [visible, layoutInfo]);

  const rightRef = useRef(null);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = rightRef.current;
    if (!el) return;
    const w = el.scrollWidth;
    const h = 8 + rows.length * (36 + 8);
    setSvgSize({ w, h });
  }, [rows.length, cursor]);

  const gridRef = useRef(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const today = new Date();
    if (today < cursor.from || today > cursor.to) return;
    const pct = dateToPct(today, cursor.from, cursor.to);
    const x = (grid.scrollWidth * pct) / 100 - grid.clientWidth / 2;
    grid.scrollLeft = clamp(x, 0, grid.scrollWidth);
  }, [cursor]);

  const statusMod = (s) => String(s || "").toLowerCase();

  const prevMonth = () => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const clearFilters = () => setFilters({ project: "all", assigned: "all", status: "all" });

  const today = new Date();
  const todayPct = today >= cursor.from && today <= cursor.to ? dateToPct(today, cursor.from, cursor.to) : null;

  return (
    <section className="gantt">
      <div className="gantt__toolbar">
        <div className="gantt__controls">
          <button className="gantt__btn" onClick={prevMonth}>‹ Month</button>
          <button className="gantt__btn" onClick={nextMonth}>Month ›</button>
        </div>

        <div className="gantt__title">
          {cursor.from.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </div>

        {errText && <span className="gantt__status gantt__status--err">{errText}</span>}
      </div>

      {/* Timeline header */}
      <div className="gantt__header" role="row">
        <div className="gantt__leftcol">Filters</div>
        <div className="gantt__timeline" role="grid" aria-label="Timeline days" ref={gridRef}>
          {buildDayScale(cursor.from, cursor.to).map((d, i) => {
            const isMonthStart = d.getDate() === 1 || i === 0;
            const isToday = ymd(d) === ymd(today);
            return (
              <div
                key={i}
                className={`gantt__tick ${isMonthStart ? "gantt__tick--month" : ""} ${isToday ? "gantt__tick--today" : ""}`}
                title={d.toDateString()}
                aria-label={d.toDateString()}
              >
                <span className="gantt__ticklabel">
                  {d.getDate() === 1 ? d.toLocaleString(undefined, { month: "short" }) : d.getDate()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid with bars */}
      <div className="gantt__grid">
        <div className="gantt__filters">
          <label className="gantt__filterrow select-label">
            <span>Project</span>
            <select
              className="gantt__select select--sm"
              value={filters.project}
              onChange={(e) => setFilters((f) => ({ ...f, project: e.target.value }))}
            >
              {allProjects.map((p) => (
                <option key={p} value={p}>
                  {p === "all" ? "All" : p}
                </option>
              ))}
            </select>
          </label>

          {role !== "assignee" && <label className="gantt__filterrow">
            <span>Assigned</span>
            <select
              className="gantt__select"
              value={filters.assigned}
              onChange={(e) => setFilters((f) => ({ ...f, assigned: e.target.value }))}
            >
              {allAssigned.map((a) => (
                <option key={a} value={a}>
                  {a === "all" ? "All" : a}
                </option>
              ))}
            </select>
          </label>}

          <label className="gantt__filterrow">
            <span>Status</span>
            <select
              className="gantt__select"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              {["all", "PLANNED", "IN_PROGRESS", "BLOCKED", "DONE", "COMPLETED"].map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All" : s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>

          <button className="gantt__btn gantt__btn--full" onClick={clearFilters}>
            Clear filters
          </button>
        </div>


        <div className="gantt__right" ref={rightRef}>
          {loading ? (
            <span className="gantt__status">Loading…</span>
          ) : rows.length === 0 ? (
            <div className="gantt__empty">No tasks match the filters for this month.</div>
          ) : (
            <>
              {todayPct !== null && (
                <div
                  className="gantt__todayline"
                  style={{ left: `${todayPct}%` }}
                  aria-hidden="true"
                />
              )}

              {/* dependency links */}
              <svg
                className="gantt__links"
                width={svgSize.w}
                height={svgSize.h}
                viewBox={`0 0 ${svgSize.w} ${svgSize.h}`}
                aria-hidden="true"
              >
                <defs>
                  <marker id="arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#9ca3af" />
                  </marker>
                </defs>
                {links.map((lnk, i) => {
                  const { fromPct, toPct } = anchorByType(lnk.type, lnk.from, lnk.to);
                  const x1 = (fromPct / 100) * svgSize.w;
                  const x2 = (toPct / 100) * svgSize.w;
                  const y1 = 8 + lnk.from.row * (36 + 8) + 18;
                  const y2 = 8 + lnk.to.row * (36 + 8) + 18;
                  const midX = x1 + (x2 >= x1 ? 12 : -12);
                  const cls =
                    lnk.type === "SS" ? "glnk glnk--ss" :
                    lnk.type === "FF" ? "glnk glnk--ff" :
                    lnk.type === "SF" ? "glnk glnk--sf" :
                    "glnk glnk--fs";
                  return (
                    <path
                      key={i}
                      className={cls}
                      d={`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`}
                      fill="none"
                      markerEnd="url(#arrow)"
                    />
                  );
                })}
              </svg>

              {/* vertical day grid */}
              <div className="gantt__cols">
                {buildDayScale(cursor.from, cursor.to).map((_, i) => (
                  <div key={i} className="gantt__col" />
                ))}
              </div>

              {/* bars */}
              <div className="gantt__rows">
                {rows.map((row, rIdx) => {
                  const t = row[0];
                  const leftPct = dateToPct(t.start, cursor.from, cursor.to);
                  const rightPct = dateToPct(t.end, cursor.from, cursor.to);
                  const widthPct = Math.max(0.5, rightPct - leftPct || 0.5);
                  const title = `${t.title} (${ymd(t.start)} → ${ymd(t.end)})`;
                  return (
                    <div key={rIdx} className="gantt__row">
                      <div
                        className={`gantt__bar gantt__bar--${statusMod(t.status)}`}
                        title={title}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      >
                        <span className="gantt__barlabel">{t.title}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

      </div>
    </section>
  );
}
