# Changelog

## Unreleased

- **Allow a whole kind of command.** When the agent wants to run a command,
  the panel now offers **Run**, **Allow `npm`** (every command of that
  program, like `npm test` and `npm run build`), **Allow all**, and **Skip**.
  Both allow choices last until the session ends. Chained or piped commands
  (`a && b`, `a | b`) can't be allowed by program, since that would let the
  other part through too. This replaces **Allow for session**, which only
  covered the exact same command.
- **The voice stops asking once you answer.** "Okay to run it?" is no longer
  spoken after you pick Run, Allow, or Skip, even if the voice was busy and
  the ask was still waiting its turn. Other speech goes on as before.
- **Words and work come in beats.** The agent now sends a batch as beats:
  each one is what it says and the actions those words are about. They start
  together, and the next beat waits until both are done. So the voice no
  longer drifts away from the code it talks about. With the voice off, the
  words show as the work starts, and a beat lasts as long as the longer of
  reading and working. The pair protocol is now version 4.
- **The agent knows if you can hear it.** It's told whether the voice is on
  when the session starts, and again whenever you flip it. With the voice
  on, it writes for the ear: plain words, and code said the way you'd say it
  out loud.
- **Clearer errors for a wrong beat.** If the agent puts `move` or `say` in
  the wrong place, it's told exactly where they go, with an example.
- **OMP forgets what never played.** When you interrupt, the panel's OMP now
  sees only the beats that played in its own history, not the code it had
  queued. It no longer talks as if that code is in your file. Your saved
  chat is not changed.
- **Pick how hard OMP thinks.** A chip next to the model pill changes OMP's
  thinking level at any time, from the levels the model offers. Lower means
  shorter waits between batches.
- **A line that won't end can't freeze the session.** With the voice on, a
  batch that points at code waits for its words to finish. If the voice went
  quiet without finishing, the batch waited forever. Now it moves on after
  about twice the line's length. A rare race that could leave a new line
  never spoken, right after you interrupt, is fixed too.
- **The agent hears when it left you waiting.** If the editor sat still for 5
  seconds or more while it wrote its next batch, the report tells it how
  long, and to keep something playing with bigger batches. The `step` tool
  now asks for batches of about 10 to 30 seconds, not single short lines.
- **The Run box shows with the voice on.** With the voice on, the box that
  asks you to allow a command was hidden, so a session could sit waiting for
  you with no sign of why. Now it stays in view.
- **The agent talks first, then looks.** It's told to start the session right
  away and say what it's going to look at, before it reads your code. Before,
  it could read and think for minutes in silence.
- **The panel shows what OMP is doing.** While it reads or searches, the
  status line says so in its own words, like "Reading hello file", with a
  clock.
- **Other extensions no longer garble the agent's typing.** When an extension
  answers a keystroke, like Pylance closing a `"""` the moment it opens, that
  addition is taken back at once. Before, it doubled the quotes, counted as
  your edit, and cut off the batch and its voice mid-sentence.
- **No more `def f(x)::`.** A `type` that puts a `:`, `;` or `,` after its
  close is rejected, since stepping past the close and typing on would add it
  twice.
- **The agent doesn't explain code it hasn't written.** Reports now say
  plainly that what didn't play never happened, and the agent is told to
  call that code a plan and to say again what you didn't hear.
- **The voice follows the speed menu,** up to 2×. One control sets the pace
  of both typing and talking; slower than 1×, the voice keeps its natural
  pace. `aiPair.voice.rate` now fine-tunes on top, and works for Chatterbox
  too.
- **Pairing keeps moving.** The agent now writes its next batches while you
  watch, up to 2 batches ahead, so the editor no longer sits still between
  batches while it thinks. Their speech is made ahead too, so each batch
  starts talking at once. Step in and what it wrote ahead is dropped, so your
  interruption still lands right away. New setting:
  `aiPair.workAheadBatches`.
- **A command waiting for you can't go unseen.** The panel comes into view,
  the command pulses, and the voice asks. The agent is told it's waiting on
  you, instead of just hearing that nothing has finished.
- **The status line says what the wait is**: a clock while the agent thinks,
  a note when it has gone quiet for long, and how many batches are ready.
- **OMP starts sooner and can think less.** It's told to get going instead of
  reading docs turn after turn, and the new `aiPair.omp.thinking` setting
  sets how hard it thinks: lower means shorter waits.
- **A tidier OMP panel.** OMP's controls are icons in a header with its
  state, its model is a pill you click to change, and voice and typing sounds
  sit in their own Sound row as clear on/off toggles.
- **Key sounds you can choose by ear.** The keyboard toggle now says **Key
  sounds**, and the arrow beside it opens a list of six keyboards (new:
  Alpaca and the IBM Model M's buckling spring). Each one types a few words
  as you move to it. The sounds themselves are more lifelike too: Shift goes
  down for capitals, each key keeps its own pitch, a word's first key lands
  harder, indentation is silent, and a small room's echo puts the keyboard on
  a desk instead of in your ear. New command: **AI Pair: Select Typing Sound
  Switch**.
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
  your own machine, so nothing leaves it to be said. The words are spread
  over the typing they explain — a long one gets a head start, then talks
  over the typing, so the two finish about together; interrupting cuts it
  off. The big
  text in the panel goes away while the voice is on — your eyes stay on the
  code — and the words still land in the history. The arrow beside **Voice** chooses
  whose it is. The first turn-on may download the model once. New settings:
  `aiPair.voice.enabled`, `.voice`, `.rate`, `.runtimePath`. Code is said the
  way a programmer says it: `req.body` is "req dot body", `user_id` "user
  id", `server.ts` "server dot T S", 404 "four oh four". And agents are told
  to talk like a pair at your desk, naming the code they type. The typing a
  `say` explains waits until its words are heard, so a slow-to-start voice
  never lags behind the code it is about.
- **Two voices to choose from.** The voice picker offers Kokoro (light, works
  everywhere) or Chatterbox (more natural; Apple Silicon only, needs
  [uv](https://docs.astral.sh/uv/), fetches about 1.3 GB on the first
  turn-on). Chatterbox speaks in its own voice, or in one taken from a
  recording you pick. New settings: `aiPair.voice.model`,
  `aiPair.voice.chatterboxVoice`.
- **Hear the agent type.** The keyboard button in the Pair panel turns on
  typing sounds: its keystrokes play as a real mechanical keyboard, from
  recordings of a switch — a press and a release per key, letters by their
  row, space, enter and backspace their own, each a little different. Kept
  well under the voice, and quieter still while it talks. Click the panel
  once so VS Code lets it make sound. New settings:
  `aiPair.typingSounds.enabled`, `.volume`, `.switch` (Holy Panda, Cream,
  MX Brown, Topre; recordings from kbsim, MIT).

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
