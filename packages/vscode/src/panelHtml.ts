// The narration panel's page. Layout, top to bottom: the band, a full-width area whose header holds
// the status (its dot fills a ring during the reading pause) and the controls, then the current
// message (top edge fixed, grows downward), then the reply box; below the band, the history, newest
// first.

import { randomBytes } from "node:crypto"

/** Speeds offered in the panel's menu. The `aiPair.speed` setting takes any value. */
export const SPEEDS = [0.4, 0.6, 1, 1.5, 2, 3]

const svg = (paths: string, cls = "") =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

const ICONS = {
  pause: svg('<path d="M9 5v14M15 5v14"/>', "pause"),
  resume: svg('<path d="M8 5l11 7-11 7z"/>', "resume"),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  exit: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>'),
  send: svg('<path d="M4 12l16-8-6 16-2.5-6.5z"/>'),
  play: svg('<path d="M8 5l11 7-11 7z"/>'),
  speaker: svg('<path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>', "speaker-on"),
  speakerOff: svg('<path d="M11 5L6 9H3v6h3l5 4zM16 9l6 6M22 9l-6 6"/>', "speaker-off"),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h1M10.5 10h1M14.5 10h1M18 10h-.5M8 14h8"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  power: svg('<path d="M12 3v8M6.3 6.8a8 8 0 1011.4 0"/>'),
  chevron: svg('<path d="M7 10l5 5 5-5"/>', "chevron"),
  spark: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0012 3z"/>'),
}

