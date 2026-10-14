// The narration panel: a webview view in the secondary side bar. See "Narration panel" in DESIGN.md.

import * as vscode from "vscode"
import type { Controller, KeysPort, PanelEvent, PanelPort, Ref, SharedSelection } from "@ai-pair/core"
import { panelHtml } from "./panelHtml"

/**
 * How the built-in OMP conversation is doing, as the panel shows it. `activity`: what OMP is doing
 * with its own tools right now, like reading a file, in its own words. `thinking`: how hard the
 * model thinks, one of `thinkingLevels`, the levels the model offers.
 */
export type OmpStatus = {
  state: "off" | "starting" | "ready" | "busy"
  model?: string
  thinking?: string
  thinkingLevels?: string[]
  detail?: string
  activity?: string
}

/** One line of the OMP conversation in the panel's history. `id` ties a reply's updates together. */
export type OmpChat = { id: string; role: "assistant" | "note" | "tool"; text: string }

/** What the panel asks of the built-in OMP conversation, when there is one. */
export type OmpPort = {
  start(): void
  stop(): void
  abort(): void
  newChat(): void
  pickModel(): void
  setThinking(level: string): void
  prompt(text: string): void
  status(): OmpStatus
}

/** How the voice is doing, as the panel shows it. `ready` is when words are actually spoken. */
export type VoiceStatus = { enabled: boolean; state: "off" | "loading" | "ready" | "error"; voice: string; detail?: string }

/** What the panel asks of the voice. */
export type VoicePanelPort = {
  toggle(): void
  pickVoice(): void
  status(): VoiceStatus
}

/** The typing sounds' settings, as the panel plays them. `sounds`: the folder of the switch's recordings; `name`: the switch's. */
export type TypingSounds = { enabled: boolean; volume: number; sounds: vscode.Uri; name: string }

/** Messages from the webview. */
type FromPanel =
  | { type: "ready" }
  | { type: "reply"; text: string; attach?: boolean }
  | { type: "draft"; empty: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "interrupt" }
  | { type: "turn"; message?: string; attach?: boolean }
  | { type: "end" }
  | { type: "open"; file: string; line: number }
  /** A file named in a message: a path, or just its name. */
  | { type: "openFile"; file: string }
  | { type: "openUrl"; url: string }
  /** A command the intro offers, like Set Up Agent. */
  | { type: "command"; command: string }
  | { type: "speed"; value: number }
  | { type: "runDecision"; id: number; run: boolean; allow?: "program" | "all" }
  | { type: "ompStart" }
  | { type: "ompStop" }
  | { type: "ompAbort" }
  | { type: "ompNew" }
  | { type: "ompModel" }
  | { type: "ompThinking"; level: string }
  | { type: "voiceToggle" }
  | { type: "voicePick" }
  | { type: "typingSoundsToggle" }
  | { type: "typingSoundPick" }

const MAX_LOG = 400

/** The commands the panel may run: the ones its intro links to. */
const PANEL_COMMANDS: ReadonlySet<string> = new Set(["aiPair.playDemo", "aiPair.setUpAgent", "aiPair.startOmp"])

/** Everything the panel replays when its view is (re)created: pair events and finished OMP lines, in order. */
type Logged = PanelEvent | ({ type: "ompChat" } & OmpChat)
export class NarrationPanel implements PanelPort, KeysPort, vscode.WebviewViewProvider {
  static readonly viewId = "aiPair.narration"
  controller?: Controller
  omp?: OmpPort
  voice?: VoicePanelPort
  private view?: vscode.WebviewView
  /** Everything posted so far, replayed when the view is (re)created. */
  private readonly log: Logged[] = []
  private ompStatus: OmpStatus = { state: "off" }
  private voiceStatus: VoiceStatus = { enabled: false, state: "off", voice: "af_heart" }
  private typingSounds?: TypingSounds

  constructor(
    private readonly resolvePath: (file: string) => string,
    private readonly speed: { get: () => number; set: (value: number) => void },
    private readonly selection: { current: () => SharedSelection | undefined; ref: () => Ref | undefined },
  ) {}

