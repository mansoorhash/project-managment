import React, { useEffect, useMemo, useRef, useState } from "react";
import "./newUser.css";

const ROLES = ["admin", "lead", "assignee"];
const API_BASE = process.env.SERVER_API || "";


function bucketsToRows(payload) {
  const rows = [];
  for (const role of ROLES) {
    const arr = Array.isArray(payload?.[role]) ? payload[role] : [];
    for (const name of arr) {
      const n = String(name || "").trim();
      if (n) rows.push({ id: `${role}:${n.toLowerCase()}`, name: n, role });
    }
  }
  return rows;
}

export default function NewUser() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errText, setErrText] = useState("");

  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState("assignee");


  const dragItem = useRef(null);
  const dragOver = useRef({ role: null, index: null, zone: "none" });

  const nameSet = useMemo(
    () => new Set(rows.map(r => r.name.toLowerCase())),
    [rows]
  );

  async function loadUsers() {
    setLoading(true);
    setErrText("");
    try {
      const resp = await fetch(`${API_BASE}/api/users`, { credentials: "include" });
      if (!resp.ok) throw new Error(`GET /api/users ${resp.status}`);
      const data = await resp.json();
      setRows(bucketsToRows(data));
    } catch (e) {
      setErrText(e?.message || "Failed to load users.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function addUser() {
    const name = draftName.trim();
    const role = draftRole;
    if (!name) { setErrText("Please enter a name."); return; }
    if (!ROLES.includes(role)) { setErrText("Invalid role."); return; }
    if (nameSet.has(name.toLowerCase())) { setErrText("This user already exists."); return; }

    setErrText("");
    const optimistic = [...rows, { id: `${role}:${name.toLowerCase()}`, name, role }];
    setRows(optimistic);

    try {
      const resp = await fetch(`${API_BASE}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, role }),
      });
      if (!resp.ok) throw new Error(`POST ${API_BASE}/api/users ${resp.status}`);
      await loadUsers();
      setDraftName("");
      setDraftRole("assignee");
    } catch (e) {
      setErrText(e?.message || "Failed to add user.");
      await loadUsers();
    }
  }

  async function changeRole(user, nextRole) {
    if (user.role === nextRole || !ROLES.includes(nextRole)) return;

    // optimistic
    const snapshot = rows;
    setRows(prev =>
      prev
        .map(r => r.id === user.id ? { ...r, role: nextRole, id: `${nextRole}:${r.name.toLowerCase()}` } : r)
    );
    try {
      const resp = await fetch(`${API_BASE}/api/users/${encodeURIComponent(user.name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: nextRole }),
      });
      if (!resp.ok) throw new Error(`PUT /api/users/:name ${resp.status}`);
    } catch (e) {
      setErrText(e?.message || "Failed to update role.");
      setRows(snapshot);
    }
  }

  async function deleteUser(user) {
    if (!window.confirm(`Remove ${user.name}?`)) return;

    const snapshot = rows;
    setRows(prev => prev.filter(r => r.id !== user.id));
    try {
      const resp = await fetch(`${API_BASE}/api/users/${encodeURIComponent(user.name)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok) throw new Error(`DELETE ${API_BASE}/api/users/:name ${resp.status}`);
    } catch (e) {
      setErrText(e?.message || "Failed to delete user.");
      setRows(snapshot);
    }
  }

  // ---------- Drag & Drop ----------
  function beginDrag(name, role, index, ev) {
    dragItem.current = { name, role, index };
    dragOver.current = { role, index, zone: "row" };
    ev.dataTransfer.setData("text/plain", JSON.stringify(dragItem.current));
    ev.dataTransfer.effectAllowed = "move";
  }
  function onDragOverColumn(role, ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    dragOver.current = { role, index: null, zone: "column" };
  }
  function onDragOverRow(role, index, ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    dragOver.current = { role, index, zone: "row" };
  }
  function computeNewStateOnDrop() {
    const src = dragItem.current;
    const tgt = dragOver.current;
    if (!src || !tgt || !tgt.role) return null;

    const grouped = { admin: [], lead: [], assignee: [] };
    for (const r of rows) grouped[r.role].push(r);

    const sourceArr = grouped[src.role];
    const srcIdx = sourceArr.findIndex(r => r.name === src.name);
    if (srcIdx === -1) return null;
    const [item] = sourceArr.splice(srcIdx, 1);

    const sameRole = src.role === tgt.role;
    const targetArr = grouped[tgt.role];
    let insertAt;
    if (tgt.zone === "column" || tgt.index == null) {
      insertAt = targetArr.length;
    } else {
      insertAt = sameRole && srcIdx < tgt.index ? Math.max(0, tgt.index - 1) : tgt.index;
    }
    targetArr.splice(insertAt, 0, { ...item, role: tgt.role, id: `${tgt.role}:${item.name.toLowerCase()}` });

    const nextRows = [...grouped.admin, ...grouped.lead, ...grouped.assignee];
    return { nextRows, toRole: tgt.role, insertAt, name: item.name };
  }
  async function finalizeDrop() {
    const calc = computeNewStateOnDrop();
    if (!calc) return;
    const { nextRows, toRole, insertAt, name } = calc;

    const snapshot = rows;
    setRows(nextRows);
    try {
      const resp = await fetch(`${API_BASE}/api/users/${encodeURIComponent(name)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: toRole, index: insertAt }),
      });
      if (!resp.ok) throw new Error(`PUT /api/users/:name ${resp.status}`);
    } catch (e) {
      setErrText(e?.message || "Failed to save new position");
      setRows(snapshot);
    } finally {
      dragItem.current = null;
      dragOver.current = { role: null, index: null, zone: "none" };
    }
  }
  function cancelDrag() {
    dragItem.current = null;
    dragOver.current = { role: null, index: null, zone: "none" };
  }

  const byRole = useMemo(() => {
    const map = { admin: [], lead: [], assignee: [] };
    for (const r of rows) map[r.role]?.push(r);
    for (const k of ROLES) map[k].sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [rows]);

  const placeholderStyle = {
    height: 6, borderRadius: 3, margin: "4px 0", background: "rgba(0,0,0,0.15)"
  };

  return (
    <div className="pageWrap">
      <div className="pageHeader">
        <h1>People & Roles</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--secondary" onClick={loadUsers}>Refresh</button>
        </div>
      </div>

      {errText && <div className="alert" role="alert">{errText}</div>}

      {/* Input bar (names only) */}
      <div className="inputBar" role="form" aria-label="Add user">
        <input
          className="textInput"
          type="text"
          placeholder='Name (e.g., "Joe Simp")'
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            className="selectInput"
            value={draftRole}
            onChange={(e) => setDraftRole(e.target.value)}
            aria-label="Role"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r.toUpperCase()}</option>
            ))}
          </select>
          <button className="btn btn--primary" onClick={addUser}>Add User</button>
        </div>
      </div>

      {loading && <div className="loading">Loading…</div>}

      {/* Role grids with drag & drop */}
      <div className="grid" aria-live="polite">
        {ROLES.map((roleKey) => {
          const list = byRole[roleKey] || [];
          return (
            <section
              key={roleKey}
              aria-label={`${roleKey} list`}
              onDragOver={(e) => onDragOverColumn(roleKey, e)}
              onDrop={finalizeDrop}
              onDragEnd={cancelDrag}
            >
              <div className="roleHeader">
                <h2 className="roleTitle">{roleKey.toUpperCase()}</h2>
                <div style={{ opacity: 0.7 }}>{list.length} user{list.length === 1 ? "" : "s"}</div>
              </div>

              <div className="tableCard" style={{ minHeight: 120 }}>
                <div className="tableRow tableHead">
                  <div>#</div>
                  <div>Name</div>
                  <div>Actions</div>
                </div>

                {list.length === 0 && <div className="emptyRow">No users</div>}

                {list.map((u, i) => {
                  const activeDrop =
                    dragOver.current.role === roleKey &&
                    dragOver.current.zone === "row" &&
                    dragOver.current.index === i;

                  return (
                    <div key={u.id} style={{ display: "grid", gap: 4 }}>
                      {/* drop placeholder before this row */}
                      {activeDrop && <div style={placeholderStyle} />}

                      <div
                        className="tableRow"
                        draggable
                        onDragStart={(e) => beginDrag(u.name, roleKey, i, e)}
                        onDragOver={(e) => onDragOverRow(roleKey, i, e)}
                        onDrop={finalizeDrop}
                        onDragEnd={cancelDrag}
                        title="Drag to reorder or move"
                        style={{ cursor: "grab" }}
                      >
                        <div className="dragHandle" aria-hidden="true" />
                        <div style={{ fontWeight: 700 }}>{u.name}</div>

                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <select
                            className="selectInput"
                            value={u.role}
                            onChange={(e) => changeRole(u, e.target.value)}
                            aria-label={`Change role for ${u.name}`}
                            style={{ width: 160 }}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r.toUpperCase()}</option>
                            ))}
                          </select>

                          <button
                            className="iconBtn"
                            title="Remove user"
                            aria-label={`Remove ${u.name}`}
                            onClick={() => deleteUser(u)}
                          >
                            <span className="icon-trash" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* tail placeholder when dropping at end of the column */}
                {dragOver.current.role === roleKey && dragOver.current.zone === "column" && (
                  <div style={{ ...placeholderStyle, marginTop: 8 }} />
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
