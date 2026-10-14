// OMP in the Pair panel: the extension runs `omp --mode rpc-ui` in the workspace, the panel is
// its conversation, and its dialogs are VS Code's own. OMP reaches the editor through the pair
// server like any other agent, which Start sets up in OMP first, so connecting is one click.

import * as os from "node:os"
import * as vscode from "vscode"
import { AGENTS, execProgram, findOmp, type Host } from "./agents"
import { field, messageText, modelLabel, OmpRpc, type OmpFrame, type OmpUiAnswer } from "./ompRpc"
import type { NarrationPanel, OmpPort, OmpStatus } from "./panel"

const HOST: Host = { home: os.homedir(), env: process.env, platform: process.platform, exec: execProgram }

const OTHER = "Other (type your own)"
/** How long what OMP last looked at stays on show after the tool is done: a read takes milliseconds. */
const ACTIVITY_LINGER_MS = 4000

/** Told to every OMP the panel starts, on top of its own system prompt. */
export const OMP_PAIR_PROMPT =
  "You are running inside the AI Pair panel in the programmer's VS Code window, in their project folder. " +
  "They talk to you in that panel and watch their editor. When they give you a coding task, or ask you to explain code in the editor, pair with them: " +
  "call the `start` tool of the `pair` MCP server first and follow the guide it returns for the whole session. " +
  "The programmer is waiting from the moment they ask, so get going: call `start` right away, reading the pair tools' docs in that same turn if you need them, " +
  "then send a `step` with one beat, just a `say`, telling them what you'll look at first, like \"Let me look around your project first.\", and only then read their files. " +
  "While pairing, make every change to files through pair `step` actions typed in their editor; never edit, write, or delete files with your own tools or the shell. " +
  "Call the pair tools themselves, never from inside eval or other code: the panel follows those calls, and after an interrupt it shows your history only what played. " +
  "Reading and searching with your own tools to plan a step is fine. Answer a plain question that needs no code work right in the chat, without starting a session. " +
  "If the pair tools are missing, say so in the chat and ask the programmer to run AI Pair: Set Up Agent, pick OMP, and restart OMP from the panel."

export type OmpOptions = {
  launcher: string
  /** The OMP extension that cuts interrupted `step` calls down to what played, in the model's history. */
  extension: string
  /** The folder OMP works in, or undefined when no folder is open. */
  root(): string | undefined
  config(): { path: string; model: string; thinking: string }
  isPairActive(): boolean
}

