# Changelog

## Unreleased

- **OMP lives in the Pair panel now.** **Start OMP** runs OMP in your project
  and you talk to it right in the panel: no terminal, and the first start
  gives it the pair server by itself. For code work it pairs as any agent
  does, typing in your editor; a plain question it answers in the panel.
  Pick the model, start a new chat, stop a turn, all in the panel; its
  questions come up as VS Code's own prompts. New settings: `aiPair.omp.path`
  and `aiPair.omp.model`.
- **AI Pair: Set Up Agent** can also connect an OMP you run yourself.
- **The agent can talk.** Turn **Voice** on in the Pair panel and everything
  it says is spoken while it works, with Kokoro: a speech model that runs on
  your own machine, so nothing leaves it to be said. Short lines talk over
  the typing; a long one is spoken first; interrupting cuts it off. The big
  text in the panel goes away while the voice is on — your eyes stay on the
  code — and the words still land in the history. **Pick a voice** chooses
  whose it is. The first turn-on may download the model once. New settings:
  `aiPair.voice.enabled`, `.voice`, `.rate`, `.runtimePath`.

## 0.1.0

The first release.

- Your coding agent gets its own cursor in the editor, types at a human pace,
  and explains what it's doing in the **Pair** panel.
- Reply, interrupt, or edit the code at any moment, and the agent's next move
  takes it into account. Select some code to ask about it.
- **My turn** lets you write a part yourself while the agent navigates.
- The agent's commands play in an *AI Pair* terminal, after you allow them.
- The speed menu sets the pace, from 0.4× to 3.0×.
- **AI Pair: Set Up Agent** connects Claude Code, Codex, OpenCode, Gemini CLI
  and Cursor. GitHub Copilot needs no setup.
- **AI Pair: Play Demo Session** shows what it's like without an agent.
