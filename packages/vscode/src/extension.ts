import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { Bridge, Controller } from "@ai-pair/core"
import { discoveryDir } from "@ai-pair/protocol"
import { playDemo } from "./demo"
import { VsCodeEditor } from "./editor"
import { NarrationPanel } from "./panel"
import { OmpHost } from "./omp"
import { registerServerProvider, setUpAgent, writeLauncher } from "./setup"
import { VoiceEngine, type VoiceModel } from "./voice"

/** The switches whose recordings ship in media/keys, one folder each, as the picker names them. */
const SWITCHES: Record<string, { label: string; detail: string }> = {
  holypanda: { label: "Holy Panda", detail: "Tactile: a deep, rounded thock" },
  cream: { label: "NovelKeys Cream", detail: "Linear: smooth and creamy" },
  alpaca: { label: "Alpaca", detail: "Linear: soft and quiet, a light clack" },
  mxbrown: { label: "Cherry MX Brown", detail: "Tactile: the classic office board" },
  topre: { label: "Topre", detail: "Rubber dome: muted and cushioned" },
  buckling: { label: "Buckling Spring", detail: "IBM Model M: loud, crisp, old-school" },
}

/** Returned from `activate`, for integration tests. */
export type Api = { controller: Controller; playDemo: () => Promise<void>; launcher: string; ready: Promise<void>; omp: OmpHost }

