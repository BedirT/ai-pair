import * as os from "node:os"
import * as vscode from "vscode"
import { Bridge, Controller } from "@ai-pair/core"
import { discoveryDir } from "@ai-pair/protocol"
import { playDemo } from "./demo"
import { VsCodeEditor } from "./editor"
import { NarrationPanel } from "./panel"
import { OmpHost } from "./omp"
import { registerServerProvider, setUpAgent, writeLauncher } from "./setup"
import { VoiceEngine } from "./voice"
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

  const bridge = new Bridge(controller, {
    dir: discoveryDir(),
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
  })
  const ready = bridge.start()
  ready.catch((e: unknown) => void vscode.window.showErrorMessage(`AI Pair couldn't start its local server: ${String(e)}`))
  const launcher = writeLauncher(context.extensionPath)
  const omp = new OmpHost(panel, {
    launcher,
    root: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    config: () => ({ path: config().get("omp.path", ""), model: config().get("omp.model", "") }),
    isPairActive: () => controller.isActive,
  })
  panel.omp = omp
  const voice = new VoiceEngine(panel, {
    extensionPath: context.extensionPath,
    config: () => ({
      enabled: config().get("voice.enabled", false),
      voice: config().get("voice.voice", "af_heart"),
      rate: config().get("voice.rate", 1),
      runtimePath: config().get("voice.runtimePath", ""),
      ompPath: config().get("omp.path", ""),
    }),
    setEnabled: (on) => void config().update("voice.enabled", on, vscode.ConfigurationTarget.Global),
    setVoice: (id) => void config().update("voice.voice", id, vscode.ConfigurationTarget.Global),
  })
  panel.voice = voice
  controller.setVoice(voice)
  if (config().get("voice.enabled", false)) voice.setEnabled(true)
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
      if (e.affectsConfiguration("aiPair.voice.enabled")) voice.setEnabled(config().get("voice.enabled", false), true)
      if (e.affectsConfiguration("aiPair.voice.voice")) panel.showVoiceStatus(voice.status())
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