export function panelHtml(cspSource: string): string {
  const nonce = randomBytes(16).toString("base64")
  const speeds = SPEEDS.map(
    (s) => `<button role="menuitemradio" aria-checked="false" data-speed="${s}">${s.toFixed(1)}×</button>`,
  ).join("")
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  /*
   * Every color is the theme's: one of its tokens, or its foreground mixed into what's behind, so
   * the panel sits in whatever theme is set, dark or light, and recedes the same way in each. The
   * fallbacks are for tokens a theme may leave unset.
   */
  :root {
    --fg: var(--vscode-foreground);
    --accent: var(--vscode-aiPair-cursor, #e8875b);
    --read: var(--vscode-aiPair-cursorRead, #facc15);
    /* Text a step and two steps back. Not descriptionForeground: some themes make it the foreground. */
    --muted: color-mix(in srgb, var(--fg) 66%, transparent);
    --faint: color-mix(in srgb, var(--fg) 46%, transparent);
    --hair: color-mix(in srgb, var(--fg) 12%, transparent);
    --soft: color-mix(in srgb, var(--fg) 7%, transparent);
    --soft-hover: color-mix(in srgb, var(--fg) 13%, transparent);
    --border: var(--vscode-contrastBorder, var(--vscode-widget-border, var(--vscode-panel-border, var(--hair))));
    /*
     * The band is the editor's surface, so the current message sits on the same ground as the code.
     * It may be lighter, darker, or the same as the side bar's; the band's hairline marks it either way.
     */
    --surface: var(--vscode-editor-background);
    --you: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
    --ok: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
    --fail: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
    --mono: var(--vscode-editor-font-family, monospace);
  }
  /* High contrast themes: text at full strength, and their contrast border for hairlines. */
  body.vscode-high-contrast, body.vscode-high-contrast-light {
    --muted: var(--fg);
    --faint: var(--fg);
    --hair: var(--vscode-contrastBorder, var(--fg));
  }
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--fg);
  }
  #app { display: flex; flex-direction: column; height: 100%; }

  button {
    font: inherit; font-size: 12px; height: 24px; min-width: 24px; box-sizing: border-box; padding: 0 5px;
    display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: none;
    border: none; border-radius: 5px; cursor: pointer; background: transparent; color: var(--fg);
  }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  button:disabled { opacity: 0.45; cursor: default; }
  /* Icon buttons hover like the theme's toolbar icons; the others are the theme's buttons. */
  button.quiet { color: var(--muted); }
  button.quiet:hover:not(:disabled), button.quiet.on { background: var(--vscode-toolbar-hoverBackground, var(--soft)); color: var(--fg); }
  button.primary { box-shadow: inset 0 0 0 1px var(--vscode-button-border, transparent); }
  button.soft { box-shadow: inset 0 0 0 1px var(--vscode-button-secondaryBorder, var(--vscode-button-border, transparent)); }
  button.soft { background: var(--vscode-button-secondaryBackground, var(--soft)); color: var(--vscode-button-secondaryForeground, var(--fg)); }
  button.soft:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--soft-hover))); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
  body.vscode-high-contrast button:hover:not(:disabled), body.vscode-high-contrast-light button:hover:not(:disabled) {
    outline: 1px dashed var(--vscode-contrastActiveBorder, var(--vscode-focusBorder)); outline-offset: -1px;
  }
  .i { width: 14px; height: 14px; flex: none; }

  #band { flex: none; padding: 10px 14px 12px; background: var(--surface); border-bottom: 1px solid var(--border); }
  /* Room for the header and two lines of message, so the reply box stays still for short messages. */
  body.active #main { min-height: calc(32px + 2 * 1.5 * 1.3 * var(--vscode-editor-font-size, 13px)); box-sizing: border-box; }

  #head { display: flex; align-items: center; gap: 4px; height: 24px; }
  /* Without a session, the title under it says it all. */
  body:not(.active) #head { display: none; }
  #status { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; font-size: 12px; }
  #status-text { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dot { position: relative; width: 7px; height: 7px; margin-left: 4px; border-radius: 50%; background: var(--accent); flex: none; }
  .dot.read { background: var(--read); animation: breathe 2.4s ease-in-out infinite; }
  .dot.dim { opacity: 0.45; }
  .dot.think { animation: breathe 1.2s ease-in-out infinite; }
  .dot.ring { background: transparent; box-shadow: inset 0 0 0 1.5px var(--accent); }
  .dot.off { background: var(--muted); opacity: 0.45; }
  @keyframes breathe { 50% { opacity: 0.35; } }
  /* The reading pause fills a ring around the dot, --progress from 0 to 1; what's left is the same color, faded. */
  .dot.reading { --ring: var(--read); background: var(--read); animation: none; }
  body.paused .dot.reading { --ring: var(--faint); }
  .dot.reading::after {
    content: ""; position: absolute; inset: -4.5px; border-radius: 50%;
    background: conic-gradient(var(--ring) calc(var(--progress, 0) * 360deg), color-mix(in srgb, var(--ring) 28%, transparent) 0);
    mask: radial-gradient(circle, transparent 6px, #000 6.5px);
  }

  #controls { display: none; align-items: center; gap: 1px; }
  body.active #controls { display: flex; }
  #pause .resume, body.paused #pause .pause { display: none; }
  body.paused #pause .resume { display: block; }
  body.user-turn #pause, body.user-turn #interrupt { display: none; }
  /* My turn is its icon; Hand back, the main action in the programmer's turn, is labeled. */
  #turn-label { display: none; }
  body.user-turn #turn-label { display: inline; }
  #end { margin-left: 2px; }
  #speed-wrap { position: relative; }
  #speed { font-variant-numeric: tabular-nums; }
  #speed-menu {
    position: absolute; right: 0; top: 28px; z-index: 10; padding: 4px; border-radius: 6px;
    display: flex; flex-direction: column; background: var(--vscode-menu-background, var(--surface));
    color: var(--vscode-menu-foreground, var(--fg));
    border: 1px solid var(--vscode-menu-border, var(--border));
    box-shadow: 0 4px 14px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.18));
  }
  #speed-menu[hidden] { display: none; }
  #speed-menu button { justify-content: flex-start; height: 24px; padding: 0 8px; color: inherit; font-variant-numeric: tabular-nums; }
  #speed-menu button[aria-checked="true"] { background: var(--soft-hover); }
  #speed-menu button:hover { background: var(--vscode-menu-selectionBackground, var(--soft)); color: var(--vscode-menu-selectionForeground, inherit); }

  #now { display: none; margin-top: 8px; }
  body.active #now { display: block; }
  #now-text { font-size: calc(var(--vscode-editor-font-size, 13px) * 1.3); line-height: 1.5; overflow-wrap: anywhere; }
  #now-text.empty { font-size: inherit; color: var(--muted); }
  #now-text code { font-size: 0.85em; padding: 1px 3px; border-radius: 3px; }
  /* Something new in the band fades in. */
  .arrive { animation: arrive 0.7s ease-out; }
  @keyframes arrive { from { opacity: 0.2; } }
  #now-ref { margin-top: 8px; font-size: 12px; }
  #now-ref:empty { display: none; }
  #run { display: none; margin-top: 12px; }
  #run.on { display: block; }
  #run-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  #run-cmd { padding: 8px 10px; border-radius: 6px; background: var(--soft); font-family: var(--mono); font-size: 12.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
  #run-cmd::before { content: "$ "; color: var(--muted); }
  #run-actions { display: none; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  #run.confirm #run-actions { display: flex; }
  /* Nothing plays until the programmer answers, so the question can't sit there unseen. */
  #run.confirm { padding: 10px; border-radius: 8px; animation: ask 1.6s ease-in-out infinite; }
  @keyframes ask {
    0%, 100% { box-shadow: 0 0 0 1.5px var(--read); }
    50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--read) 35%, transparent); }
  }
  #run-actions button { height: 26px; padding: 0 8px; }
  #run-actions button[hidden] { display: none; }

  body.active #idle { display: none; }
  #idle-title { font-size: 15px; font-weight: 600; }
  #idle-summary { margin-top: 6px; font-size: 14px; line-height: 1.5; }
  #idle-summary:empty { display: none; }
  #idle-text { margin-top: 4px; font-size: 12.5px; line-height: 1.5; color: var(--muted); }

  /* OMP, when it runs in the panel: a header with its state and its few controls, then its model. */
  #omp-head { display: none; align-items: center; gap: 6px; height: 24px; }
  body.omp #omp-head { display: flex; }
  #omp-title { font-size: 15px; font-weight: 600; }
  #omp-state { flex: 1; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #omp-dot { margin-left: 0; margin-right: 2px; }
  #omp-dot.ready { background: var(--ok); }
  #omp-dot.busy { animation: breathe 1.2s ease-in-out infinite; }
  #omp-dot.starting { background: var(--muted); animation: breathe 1.2s ease-in-out infinite; }
  body:not(.omp-busy) #omp-abort { display: none; }
  button.chip {
    height: 22px; max-width: 100%; padding: 0 6px 0 8px; border-radius: 11px; gap: 4px;
    font-size: 11.5px; color: var(--muted); background: var(--soft);
  }
  button.chip:hover:not(:disabled) { background: var(--soft-hover); color: var(--fg); }
  button.chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button.chip .i { width: 12px; height: 12px; }
  /* The model and how hard it thinks sit under the reply box, so they can be changed at any
     point, mid-session too. Another agent's are set in its own app: the level shows, greyed. */
  #agent-row { display: none; align-items: center; gap: 6px; margin-top: 6px; }
  body:is(.active, .omp) #agent-row { display: flex; }
  body:not(.omp) #omp-model { display: none; }
  /* The level is a short word that must read whole; a long model name gives way to it. */
  #agent-row #omp-model { min-width: 0; }
  #think-wrap { position: relative; flex-shrink: 0; }
  #think-menu {
    position: absolute; right: 0; bottom: 26px; z-index: 10; padding: 4px; border-radius: 6px;
    display: flex; flex-direction: column; background: var(--vscode-menu-background, var(--surface));
    color: var(--vscode-menu-foreground, var(--fg));
    border: 1px solid var(--vscode-menu-border, var(--border));
    box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
  }
  #think-menu[hidden] { display: none; }
  #think-menu button { justify-content: flex-start; height: 24px; padding: 0 8px; color: inherit; white-space: nowrap; }
  #think-menu button[aria-checked="true"] { background: var(--soft-hover); }
  #think-menu button:hover { background: var(--vscode-menu-selectionBackground, var(--soft)); color: var(--vscode-menu-selectionForeground, inherit); }
  body.omp #idle-text { margin-top: 8px; }
  /* With OMP on, its header names the panel; a session's end still gets its own title. */
  body.omp #idle:not(.ended) #idle-title { display: none; }
  #omp-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  body.omp #omp-bar { display: none; }
  #omp-bar button { height: 26px; padding: 0 10px; }
  #omp-status, #voice-status { font-size: 12px; color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Sound: toggles that show their state, set apart from what the agent is doing. */
  #sound { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--hair); }
  .seg { display: inline-flex; border-radius: 5px; box-shadow: inset 0 0 0 1px var(--hair); }
  .seg button { border-radius: 0; }
  .seg button:first-child { border-radius: 5px 0 0 5px; }
  .seg button:last-child { border-radius: 0 5px 5px 0; box-shadow: inset 1px 0 0 var(--hair); }
  button.toggle { height: 24px; padding: 0 8px; color: var(--muted); }
  button.toggle:hover:not(:disabled) { color: var(--fg); background: var(--vscode-toolbar-hoverBackground, var(--soft)); }
  button.toggle[aria-pressed="true"] { color: var(--fg); background: var(--vscode-toolbar-hoverBackground, var(--soft)); }
  :is(#voice-pick, #keys-pick) { padding: 0 4px; }
  /* Words show only when something needs saying, on a line of their own under the toggles. */
  #voice-status { flex-basis: 100%; }
  #voice-status:empty { display: none; }
  body.keys-blocked #keys-toggle { color: var(--read); }
  /* With the voice speaking, the band's big words go: the eyes belong on the code. A command
     stays: allowing it is a button to press, and nothing plays until it's pressed. */
  body.voice :is(#now-text, #now-ref) { display: none; }
  body.voice #now:not(:has(#run.on)) { display: none; }
  body:is(.active.voice) #main { min-height: 0; }
  :is(#voice, #voice-toggle) .speaker-on { display: none; }
  body.voice-enabled :is(#voice, #voice-toggle) .speaker-on { display: block; }
  body.voice-enabled :is(#voice, #voice-toggle) .speaker-off { display: none; }
  body.voice-enabled #voice { color: var(--fg); background: var(--vscode-toolbar-hoverBackground, var(--soft)); }
  body.typing-sounds #keys { color: var(--fg); background: var(--vscode-toolbar-hoverBackground, var(--soft)); }
  body.keys-blocked #keys { color: var(--read); }
  .entry.tool { font-family: var(--mono); font-size: 11.5px; color: var(--faint); }

  #composer { display: none; margin-top: 12px; }
  body:is(.active, .omp) #composer { display: block; }
  #compose-row {
    display: flex; align-items: flex-end; gap: 4px; padding: 3px 3px 3px 10px; border-radius: 6px;
    background: var(--vscode-sideBar-background, var(--vscode-input-background)); border: 1px solid var(--vscode-input-border, var(--border));
  }
  #compose-row:focus-within { border-color: var(--vscode-focusBorder); }
  #reply {
    flex: 1; min-width: 0; box-sizing: border-box; resize: none; border: none; outline: none; padding: 4px 0; margin: 0;
    font: inherit; font-size: 13px; line-height: 1.4; background: transparent; color: var(--vscode-input-foreground, var(--fg));
  }
  #reply::placeholder { color: var(--vscode-input-placeholderForeground, var(--muted)); }
  #attach { display: none; align-items: center; gap: 6px; margin: 0 2px 6px; font-size: 11.5px; color: var(--muted); }
  #attach.on { display: flex; }
  #attach-ref { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #attach button { height: 18px; min-width: 18px; padding: 0 4px; font-size: 12px; }

  #history {
    flex: 1; overflow-y: auto; padding: 14px 14px 18px; display: flex; flex-direction: column; gap: 12px;
    font-size: 12.5px; color: var(--muted);
  }
  .entry { overflow-wrap: anywhere; line-height: 1.5; }
  .you {
    align-self: flex-end; max-width: 85%; padding: 6px 10px; border-radius: 10px;
    background: var(--soft); color: var(--fg); line-height: 1.45;
  }
  .you .ref { display: block; margin-top: 4px; }
  .run { display: flex; align-items: center; gap: 7px; padding: 6px 9px; border-radius: 5px; background: var(--soft); font-size: 12px; }
  .run .cmd { font-family: var(--mono); color: var(--fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .run .cmd::before { content: "$ "; color: var(--muted); }
  .run.skipped .cmd { color: var(--muted); }
  .run .outcome { margin-left: auto; flex: none; font-size: 11px; white-space: nowrap; }
  .run .outcome.ok { color: var(--ok); }
  .run .outcome.fail { color: var(--fail); }
  body.vscode-high-contrast :is(.you, .run), body.vscode-high-contrast-light :is(.you, .run) { outline: 1px solid var(--border); }
  .divider { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--faint); }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--hair); }

  code { font-family: var(--mono); font-size: 0.88em; padding: 1px 4px; border-radius: 4px; background: var(--soft); color: inherit; }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  a:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); text-decoration: underline; }
  /* Code references, in messages and after them: mono, underlined quietly, a link's color only on hover. */
  a.file, a.ref {
    color: inherit; font-family: var(--mono); font-size: 0.88em;
    text-decoration: underline dotted color-mix(in srgb, currentColor 45%, transparent); text-underline-offset: 3px;
  }
  a.file:hover, a.ref:hover { color: var(--vscode-textLink-foreground); text-decoration-color: currentColor; }
  a.ref { font-size: 11.5px; }
  #now-ref a.ref { color: var(--muted); }

  /*
   * Tooltips are the panel's own, in the theme's hover colors, like VS Code's: native ones show
   * unreliably in a webview, and only on hover.
   */
  #tip {
    position: fixed; z-index: 20; max-width: min(280px, calc(100vw - 12px)); box-sizing: border-box;
    padding: 4px 8px; border-radius: 4px; font-size: 12px; line-height: 1.4; pointer-events: none;
    background: var(--vscode-editorHoverWidget-background, var(--surface));
    color: var(--vscode-editorHoverWidget-foreground, var(--fg));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--border));
    box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
  }
  #tip[hidden] { display: none; }

  @media (prefers-reduced-motion: reduce) {
    .dot.read, .dot.think, .arrive, #run.confirm { animation: none; }
  }