export function activate(context: vscode.ExtensionContext): Api {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
  const config = () => vscode.workspace.getConfiguration("aiPair")

  const editor = new VsCodeEditor(root, config().get("agentName", "Agent"))
  const speed = {
    get: () => config().get("speed", 1),
    set: (value: number) => void config().update("speed", value, vscode.ConfigurationTarget.Global),
  }
  const panel = new NarrationPanel((file) => editor.resolvePath(file), speed, {
    current: () => editor.programmerSelection(),
    ref: () => editor.selectionRef(),
  })
  const controller = new Controller(editor, panel)
  editor.controller = controller
  editor.onSelection = (ref) => panel.showSelection(ref)
  panel.controller = controller
  controller.setSpeed(speed.get())
  controller.setTiming(config().get("timing", {}))
  controller.setConfirmCommands(config().get("confirmCommands", true))
  controller.setWorkAhead(config().get("workAheadBatches", 2))

  const bridge = new Bridge(controller, {
    dir: discoveryDir(),
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
  })
  const ready = bridge.start()
  ready.catch((e: unknown) => void vscode.window.showErrorMessage(`AI Pair couldn't start its local server: ${String(e)}`))
  const launcher = writeLauncher(context.extensionPath)
  const omp = new OmpHost(panel, {
    launcher,
    extension: path.join(context.extensionPath, "dist", "ompExtension.js"),
    root: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    config: () => ({ path: config().get("omp.path", ""), model: config().get("omp.model", ""), thinking: config().get("omp.thinking", "") }),
    isPairActive: () => controller.isActive,
  })
  panel.omp = omp
  const voice = new VoiceEngine(panel, {
    extensionPath: context.extensionPath,
    config: () => ({
      enabled: config().get("voice.enabled", false),
      model: config().get<VoiceModel>("voice.model", "kokoro"),
      voice: config().get("voice.voice", "af_heart"),
      chatterboxVoice: config().get("voice.chatterboxVoice", ""),
      rate: config().get("voice.rate", 1),
      pace: speed.get(),
      runtimePath: config().get("voice.runtimePath", ""),
      ompPath: config().get("omp.path", ""),
    }),
    setEnabled: (on) => void config().update("voice.enabled", on, vscode.ConfigurationTarget.Global),
    setVoice: async (model, voice) => {
      const global = vscode.ConfigurationTarget.Global
      await config().update(model === "kokoro" ? "voice.voice" : "voice.chatterboxVoice", voice, global)
      await config().update("voice.model", model, global)
    },
  })
  panel.voice = voice
  controller.setVoice(voice)
  if (config().get("voice.enabled", false)) voice.setEnabled(true)
  const typingSounds = () => {
    const chosen = config().get("typingSounds.switch", "holypanda")
    const key = chosen in SWITCHES ? chosen : "holypanda"
    return {
      enabled: config().get("typingSounds.enabled", false),
      volume: Math.min(1, Math.max(0, config().get("typingSounds.volume", 0.5))),
      sounds: vscode.Uri.joinPath(context.extensionUri, "media", "keys", key),
      name: SWITCHES[key]!.label,
    }
  }
  // Each switch is heard as the list moves to it, so it is chosen by ear.
  const pickSwitch = async () => {
    const current = config().get("typingSounds.switch", "holypanda")
    const items = Object.entries(SWITCHES).map(([id, s]) => ({ id, label: s.label, description: id === current ? "current" : "", detail: s.detail }))
    const quick = vscode.window.createQuickPick<(typeof items)[number]>()
    quick.items = items
    quick.placeholder = "Choose the keyboard switch you hear the agent type on (each plays as you move to it)"
    quick.onDidChangeActive(([item]) => {
      if (item) panel.previewTypingSound(vscode.Uri.joinPath(context.extensionUri, "media", "keys", item.id))
    })
    // No Promise.withResolvers: the extension still runs on VS Code builds with Node 20.
    const picked = await new Promise<string | undefined>((resolve) => {
      quick.onDidAccept(() => resolve(quick.selectedItems[0]?.id))
      quick.onDidHide(() => resolve(undefined))
      quick.show()
      // Set once shown, so the current switch is the first one heard.
      quick.activeItems = items.filter((i) => i.id === current)
    })
    quick.dispose()
    if (!picked) return
    const global = vscode.ConfigurationTarget.Global
    await config().update("typingSounds.switch", picked, global)
    // Choosing a switch is asking to hear it.
    if (!config().get("typingSounds.enabled", false)) await config().update("typingSounds.enabled", true, global)
  }
  panel.showTypingSounds(typingSounds())
  controller.setKeys(panel)
  registerServerProvider(context)

  context.subscriptions.push(
    { dispose: () => bridge.dispose() },
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) bridge.focused()
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => bridge.writeDiscovery()),
    vscode.commands.registerCommand("aiPair.setUpAgent", () => setUpAgent(launcher)),
    vscode.commands.registerCommand("aiPair.startOmp", () => omp.start()),
    vscode.commands.registerCommand("aiPair.stopOmp", () => omp.stop()),
    vscode.commands.registerCommand("aiPair.abortOmp", () => omp.abort()),
    vscode.commands.registerCommand("aiPair.newOmpChat", () => omp.newChat()),
    vscode.commands.registerCommand("aiPair.selectOmpModel", () => omp.pickModel()),
    vscode.commands.registerCommand("aiPair.toggleVoice", () => voice.toggle()),
    vscode.commands.registerCommand("aiPair.selectVoice", () => voice.pickVoice()),
    vscode.commands.registerCommand("aiPair.toggleTypingSounds", () =>
      config().update("typingSounds.enabled", !typingSounds().enabled, vscode.ConfigurationTarget.Global),
    ),
    vscode.commands.registerCommand("aiPair.selectTypingSound", pickSwitch),
    omp,
    voice,
    editor,
    vscode.window.registerWebviewViewProvider(NarrationPanel.viewId, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aiPair.speed")) {
        controller.setSpeed(speed.get())
        panel.showSpeed(speed.get())
      }
      if (e.affectsConfiguration("aiPair.timing")) controller.setTiming(config().get("timing", {}))
      if (e.affectsConfiguration("aiPair.agentName")) editor.setAgentName(config().get("agentName", "Agent"))
      if (e.affectsConfiguration("aiPair.confirmCommands")) {
        controller.setConfirmCommands(config().get("confirmCommands", true))
      }
      if (e.affectsConfiguration("aiPair.workAheadBatches")) controller.setWorkAhead(config().get("workAheadBatches", 2))
      if (e.affectsConfiguration("aiPair.voice.enabled")) voice.setEnabled(config().get("voice.enabled", false), true)
      if (e.affectsConfiguration("aiPair.voice.model")) voice.followModel(true)
      if (e.affectsConfiguration("aiPair.voice.voice") || e.affectsConfiguration("aiPair.voice.chatterboxVoice")) panel.showVoiceStatus(voice.status())
      if (e.affectsConfiguration("aiPair.typingSounds")) panel.showTypingSounds(typingSounds())
    }),
    vscode.commands.registerCommand("aiPair.playDemo", () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showErrorMessage("Open a folder first: the demo creates files in ai-pair-demo/.")
        return
      }
      void playDemo(controller, root)
    }),
    vscode.commands.registerCommand("aiPair.togglePause", () => {
      if (controller.isPaused) controller.resume()
      else controller.pause()
    }),
    vscode.commands.registerCommand("aiPair.interrupt", () => controller.userInterrupt()),
    vscode.commands.registerCommand("aiPair.toggleTurn", () => {
      if (controller.turn === "user") controller.handBack()
      else controller.takeTurn()
    }),
    vscode.commands.registerCommand("aiPair.endSession", () => controller.endSession()),
    vscode.commands.registerCommand("aiPair.focusReply", () => panel.focusReply()),
    vscode.commands.registerCommand("aiPair.askAboutSelection", () => panel.focusReply()),
    { dispose: () => controller.disconnect() },
  )
  if (!context.globalState.get("aiPair.offeredSetup")) {
    void context.globalState.update("aiPair.offeredSetup", true)
    void vscode.window
      .showInformationMessage("AI Pair is installed. Connect it to your agent?", "Set Up Agent")
      .then((answer) => answer && setUpAgent(launcher))
  }

  return { controller, playDemo: () => playDemo(controller, root), launcher, ready, omp }
}

export function deactivate(): void {}