export class OmpHost implements OmpPort {
  private rpc?: OmpRpc
  private current: OmpStatus = { state: "off" }
  /** The model and thinking level OMP last reported, kept across state changes while it runs. */
  private chosen: Pick<OmpStatus, "model" | "thinking" | "thinkingLevels"> = {}
  private seq = 0
  /** A reply still streaming in, by OMP's message id: the text so far. */
  private readonly streaming = new Map<string, string>()
  private readonly output = vscode.window.createOutputChannel("AI Pair OMP")
  /** Lets a finished tool's activity linger, so a quick read shows long enough to be seen. */
  private activityTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly panel: NarrationPanel,
    private readonly options: OmpOptions,
  ) {}

  status(): OmpStatus {
    return this.current
  }

  start(): void {
    void this.run().catch((error: unknown) => {
      this.setStatus({ state: "off" })
      void vscode.window.showErrorMessage(`AI Pair couldn't start OMP: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private async run(): Promise<void> {
    if (this.rpc?.running) {
      this.panel.focusReply()
      return
    }
    const root = this.options.root()
    if (!root) throw new Error("open a folder first, so OMP knows where to work.")
    const { path, model, thinking } = this.options.config()
    const command = path.trim() || findOmp(HOST)
    if (!command) {
      throw new Error("OMP wasn't found on this machine. Install OMP, or set its full path in the `aiPair.omp.path` setting.")
    }
    // Connecting feels native when it needs no hand work: give OMP the pair server before it starts,
    // so its tools are simply there. Set Up Agent does the same for a terminal OMP.
    const agent = AGENTS.find((a) => a.id === "omp")!
    if (!agent.isSetUp(HOST, this.options.launcher)) {
      const where = await agent.setUp(HOST, this.options.launcher)
      this.note(`Pair is set up in OMP (${where}).`)
    }
    this.setStatus({ state: "starting" })
    const rpc = new OmpRpc({
      onFrame: (frame) => this.onFrame(rpc, frame),
      onDialog: (frame) => this.onDialog(frame),
      onStderr: (text) => this.output.append(text),
      onExit: (code) => {
        if (this.rpc !== rpc) return
        this.rpc = undefined
        this.streaming.clear()
        this.setStatus({ state: "off" })
        this.note(code === 0 || code === null ? "OMP stopped." : `OMP stopped (code ${code}). Its own words are in the AI Pair OMP output.`)
      },
    })
    this.rpc = rpc
    const args = ["--mode", "rpc-ui", "--cwd", root]
    if (model.trim()) args.push("--model", model.trim())
    if (thinking) args.push("--thinking", thinking)
    args.push("--append-system-prompt", OMP_PAIR_PROMPT, "-e", this.options.extension)
    await rpc.start(command, args, root, process.env)
    void rpc.request("set_ask_dialog", { enabled: true }).catch(() => {})
    this.note("OMP started.")
    await this.refreshModel()
    if (this.rpc === rpc) this.setStatus({ state: rpc.streaming ? "busy" : "ready" })
  }

  stop(): void {
    const rpc = this.rpc
    if (!rpc) return
    this.rpc = undefined
    this.streaming.clear()
    rpc.dispose()
    this.setStatus({ state: "off" })
    this.note("OMP stopped.")
  }

  abort(): void {
    void this.rpc?.request("abort").catch((error: unknown) => this.note(`Couldn't stop OMP: ${error instanceof Error ? error.message : String(error)}`))
  }

  newChat(): void {
    if (this.options.isPairActive()) {
      void vscode.window.showInformationMessage("End the pair session first, then start a new OMP chat.")
      return
    }
    void this.rpc
      ?.request("new_session")
      .then(() => {
        this.streaming.clear()
        this.note("New OMP chat.")
      })
      .catch((error: unknown) => this.note(`Couldn't start a new chat: ${error instanceof Error ? error.message : String(error)}`))
  }

  pickModel(): void {
    void this.pick().catch((error: unknown) => this.note(`Couldn't change the model: ${error instanceof Error ? error.message : String(error)}`))
  }

  private async pick(): Promise<void> {
    const rpc = this.rpc
    if (!rpc) return
    const list = field(await rpc.request("get_available_models"), "models")
    const models: Array<{ provider: string; id: string; name?: string }> = []
    if (Array.isArray(list)) {
      for (const m of list) {
        const provider = field(m, "provider")
        const id = field(m, "id")
        const name = field(m, "name")
        if (typeof provider === "string" && typeof id === "string") models.push({ provider, id, ...(typeof name === "string" ? { name } : {}) })
      }
    }
    const picked = await vscode.window.showQuickPick(
      models.map((m) => ({ label: m.name || m.id, description: `${m.provider}/${m.id}`, provider: m.provider, modelId: m.id })),
      { title: "Which model should OMP use?", placeHolder: "Type to search. The chat so far goes to the new model.", matchOnDescription: true },
    )
    if (!picked) return
    await rpc.request("set_model", { provider: picked.provider, modelId: picked.modelId })
    await this.refreshModel()
  }

  setThinking(level: string): void {
    const rpc = this.rpc
    if (!rpc) return
    void rpc
      .request("set_thinking_level", { level })
      .then(() => this.refreshModel())
      .catch((error: unknown) => this.note(`Couldn't change the thinking level: ${error instanceof Error ? error.message : String(error)}`))
  }

  prompt(text: string): void {
    const rpc = this.rpc
    if (!rpc?.running) {
      this.note("OMP isn't running. Start it above, then say that again.")
      return
    }
    void rpc
      .request("prompt", { message: text, ...(rpc.streaming ? { streamingBehavior: "steer" } : {}) })
      .catch((error: unknown) => this.note(`OMP didn't take that: ${error instanceof Error ? error.message : String(error)}`))
  }

  dispose(): void {
    clearTimeout(this.activityTimer)
    this.rpc?.dispose()
    this.output.dispose()
  }

  /** Sets how OMP is doing; while it runs, its model and thinking level ride along. */
  private setStatus(status: Omit<OmpStatus, "model" | "thinking" | "thinkingLevels">): void {
    this.current = status.state === "off" ? status : { ...status, ...this.chosen }
    this.panel.showOmpStatus(this.current)
  }

  private showActivity(activity: string | undefined): void {
    clearTimeout(this.activityTimer)
    if (activity === this.current.activity || this.current.state !== "busy") return
    this.setStatus({ ...this.current, activity })
  }

  private note(text: string): void {
    this.panel.showOmpChat({ id: `note-${++this.seq}`, role: "note", text }, true)
  }

  private async refreshModel(): Promise<void> {
    const rpc = this.rpc
    if (!rpc) return
    try {
      // The levels depend on the model, so they're asked again whenever the model changes.
      const [state, levels] = await Promise.all([rpc.request("get_state"), rpc.request("get_available_thinking_levels")])
      if (this.rpc !== rpc) return
      const thinking = field(state, "thinkingLevel")
      const list = field(levels, "levels")
      this.chosen = {
        model: modelLabel(field(state, "model")),
        ...(typeof thinking === "string" ? { thinking } : {}),
        ...(Array.isArray(list) ? { thinkingLevels: list.filter((l): l is string => typeof l === "string") } : {}),
      }
      this.setStatus({ state: field(state, "isStreaming") === true ? "busy" : "ready", ...(this.current.activity ? { activity: this.current.activity } : {}) })
    } catch {
      // The next event will say how OMP is doing; a missing model label is not worth an error.
    }
  }

  private onFrame(rpc: OmpRpc, frame: OmpFrame): void {
    if (this.rpc !== rpc) return
    const pairing = this.options.isPairActive()
    switch (frame.type) {
      case "agent_start":
        this.setStatus({ state: "busy" })
        return
      case "agent_end":
      case "session_settled":
        clearTimeout(this.activityTimer)
        if (this.current.state !== "off") this.setStatus({ state: "ready" })
        return
      case "model_changed":
      case "thinking_level_changed":
        void this.refreshModel()
        return
      case "prompt_result": {
        if (frame.status === "error") {
          const message = field(frame.error, "message")
          this.note(`OMP hit a snag: ${typeof message === "string" ? message : "the turn failed."}`)
        } else if (frame.status === "aborted") {
          this.note("OMP stopped that turn.")
        }
        return
      }
      case "message_update": {
        // While pairing, the narration is OMP's voice; its raw replies would say it all twice.
        if (pairing) return
        const delta = field(frame.assistantMessageEvent, "delta")
        if (field(frame.assistantMessageEvent, "type") !== "text_delta" || typeof delta !== "string" || typeof frame.messageId !== "string") return
        const text = (this.streaming.get(frame.messageId) ?? "") + delta
        this.streaming.set(frame.messageId, text)
        if (text.trim()) this.panel.showOmpChat({ id: frame.messageId, role: "assistant", text }, false)
        return
      }
      case "message_end": {
        if (typeof frame.messageId === "string") this.streaming.delete(frame.messageId)
        if (pairing) return
        if (field(frame.message, "role") !== "assistant" || typeof frame.messageId !== "string") return
        const text = messageText(frame.message)
        if (text.trim()) this.panel.showOmpChat({ id: frame.messageId, role: "assistant", text }, true)
        return
      }
      case "tool_execution_start": {
        if (typeof frame.toolName !== "string") return
        const where = field(frame.args, "path")
        const command = field(frame.args, "command")
        const about = typeof where === "string" ? where : typeof command === "string" ? command : ""
        // The pair tools show themselves in the editor; anything else is OMP looking around, and
        // the panel says so, in OMP's own words when it gave some.
        const pairTool = /^(xd:\/\/)?mcp__pair_/.test(about) || frame.toolName.startsWith("mcp__pair_")
        const doing = typeof frame.intent === "string" && frame.intent ? frame.intent : `${frame.toolName}${about ? ` ${about.slice(0, 60)}` : ""}`
        this.showActivity(pairTool ? undefined : doing)
        if (pairing) return
        const id = typeof frame.toolCallId === "string" ? frame.toolCallId : `tool-${++this.seq}`
        this.panel.showOmpChat({ id, role: "tool", text: `▸ ${frame.toolName}${about ? ` ${about.slice(0, 80)}` : ""}` }, true)
        return
      }
      case "tool_execution_end": {
        clearTimeout(this.activityTimer)
        if (this.current.activity) this.activityTimer = setTimeout(() => this.showActivity(undefined), ACTIVITY_LINGER_MS)
        return
      }
      case "notice": {
        if (typeof frame.message === "string" && (frame.level === "error" || frame.level === "warn")) this.note(frame.message)
        return
      }
      case "extension_error": {
        if (typeof frame.error === "string") this.note(`An OMP add-on hit a snag: ${frame.error}`)
        return
      }
      case "command_output": {
        const text =
          typeof frame.text === "string" ? frame.text : typeof frame.message === "string" ? frame.message : typeof frame.output === "string" ? frame.output : ""
        if (text.trim()) this.panel.showOmpChat({ id: `cmd-${++this.seq}`, role: "assistant", text }, true)
        return
      }
      case "extension_ui_request": {
        // Dialogs never arrive here; these are the fire-and-forget kinds.
        if (frame.method === "notify" && typeof frame.message === "string") this.note(frame.message)
        else if (frame.method === "set_editor_text" && typeof frame.text === "string") this.panel.showDraft(frame.text)
        else if (frame.method === "open_url") {
          const url = typeof frame.launchUrl === "string" ? frame.launchUrl : typeof frame.url === "string" ? frame.url : undefined
          if (url && /^https?:\/\//.test(url)) void vscode.env.openExternal(vscode.Uri.parse(url))
        }
        return
      }
      default:
        return
    }
  }

  private async onDialog(frame: OmpFrame): Promise<OmpUiAnswer | undefined> {
    const title = typeof frame.title === "string" ? frame.title : undefined
    switch (frame.method) {
      case "select": {
        const options = Array.isArray(frame.options) ? frame.options.filter((o): o is string => typeof o === "string") : []
        const details = Array.isArray(frame.optionDetails) ? frame.optionDetails : []
        const picked = await vscode.window.showQuickPick(
          options.map((label, i) => {
            const description = field(details[i], "description")
            return { label, description: typeof description === "string" ? description : undefined }
          }),
          { title, placeHolder: title ?? "OMP asks…", ignoreFocusOut: true },
        )
        return picked ? { value: picked.label } : { cancelled: true }
      }
      case "confirm": {
        const message = typeof frame.message === "string" ? frame.message : "Continue?"
        const picked = await vscode.window.showInformationMessage(message, { modal: true, detail: title }, "Yes", "No")
        return { confirmed: picked === "Yes" }
      }
      case "input":
      case "editor": {
        const value = typeof frame.prefill === "string" ? frame.prefill : typeof frame.initialValue === "string" ? frame.initialValue : undefined
        const typed = await vscode.window.showInputBox({
          title,
          prompt: title ?? "OMP asks…",
          placeHolder: typeof frame.placeholder === "string" ? frame.placeholder : undefined,
          value,
          ignoreFocusOut: true,
        })
        return typed === undefined ? { cancelled: true } : { value: typed }
      }
      case "ask": {
        const questions = Array.isArray(frame.questions) ? frame.questions : []
        const answers: Array<{ id: string; selectedOptions: string[]; customInput?: string }> = []
        for (const raw of questions) {
          const id = field(raw, "id")
          if (typeof id !== "string") return { cancelled: true }
          const question = field(raw, "question")
          const recommended = field(raw, "recommended")
          const options = field(raw, "options")
          const items: Array<{ label: string; description?: string; detail?: string }> = []
          if (Array.isArray(options)) {
            options.forEach((option, i) => {
              const label = field(option, "label")
              if (typeof label !== "string") return
              const description = field(option, "description")
              const preview = field(option, "preview")
              items.push({
                label,
                description: [typeof description === "string" ? description : "", recommended === i ? "(Recommended)" : ""].filter(Boolean).join(" ") || undefined,
                detail: typeof preview === "string" ? preview : undefined,
              })
            })
          }
          items.push({ label: OTHER, description: undefined, detail: undefined })
          const picked = await vscode.window.showQuickPick(items, {
            title: typeof question === "string" ? question : "OMP asks…",
            canPickMany: field(raw, "multi") === true,
            ignoreFocusOut: true,
          })
          if (picked === undefined) return { cancelled: true }
          const chosen = (Array.isArray(picked) ? picked : [picked]).map((p) => p.label)
          const answer: { id: string; selectedOptions: string[]; customInput?: string } = {
            id,
            selectedOptions: chosen.filter((label) => label !== OTHER),
          }
          if (chosen.includes(OTHER)) {
            const typed = await vscode.window.showInputBox({
              prompt: typeof question === "string" ? question : "Your answer",
              ignoreFocusOut: true,
            })
            if (typed === undefined) return { cancelled: true }
            if (typed.trim()) answer.customInput = typed.trim()
          }
          answers.push(answer)
        }
        return { answers }
      }
      default:
        return { cancelled: true }
    }
  }
}
