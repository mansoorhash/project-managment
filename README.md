# Project Management Tool

A web-based project management application designed to streamline task organization, delegation, and progress tracking across teams. It expands on the simplicity of a to-do list by introducing ownership, task assignment, hierarchical visibility, and multiple visual workflows for monitoring work over time.

---

## Features

### Task List
- View tasks you **created** and tasks **assigned to you**
- Each task has:
  - **Owner** (creator / responsible party)
  - **Assignees** (people expected to complete the task or collaborate)
  - **Dependencies** (FF,SS,FS,SF)
  - **Status**, **due date**, and **priority**
- Administrators can view and edit tasks across the entire system

### Gantt Chart View
- Visual timeline of all work being done
- Adjustable filters for:
  - Date range
  - Assigned users
  - Priority
  - Project / category
- Helps identify overlapping work, deadlines, and workload distribution

### Calendar View
- Day, Week, or Month display of active and upcoming tasks
- Useful for time planning, daily standups, and work scheduling

---

## Hierarchical Team Structure (Long-Term Feature Vision)
The system is designed to integrate with an organization’s reporting structure.

- Higher-level users can see:
  - Every project under their supervision
  - The entire branching structure of tasks
- Lower-level team members only see:
  - Their assigned tasks
  - Tasks in projects they are part of

Think of it as a **task tree**:
- At the top: broad project goals
- Branching downward: sub-projects → task groups → individual tasks  
- The tree becomes more detailed as you move down levels of responsibility.

---

## Core Concepts

| Role       | Capabilities |
|-----------|--------------|
| **Admin** | Manage users, view all tasks, edit all projects |
| **Owner** | Creates and oversees a task; responsible for its progress |
| **Assignee** | Completes the task and updates progress |

---

## Technologies Used
*(Fill in based on your actual stack)*

- **Frontend:** React / JavaScript
- **Backend:** Node.js (Optional APIs, Auth, DB)
- **Database:** (MongoDB / PostgreSQL / Firebase / etc.)
- **UI / Visualization:** (e.g., Recharts, D3, FullCalendar, or custom components)

---

## Getting Started

```bash
git clone https://github.com/mansoorhash/project-managment.git
cd "project management"
npm install
npm start


