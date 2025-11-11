import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./header.css";
import { NavLink, useNavigate } from "react-router-dom";

const API_BASE = process.env.SERVER_API || "";

function genUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.substr(0, 8)}-${hex.substr(8, 4)}-${hex.substr(12, 4)}-${hex.substr(16, 4)}-${hex.substr(20)}`;
  }
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateDraftId() {
  const key = "draft_project_taskId";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = genUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export default function Header() {
  const navigate = useNavigate();

  const [role, setRole] = useState(() => (localStorage.getItem("role") || "assignee").toLowerCase());
  const [name, setName] = useState(() => localStorage.getItem("name") || "");
  const [users, setUsers] = useState({ admin: [], lead: [], assignee: [] });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/users`, { credentials: "include" });
        const data = resp.ok ? await resp.json() : { admin: [], lead: [], assignee: [] };

        const extraassignees = ["Sam assignee", "Taylor assignee"];
        const admins = (data.admin || []).map((s) => String(s).trim()).filter(Boolean);
        const leads = (data.lead || []).map((s) => String(s).trim()).filter(Boolean);
        const assigneeSet = new Set([...(data.assignee || []), ...extraassignees].map((s) => String(s).trim()).filter(Boolean));
        const assignees = Array.from(assigneeSet);

        if (!alive) return;
        setUsers({ admin: admins, lead: leads, assignee: assignees });
      } catch {
        if (!alive) return;
        setUsers({ admin: [], lead: [], assignee: ["Sam assignee", "Taylor assignee"] });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const viewOptions = useMemo(() => {
    const opts = [];
    if (users.admin?.[0]) opts.push({ role: "admin", label: `Admin — ${users.admin[0]}`, name: users.admin[0] });
    if (users.lead?.[0]) opts.push({ role: "lead", label: `Lead — ${users.lead[0]}`, name: users.lead[0] });
    if (users.assignee?.[0]) opts.push({ role: "assignee", label: `assignee — ${users.assignee[0]}`, name: users.assignee[0] });
    return opts;
  }, [users]);

  const selectedKey = `${role}|${name}`;

  useEffect(() => {
    if (!name && viewOptions.length > 0) {
      const first = viewOptions[0];
      setRole(first.role);
      setName(first.name);
      localStorage.setItem("role", first.role);
      localStorage.setItem("name", first.name);
    }
  }, [name, viewOptions]);

  useEffect(() => {
    const onCleared = () => {
      sessionStorage.removeItem("draft_project_taskId");
    };
    window.addEventListener("draft:cleared", onCleared);
    return () => window.removeEventListener("draft:cleared", onCleared);
  }, []);

  const canSeeNewUsers = role === "admin" || role === "lead";

  const onViewChange = useCallback((e) => {
    const [nextRole, ...rest] = e.target.value.split("|");
    const nextName = rest.join("|");
    setRole(nextRole);
    setName(nextName);
    localStorage.setItem("role", nextRole);
    localStorage.setItem("name", nextName);
    window.location.reload();
  }, []);

  const handleAddProject = useCallback(
    (e) => {
      e.preventDefault();
      const draftId = getOrCreateDraftId();
      navigate(`/edit-project/${encodeURIComponent(draftId)}?draft=1`);
    },
    [navigate]
  );

  return (
    <header className="header">
      {/* Left: logo + nav */}
      <div className="left" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          onClick={() => navigate("/")}
          style={{ fontWeight: 700, cursor: "pointer", color: "#333" }}
          title="Go to Dashboard"
        >
          PM
        </div>
        <nav style={{ display: "flex", gap: 12 }}>
          {canSeeNewUsers && (
            <button
              type="button"
              onClick={handleAddProject}
              className="user-info"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--link, #2563eb)",
                textDecoration: "none",
                font: "inherit",
              }}
              title="Create a new project (draft) and edit"
            >
              Add Project
            </button>
          )}
          {canSeeNewUsers && (
            <NavLink to="/new-users" className="user-info">
              New Users
            </NavLink>
          )}
        </nav>
      </div>

      {/* Right: single View-as dropdown (changes both role + name) */}
      <div className="right" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="viewAs" style={{ fontSize: 12, color: "#6b7280" }}>
            View as
          </label>
          <select
            id="viewAs"
            value={selectedKey}
            onChange={onViewChange}
            className="role-select"
            style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff" }}
          >
            {viewOptions.map((opt) => (
              <option key={`${opt.role}|${opt.name}`} value={`${opt.role}|${opt.name}`}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="user-info" style={{ opacity: 0.7 }}>{role.toUpperCase()}</span>
        </div>
      </div>
    </header>
  );
}
