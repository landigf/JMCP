import Link from "next/link"
import { ProjectAutomationControls } from "../../../components/project-automation-controls"
import { ProjectFeed } from "../../../components/project-feed"
import { ProjectMessageForm } from "../../../components/project-message-form"
import { RunActions } from "../../../components/run-actions"
import { TodoForm } from "../../../components/todo-form"
import { TodoRunButton } from "../../../components/todo-run-button"
import { VoiceComposer } from "../../../components/voice-composer"
import { getProject } from "../../../lib/api"
import { parseAssistantReply } from "../../../lib/reply"

export default async function ProjectPage(props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params
  const project = await getProject(params.projectId)
  const activeRuns = project.taskRuns.filter((run) =>
    ["planning", "running", "validating", "merging"].includes(run.status),
  )
  const blockedRuns = project.taskRuns.filter((run) =>
    ["blocked", "needs_approval"].includes(run.status),
  )
  const readyTodos = project.todos.filter((todo) => ["queued", "ready"].includes(todo.status))

  return (
    <main className="page-shell">
      <Link className="back-link" href="/">
        Back to workspace
      </Link>

      <section className="hero hero-project hero-project-grid">
        <div className="stack">
          <span className="eyebrow">
            {project.project.githubOwner}/{project.project.githubRepo}
          </span>
          <h1>{project.project.name}</h1>
          <p className="hero-copy">{project.brief.summary}</p>
        </div>
        <div className="hero-sidebar stack-tight">
          <div className="metric-card">
            <strong>{readyTodos.length}</strong>
            <span>Queued TODOs</span>
          </div>
          <div className="metric-card">
            <strong>{activeRuns.length}</strong>
            <span>Runs active</span>
          </div>
          <div className="metric-card">
            <strong>{blockedRuns.length}</strong>
            <span>Need attention</span>
          </div>
        </div>
      </section>

      <section className="grid-main">
        <div className="stack">
          <ProjectAutomationControls
            nightlyEnabled={project.automationPolicy.nightlyEnabled}
            paused={project.automationPolicy.paused}
            projectId={project.project.id}
          />
          <ProjectMessageForm projectId={project.project.id} />
          <VoiceComposer projectId={project.project.id} />
          <TodoForm projectId={project.project.id} />
          <ProjectFeed projectId={project.project.id} />
        </div>

        <div className="stack">
          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Do now</h2>
              <span>{readyTodos.length}</span>
            </div>
            {readyTodos.length === 0 ? (
              <p className="muted">Nothing waiting for immediate execution.</p>
            ) : (
              readyTodos.map((todo) => (
                <div className="todo-card todo-card-strong" id={`todo-${todo.id}`} key={todo.id}>
                  <div className="event">
                    <strong>{todo.title}</strong>
                    <span>{todo.status}</span>
                  </div>
                  {todo.details ? <p>{todo.details}</p> : null}
                  <TodoRunButton projectId={project.project.id} todoId={todo.id} />
                </div>
              ))
            )}
          </div>

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Runs</h2>
              <span>{project.taskRuns.length}</span>
            </div>
            {project.taskRuns.length === 0 ? (
              <p className="muted">No active or completed runs yet.</p>
            ) : (
              project.taskRuns.map((run) => (
                <div className="run-card run-card-strong" id={`run-${run.id}`} key={run.id}>
                  <div className="event">
                    <strong>{run.objective}</strong>
                    <span>{run.status}</span>
                  </div>
                  {run.resultSummary ? <p>{run.resultSummary}</p> : null}
                  {run.branchName ? <p className="muted">Branch: {run.branchName}</p> : null}
                  {run.prUrl ? (
                    <a className="inline-link" href={run.prUrl} rel="noreferrer" target="_blank">
                      Open PR
                    </a>
                  ) : null}
                  <RunActions status={run.status} taskRunId={run.id} />
                </div>
              ))
            )}
          </div>

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Recent replies</h2>
              <span>{project.conversation.messages.length}</span>
            </div>
            {project.conversation.messages
              .slice(-6)
              .reverse()
              .map((message) => {
                const parsedReply =
                  message.role === "assistant" ? parseAssistantReply(message.text) : null

                return (
                  <div className="message-card" key={message.id}>
                    <strong>{message.role}</strong>
                    {parsedReply ? (
                      <div className="stack-tight">
                        <p>{parsedReply.status}</p>
                        <ul className="list">
                          {parsedReply.whatChanged.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p>{message.text}</p>
                    )}
                  </div>
                )
              })}
          </div>

          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Morning recaps</h2>
              <span>{project.recaps.length}</span>
            </div>
            {project.recaps.length === 0 ? (
              <p className="muted">No recap yet for this project.</p>
            ) : (
              project.recaps.map((recap) => (
                <div className="notification-card" key={recap.id}>
                  <strong>{recap.title}</strong>
                  <p>{recap.summary}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
