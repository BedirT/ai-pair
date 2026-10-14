# <img src="packages/vscode/media/icon.png" alt="" width="40" align="top"> AI Pair Programmer

**[Install it from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=michalstrba.ai-pair)**

## For those of us who want, need, or love to stay close to the code

> A **mirror neuron** is a neuron that fires both when an animal acts and when
> the animal observes the same action performed by another.
>
> — [Wikipedia](https://en.wikipedia.org/wiki/Mirror_neuron)

**Be there for every keystroke**

![The agent explains the update method in the Pair panel, then types it in the editor](media/every-keystroke.gif)

Some of us, at least some of the time, want to understand our code at a deep
level. For that, handing a task to an agent and reviewing the diff that comes
back can be exhausting. With _AI Pair Programmer_, you're there for every
keystroke instead, and you end up knowing the code almost as if you'd typed it
yourself.

It's pair programming where your coding agent has the keyboard. It types in
your editor slowly enough to follow and explains what it's doing. Interrupt it
whenever you like, or take over and let it watch you for a change.

**Interrupt and steer**

![The programmer asks the agent to fix its imports, and it adds them at the top of the file](media/interrupt-and-steer.gif)

**Watch it change its mind in real time**

![The agent writes a comment, reconsiders, deletes it, and documents the type differently](media/change-its-mind.gif)

It's also a good way to learn a new technology, or to have the agent walk you
through code you don't know yet.

**Ask it to explain code line by line**

![The agent walks through a function line by line, highlighting each line and explaining it in the Pair panel](media/explain-line-by-line.gif)

It works in VS Code. With [OMP](https://omp.sh) it needs no terminal at all:
**Start OMP** in the Pair panel and talk to it right there. Setup is also built
in for Claude Code, Codex, OpenCode, Gemini CLI, Cursor and GitHub Copilot,
and any agent that supports MCP can be connected by hand.

**Note:** It works best with strong models; weaker ones tend to struggle with
this way of working.

## How to use it

Once the extension is [installed](#install), the easy way is OMP in the panel:

1. Open the project in VS Code and open the **Pair** panel.
2. Press **Start OMP**. The first time, it also gives OMP the pair server, so
   there is nothing to set up by hand.
3. Say what to do in the panel: _"Add a settings page. I'm new to Svelte,
   explain as you go."_ For code work, OMP starts a pair session and types in
   your editor; a plain question it answers in the panel. The model pill
   under OMP's name picks the model, the chip beside it how hard it thinks
   (lower means shorter waits between batches), **+** starts a new chat,
   **■** (shown while it works) halts a turn, and the power button turns OMP
   off.

With any other agent, [connect it](#connect-your-agent) once, keep using it as
usual, and when you want to pair:

1. Open the project in VS Code, and start your agent **in the same folder** (or
   a subfolder of it).
2. Ask it to pair: _"Let's pair on adding a settings page."_ In Claude Code,
   you can also run `/mcp__pair__start`. If you want to learn the technology
   too, say so: _"…I'm new to Svelte, explain as you go."_
3. The **Pair** panel opens in the secondary side bar, and the agent's cursor
   appears in your editor.

Anything you say or edit interrupts the agent, so its next move takes it into
account. While you pair:

| To…                        | Do this                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| say something to the agent | type in the reply box, press Enter. Typing pauses playback.                                                                                  |
| ask about some code        | select it in the editor, then reply: the selection goes along (× leaves it out)                                                              |
| let it run a command       | the agent's tests and builds play in an _AI Pair_ terminal; **Run**, **Allow _npm_** (that program), **Allow all**, or **Skip** in the panel |
| stop it right now          | **Interrupt**, or just edit the code: any edit interrupts                                                                                    |
| look around                | scroll or switch files. Playback pauses until you **Resume**, which brings you back to the agent's cursor                                    |
| write a part yourself      | **My turn**. The agent becomes the navigator and comments as you type. **Hand back** returns the turn, with your reply if you typed one      |
| change the pace            | the speed menu (**1.0×**), from 0.4× to 3.0×. The voice speeds up with it, up to 2×                                                          |
| hear it, not read it       | turn **Voice** on in the panel. It talks while it types, so your eyes stay on the code; the words still land in the history                  |
| hear it type               | turn **Key sounds** on. Its keystrokes sound like a mechanical keyboard, kept well under the voice; the arrow beside it picks the keyboard   |
| finish                     | **End**, or tell the agent you're done. You can pair again anytime                                                                           |

The cursor's color tells you what the agent is doing. It's yellow and pulsing
when it's just said something and is waiting for you to read it — or, with the
voice on, while it says it.

**Hear it instead of reading it.** Turn **Voice** on in the Pair panel and
everything the agent says is spoken as it works: the words are spread over
the typing they explain — a long explanation gets a head start, then talks
over the typing, so the talking and the typing finish about together. The
big text in the panel
goes away, so there's only one thing to watch — the code. The words still
land in the panel's history. The voice runs on your own machine, so nothing
is sent anywhere to be spoken, and the typing a sentence explains waits
until you hear it. The arrow beside **Voice** chooses the model and whose voice it is:

- **Kokoro** (the default), the speech model OMP ships. Light, and works
  everywhere. The first turn-on may download it once: about 100 MB of model,
  in a few hundred MB of runtime that OMP already keeps.
- **Chatterbox**, more natural, on Apple Silicon only. It runs through
  [uv](https://docs.astral.sh/uv/), which must be installed, and the first
  turn-on fetches about 1.3 GB (a couple of minutes). It speaks in its own
  voice, or in one taken from a recording you pick — only use a voice you
  have the right to.

Turning the voice off brings the big text back.

**Hear it type.** The keyboard button in the Pair panel turns on **typing
sounds**: each of the agent's keystrokes plays a recording of a real switch,
a press and then a release, the way keyboard sound apps do it. Letters sound
by the row their key sits in, space, enter and backspace have their own
sounds, and every stroke is placed left or right and varied a little, so it
never drones. It stays well under the voice and steps back further while the
voice talks. VS Code lets the panel make sound only after a click in it: until
then the keyboard button turns yellow, and clicking it lets the sound start.
`aiPair.typingSounds.switch` picks the switch (Holy Panda by default, or
Cream, MX Brown, Topre). The recordings are from
[kbsim](https://github.com/tplai/kbsim), MIT.

**Try it without an agent:** _AI Pair: Play Demo Session_ plays a scripted
session that adds a small API to an Express app, which it creates in
`ai-pair-demo/`.

## How it works under the hood

```
agent (Claude Code, …) ── stdio MCP ──▶ pair-mcp ── local WebSocket ──▶ VS Code extension
```

The agent submits small batches of actions: say, move, select, type, delete,
point, run. The extension plays them at a human pace and reports back exactly
what happened, including everything you did in the meantime. The agent writes
its next batches while you watch the current one, up to about 30 seconds of
playback ahead, which hides its thinking time. That cap is kept short on
purpose: when you step in, what it wrote ahead is thrown away, and your
interruption lands right away.

The design is written up in:

- [PROTOCOL.md](PROTOCOL.md): the tools and their exact semantics, as the agent sees them.
- [AGENT_GUIDE.md](AGENT_GUIDE.md): how the agent should pair, returned to it when a session starts.
- [DESIGN.md](DESIGN.md): what you see: the cursor, the panel, the timing.
- [ARCHITECTURE.md](ARCHITECTURE.md): the components and how they connect.

## Install

You need **VS Code 1.105 or newer**. Install **AI Pair** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=michalstrba.ai-pair): in the
Extensions view, search for `@id:michalstrba.ai-pair`, or run:

```sh
code --install-extension michalstrba.ai-pair
```

To build it from source instead, you also need **Node.js 20 or newer**:

```sh
git clone https://github.com/faiface/ai-pair.git
cd ai-pair
npm install
npm run package
code --install-extension ai-pair-*.vsix
```

## Connect your agent

1. **Open a project folder in VS Code.** The extension installs the MCP server
   your agent runs, at `~/.ai-pair/bin/pair-mcp`
   (`%USERPROFILE%\.ai-pair\bin\pair-mcp.cmd` on Windows). It runs on
   VS Code's own runtime, so it doesn't need Node.js.
2. **Run _AI Pair: Set Up Agent_** from the command palette (VS Code also
   offers this the first time the extension starts). Pick your agents; the
   ones it finds installed are already checked. For each one, it adds a
   server named `pair` to that agent's user-wide MCP configuration, leaving
   everything else in the file as it was:

   | Agent                                                                            | Where                                                                                                                                                               |
   | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **OMP**                                                                          | `~/.omp/agent/mcp.json` (a named profile's folder when one is in use). The panel's **Start OMP** does this for you; set up is only for an OMP you run in a terminal |
   | **Claude Code** (the CLI, the IDE extensions, the Claude desktop app's Code tab) | `claude mcp add --scope user`, or `~/.claude.json` without the `claude` command                                                                                     |
   | **Codex** (the CLI, the IDE extension, the app)                                  | `~/.codex/config.toml` (or in `$CODEX_HOME`)                                                                                                                        |
   | **OpenCode**                                                                     | `~/.config/opencode/opencode.json` (`.jsonc` if you have one), on Windows too                                                                                       |
   | **Gemini CLI**                                                                   | `~/.gemini/settings.json`                                                                                                                                           |
   | **Cursor**                                                                       | `~/.cursor/mcp.json`                                                                                                                                                |
   | **Another agent**                                                                | copies an MCP server configuration to the clipboard: a stdio server named `pair` running the launcher                                                               |
   | **GitHub Copilot** in VS Code needs none of this: the extension gives it         |
   | the `pair` server itself.                                                        |

3. **Restart your agent** so it picks up the new server.

## Settings

| Setting                        |                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiPair.speed`                 | Overall playback speed (the panel's speed menu offers 0.4× to 3.0×). The voice follows it from 1× up to 2×.                                                                                  |
| `aiPair.agentName`             | The name on the agent's cursor.                                                                                                                                                              |
| `aiPair.timing`                | Fine-tune any typing or pause duration, e.g. `{ "afterSelectMs": 900, "type": { "wordStartMs": 140 } }`. Every key is in [`timing.ts`](packages/core/src/timing.ts).                         |
| `aiPair.confirmCommands`       | Ask before each command the agent runs in the terminal (default on). Turned off, the agent's commands run without any prompt, not even its own.                                              |
| `aiPair.workAheadBatches`      | How many batches the agent may write ahead of what you're watching (default 2, at most 10). More means fewer pauses; less means less thrown away when you step in. `0` waits for each batch. |
| `aiPair.omp.path`              | Path to the `omp` program the panel starts. Empty finds it on the PATH, in `~/.local/bin`, or in `~/.bun/bin`.                                                                               |
| `aiPair.omp.model`             | Model the panel's OMP starts with (OMP's fuzzy match). Empty uses OMP's own default.                                                                                                         |
| `aiPair.omp.thinking`          | How hard the panel's OMP thinks before each move (`off` … `max`). Lower means shorter waits between batches; `low` or `medium` suit most pairing. Empty uses OMP's own setting.              |
| `aiPair.voice.enabled`         | Speak what the agent says, live, on this machine. Off by default; the panel's **Voice** button flips it.                                                                                     |
| `aiPair.voice.model`           | Which speech model: `kokoro` (default, works everywhere) or `chatterbox` (more natural, Apple Silicon, needs uv).                                                                            |
| `aiPair.voice.voice`           | Whose Kokoro voice it is.                                                                                                                                                                    |
| `aiPair.voice.chatterboxVoice` | A recording for Chatterbox to sound like. Empty uses its own voice.                                                                                                                          |
| `aiPair.voice.rate`            | How fast the voice talks on top of the playback speed (1 is its own pace).                                                                                                                   |
| `aiPair.voice.runtimePath`     | A bun or node program to run the voice with, if the usual places have none.                                                                                                                  |
| `aiPair.typingSounds.enabled`  | Play the agent's keystrokes as a mechanical keyboard. Off by default; the panel's keyboard button flips it.                                                                                  |
| `aiPair.typingSounds.volume`   | How loud, from 0 to 1 (0.5 by default). Always under the voice.                                                                                                                              |
| `aiPair.typingSounds.switch`   | Which switch's recordings: `holypanda`, `cream`, `alpaca`, `mxbrown`, `topre` or `buckling`. Or pick one by ear with the arrow by **Key sounds**.                                            |

## Troubleshooting

- **The agent says `no_editor`.** Its working directory isn't inside a folder
  that's open in VS Code. Open that folder in VS Code, or start the agent in
  it.
- **The agent doesn't have the pair tools.** Restart the agent after setting
  it up. _AI Pair: Set Up Agent_ marks the agents that are set up. With
  Claude Code, `claude mcp list` should show `pair`. With Copilot, `pair`
  should be in _MCP: List Servers_; start it there if it isn't running.
- **Start OMP says OMP wasn't found.** Install OMP, or set `aiPair.omp.path`
  to its full path. If OMP starts but does no code work, its own words are in
  the _AI Pair OMP_ output channel.
- **The voice won't start.** It is OMP's Kokoro, run by bun or node (VS Code's
  own runtime can't load its native code). Install OMP so the first turn-on
  can fetch it, and have bun or node on the machine, or set
  `aiPair.voice.runtimePath`. What it said on its way out is in the _AI Pair
  Voice_ output channel. Chatterbox needs [uv](https://docs.astral.sh/uv/)
  and an Apple Silicon Mac; if it says it couldn't start from what's already
  downloaded, turn the voice off and on to fetch it.
- **After updating the extension,** reload the VS Code window and restart the
  agent.

## Development

```
packages/
  protocol/   types shared by everything
  core/       editor-agnostic sessions, playback, and the local WebSocket server
  relay/      pair-mcp, the MCP server the agent runs
  vscode/     the extension, which ships the relay
```

```sh
npm install
npm test                  # unit and end-to-end tests
npm run typecheck
npm run build             # development build of the extension
npm run test:integration  # plays a session inside a real, isolated VS Code (macOS)
npm run package           # production build → ai-pair-<version>.vsix
```

To run your working copy, open the repository in VS Code and press F5, or:

```sh
code --extensionDevelopmentPath="$PWD/packages/vscode" <a project folder>
```

### Releasing

Add a section for the new version to
[`packages/vscode/CHANGELOG.md`](packages/vscode/CHANGELOG.md), then, on an
up-to-date `main`:

```sh
npm run release -- patch   # or minor, major, or an exact version
```

It runs every test, bumps the version, builds the `.vsix` once and publishes
that file to the Marketplace, then commits, tags and pushes the release and
makes a GitHub release with the `.vsix` attached. It asks before publishing,
since a version can't be published twice. It needs `vsce login michalstrba` and
`gh auth login` done once.

## License

[MIT](LICENSE)
