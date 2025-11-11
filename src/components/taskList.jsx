import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./taskList.css";
import { useNavigate } from "react-router-dom";

const API_BASE = process.env.SERVER_API || "";

function toYMD(v) {
  return v ? String(v).slice(0, 10) : "";
}
function parseDateMaybe(v) {
  const s = toYMD(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s) : null;
}

function normalizeTasks(payload) {
  const asArray = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
    ? Object.values(payload).flatMap((v) => (Array.isArray(v) ? v : []))
    : [];

  return asArray.map((t, i) => ({
    id: t.id ?? t._id ?? `t-${i}`,
    projectId: t.projectId ?? String(t.project ?? "unassigned"),
    project: t.project ?? "Untitled Project",
    task: t.task ?? "Untitled",
    status: String(t.status || "IN_PROGRESS").toUpperCase(),
    priority: ["High", "Medium", "Low", "LOW", "MEDIUM", "HIGH"].includes(t.priority)
      ? String(t.priority).replace(
          /^([a-z]).*$/i,
          (m, c) => c.toUpperCase() + m.slice(1).toLowerCase()
        )
      : "Low",
    assigned: t.assigned ?? "",
    startDate: t.startDate ?? "",
    dueDate: t.dueDate ?? "",
    note: t.note ?? "",
    lead: t.lead ?? "",
    dependsOn: Array.isArray(t.dependsOn)
      ? t.dependsOn
      : Array.isArray(t.dependencies)
      ? t.dependencies
      : Array.isArray(t.predecessors)
      ? t.predecessors
      : typeof t.dependsOn === "string"
      ? t.dependsOn
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  }));
}

function normalizeName(n) {
  const s = String(n || "").trim().toLowerCase();
  if (!s) return { full: "", local: "", first: "" };
  const local = s.includes("@") ? s.split("@")[0] : s;
  const first = s.split(/\s+/)[0] || s;
  return { full: s, local, first };
}

function makeMatcher(whoRaw) {
  const who = normalizeName(whoRaw);
  return function matches(candidate) {
    const c = normalizeName(candidate);
    if (!c.full) return false;
    return (
      c.full === who.full ||
      c.local === who.local ||
      c.first === who.first ||
      who.local === c.first ||
      who.first === c.local
    );
  };
}

function useClickAway(onAway) {
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onAway?.();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onAway]);
  return ref;
}