  /** The programmer's selection changed. Not logged: only the current one matters. */
  showSelection(ref: Ref | undefined): void {
    void this.view?.webview.postMessage({ type: "selection", ref })
  }

  /** The speed setting changed. Not logged: only the current value matters. */
  showSpeed(value: number): void {
    void this.view?.webview.postMessage({ type: "speed", value })
  }

  /** The built-in OMP conversation started, stopped, or changed its mind. Not logged: only now matters. */
  showOmpStatus(status: OmpStatus): void {
    this.ompStatus = status
    void vscode.commands.executeCommand("setContext", "aiPair.ompActive", status.state !== "off")
    void this.view?.webview.postMessage({ type: "ompState", ...status })
  }

  /** The voice was turned on or off, loaded, or failed. Not logged: only now matters. */
  showVoiceStatus(status: VoiceStatus): void {
    this.voiceStatus = status
    void vscode.commands.executeCommand("setContext", "aiPair.voiceOn", status.enabled)
    void this.view?.webview.postMessage({ type: "voiceState", ...status })
  }

  /** The voice started or stopped sounding: the typing sounds step back while it does. Not logged. */
  showSpeaking(speaking: boolean): void {
    void this.view?.webview.postMessage({ type: "speaking", speaking })
  }

  /** The typing sounds were turned on or off, louder or softer, or another switch. Not logged: only now matters. */
  showTypingSounds(sounds: TypingSounds): void {
    this.typingSounds = sounds
    const webview = this.view?.webview
    if (!webview) return
    const { enabled, volume, name } = sounds
    void webview.postMessage({ type: "typingSounds", enabled, volume, name, sounds: webview.asWebviewUri(sounds.sounds).toString() })
  }

  /** Plays a few words typed on the switch recorded in `sounds`, on or off, so it can be chosen by ear. */
  previewTypingSound(sounds: vscode.Uri): void {
    const webview = this.view?.webview
    if (webview) void webview.postMessage({ type: "keysPreview", sounds: webview.asWebviewUri(sounds).toString() })
  }

  /** A keystroke of the agent's landed: the page plays it, when typing sounds are on. Not logged. */
  press(text: string): void {
    if (this.typingSounds?.enabled) void this.view?.webview.postMessage({ type: "key", text })
  }