</style>
</head>
<body>
<div id="app">
  <section id="band">
    <div id="main">
      <div id="head">
        <div id="status"><span id="dot" class="dot off"></span><span id="status-text">No session</span></div>
        <div id="controls">
          <button id="voice" class="quiet" aria-label="Voice" data-tip="Hear the agent instead of reading it">${ICONS.speaker}${ICONS.speakerOff}</button>
          <button id="keys" class="quiet" aria-label="Typing sounds" aria-pressed="false" data-tip="Hear the agent's keystrokes">${ICONS.keyboard}</button>
          <button id="pause" class="quiet" aria-label="Pause" data-tip="Pause (Space)" aria-keyshortcuts="Space">${ICONS.pause}${ICONS.resume}</button>
          <button id="interrupt" class="quiet" aria-label="Interrupt" data-tip="Interrupt">${ICONS.stop}</button>
          <button id="turn" class="quiet" aria-label="My turn" data-tip="Take the turn: you drive, the agent navigates">${ICONS.swap}<span id="turn-label">My turn</span></button>
          <div id="speed-wrap">
            <button id="speed" class="quiet" aria-haspopup="menu" aria-expanded="false" data-tip="Playback speed: the typing, and the voice up to 2×">1.0×</button>
            <div id="speed-menu" role="menu" aria-label="Playback speed" hidden>${speeds}</div>
          </div>
          <button id="end" class="quiet" aria-label="End the session" data-tip="End the session">${ICONS.exit}</button>
        </div>
      </div>
      <div id="now">
        <div id="now-text" class="empty"></div>
        <div id="now-ref"></div>
        <div id="run">
          <div id="run-label"></div>
          <div id="run-cmd"></div>
          <div id="run-actions">
            <button id="run-go" class="primary">${ICONS.play}<span>Run</span></button>
            <button id="run-program" class="soft"></button>
            <button id="run-all" class="soft" data-tip="Run it, and every command after it without asking until the session ends">Allow all</button>
            <button id="run-skip" class="quiet">Skip</button>
          </div>
        </div>
      </div>
      <div id="idle">
        <div id="omp-head">
          <span id="omp-dot" class="dot"></span>
          <span id="omp-title">OMP</span>
          <span id="omp-state"></span>
          <button id="omp-new" class="quiet" aria-label="New chat" data-tip="New chat: start a fresh conversation">${ICONS.plus}</button>
          <button id="omp-abort" class="quiet" aria-label="Stop" data-tip="Stop what OMP is doing now">${ICONS.stop}</button>
          <button id="omp-stop" class="quiet" aria-label="Turn OMP off" data-tip="Turn OMP off">${ICONS.power}</button>
        </div>
        <div id="idle-title">No active session</div>
        <div id="idle-summary"></div>
        <div id="idle-text">Talk to OMP right here, ask another agent to pair with you, or run <a class="command" data-command="aiPair.playDemo">AI Pair: Play Demo Session</a>. First time? Run <a class="command" data-command="aiPair.setUpAgent">AI Pair: Set Up Agent</a>.</div>
        <div id="omp-bar">
          <button id="omp-start" class="primary">${ICONS.play}<span>Start OMP</span></button>
          <span id="omp-status"></span>
        </div>
        <div id="sound" role="group" aria-label="Sound">
          <div class="seg">
            <button id="voice-toggle" class="toggle" aria-pressed="false">${ICONS.speaker}${ICONS.speakerOff}<span>Voice</span></button>
            <button id="voice-pick" class="toggle" aria-label="Choose a voice" data-tip="Choose whose voice it is">${ICONS.chevron}</button>
          </div>
          <div class="seg">
            <button id="keys-toggle" class="toggle" aria-pressed="false">${ICONS.keyboard}<span id="keys-label">Key sounds</span></button>
            <button id="keys-pick" class="toggle" aria-label="Choose a keyboard switch" data-tip="Choose the keyboard: each one plays as you move to it">${ICONS.chevron}</button>
          </div>
          <span id="voice-status"></span>
        </div>
      </div>
    </div>
    <div id="composer">
      <div id="attach"><span>With selection</span><a id="attach-ref"></a><button id="attach-x" class="quiet" aria-label="Don't send the selection" data-tip="Don't send the selection">×</button></div>
      <div id="compose-row">
        <textarea id="reply" rows="1" aria-label="Reply to the agent" placeholder="Reply to the agent…"></textarea>
        <button id="send" class="quiet" aria-label="Send" data-tip="Send (Enter)">${ICONS.send}</button>
      </div>
      <div id="agent-row">
        <button id="omp-model" class="chip" data-tip="Choose the model OMP uses">${ICONS.spark}<span id="omp-model-name">Model</span>${ICONS.chevron}</button>
        <div id="think-wrap">
          <button id="omp-think" class="chip" aria-haspopup="menu" aria-expanded="false" disabled data-tip="Your agent's thinking level is set in its own app">${ICONS.bulb}<span id="omp-think-name">Thinking</span>${ICONS.chevron}</button>
          <div id="think-menu" role="menu" aria-label="Thinking level" hidden></div>
        </div>
      </div>
    </div>
  </section>
  <section id="history" aria-label="Earlier, newest first"></section>
