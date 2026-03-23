import {
  getActiveRuns,
  getAttentionRuns,
  getBlockedTodos,
  getNeedsDecisionTasks,
  getPendingProposalTodos,
  getRunnableTodos,
} from "@jmcp/contracts"
import Link from "next/link"
import { CreateProjectForm } from "../components/create-project-form"
import { PushSetup } from "../components/push-setup"
import { SharePanel } from "../components/share-panel"
import { getDashboard } from "../lib/api"

export default async function HomePage() {
  const dashboard = await getDashboard()
  const pausedProjects = new Set(
    dashboard.automationPolicies
      .filter((policy) => policy.paused)
      .map((policy) => policy.projectId),
  )
  const doNow = getRunnableTodos(dashboard.todos, dashboard.taskRuns)
    .filter((todo) => !pausedProjects.has(todo.projectId))
    .slice(0, 6)
  const running = getActiveRuns(dashboard.taskRuns).slice(0, 6)
  const blocked = getAttentionRuns(dashboard.taskRuns).slice(0, 6)
  const blockedTodos = getBlockedTodos(dashboard.todos).slice(0, 6)
  const proposed = getPendingProposalTodos(dashboard.todos).slice(0, 6)
  const decisionTasks = getNeedsDecisionTasks(dashboard.epicTasks).slice(0, 6)
  const mergedOvernight = dashboard.recaps
    .filter((recap) => recap.title.toLowerCase().includes("merged"))
    .slice(0, 4)
  const websiteProject = dashboard.projects.find(
    (project) => project.githubOwner === "landigf" && project.githubRepo === "landigf.github.io",
  )

  return (
    <main className="page-shell">
      <section className="hero command-deck">
        <div className="stack">
          <span className="eyebrow">Jarvis control plane</span>
          <h1>Private agentic execution, built for your phone.</h1>
          <p className="hero-copy">
            Steer multiple repos, launch runs with one tap, process your overnight queue, and keep
            the laptop as the sealed execution host while the phone stays clean and decision-first.
          </p>
        </div>
        <div className="hero-metrics">
          <div className="metric-card">
            <strong>{dashboard.projects.length}</strong>
            <span>Projects online</span>
          </div>
          <div className="metric-card">
            <strong>{running.length}</strong>
            <span>Runs moving</span>
          </div>
          <div className="metric-card">
            <strong>
              {blocked.length + proposed.length + blockedTodos.length + decisionTasks.length}
            </strong>
            <span>Need a decision</span>
          </div>
        </div>
      </section>

      <section className="lane-grid">
        <div className="lane">
          <div className="lane-header">
            <h2>Do Now</h2>
            <span>{doNow.length}</span>
          </div>
          {doNow.length === 0 ? (
            <p className="muted">No waiting TODOs. Drop more work into any connected project.</p>
          ) : (
            doNow.map((todo) => (
              <Link
                className="lane-card"
                href={`/projects/${todo.projectId}#todo-${todo.id}`}
                key={todo.id}
              >
                <strong>{todo.title}</strong>
                <p>{todo.details ?? "Queued for one-tap execution."}</p>
              </Link>
            ))
          )}
        </div>

        <div className="lane">
          <div className="lane-header">
            <h2>Running</h2>
            <span>{running.length}</span>
          </div>
          {running.length === 0 ? (
            <p className="muted">No active runs right now.</p>
          ) : (
            running.map((run) => (
              <Link
                className="lane-card"
                href={`/projects/${run.projectId}#run-${run.id}`}
                key={run.id}
              >
                <strong>{run.objective}</strong>
                <p>{run.resultSummary ?? run.status}</p>
              </Link>
            ))
          )}
        </div>

        <div className="lane">
          <div className="lane-header">
            <h2>Blocked</h2>
            <span>{blocked.length}</span>
          </div>
          {blocked.length === 0 ? (
            <p className="muted">No blocked runs.</p>
          ) : (
            blocked.map((run) => (
              <Link
                className="lane-card lane-card-warn"
                href={`/projects/${run.projectId}#run-${run.id}`}
                key={run.id}
              >
                <strong>{run.objective}</strong>
                <p>{run.approvalReason ?? run.resultSummary ?? run.status}</p>
              </Link>
            ))
          )}
        </div>

        <div className="lane">
          <div className="lane-header">
            <h2>Merged Overnight</h2>
            <span>{mergedOvernight.length}</span>
          </div>
          {mergedOvernight.length === 0 ? (
            <p className="muted">Nothing merged overnight yet.</p>
          ) : (
            mergedOvernight.map((recap) => (
              <div className="lane-card" key={recap.id}>
                <strong>{recap.title}</strong>
                <p>{recap.summary}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid-main">
        <div className="stack">
          <CreateProjectForm />

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Projects</h2>
              <span>{dashboard.projects.length}</span>
            </div>
            {dashboard.projects.length === 0 ? (
              <p className="muted">
                No projects yet. Create one to open its chat, queue, voice lane, and overnight
                automation.
              </p>
            ) : (
              dashboard.projects.map((project) => (
                <Link
                  className="project-card project-card-strong"
                  href={`/projects/${project.id}`}
                  key={project.id}
                >
                  <div className="project-card-top">
                    <div className="stack-tight">
                      <strong>{project.name}</strong>
                      <span className="muted">
                        {project.githubOwner}/{project.githubRepo}
                      </span>
                    </div>
                    <span
                      className={pausedProjects.has(project.id) ? "badge badge-muted" : "badge"}
                    >
                      {pausedProjects.has(project.id) ? "Paused" : "Live"}
                    </span>
                  </div>
                  <p>{project.summary}</p>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="stack">
          <SharePanel projectId={websiteProject?.id} projectName={websiteProject?.name} />

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Needs decision</h2>
              <span>{decisionTasks.length}</span>
            </div>
            {decisionTasks.length === 0 ? (
              <p className="muted">
                Product and architecture decisions that Jarvis cannot safely auto-resolve will show
                up here.
              </p>
            ) : (
              decisionTasks.map((task) => (
                <Link
                  className="notification-card"
                  href={`/projects/${task.projectId}#epic-task-${task.id}`}
                  key={task.id}
                >
                  <strong>{task.title}</strong>
                  <p>{task.details ?? "Decision needed before Jarvis can keep going."}</p>
                </Link>
              ))
            )}
          </div>

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Proposed by Jarvis</h2>
              <span>{proposed.length}</span>
            </div>
            {proposed.length === 0 ? (
              <p className="muted">
                Improvements discovered during runs will show up here before they become real work.
              </p>
            ) : (
              proposed.map((todo) => (
                <Link
                  className="notification-card"
                  href={`/projects/${todo.projectId}#todo-${todo.id}`}
                  key={todo.id}
                >
                  <strong>{todo.title}</strong>
                  <p>{todo.details ?? "Assistant proposal waiting for review."}</p>
                </Link>
              ))
            )}
          </div>

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Queue conflicts</h2>
              <span>{blockedTodos.length}</span>
            </div>
            {blockedTodos.length === 0 ? (
              <p className="muted">
                Overnight conflicts that need your confirmation will show up here.
              </p>
            ) : (
              blockedTodos.map((todo) => (
                <Link
                  className="notification-card"
                  href={`/projects/${todo.projectId}#todo-${todo.id}`}
                  key={todo.id}
                >
                  <strong>{todo.title}</strong>
                  <p>{todo.systemNote ?? todo.details ?? "Nightly queue conflict needs review."}</p>
                </Link>
              ))
            )}
          </div>

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Inbox</h2>
              <span>{dashboard.notifications.length}</span>
            </div>
            {dashboard.notifications.length === 0 ? (
              <p className="muted">
                Task completions, merge notices, blocks, approvals, and morning recaps will land
                here.
              </p>
            ) : (
              dashboard.notifications.slice(0, 8).map((notification) => (
                <div className="notification-card" key={notification.id}>
                  <strong>{notification.title}</strong>
                  <p>{notification.body}</p>
                </div>
              ))
            )}
          </div>

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Executors</h2>
              <span>{dashboard.executors.length}</span>
            </div>
            {dashboard.executors.length === 0 ? (
              <p className="muted">
                No bridge connected yet. Start `npm run dev:bridge` when the control plane is
                online.
              </p>
            ) : (
              dashboard.executors.map((executor) => (
                <div className="event" key={executor.id}>
                  <strong>{executor.name}</strong>
                  <span>{executor.status}</span>
                </div>
              ))
            )}
          </div>

          <PushSetup />
        </div>
      </section>
    </main>
  )
}
