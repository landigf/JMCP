import {
  getActiveRuns,
  getAttentionRuns,
  getBlockedTodos,
  getPendingProposalTodos,
  getRunnableTodos,
} from "@jmcp/contracts"
import Link from "next/link"
import { EpicTaskActions } from "../../../components/epic-task-actions"
import { ProjectAutomationControls } from "../../../components/project-automation-controls"
import { ProjectFeed } from "../../../components/project-feed"
import { ProjectMessageForm } from "../../../components/project-message-form"
import { ProposalActions } from "../../../components/proposal-actions"
import { RunActions } from "../../../components/run-actions"
import { SharePanel } from "../../../components/share-panel"
import { TodoForm } from "../../../components/todo-form"
import { TodoRunButton } from "../../../components/todo-run-button"
import { VoiceComposer } from "../../../components/voice-composer"
import { getProject } from "../../../lib/api"
import { parseAssistantReply } from "../../../lib/reply"

export default async function ProjectPage(props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params
  const project = await getProject(params.projectId)
  const activeRuns = getActiveRuns(project.taskRuns, project.project.id)
  const openRuns = project.taskRuns.filter((run) =>
    [
      "queued",
      "planning",
      "running",
      "validating",
      "merging",
      "needs_approval",
      "blocked",
    ].includes(run.status),
  )
  const blockedRuns = getAttentionRuns(project.taskRuns, project.project.id)
  const pendingProposals = getPendingProposalTodos(project.todos, project.project.id)
  const blockedTodos = getBlockedTodos(project.todos, project.project.id)
  const readyTodos = getRunnableTodos(project.todos, project.taskRuns, project.project.id)
  const epicGroups = project.epics.map((epic) => ({
    epic,
    tasks: project.epicTasks.filter((task) => task.epicId === epic.id),
  }))

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
            <strong>{blockedRuns.length + pendingProposals.length + blockedTodos.length}</strong>
            <span>Need attention</span>
          </div>
        </div>
      </section>

      <section className="grid-main">
        <div className="stack">
          {openRuns.length > 0 ? (
            <div className="panel stack-tight">
              <strong>Execution lane is occupied</strong>
              <p className="muted">
                Jarvis keeps one live workstream per project. New chat requests are deduped if they
                match existing work, otherwise they are queued behind the current run.
              </p>
            </div>
          ) : null}
          <ProjectAutomationControls
            nightlyEnabled={project.automationPolicy.nightlyEnabled}
            paused={project.automationPolicy.paused}
            projectId={project.project.id}
          />
          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Project memory</h2>
              <span>{project.projectMemory.stackProfile.length}</span>
            </div>
            <p className="muted">
              Template {project.projectMemory.templateName}@{project.projectMemory.templateVersion}
            </p>
            <ul className="list">
              {project.projectMemory.repoFacts.slice(0, 5).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <p className="muted">
              Validation:{" "}
              {project.brief.testCommands.length > 0
                ? project.brief.testCommands.join(" | ")
                : "None inferred yet"}
            </p>
          </div>
          <ProjectMessageForm projectId={project.project.id} />
          <VoiceComposer projectId={project.project.id} />
          <TodoForm projectId={project.project.id} />
          <ProjectFeed projectId={project.project.id} />
        </div>

        <div className="stack">
          <SharePanel projectId={project.project.id} projectName={project.project.name} />
          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Epic breakdown</h2>
              <span>{project.epics.length}</span>
            </div>
            {epicGroups.length === 0 ? (
              <p className="muted">
                Long product or architecture requests will appear here once Jarvis decomposes them.
              </p>
            ) : (
              epicGroups.map(({ epic, tasks }) => (
                <div className="todo-card" id={`epic-${epic.id}`} key={epic.id}>
                  <div className="event">
                    <strong>{epic.title}</strong>
                    <span>{epic.status}</span>
                  </div>
                  <p>{epic.description}</p>
                  <div className="stack-tight">
                    {tasks.map((task) => (
                      <div
                        className="todo-card todo-card-strong"
                        id={`epic-task-${task.id}`}
                        key={task.id}
                      >
                        <div className="event">
                          <strong>{task.title}</strong>
                          <span>
                            {task.kind.replaceAll("_", " ")} · {task.status}
                          </span>
                        </div>
                        {task.details ? <p>{task.details}</p> : null}
                        <EpicTaskActions
                          epicId={epic.id}
                          kind={task.kind}
                          projectId={project.project.id}
                          status={task.status}
                          taskId={task.id}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="panel stack-tight">
            <div className="lane-header">
              <h2>Proposed by Jarvis</h2>
              <span>{pendingProposals.length}</span>
            </div>
            {pendingProposals.length === 0 ? (
              <p className="muted">
                New improvement ideas discovered during runs will land here for your review.
              </p>
            ) : (
              pendingProposals.map((todo) => (
                <div className="todo-card todo-card-strong" id={`todo-${todo.id}`} key={todo.id}>
                  <div className="event">
                    <strong>{todo.title}</strong>
                    <span>assistant proposal</span>
                  </div>
                  {todo.details ? <p>{todo.details}</p> : null}
                  {todo.proposedFromTaskRunId ? (
                    <p className="muted">
                      Suggested during run {todo.proposedFromTaskRunId.slice(0, 8)}
                    </p>
                  ) : null}
                  <ProposalActions projectId={project.project.id} todoId={todo.id} />
                </div>
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
                If two overnight tasks pull the project in different directions, Jarvis will pause
                them here.
              </p>
            ) : (
              blockedTodos.map((todo) => (
                <div className="todo-card" id={`todo-${todo.id}`} key={todo.id}>
                  <div className="event">
                    <strong>{todo.title}</strong>
                    <span>blocked</span>
                  </div>
                  {todo.details ? <p>{todo.details}</p> : null}
                  {todo.systemNote ? <p className="muted">{todo.systemNote}</p> : null}
                </div>
              ))
            )}
          </div>

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
                  {todo.systemNote ? <p className="muted">{todo.systemNote}</p> : null}
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