export default function ToDoList() {
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errText, setErrText] = useState("");
  const [menuForId, setMenuForId] = useState(null);
  const navigate = useNavigate();

  const [localRole, setRole] = useState(
    () => (localStorage.getItem("role") || "assignee").toLowerCase()
  );

  const whoAmI = useMemo(
    () => localStorage.getItem("username") || localStorage.getItem("name") || "",
    []
  );
  const isMe = useMemo(() => makeMatcher(whoAmI), [whoAmI]);

  const canSeeNewUsers = localRole === "admin" || localRole === "lead";
  const showRowMenu = canSeeNewUsers;

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/users`, { credentials: "include" });
        if (!resp.ok) throw new Error(`GET /api/users ${resp.status}`);
        const data = await resp.json();

        const structured = [];
        for (const [role, list] of Object.entries(data)) {
          if (Array.isArray(list)) {
            list.forEach((n) => {
              const name = String(n).trim();
              if (name) structured.push({ name, role });
            });
          }
        }

        structured.sort((a, b) => a.name.localeCompare(b.name));
        setMembers(structured);
      } catch (e) {
        console.error("Failed to load members:", e);
      }
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErrText("");
      try {
        const resp = await fetch(`${API_BASE}/api/tasks`, { credentials: "include" });
        if (!resp.ok) throw new Error(`GET /api/tasks ${resp.status}`);
        const data = await resp.json();
        if (!alive) return;
        setTasks(normalizeTasks(data));
      } catch (e) {
        if (!alive) return;
        setErrText(e?.message || "Failed to load tasks.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const saveProjectTasks = useCallback(async (projectId, items) => {
    const resp = await fetch(
      `${API_BASE}/api/tasks/${encodeURIComponent(projectId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(items),
      }
    );
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`PUT ${API_BASE}/api/tasks/${projectId} ${resp.status} ${t}`.trim());
    }
  }, []);

  const toISODate = (val) => {
    if (!val) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  const handleChange = useCallback(
    async (taskId, field, value) => {
      let v = value;
      if (field === "startDate" || field === "dueDate") v = toISODate(value);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, [field]: v } : t))
      );
      

      try {
        const task = tasks.find((t) => t.id === taskId);
        if (!task) return;
        const pid = String(task.projectId || "unassigned");
        const projectTasks = tasks.filter(
          (t) => String(t.projectId || "") === pid
        );
        const updated = projectTasks.map((t) =>
          t.id === taskId ? { ...t, [field]: v } : t
        );
        await saveProjectTasks(pid, updated);
      } catch (e) {
        console.error("Save failed:", e);
        setErrText(e?.message || "Failed to save change.");
      }
    },
    [saveProjectTasks, tasks]
  );

  const sortTasks = useCallback((a, b) => {
    const na = a.number ?? 0;
    const nb = b.number ?? 0;
    return na - nb;
  }, []);

  const filtered = useMemo(() => {
    const role = (localRole || "assignee").toLowerCase();
    if (role === "admin" || role === "owner") return tasks;
    if (role === "lead") return tasks.filter((t) => isMe(t.lead));
    return tasks.filter((t) => isMe(t.assigned));
  }, [tasks, localRole, isMe]);

  const rows = useMemo(() => filtered, [filtered]);

  const closeMenu = useCallback(() => setMenuForId(null), []);
  const menuRef = useClickAway(closeMenu);

  const handleEditTask = useCallback(
    (t) => {
      closeMenu();
      if (!t?.projectId) return;
      navigate(`/edit-project/${encodeURIComponent(t.projectId)}`);
    },
    [navigate, closeMenu]
  );

  const handleDeleteTask = useCallback(
    async (t) => {
      closeMenu();
      if (!t) return;
      const ok = window.confirm(`Delete task "${t.task}" from project "${t.project}"?`);
      if (!ok) return;

      try {
        const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(t.id)}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);

        setTasks((prev) => prev.filter((x) => x.id !== t.id));
      } catch (e) {
        console.error("Delete failed:", e);
        setErrText(e?.message || "Failed to delete task.");
      }
    },
    [closeMenu]
  );

  const actionStyles = {
    dotBtn: {
      background: "transparent",
      border: "none",
      cursor: "pointer",
      fontSize: 18,
      lineHeight: 1,
      padding: 4,
      opacity: 0.0,
      transition: "opacity 120ms",
      color: "#6b7280",
      marginLeft: 6,
    },
    menu: {
      position: "absolute",
      top: "50%",
      right: 6,
      transform: "translateY(-50%)",
      background: "#fff",
      border: "1px solid #e5e7eb",
      boxShadow: "0 6px 18px rgba(0,0,0,.08)",
      borderRadius: 8,
      minWidth: 160,
      zIndex: 10,
    },
    item: {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "8px 10px",
      background: "transparent",
      border: "none",
      cursor: "pointer",
      fontSize: 13,
    },
    itemDanger: { color: "#b91c1c" },
  };

  return (
    <section className="todo">
      <div className="todo__hdr">
        <h2 className="todo__title">Tasks</h2>
        {loading && <span className="todo__status">Loading…</span>}
        {errText && (
          <span className="todo__status todo__status--err">{errText}</span>
        )}
      </div>

      <div className="todo__tablewrap">
        <table className="todo__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Project</th>
              <th>Task</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assigned</th>
              <th>Start</th>
              <th>Due</th>
              <th>Note (everyone can edit)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, idx) => {
              const displayNum = idx + 1;
              const startVal = toYMD(t.startDate || "");
              const dueVal = toYMD(t.dueDate || "");
              const isMenuOpen = menuForId === t.id;

              return (
                <tr
                  key={t.id}
                  className="todo__row"
                  onMouseEnter={(e) => {
                    const btn = e.currentTarget.querySelector("button[data-dot-proj]");
                    if (btn) btn.style.opacity = showRowMenu ? 1 : 0;
                  }}
                  onMouseLeave={(e) => {
                    const btn = e.currentTarget.querySelector("button[data-dot-proj]");
                    if (btn && !isMenuOpen) btn.style.opacity = 0;
                  }}
                >
                  <td className="todo__num">{displayNum}</td>

                  {/* Project */}
                  <td
                    className="todo__proj"
                    title={t.project}
                    style={{ whiteSpace: "nowrap", position: "relative" }}
                  >
                    <span>{t.project}</span>

                    {showRowMenu && (
                      <>
                        <button
                          data-dot-proj
                          title="Actions"
                          style={actionStyles.dotBtn}
                          onClick={() =>
                            setMenuForId((curr) => (curr === t.id ? null : t.id))
                          }
                        >
                          ⋯
                        </button>
                        {isMenuOpen && (
                          <div ref={menuRef} style={actionStyles.menu}>
                            <button
                              style={actionStyles.item}
                              onClick={() => handleEditTask(t)}
                            >
                              Edit task
                            </button>
                            <button
                              style={{ ...actionStyles.item, ...actionStyles.itemDanger }}
                              onClick={() => handleDeleteTask(t)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </td>

                  <td className="todo__task" title={t.task}>
                    {t.task}
                  </td>

                  {/* Status */}
                  <td>
                    <select
                      value={t.status}
                      disabled={localRole === "assignee"}
                      onChange={(e) =>
                        localRole !== "assignee" &&
                        handleChange(t.id, "status", e.target.value)
                      }
                    >
                      {["PLANNED", "IN_PROGRESS", "BLOCKED", "DONE", "COMPLETED"].map(
                        (s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        )
                      )}
                    </select>
                  </td>

                  {/* Priority */}
                  <td>
                    <select
                      value={t.priority}
                      disabled={localRole === "assignee"}
                      onChange={(e) =>
                        localRole !== "assignee" &&
                        handleChange(t.id, "priority", e.target.value)
                      }
                    >
                      {["Low", "Medium", "High"].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Assigned */}
                  <td>
                    <select
                      value={t.assigned || ""}
                      disabled={localRole === "assignee"}
                      onChange={(e) =>
                        handleChange(t.id, "assigned", e.target.value)
                      }
                    >
                      {(localRole === "lead"
                        ? members.filter((m) => m.role === "assignee")
                        : members
                      ).map(({ name, role }) => (
                        <option key={`${name}-${role}`} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Start */}
                  <td>
                    <input
                      type="date"
                      value={startVal}
                      disabled={localRole === "assignee"}
                      onChange={(e) => {
                        if (localRole !== "assignee")
                          return handleChange(t.id, "startDate", e.target.value);
                      }}
                    />
                  </td>

                  {/* Due */}
                  <td>
                    <input
                      type="date"
                      value={dueVal}
                      disabled={localRole === "assignee"}
                      onChange={(e) => {
                        if (localRole !== "assignee")
                          return handleChange(t.id, "dueDate", e.target.value);
                      }}
                    />
                  </td>

                  {/* Note */}
                  <td className="todo__note">
                    <textarea
                      value={t.note || ""}
                      placeholder="Add a quick note…"
                      onChange={(e) =>
                        handleChange(t.id, "note", e.target.value)
                      }
                    />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="todo__empty">
                  No tasks
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
