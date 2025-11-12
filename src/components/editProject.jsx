import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FaTrash } from "react-icons/fa";
import "./taskList.css";
import "./editProject.css";

const API_BASE = process.env.SERVER_API || "";

export default function EditProject() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState([]);
  const [changed, setChanged] = useState([]);
  const [loading, setLoading] = useState(true);
  const [depDraft, setDepDraft] = useState({});
  const [userRoles, setUserRoles] = useState({ assignee: [], lead: [], admin: [] });

  const signedInName = (localStorage.getItem("username") || localStorage.getItem("name") || "").trim();
  const role = (localStorage.getItem("role") || "").trim().toLowerCase();

  useEffect(() => {
    if (role === "assignee") navigate("/");
  }, [role, navigate]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/users`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = await res.json();
        setUserRoles({
          assignee: (data.assignee || []).map(String),
          lead: (data.lead || []).map(String),
          admin: (data.admin || []).map(String),
        });
      } catch (err) {
        console.error("GET /api/users failed:", err);
      }
    })();
  }, []);

  const priorityOptions = ["High", "Medium", "Low"];
  const priorityColors = { High: "#ef4444", Medium: "#f59e0b", Low: "#10b981" };

  const toISODate = (val) => {
    if (!val) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  const nextNumber = (list) =>
    (list.reduce((m, t) => Math.max(m, Number(t.number || 0)), 0) || 0) + 1;

  const markChanged = (updatedTask) => {
    setChanged((prev) => {
      const idx = prev.findIndex((t) => t.id === updatedTask.id);
      if (idx === -1) return [...prev, updatedTask];
      const copy = [...prev];
      copy[idx] = updatedTask;
      return copy;
    });
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tasks`, { credentials: "include" });
        const data = await res.json();

        const flat = Array.isArray(data)
          ? data
          : data && typeof data === "object"
          ? Object.values(data).flat()
          : [];

        const projectTasks = flat
          .filter((t) => String(t.projectId || t.project_id || "") === String(projectId))
          .map((t, i) => ({
            id: t.id ?? crypto.randomUUID(),
            projectId: String(t.projectId || projectId),
            project: t.project ?? "Untitled Project",
            number: typeof t.number === "number" ? t.number : i + 1,
            task: t.task ?? "",
            status: String(t.status || "IN_PROGRESS").replace(/\s+/g, "_").toUpperCase(),
            priority: ["High", "Medium", "Low"].includes(t.priority) ? t.priority : "Low",
            lead: (t.lead ?? "").trim(),
            assigned: (t.assigned ?? "").trim(),
            dependsOn: Array.isArray(t.dependsOn)
              ? t.dependsOn.map((d) => {
                  const [targetId, type] = String(d).split(":");
                  return { targetId, type: (type || "FS").toUpperCase() };
                })
              : Array.isArray(t.dependencies)
              ? t.dependencies.map((d) => ({
                  targetId: String(d.targetId || d.id || ""),
                  type: String(d.type || "FS").toUpperCase(),
                }))
              : [],
            startDate: toISODate(t.startDate || ""),
            dueDate: toISODate(t.dueDate || ""),
            note: t.note ?? "",
          }));

        if (!alive) return;
        setTasks(projectTasks);
      } catch (e) {
        console.error("Failed to load tasks:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const projectName = useMemo(
    () => (tasks[0]?.project ? tasks[0].project : "New Project"),
    [tasks]
  );

  const resolvedLead = useMemo(() => {
    const existing = tasks.find((t) => (t.lead || "").trim());
    return existing?.lead || signedInName || "";
  }, [tasks, signedInName]);

  const findTaskIdByNumber = (num) => {
    const task = tasks.find((x) => Number(x.number) === Number(num));
    return task?.id || "";
  };

  const findTaskNumberById = (id) => {
    const task = tasks.find((x) => x.id === id);
    return task ? task.number : "?";
  };

  const handleTaskChange = (index, field, value) => {
    setTasks((prev) => {
      const copy = [...prev];
      let v = value;
      if (field === "startDate" || field === "dueDate") v = toISODate(value);
      copy[index] = { ...copy[index], [field]: v };
      if (!copy[index].lead) copy[index].lead = resolvedLead;
      markChanged(copy[index]);
      return copy;
    });
  };

  const handleAddTask = () => {
    setTasks((prev) => {
      const t = {
        id: crypto.randomUUID(),
        projectId,
        project: projectName || "New Project",
        number: nextNumber(prev),
        task: "",
        status: "IN_PROGRESS",
        priority: "Low",
        lead: role === "admin" ? (userRoles.lead[0] || userRoles.assignee[0] || "") : (userRoles.assignee[0] || ""),
        assigned: signedInName || "",
        dependsOn: [],
        startDate: "",
        dueDate: "",
        note: "",
      };
      markChanged(t);
      return [...prev, t];
    });
  };

  const handleAddDependency = (taskIndex) => {
    const task = tasks[taskIndex];
    const draft = depDraft[task.id] || { type: "FS", target: "" };
    const type = (draft.type || "FS").toUpperCase();
    const targetNum = Number(draft.target);
    const targetId = findTaskIdByNumber(targetNum);
    if (!targetId || targetId === task.id) return;

    const exists = (task.dependencies || []).some(
      (d) => d.targetId === targetId && d.type === type
    );
    if (exists) return;

    setTasks((prev) => {
      const copy = [...prev];
      const deps = [...(copy[taskIndex].dependencies || [])];
      deps.push({ type, targetId });
      copy[taskIndex] = { ...copy[taskIndex], dependencies: deps };
      markChanged(copy[taskIndex]);
      return copy;
    });
  };

  const normalizeForSave = (t) => ({
    id: t.id,
    projectId: t.projectId,
    project: t.project,
    task: t.task,
    status: (t.status || "IN_PROGRESS").replace(/\s+/g, "_").toUpperCase(),
    priority: t.priority,
    assigned: t.assigned || "",
    lead: t.lead || "",
    startDate: t.startDate ?? "-",
    dueDate: t.dueDate ?? "-",
    note: t.note || "-",
    dependsOn: (t.dependsOn || []).map((d) => `${d.targetId}:${d.type || "FS"}`),
  });

    const handleDeleteTask = useCallback(
      async (t) => {
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
      }
    );

  const handleSave = async () => {
    sessionStorage.removeItem("draft_project_taskId");
    window.dispatchEvent(new Event("draft:cleared"));

    try {
      const payloadSrc = changed.length ? changed : tasks;
      const payload = payloadSrc.map(normalizeForSave);

      const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(projectId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save tasks");
      await res.json();
      navigate("/");
    } catch (err) {
      console.error(err);
      alert("Save failed. See console for details.");
    }
  };

  if (loading) return <div className="todo-container">Loading…</div>;

  const leadOptions =
    role === "admin"
      ? [...(userRoles.admin || []), ...(userRoles.lead || []), ...(userRoles.assignee || [])]
      : [...(userRoles.assignee || [])];

  return (
    <div className="todo-container">
      <input
        className="edit-title"
        style={{ textAlign: "left", marginBottom: 10, width: "100%" }}
        placeholder={`${projectName}${tasks.length === 0 ? " – New Project" : ""}`}
        defaultValue={projectName}
        onChange={(e) =>
          setTasks((prev) => prev.map((t) => ({ ...t, project: e.target.value })))
        }
      />

      <table className="todo-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Task Name</th>
            <th>Priority</th>
            <th>Assigned to</th>
            <th>Dependencies</th>
            <th>Start Date</th>
            <th>Due Date</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t, index) => {
            const draft = depDraft[t.id] || { type: "FS", target: "" };
            const dependencyTargets = tasks.filter((x) => x.id !== t.id);

            return (
              <tr key={t.id}>
                <td>
                  <span>{t.number}</span>
                  <FaTrash
                    style={{ cursor: "pointer", color: "red", marginLeft: "8px" }}
                    onClick={() => handleDeleteTask(t)}
                  />
                </td>

                <td>
                  <input
                    className="edit-task-box"
                    placeholder="Enter Task Name"
                    type="text"
                    value={t.task}
                    onChange={(e) => handleTaskChange(index, "task", e.target.value)}
                  />
                </td>

                {/* Colored priority dropdown */}
                <td>
                  <select
                    className="dropdown priority"
                    value={t.priority}
                    onChange={(e) => handleTaskChange(index, "priority", e.target.value)}
                    style={{
                      color: priorityColors[t.priority],
                      fontWeight: "bold",
                    }}
                  >
                    {priorityOptions.map((p) => (
                      <option
                        key={p}
                        value={p}
                        style={{ color: priorityColors[p], fontWeight: "bold" }}
                      >
                        {p}
                      </option>
                    ))}
                  </select>
                </td>

                {/* Lead ComboBox (editable for admins & leads; leads only see assignees) */}
                <td>
                  <select
                    className="dropdown"
                    value={t.assigned || ""}
                    onChange={(e) => handleTaskChange(index, "lead", e.target.value)}
                  >
                    {leadOptions.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </td>

                {/* Dependencies */}
                <td>
                  <div>
                    {t.dependsOn.map((d, di) => (
                      <span
                        key={`${d.type}-${d.targetId}-${di}`}
                        style={{
                          background: "#eee",
                          padding: "3px 6px",
                          margin: "2px",
                          borderRadius: "3px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {d.type} → {findTaskNumberById(d.targetId)}
                        <button
                          style={{
                            color: "red",
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            const deps = [...(t.dependencies || [])];
                            deps.splice(di, 1);
                            handleTaskChange(index, "dependencies", deps);
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <select
                      value={draft.type}
                      onChange={(e) =>
                        setDepDraft((s) => ({ ...s, [t.id]: { ...draft, type: e.target.value } }))
                      }
                    >
                      <option>FS</option>
                      <option>SS</option>
                      <option>FF</option>
                      <option>SF</option>
                    </select>

                    <select
                      value={draft.target}
                      onChange={(e) =>
                        setDepDraft((s) => ({ ...s, [t.id]: { ...draft, target: e.target.value } }))
                      }
                      style={{ minWidth: "80px" }}
                    >
                      <option value="" disabled hidden>
                        Task #
                      </option>
                      {dependencyTargets.map((x) => (
                        <option key={x.id} value={x.number}>
                          {x.number}
                        </option>
                      ))}
                    </select>

                    <button
                      style={{
                        background: "#007bff",
                        color: "white",
                        border: "none",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                      onClick={() => handleAddDependency(index)}
                    >
                      Add
                    </button>
                  </div>
                </td>

                <td>
                  <input
                    className="calendar-input"
                    type="date"
                    value={t.startDate || ""}
                    onChange={(e) => handleTaskChange(index, "startDate", e.target.value)}
                  />
                </td>

                <td>
                  <input
                    className="calendar-input"
                    type="date"
                    value={t.dueDate || ""}
                    onChange={(e) => handleTaskChange(index, "dueDate", e.target.value)}
                  />
                </td>

                <td>
                  <textarea
                    className="note-textarea"
                    value={t.note || ""}
                    placeholder="Add a quick note…"
                    onChange={(e) => handleTaskChange(index, "note", e.target.value)}
                  />
                </td>
              </tr>
            );
          })}

          <tr>
            <td colSpan="8" style={{ textAlign: "center" }}>
              <button
                style={{
                  background: "#28a745",
                  color: "white",
                  padding: "6px 12px",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
                onClick={handleAddTask}
              >
                ➕ Add New Task
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 15, display: "flex", justifyContent: "space-between", gap: "5px" }}>
        <button className="back-btn" onClick={() => navigate("/")}>
          ⬅ Back
        </button>
        <button className="save-btn" onClick={handleSave}>
          Save Changes
        </button>
      </div>
    </div>
  );
}
