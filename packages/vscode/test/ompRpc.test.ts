// The OMP RPC client against a script that speaks the same JSON lines, including a dialog
// round trip and a v2 chunked frame.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, it } from "vitest"
import { field, messageText, modelLabel, OmpRpc, type OmpFrame } from "../src/ompRpc"

const FAKE_OMP = `
const rl = require("node:readline").createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n")
const chunked = (o) => {
  const bytes = Buffer.from(JSON.stringify(o), "utf8")
  const third = Math.ceil(bytes.length / 3)
  for (let i = 0; i < 3; i++) {
    send({ type: "rpc_chunk", chunkId: "c1", index: i, count: 3, byteLength: bytes.length, data: bytes.subarray(i * third, (i + 1) * third).toString("base64") })
  }
}
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576 })
rl.on("line", (line) => {
  const m = JSON.parse(line)
  if (m.type === "extension_ui_response") {
    send({ type: "ui_got", value: m.value })
    chunked({ type: "message_update", messageId: "m1", assistantMessageEvent: { type: "text_delta", delta: "chunked hello" } })
    send({ type: "message_end", messageId: "m1", message: { role: "assistant", content: [{ type: "text", text: "chunked hello" }] } })
    send({ type: "agent_end", messages: [], yielded: true })
    return
  }
  switch (m.type) {
    case "negotiate_protocol":
      send({ id: m.id, type: "response", command: m.type, success: true, data: { protocolVersion: 2 } })
      break
    case "get_state":
      send({ id: m.id, type: "response", command: m.type, success: true, data: { model: { provider: "prov", id: "mod" }, isStreaming: false } })
      break
    case "prompt":
      send({ id: m.id, type: "response", command: m.type, success: true })
      send({ type: "agent_start" })
      send({ type: "extension_ui_request", id: "ui-1", method: "select", title: "Pick", options: ["a", "b"] })
      break
    default:
      send({ id: m.id, type: "response", command: m.type, success: false, error: "no such command" })
  }
})
`

it("talks to OMP: requests, events, a dialog, and a chunked frame", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-pair-omp-"))
  const script = path.join(dir, "fake-omp.cjs")
  fs.writeFileSync(script, FAKE_OMP)
  const frames: OmpFrame[] = []
  const dialogs: OmpFrame[] = []
  // Await the client's own events, not a guessed wait. No Promise.withResolvers: tests run on Node 20 too.
  let endTurn!: () => void
  let exitNow!: () => void
  const ended = new Promise<void>((resolve) => (endTurn = resolve))
  const exited = new Promise<void>((resolve) => (exitNow = resolve))
  const rpc = new OmpRpc({
    onFrame: (frame) => {
      frames.push(frame)
      if (frame.type === "agent_end") endTurn()
    },
    onDialog: async (frame) => {
      dialogs.push(frame)
      return { value: "b" }
    },
    onExit: () => exitNow(),
  })
  await rpc.start(process.execPath, [script], dir, process.env)
  expect(rpc.running).toBe(true)

  const state = await rpc.request("get_state")
  expect(modelLabel(field(state, "model"))).toBe("prov/mod")
  await expect(rpc.request("no_such")).rejects.toThrow("no such command")

  await rpc.request("prompt", { message: "hi" })
  await ended
  expect(dialogs.map((d) => d.method)).toEqual(["select"])
  expect(frames.find((f) => f.type === "ui_got")?.value).toBe("b")
  const update = frames.find((f) => f.type === "message_update")
  expect(field(update?.assistantMessageEvent, "delta")).toBe("chunked hello")
  const end = frames.find((f) => f.type === "message_end")
  expect(messageText(end?.message)).toBe("chunked hello")
  expect(rpc.streaming).toBe(false)

  rpc.dispose()
  await exited
  expect(rpc.running).toBe(false)
})