</div>
<div id="tip" role="tooltip" hidden></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const ui = {
    band: $("band"), dot: $("dot"), status: $("status-text"), pause: $("pause"), interrupt: $("interrupt"),
    turn: $("turn"), turnLabel: $("turn-label"), speed: $("speed"), speedMenu: $("speed-menu"), end: $("end"),
    now: $("now-text"), ref: $("now-ref"),
    idle: $("idle"), idleTitle: $("idle-title"), idleSummary: $("idle-summary"), idleText: $("idle-text"),
    ompStart: $("omp-start"), ompStop: $("omp-stop"), ompAbort: $("omp-abort"), ompNew: $("omp-new"), ompModel: $("omp-model"), ompStatus: $("omp-status"),
    ompDot: $("omp-dot"), ompState: $("omp-state"), ompModelName: $("omp-model-name"),
    ompThink: $("omp-think"), ompThinkName: $("omp-think-name"), thinkMenu: $("think-menu"),
    voice: $("voice"), voiceToggle: $("voice-toggle"), voicePick: $("voice-pick"), voiceStatus: $("voice-status"),
    keys: $("keys"), keysToggle: $("keys-toggle"), keysLabel: $("keys-label"), keysPick: $("keys-pick"),
    reply: $("reply"), send: $("send"), attach: $("attach"), attachRef: $("attach-ref"), attachX: $("attach-x"),
    run: $("run"), runLabel: $("run-label"), runCmd: $("run-cmd"), runGo: $("run-go"), runProgram: $("run-program"), runAll: $("run-all"), runSkip: $("run-skip"),
    history: $("history"), tip: $("tip"),
  };
  /** What the panel says with nothing going on, and with OMP ready to talk. */
  const IDLE_INTRO = ui.idleText.innerHTML;
  const OMP_INTRO = "Ask anything. For code work, OMP pairs with you: it types in your editor and talks as it goes.";
  let active = false, turn = "agent", paused = false, replaying = false;
  let omp = { state: "off" };   // the built-in OMP conversation, as the extension last reported it
  let voice = { enabled: false, state: "off", voice: "af_heart" };   // the voice, as the extension last reported it
  const ompEntries = {};   // a streaming OMP reply's history row, by its id
  let state = null;     // the agent's state, as the extension last reported it
  let ahead = 0;        // batches written and waiting behind the one playing
  let working = false;  // the agent is at work between its calls: thinking, or writing ahead
  let thinkingSince = 0, statusClock = null;   // how long the agent has been thinking, shown as it goes
  let selection = null, selectionDismissed = false;   // the programmer's selection, offered with the reply
  let runId = null, runConfirming = false;   // the command shown in the run box
  let current = null;   // text of the current message
  let reading = null;   // { ms, elapsed, last }
  let pointed = null;   // a link to the code the agent just pointed at, shown with the message about it

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // A code span that names a file, like \`game.ts\` or \`src/game.ts\`, becomes a link that opens it.
  const FILE = /^[\\w@.~-]*(\\/[\\w@.~-]+)*\\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|css|scss|less|html|vue|svelte|py|rs|go|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|lua|sh|zsh|toml|yaml|yml|xml|sql|txt|lock|env)$/;
  const URL = /\\bhttps?:\\/\\/[^\\s<>"'\`]*[^\\s<>"'\`.,;:!?)\\]]/g;
  const codeSpan = (code) =>
    FILE.test(code) && !code.startsWith(".") ? '<a class="file" data-file="' + code + '">' + code + "</a>" : "<code>" + code + "</code>";
  const rich = (s) => esc(s).split(/(\`[^\`]+\`)/).map((part, i) =>
    i % 2 === 1 ? codeSpan(part.slice(1, -1)) : part.replace(URL, (u) => '<a class="url" data-url="' + u + '">' + u + "</a>")).join("");

  function add(el) {
    ui.history.prepend(el);
    return el;
  }

  function entry(cls, html) {
    const el = document.createElement("div");
    el.className = "entry " + cls;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }

  function addAgent(html) { return add(entry("agent", html)); }

  function addDivider(text) { add(entry("divider")).textContent = text; }

  function refLink(ref) {
    const a = document.createElement("a");
    a.className = "ref";
    a.textContent = ref.file + ":" + ref.line + (ref.endLine > ref.line ? "–" + ref.endLine : "");
    a.onclick = () => vscode.postMessage({ type: "open", file: ref.file, line: ref.line });
    return a;
  }

  function addYou(text, ref) {
    const el = entry("you", text ? rich(text) : "");
    if (ref) el.append(refLink(ref));
    add(el);
  }

  function addRun(id, command, phase, exitCode) {
    const el = entry("run");
    el.dataset.run = String(id);
    const cmd = document.createElement("span");
    cmd.className = "cmd";
    cmd.textContent = command;
    cmd.dataset.tip = command;
    const outcome = document.createElement("span");
    el.append(cmd, outcome);
    setOutcome(el, phase, exitCode);
    add(el);
  }

  function setOutcome(el, phase, exitCode) {
    const outcome = el.querySelector(".outcome") || el.lastElementChild;
    outcome.className = "outcome";
    el.classList.toggle("skipped", phase === "declined");
    if (phase === "declined") outcome.textContent = "⊘ skipped";
    else if (phase === "background") outcome.textContent = "still running";
    else if (exitCode === undefined) outcome.textContent = phase === "exited" ? "ended" : "done";
    else if (exitCode === 0) { outcome.classList.add("ok"); outcome.textContent = "✓ exit 0"; }
    // Interrupted (Ctrl+C) or terminated, like a server being restarted: not a failure.
    else if (exitCode === 130 || exitCode === 143) outcome.textContent = "■ stopped";
    else { outcome.classList.add("fail"); outcome.textContent = "✕ exit " + exitCode; }
  }

  const ompOn = () => omp.state !== "off";
  const attaching = () => (active || ompOn()) && selection !== null && !selectionDismissed;
  function syncAttach() {
    ui.attach.classList.toggle("on", attaching());
    if (attaching()) ui.attachRef.replaceChildren(refLink(selection));
  }

  // Fades something new in the band in, restarting the fade if it's still going.
  function arrive(el) {
    if (replaying) return;
    el.classList.remove("arrive");
    void el.offsetWidth;
    el.classList.add("arrive");
  }

  const voiceReady = () => voice.enabled && voice.state === "ready";

  function setNow(text) {
    if (current !== null) addAgent(rich(current));
    current = null;
    // Spoken words go straight to the history: the band keeps none of them big.
    if (voiceReady()) {
      const el = addAgent(rich(text));
      if (pointed) el.append(" ", pointed);
      pointed = null;
      return;
    }
    current = text;
    ui.now.className = "";
    ui.now.innerHTML = rich(text);
    // The agent points first, then says what's there.
    ui.ref.replaceChildren(...(pointed ? [pointed] : []));
    pointed = null;
    arrive(ui.now);
  }

  function setVoice(e) {
    const wasReady = voiceReady();
    voice = e;
    document.body.classList.toggle("voice", voiceReady());
    document.body.classList.toggle("voice-enabled", e.enabled);
    ui.voiceToggle.setAttribute("aria-pressed", String(e.enabled));
    // Only what needs saying shows in the row: loading and failing. The rest is in the tip.
    const words = !e.enabled ? "" : e.state === "loading" ? "Loading voice…" : e.state === "error" ? (e.detail || "Voice failed. Words show here.") : "";
    ui.voiceStatus.textContent = words;
    ui.voiceStatus.dataset.tip = words;
    const tip = !e.enabled ? "Voice off: hear the agent instead of reading it" : e.state === "ready" ? "Voice on: it speaks, and its words land in the history. Click to turn it off" : "Voice on: click to turn it off";
    setTip(ui.voice, tip);
    setTip(ui.voiceToggle, tip);
    if (voiceReady() && !wasReady && current !== null) {
      addAgent(rich(current));
      current = null;
    }
    syncTip();
  }

  // Typing sounds: a mechanical keyboard under the agent's typing, played from recordings of a real
  // switch (see media/keys), the way keyboard sound apps do it. Each keystroke is a press and, a
  // moment later, a release. A letter sounds like the row its key sits in, and space, enter and
  // backspace have their own sounds; a capital or a symbol is typed with Shift held, as hands do.
  // Each key has a pitch of its own, the same every time, as the keys of one board differ, and is
  // placed left or right where it sits. A word's first stroke lands harder than those rattled off
  // inside it, and harder strokes ring brighter. A short room around it all puts the keyboard on a
  // desk instead of in the ear. Quiet by design, and quieter still while the voice talks.
  const KEYS_RMS = 0.045;   // how loud a switch's presses are, on average, at full volume
  const KEYS_DUCK = 0.5;    // its share of that while the voice is talking
  const KEYS_ROOM = 0.14;   // how much of the room is heard, next to the keys themselves
  // The keys of a US layout, row by row from the numbers down, unshifted and shifted.
  const KEY_ROWS = [
    ["\`1234567890-=", "~!@#$%^&*()_+"],
    ["qwertyuiop[]\\\\", "QWERTYUIOP{}|"],
    ["asdfghjkl;'", "ASDFGHJKL:\\""],
    ["zxcvbnm,./", "ZXCVBNM<>?"],
  ];
  // GENERIC_R4 is the bottom row, where Shift sits.
  const KEY_FILES = {
    press: ["GENERIC_R0", "GENERIC_R1", "GENERIC_R2", "GENERIC_R3", "GENERIC_R4", "SPACE", "ENTER", "BACKSPACE"],
    release: ["GENERIC", "SPACE", "ENTER", "BACKSPACE"],
  };
  /** What a switch types when it's tried out in the picker. */
  const PREVIEW = "const name = \\"Ada\\";\\n";
  let typingSounds = { enabled: false, volume: 0.5, sounds: "", name: "" }, speaking = false;
  let audio = null, keysOut = null, samples = null, samplesFrom = "", lastKey = -1, lastShifted = false, previewRun = 0;
  const banks = {};   // each switch's recordings, by folder: loaded once, so trying them out is instant

  function keysAudio() {
    if (!audio) {
      audio = new AudioContext();
      audio.onstatechange = syncKeys;
      keysOut = audio.createGain();
      keysOut.gain.value = keysLevel();
      keysOut.connect(audio.destination);
      const room = audio.createConvolver();
      room.buffer = roomEcho();
      const wet = audio.createGain();
      wet.gain.value = KEYS_ROOM;
      keysOut.connect(room).connect(wet).connect(audio.destination);
    }
    if (audio.state === "suspended") audio.resume().catch(() => {});
    return audio;
  }

  // A small room's echo: a few early reflections off the desk and walls, then a soft tail gone in a
  // quarter second, darker as it fades, a little different in each ear. Scaled to unit energy, so
  // KEYS_ROOM alone sets how much of it is heard.
  function roomEcho() {
    const rate = audio.sampleRate, length = Math.round(rate * 0.25);
    const echo = audio.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = echo.getChannelData(ch);
      let dark = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate, keep = Math.min(0.9, t * 8);
        dark = dark * keep + (Math.random() * 2 - 1) * (1 - keep);
        data[i] = dark * Math.exp(-t / 0.05);
      }
      for (const ms of [6, 11, 17]) data[Math.round(rate * (ms + ch * 1.5) / 1000)] += 0.3;
      let energy = 0;
      for (const x of data) energy += x * x;
      const scale = 1 / Math.sqrt(energy);
      for (let i = 0; i < length; i++) data[i] *= scale;
    }
    return echo;
  }

  // A switch's recordings, from the folder the extension names. Switches are recorded louder or
  // softer: each is evened out by its presses' loudness, so every switch sits at the same level.
  function loadBank(from) {
    banks[from] ??= (async () => {
      const bank = { press: {}, release: {}, gain: 1 };
      await Promise.all(Object.entries(KEY_FILES).flatMap(([stroke, names]) => names.map(async (name) => {
        const response = await fetch(from + "/" + stroke + "/" + name + ".mp3");
        bank[stroke][name] = await audio.decodeAudioData(await response.arrayBuffer());
      })));
      let energy = 0, length = 0;
      for (const buffer of Object.values(bank.press)) {
        for (const x of buffer.getChannelData(0)) energy += x * x;
        length += buffer.length;
      }
      bank.gain = KEYS_RMS / Math.sqrt(energy / length);
      return bank;
    })().catch((error) => {
      console.error("AI Pair couldn't load the typing sounds:", error);
      delete banks[from];
      return null;
    });
    return banks[from];
  }

  // Keystrokes before the switch's recordings are in make no sound.
  async function useBank(from) {
    samplesFrom = from;
    samples = null;
    const bank = await loadBank(from);
    if (samplesFrom === from) samples = bank;
  }

  // Volume squared, the way ears hear it.
  const keysLevel = () => typingSounds.volume * typingSounds.volume * (speaking ? KEYS_DUCK : 1);

  // Steps back quickly when the voice starts and returns slowly, so gaps between sentences don't pump.
  function syncKeysLevel() {
    if (keysOut) keysOut.gain.setTargetAtTime(keysLevel(), audio.currentTime, speaking ? 0.04 : 0.5);
  }

  function setTypingSounds(e) {
    typingSounds = { enabled: e.enabled, volume: e.volume, sounds: e.sounds, name: e.name || "" };
    if (e.enabled) {
      keysAudio();
      if (e.sounds !== samplesFrom) void useBank(e.sounds);
    } else if (audio) audio.suspend().catch(() => {});
    syncKeysLevel();
    syncKeys();
  }

  // A webview may only make sound once it has had a click or key of its own; until then the keys
  // button asks for one, and clicking it lets the sound start rather than turning it off.
  function syncKeys() {
    const on = typingSounds.enabled, blocked = on && audio?.state !== "running";
    document.body.classList.toggle("typing-sounds", on);
    document.body.classList.toggle("keys-blocked", blocked);
    ui.keys.setAttribute("aria-pressed", String(on));
    ui.keysToggle.setAttribute("aria-pressed", String(on));
    ui.keysLabel.textContent = blocked ? "Click to hear" : "Key sounds";
    const named = typingSounds.name ? " (" + typingSounds.name + ")" : "";
    const tip = blocked ? "Click to let the key sounds play: the panel needs a click before it may make sound" : on ? "Key sounds on" + named + ": you hear the agent's keystrokes. Click to turn them off" : "Key sounds off: hear the agent's keystrokes, softly, under its voice";
    setTip(ui.keys, tip);
    setTip(ui.keysToggle, tip);
    syncTip();
  }

  function pressKey(text) {
    if (samples && typingSounds.enabled && audio?.state === "running") stroke(samples, text);
  }

  // A few words typed on a switch, on or off, so it can be chosen by ear. A newer try cuts this one short.
  async function previewKeys(from) {
    const run = ++previewRun;
    keysAudio();
    const bank = await loadBank(from);
    for (const ch of PREVIEW) {
      if (run !== previewRun || !bank) return;
      if (audio.state === "running") stroke(bank, ch);
      const { promise, resolve } = Promise.withResolvers();
      setTimeout(resolve, 65 + Math.random() * 45 + (/[\\s=;(]/.test(ch) ? 110 : 0));
      await promise;
    }
    if (run === previewRun && !typingSounds.enabled) audio.suspend().catch(() => {});
  }

  function stroke(bank, text) {
    const key = keyOf(text);
    const now = audio.currentTime, gap = now - lastKey;
    // Indentation lands all at once, unheard; and faster than fingers, as a fast type at high
    // speed can be, is one sound for the burst.
    if (!key || gap < 0.025) return;
    lastKey = now;
    const vary = (spread) => 1 + (Math.random() * 2 - 1) * spread;
    const force = (gap > 0.15 ? 1.1 : gap < 0.09 ? 0.92 : 1) * vary(0.08);
    const gain = bank.gain * force, rate = key.tone * vary(0.01);
    let at = now;
    // Shift goes down first, unless it's still held from the capital just before.
    if (key.shift && !(lastShifted && gap < 0.3)) {
      strike(bank.press.GENERIC_R4, now, gain * 0.55, 0.97, -0.5, force);
      at += 0.035;
    }
    lastShifted = !!key.shift;
    strike(bank.press[key.press], at, gain, rate, key.pan, force);
    // A finger holds a key down for a moment, never quite the same one.
    strike(bank.release[key.release], at + 0.05 + Math.random() * 0.06, gain * 0.8, rate, key.pan, force);
  }

  // Each key's own pitch, the same every time it's struck: within 3% either way.
  const toneOf = (ch) => 1 + ((((ch.charCodeAt(0) * 2654435761) >>> 0) % 61) - 30) / 1000;

  // Which recordings a keystroke sounds like, where its key sits from -1 (left) to 1 (right), its
  // pitch, and whether Shift is held for it. None for a run of whitespace: indentation.
  function keyOf(text) {
    if (text === "\\b") return { press: "BACKSPACE", release: "BACKSPACE", pan: 0.35, tone: 1 };
    if (text[0] === "\\n" || text[0] === "\\r") return { press: "ENTER", release: "ENTER", pan: 0.4, tone: 1 };
    if (text === " ") return { press: "SPACE", release: "SPACE", pan: 0, tone: 1 };
    if (text === "\\t") return { press: "GENERIC_R1", release: "GENERIC", pan: -0.4, tone: 0.98 };
    if (!text.trim()) return null;
    const ch = text[0];
    for (let row = 0; row < KEY_ROWS.length; row++) {
      const [plain, shifted] = KEY_ROWS[row];
      const shiftAt = shifted.indexOf(ch), at = shiftAt >= 0 ? shiftAt : plain.indexOf(ch);
      if (at >= 0) return { press: "GENERIC_R" + row, release: "GENERIC", pan: (at / (plain.length - 1) - 0.5) * 0.6, tone: toneOf(plain[at]), shift: shiftAt >= 0 };
    }
    return { press: "GENERIC_R2", release: "GENERIC", pan: 0, tone: toneOf(ch) };
  }

  function strike(buffer, at, gain, rate, pan, force) {
    if (!buffer) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    // Harder strokes ring brighter: a couple of decibels up top either way.
    const tone = audio.createBiquadFilter();
    tone.type = "highshelf";
    tone.frequency.value = 3500;
    tone.gain.value = (force - 1) * 25;
    const level = audio.createGain();
    level.gain.value = gain;
    const place = audio.createStereoPanner();
    place.pan.value = pan;
    source.connect(tone).connect(level).connect(place).connect(keysOut);
    source.start(at);
  }

  // A click or key in the panel lets sound start, should it have been held back until one. The keys
  // buttons decide for themselves, by whether sound was held back when they were clicked.
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, (e) => {
      if (typingSounds.enabled && !e.target.closest?.("#keys, #keys-toggle")) keysAudio();
    }, true);
  }

  // The reading pause fills a ring around the status dot.
  function startReading(ms) {
    if (replaying) return;
    reading = { ms, elapsed: 0, last: performance.now() };
    ui.dot.style.setProperty("--progress", "0");
    syncReading();
    requestAnimationFrame(tick);
  }

  function tick(t) {
    if (!reading) return;
    if (!paused) reading.elapsed += t - reading.last;
    reading.last = t;
    const f = Math.min(1, reading.elapsed / reading.ms);
    ui.dot.style.setProperty("--progress", String(f));
    if (f >= 1) { reading = null; syncReading(); return; }
    requestAnimationFrame(tick);
  }

  function syncReading() { ui.dot.classList.toggle("reading", reading !== null); }

  const STATUS = {
    typing: ["", "Agent is typing"],
    read: ["read", "Read this"],
    running: ["", "Running a command"],
    thinking: ["think", "Agent is thinking"],
    paused: ["dim", "Paused"],
    listening: ["ring", "Your move"],
    navigator: ["ring", "Your turn"],
  };

  /** Seconds as "8s" or "1:05". */
  function elapsed(ms) {
    const s = Math.floor(ms / 1000);
    return s < 60 ? s + "s" : Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function syncStatus() {
    if (!active) {
      clearInterval(statusClock);
      statusClock = null;
      ui.dot.className = "dot off";
      ui.status.textContent = "No session";
      return;
    }
    let [cls, text] = runConfirming ? ["read", "Needs you: allow the command?"] : STATUS[state] || ["", "Session started"];
    if (!runConfirming && state === "thinking") {
      // What the agent is looking into, when it's OMP and says; a clock, so a long think reads as
      // work going on, and a stuck agent as one.
      if (omp && omp.activity) text = omp.activity;
      const ms = Date.now() - thinkingSince;
      text += " · " + elapsed(ms) + (ms > 90000 ? " · no word from it yet" : "");
    } else if (!runConfirming && (state === "typing" || state === "read" || state === "running")) {
      if (ahead > 0) text += " · " + ahead + " more ready";
      if (working) text += " · writing more";
    }
    ui.dot.className = "dot " + cls;
    syncReading();
    ui.status.textContent = text;
  }

  function setState(e) {
    if (e.state === "thinking" && state !== "thinking") thinkingSince = Date.now();
    state = e.state; turn = e.turn; paused = e.paused; ahead = e.ahead || 0; working = !!e.working;
    clearInterval(statusClock);
    statusClock = state === "thinking" ? setInterval(syncStatus, 1000) : null;
    document.body.classList.toggle("paused", paused);
    document.body.classList.toggle("user-turn", turn === "user");
    ui.pause.classList.toggle("on", paused);
    ui.pause.setAttribute("aria-label", paused ? "Resume" : "Pause");
    setTip(ui.pause, paused ? "Resume (Space)" : "Pause (Space)");
    ui.turnLabel.textContent = turn === "user" ? "Hand back" : "My turn";
    ui.turn.setAttribute("aria-label", ui.turnLabel.textContent);
    setTip(ui.turn, turn === "user" ? "Hand the turn back to the agent, with your reply if you typed one" : "Take the turn: you drive, the agent navigates");
    syncStatus();
    syncTip();
  }

  function setActive(on) {
    active = on;
    document.body.classList.toggle("active", on);
    ui.reply.disabled = !(on || ompOn());
    if (!on) {
      reading = null;
      runId = null; runConfirming = false; ui.run.className = "";
      closeSpeedMenu();
      if (ompOn()) ui.reply.placeholder = "Ask OMP…";
    } else {
      ui.reply.placeholder = turn === "user" ? "Ask the agent…" : "Reply to the agent…";
    }
    syncStatus();
    syncAttach();
    syncTip();
  }

  function setOmp(e) {
    omp = e;
    document.body.classList.toggle("omp", ompOn());
    document.body.classList.toggle("omp-busy", e.state === "busy");
    ui.reply.disabled = !(active || ompOn());
    if (!active) ui.reply.placeholder = ompOn() ? "Ask OMP…" : "Reply to the agent…";
    ui.ompStart.disabled = e.state === "starting";
    ui.ompDot.className = "dot " + e.state;
    const doing = e.state === "busy" && e.activity ? e.activity : { starting: "Starting…", ready: "Ready", busy: "Working…" }[e.state] || "";
    ui.ompState.textContent = [doing, e.detail].filter(Boolean).join(" · ");
    ui.ompState.dataset.tip = ui.ompState.textContent;
    // The provider is in the tip; the pill has room for the model's own name.
    ui.ompModelName.textContent = e.model ? e.model.split("/").pop() : "Model";
    setTip(ui.ompModel, e.model ? "Model: " + e.model + ". Click to change it" : "Choose the model OMP uses");
    // How hard it thinks: OMP's own levels for this model, changed from a menu at any point.
    // Another agent's level is its own app's to set, so the chip only says so.
    const levels = e.thinkingLevels || [];
    ui.ompThink.disabled = !ompOn() || levels.length === 0;
    ui.ompThinkName.textContent = ompOn() && e.thinking ? thinkLabel(e.thinking) : "Thinking";
    setTip(ui.ompThink, !ompOn() ? "Your agent's thinking level is set in its own app" :
      e.thinking ? "Thinking: " + thinkLabel(e.thinking) + ". Click to change it" : "How hard the model thinks");
    ui.thinkMenu.replaceChildren(...levels.map((level) => {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", String(level === e.thinking));
      b.textContent = thinkLabel(level);
      b.onclick = () => { closeThinkMenu(); ui.ompThink.focus(); vscode.postMessage({ type: "ompThinking", level }); };
      return b;
    }));
    if (ui.ompThink.disabled) closeThinkMenu();
    // Off, a reason it stopped shows by the Start button.
    ui.ompStatus.textContent = e.state === "off" ? e.detail || "" : "";
    ui.ompStatus.dataset.tip = ui.ompStatus.textContent;
    if (!active && ompOn() && !ui.idle.classList.contains("ended")) {
      ui.idleText.textContent = OMP_INTRO;
    } else if (!active && !ompOn() && ui.idleText.textContent === OMP_INTRO) {
      ui.idleText.innerHTML = IDLE_INTRO;
    }
    syncAttach();
    syncStatus();
    syncTip();
  }

  const THINK_LABELS = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
  function thinkLabel(level) { return THINK_LABELS[level] || level; }

  function addOmp(e) {
    if (e.role === "note") { addDivider(e.text); return; }
    let el = ompEntries[e.id];
    if (!el) {
      el = add(entry(e.role === "tool" ? "tool" : "agent"));
      ompEntries[e.id] = el;
    }
    if (e.role === "tool") el.textContent = e.text;
    else el.innerHTML = rich(e.text);
  }

  function handle(e) {
    switch (e.type) {
      case "replay":
        replaying = true;
        for (const ev of e.events) handle(ev);
        replaying = false;
        return;
      case "session":
        if (e.active) {
          if (current !== null) addAgent(rich(current));
          current = null;
          state = null;
          ui.now.className = "empty";
          ui.now.textContent = "Waiting for the agent…";
          ui.ref.innerHTML = "";
          pointed = null;
          addDivider("Session started" + (e.task ? ": " + e.task : ""));
          ui.idle.classList.remove("ended");
          setActive(true);
        } else {
          if (current !== null) addAgent(rich(current));
          current = null;
          const why = { agent: "The agent ended the session", user: "You ended the session", disconnected: "The agent disconnected" }[e.reason];
          addDivider(why);
          ui.idle.classList.add("ended");
          ui.idleTitle.textContent = e.reason === "disconnected" ? "The agent disconnected" : "Session ended";
          ui.idleSummary.innerHTML = e.summary ? rich(e.summary) : "";
          ui.idleText.textContent = ompOn() ? "OMP is still here. Say what to do next." : "Ask your agent to pair again, or start OMP here.";
          setActive(false);
        }
        return;
      case "say": setNow(e.text); return;
      case "reading": startReading(e.ms); return;
      case "state": setState(e); return;
      case "user": addYou(e.text, e.ref); return;
      case "interrupt": addDivider("You interrupted"); return;
      case "turn":
        addDivider(e.to === "user" ? "You took the turn" : "You handed the turn back");
        if (e.message || e.ref) addYou(e.message, e.ref);
        ui.reply.placeholder = e.to === "user" ? "Ask the agent…" : "Reply to the agent…";
        return;
      case "point": {
        const a = document.createElement("a");
        a.className = "ref";
        a.textContent = "→ " + e.file + ":" + e.line;
        a.onclick = () => vscode.postMessage({ type: "open", file: e.file, line: e.line });
        pointed = a;
        return;
      }
      case "run": {
        if (e.phase === "confirm" || e.phase === "running") {
          runId = e.id;
          runConfirming = e.phase === "confirm";
          ui.run.className = "on" + (runConfirming ? " confirm" : "");
          ui.runLabel.textContent = runConfirming ? "Allow this command in the terminal?" : "Running in the terminal…";
          ui.runCmd.textContent = e.command;
          // Only a plain command has a program to allow: chained or piped ones could run anything.
          ui.runProgram.hidden = !e.program;
          if (e.program) {
            ui.runProgram.textContent = "Allow " + e.program;
            ui.runProgram.dataset.tip = "Run it, and every " + e.program + " command without asking until the session ends";
          }
          syncStatus();
          if (runConfirming) arrive(ui.run);
          return;
        }
        if (e.phase === "exited") {
          // A command left running has ended: its row says how.
          const row = ui.history.querySelector('.run[data-run="' + e.id + '"]');
          if (row) setOutcome(row, e.phase, e.exitCode);
          return;
        }
        if (runId === e.id) { runId = null; runConfirming = false; ui.run.className = ""; syncStatus(); }
        addRun(e.id, e.command, e.phase, e.exitCode);
        return;
      }
      case "selection":
        selection = e.ref || null;
        selectionDismissed = false;
        syncAttach();
        return;
      case "focusReply": ui.reply.focus(); return;
      case "ompState": setOmp(e); return;
      case "voiceState": setVoice(e); return;
      case "typingSounds": setTypingSounds(e); return;
      case "speaking": speaking = e.speaking; syncKeysLevel(); return;
      case "key": pressKey(e.text); return;
      case "keysPreview": void previewKeys(e.sounds); return;
      case "ompChat": addOmp(e); return;
      case "ompDraft": ui.reply.value = e.text; syncDraft(); return;
      case "speed": {
        // One decimal, so the menu's speeds line up; a setting with more keeps them.
        const label = (Number.isInteger(e.value * 10) ? e.value.toFixed(1) : String(e.value)) + "×";
        ui.speed.textContent = label;
        ui.speed.setAttribute("aria-label", "Playback speed: " + label);
        for (const b of ui.speedMenu.querySelectorAll("button")) {
          b.setAttribute("aria-checked", String(Math.abs(Number(b.dataset.speed) - e.value) < 0.01));
        }
        return;
      }
    }
  }

  window.addEventListener("message", (m) => handle(m.data));

  let draftEmpty = true;
  function syncDraft() {
    const empty = ui.reply.value.trim() === "";
    ui.reply.style.height = "auto";
    ui.reply.style.height = Math.min(ui.reply.scrollHeight, 120) + "px";
    if (empty !== draftEmpty) { draftEmpty = empty; vscode.postMessage({ type: "draft", empty }); }
  }
  function takeDraft() {
    const text = ui.reply.value.trim();
    ui.reply.value = "";
    draftEmpty = true;
    syncDraft();
    return text;
  }
  function takeAttach() {
    const on = attaching();
    if (on) { selectionDismissed = true; syncAttach(); }
    return on;
  }
  function sendReply() {
    const text = takeDraft();
    if (text) vscode.postMessage({ type: "reply", text, attach: takeAttach() });
  }

  ui.reply.addEventListener("input", syncDraft);
  ui.reply.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendReply();
    } else if (e.key === "Escape") {
      ui.reply.blur();
    }
  });
  ui.send.onclick = sendReply;
  ui.pause.onclick = () => vscode.postMessage({ type: paused ? "resume" : "pause" });
  ui.interrupt.onclick = () => vscode.postMessage({ type: "interrupt" });
  ui.turn.onclick = () => {
    const handingBack = turn === "user";
    const message = handingBack ? takeDraft() : "";
    const attach = handingBack && takeAttach();
    vscode.postMessage({ type: "turn", ...(message ? { message } : {}), ...(attach ? { attach } : {}) });
  };
  ui.attachX.onclick = () => { selectionDismissed = true; syncAttach(); };
  const decide = (run, allow) => { if (runId !== null) vscode.postMessage({ type: "runDecision", id: runId, run, allow }); };
  ui.runGo.onclick = () => decide(true);
  ui.ompStart.onclick = () => vscode.postMessage({ type: "ompStart" });
  ui.ompStop.onclick = () => vscode.postMessage({ type: "ompStop" });
  ui.ompAbort.onclick = () => vscode.postMessage({ type: "ompAbort" });
  ui.ompNew.onclick = () => vscode.postMessage({ type: "ompNew" });
  ui.voice.onclick = () => vscode.postMessage({ type: "voiceToggle" });
  ui.voiceToggle.onclick = () => vscode.postMessage({ type: "voiceToggle" });
  ui.voicePick.onclick = () => vscode.postMessage({ type: "voicePick" });
  const toggleTypingSounds = () => {
    // A click may start sound where nothing else can. While sound waits for one, this is that click.
    if (typingSounds.enabled && audio?.state !== "running") { keysAudio(); return; }
    if (!typingSounds.enabled) keysAudio();
    vscode.postMessage({ type: "typingSoundsToggle" });
  };
  ui.keys.onclick = toggleTypingSounds;
  ui.keysToggle.onclick = toggleTypingSounds;
  // This click is also what lets the picker's tries make sound: the list itself is outside the panel.
  ui.keysPick.onclick = () => { keysAudio(); vscode.postMessage({ type: "typingSoundPick" }); };
  ui.ompModel.onclick = () => vscode.postMessage({ type: "ompModel" });
  ui.runProgram.onclick = () => decide(true, "program");
  ui.runAll.onclick = () => decide(true, "all");
  ui.runSkip.onclick = () => decide(false);
  ui.end.onclick = () => vscode.postMessage({ type: "end" });

  function closeSpeedMenu() {
    ui.speedMenu.hidden = true;
    ui.speed.setAttribute("aria-expanded", "false");
    ui.speed.classList.remove("on");
  }
  ui.speed.onclick = (e) => {
    e.stopPropagation();
    const open = ui.speedMenu.hidden;
    ui.speedMenu.hidden = !open;
    ui.speed.setAttribute("aria-expanded", String(open));
    ui.speed.classList.toggle("on", open);
    if (open) ui.speedMenu.querySelector('[aria-checked="true"]')?.focus();
  };
  for (const b of ui.speedMenu.querySelectorAll("button")) {
    b.onclick = () => { closeSpeedMenu(); ui.speed.focus(); vscode.postMessage({ type: "speed", value: Number(b.dataset.speed) }); };
  }
  document.addEventListener("click", (e) => { if (!ui.speedMenu.hidden && !ui.speedMenu.contains(e.target)) closeSpeedMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ui.speedMenu.hidden) { closeSpeedMenu(); ui.speed.focus(); } });

  function closeThinkMenu() {
    ui.thinkMenu.hidden = true;
    ui.ompThink.setAttribute("aria-expanded", "false");
  }
  ui.ompThink.onclick = (e) => {
    e.stopPropagation();
    const open = ui.thinkMenu.hidden;
    ui.thinkMenu.hidden = !open;
    ui.ompThink.setAttribute("aria-expanded", String(open));
    if (open) ui.thinkMenu.querySelector('[aria-checked="true"]')?.focus();
  };
  document.addEventListener("click", (e) => { if (!ui.thinkMenu.hidden && !ui.thinkMenu.contains(e.target)) closeThinkMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ui.thinkMenu.hidden) { closeThinkMenu(); ui.ompThink.focus(); } });

  // Tooltips: an element's data-tip shows under it after a moment's hover, or at once while one is
  // showing or just was, the way VS Code's own hovers do; and on keyboard focus. A click hides it.
  const TIP_DELAY_MS = 500, TIP_WARM_MS = 300, TIP_GAP = 4, TIP_MARGIN = 6;
  let tipTarget = null, tipTimer = 0, tipWarmUntil = 0;

  function setTip(el, text) {
    el.dataset.tip = text;
    if (el === tipTarget) { ui.tip.textContent = text; placeTip(); }
  }

  function showTip(el) {
    clearTimeout(tipTimer);
    if ((el === ui.speed && !ui.speedMenu.hidden) || (el === ui.ompThink && !ui.thinkMenu.hidden)) return;
    tipTarget = el;
    ui.tip.textContent = el.dataset.tip;
    ui.tip.hidden = false;
    el.setAttribute("aria-describedby", "tip");
    placeTip();
  }

  // Under the element, centered on it, inside the panel; above it if there's no room below.
  function placeTip() {
    const r = tipTarget.getBoundingClientRect(), w = ui.tip.offsetWidth, h = ui.tip.offsetHeight;
    const left = Math.max(TIP_MARGIN, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - TIP_MARGIN));
    const top = r.bottom + TIP_GAP + h <= innerHeight - TIP_MARGIN ? r.bottom + TIP_GAP : r.top - TIP_GAP - h;
    ui.tip.style.left = left + "px";
    ui.tip.style.top = Math.max(TIP_MARGIN, top) + "px";
  }

  function hideTip() {
    clearTimeout(tipTimer);
    if (!tipTarget) return;
    tipTarget.removeAttribute("aria-describedby");
    tipTarget = null;
    ui.tip.hidden = true;
    tipWarmUntil = performance.now() + TIP_WARM_MS;
  }

  function hoverTip(el) {
    if (el === tipTarget) return;
    const warm = tipTarget !== null || performance.now() < tipWarmUntil;
    hideTip();
    if (!el) return;
    if (warm) showTip(el);
    else tipTimer = setTimeout(() => showTip(el), TIP_DELAY_MS);
  }

  // The element went away or moved, when the panel changed under it.
  function syncTip() {
    if (!tipTarget) return;
    if (tipTarget.getClientRects().length === 0) hideTip();
    else placeTip();
  }

  document.addEventListener("pointerover", (e) => hoverTip(e.target.closest("[data-tip]")));
  document.documentElement.addEventListener("pointerleave", () => hoverTip(null));
  document.addEventListener("pointerdown", hideTip, true);
  document.addEventListener("focusin", (e) => { if (e.target.matches("[data-tip]:focus-visible")) showTip(e.target); });
  document.addEventListener("focusout", (e) => { if (e.target === tipTarget) hideTip(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); }, true);
  document.addEventListener("scroll", hideTip, true);
  window.addEventListener("blur", hideTip);

  // Space pauses and resumes, anywhere in the panel but the reply box. It doesn't press the focused
  // button, which after a click could be End; Enter still does.
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || !active) return;
    if (e.target === ui.reply) return;
    e.preventDefault();
    if (e.repeat || turn === "user") return;
    vscode.postMessage({ type: paused ? "resume" : "pause" });
  });

  // File names in messages open the file, URLs open in the browser, and the intro's commands run.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.file, a.url, a.command");
    if (a?.dataset.file) vscode.postMessage({ type: "openFile", file: a.dataset.file });
    if (a?.dataset.url) vscode.postMessage({ type: "openUrl", url: a.dataset.url });
    if (a?.dataset.command) vscode.postMessage({ type: "command", command: a.dataset.command });
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`
}