  /**
   * One line of the OMP conversation. While a reply is still coming in (`done` false) it only
   * updates the live view; the finished line is what a recreated view replays.
   */
  showOmpChat(chat: OmpChat, done: boolean): void {
    const event: Logged = { type: "ompChat", ...chat }
    if (done) {
      const at = this.log.findIndex((e) => e.type === "ompChat" && e.id === chat.id)
      if (at >= 0) this.log[at] = event
      else {
        this.log.push(event)
        if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG)
      }
    }
    void this.view?.webview.postMessage(event)
  }

  /** Puts words in the reply box, as OMP's `set_editor_text` asks. */
  showDraft(text: string): void {
    void this.view?.webview.postMessage({ type: "ompDraft", text })
  }

  post(event: PanelEvent): void {
    this.log.push(event)
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG)
    void this.view?.webview.postMessage(event)
    if (event.type === "session") {
      void vscode.commands.executeCommand("setContext", "aiPair.active", event.active)
      if (event.active) this.reveal()
    }
    // Nothing plays until the programmer answers, so the question is brought into view.
    if (event.type === "run" && event.phase === "confirm") this.reveal()
  }

  focusReply(): void {
    this.reveal(false)
    void this.view?.webview.postMessage({ type: "focusReply" })
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = panelHtml(view.webview.cspSource)
    view.webview.onDidReceiveMessage((m: FromPanel) => this.receive(m))
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
    })
  }

  private reveal(preserveFocus = true): void {
    if (this.view) this.view.show(preserveFocus)
    else void vscode.commands.executeCommand(`${NarrationPanel.viewId}.focus`)
  }

  private receive(m: FromPanel): void {
    const c = this.controller
    switch (m.type) {
      case "ready":
        void this.view?.webview.postMessage({ type: "replay", events: this.log })
        this.showSpeed(this.speed.get())
        this.showSelection(this.selection.ref())
        this.showOmpStatus(this.omp?.status() ?? this.ompStatus)
        this.showVoiceStatus(this.voice?.status() ?? this.voiceStatus)
        if (this.typingSounds) this.showTypingSounds(this.typingSounds)
        return
      case "speed":
        this.speed.set(m.value)
        return
      case "reply": {
        // In a pair session the reply belongs to the session, whoever the agent is. Outside one,
        // it is a prompt for the built-in OMP conversation.
        if (c?.isActive) {
          // Replying means "go on with this", so any pause ends.
          c.resume()
          c.userMessage(m.text, m.attach ? this.selection.current() : undefined)
          return
        }
        const omp = this.omp
        if (!omp || omp.status().state === "off") return
        const selection = m.attach ? this.selection.current() : undefined
        this.post({ type: "user", text: m.text, ref: selection && this.selection.ref() })
        omp.prompt(
          selection
            ? `${m.text}\n\nAbout this code in ${selection.file} (lines ${selection.from.line}–${selection.to.line}):\n\n${selection.text}`
            : m.text,
        )
        return
      }
      case "ompStart":
        this.omp?.start()
        return
      case "ompStop":
        this.omp?.stop()
        return
      case "ompAbort":
        this.omp?.abort()
        return
      case "ompNew":
        this.omp?.newChat()
        return
      case "ompModel":
        this.omp?.pickModel()
        return
      case "ompThinking":
        this.omp?.setThinking(m.level)
        return
      case "voiceToggle":
        this.voice?.toggle()
        return
      case "voicePick":
        this.voice?.pickVoice()
        return
      case "typingSoundsToggle":
        void vscode.commands.executeCommand("aiPair.toggleTypingSounds")
        return
      case "typingSoundPick":
        void vscode.commands.executeCommand("aiPair.selectTypingSound")
        return
      case "draft":
        // Typing a reply pauses playback, the way a pair stops when you start talking.
        if (!c?.isActive) return
        if (m.empty) c.resume("reply")
        else c.pause("reply")
        return
      case "pause":
        c?.pause()
        return
      case "resume":
        c?.resume()
        return
      case "interrupt":
        c?.userInterrupt()
        return
      case "turn":
        c?.resume()
        if (c?.turn === "user") c.handBack(m.message, m.attach ? this.selection.current() : undefined)
        else c?.takeTurn()
        return
      case "end":
        c?.endSession()
        return
      case "runDecision":
        c?.decideRun(m.id, m.run, m.allow)
        return
      case "open": {
        const uri = vscode.Uri.file(this.resolvePath(m.file))
        const position = new vscode.Position(Math.max(0, m.line - 1), 0)
        void vscode.window.showTextDocument(uri, { selection: new vscode.Range(position, position) })
        return
      }
      case "openFile":
        void this.openByName(m.file)
        return
      case "command":
        if (PANEL_COMMANDS.has(m.command)) void vscode.commands.executeCommand(m.command)
        return
      case "openUrl":
        if (/^https?:\/\//.test(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url))
        return
    }
  }

  /** Opens a file the agent named: as a path in the workspace, else the file of that name, asking if there are several. */
  private async openByName(name: string): Promise<void> {
    const direct = vscode.Uri.file(this.resolvePath(name))
    try {
      await vscode.workspace.fs.stat(direct)
      await vscode.window.showTextDocument(direct)
      return
    } catch {
      // Not a path from the workspace's root: look for it by name.
    }
    const found = await vscode.workspace.findFiles(`**/${name}`, "**/node_modules/**", 20)
    if (found.length === 0) {
      void vscode.window.showInformationMessage(`AI Pair: couldn't find ${name} in the workspace.`)
      return
    }
    let uri = found[0]!
    if (found.length > 1) {
      const picked = await vscode.window.showQuickPick(
        found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })),
        { placeHolder: `Which ${name}?` },
      )
      if (!picked) return
      uri = picked.uri
    }
    await vscode.window.showTextDocument(uri)
  }
}
