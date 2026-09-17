# Session playback — design

## Goal

A static, GitHub-Pages-hosted webpage that replays a real Claude Code session
(the `sundial-cafe-frontend` image-upload-dialog session) as a semi-interactive,
terminal-styled playback — to show other people how the user works with Claude.
No backend, no build step, no tests. Throwaway one-off; code quality is not a
concern.

## Source material

- Session transcript: `~/.claude/projects/-home-ross-workspace-sundial-cafe-frontend/b5eb8184-3cdb-4604-8480-f07cf1eb1567.jsonl`
  (still growing at spec-writing time; only the portion through the end of
  subagent-driven-development is in scope — see Content Scope).
- Referenced spec/plan docs under that project's `docs/superpowers/` — vendored
  (copied) into this repo so links resolve for a public audience, since the
  source repo is private.

## Content scope

Two regimes, back to back:

1. **Full conversation, pre-subagent-driven-development.** Every user/assistant
   exchange from the start of the brainstorming skill invocation through the
   end of the writing-plans skill (i.e. up to but not including the first
   "Implement Task N" agent dispatch). Rendered as a normal message stream.
2. **Subagent-driven-development, compacted into a dedicated visualization.**
   Not shown as conversation — shown as task blocks (see Data Model). Ends
   with the final wrap-up message produced at the end of that skill, which
   *is* shown as a normal message. Anything after that final message is
   ignored.

Within regime 1, tool activity between primary text messages (file reads,
greps, edits, bash commands, the brainstorming skill's parallel adversarial
spec-review agents, etc.) is not shown blow-by-blow — it's compacted into a
single one-line summary of what happened, inserted between the primary
messages it occurred between.

The very first "user" turn (the slash-command invocation) and the synthetic
turn that follows it (the injected skill file contents) are not real
conversation — the extraction collapses them to a single clean turn showing
just the command name and the user's actual argument text.

## Architecture

Plain static site, no build step:

```
index.html          playback page (terminal + task-block viz + docs panel)
doc.html             generic markdown doc viewer (?file=<path>)
css/style.css
js/playback.js       playback state machine + rendering
data/content.json    curated playback content (the "beats" — see below)
docs-vendor/...       copied .md files, referenced by doc.html
scripts/
  extract_skeleton.py  one-off aid: dumps raw structured skeleton from the
                        session JSONL to speed up hand-authoring content.json
                        (not part of the deployed site)
```

Markdown rendering (marked.js) and syntax highlighting (highlight.js) are
pulled from a CDN in both `index.html` and `doc.html`.

Deployment: enable GitHub Pages on the repo's default branch, root directory.
Nothing to build.

## Data model

`data/content.json` is a flat, ordered array of **beats**. Each beat is one
step for manual next/back navigation. The renderer switches on `type`:

- `user` — `{ type: "user", text }` — rendered with the typewriter effect.
- `assistant` — `{ type: "assistant", text }` — markdown-rendered, syntax
  highlighted.
- `activity` — `{ type: "activity", text }` — a single dim/muted line
  summarizing tool activity that happened between two primary messages.
- `task-section` — belongs to the subagent-driven-development visualization:
  `{ type: "task-section", task: "Task 2: API profile image endpoints",
  kind: "implementation" | "spec-review" | "code-review" | "fix", round,
  summary, verdict }`. Consecutive `task-section` beats render into a
  stacked, block-per-task card layout (one card per task, sections appended
  within it in order) rather than the terminal stream. The terminal stream
  resumes with the next non-`task-section` beat.

Any beat may optionally carry `docsAdded: [{ path, label }]` — paths under
`docs-vendor/`. When a beat with `docsAdded` plays, those entries appear in
the persistent docs side panel (which otherwise just accumulates for the
rest of playback — nothing is ever removed from it).

`scripts/extract_skeleton.py` reads the session JSONL and writes a raw
skeleton (classified turns, tool-call groups, agent call descriptions and
results) to speed up writing `content.json` by hand. `content.json` itself
is hand-authored content, committed directly — the script is a one-time
authoring aid, not regenerated/reconciled automatically.

Vendoring docs is manual: as referenced files are identified while authoring
`content.json`, copy them into `docs-vendor/` preserving their path under
`docs/superpowers/`.

## UI / interaction

**Layout:** dark terminal window (monospace font, macOS-style traffic-light
chrome, a title like `claude — sundial-cafe-frontend`) as the main column;
persistent docs panel alongside it (stacks below on narrow screens). A short
(2-3 sentence) intro sits above the terminal, explaining what this is.
Playback controls sit below: Play/Pause, Step back, Step forward.

**Styling:** user lines prefixed with an accent-colored `❯`; assistant lines
labeled distinctly (different accent color); activity lines small, dim,
prefixed with `·`. Task-section cards are visually distinct from the
terminal stream — bordered, one card per task, a small icon per section kind
(implementation / spec-review / code-review / fix) plus a pass/fail badge
where applicable, and the one-line summary text.

**Playback modes:**
- *Paused / manual step:* Next/Prev instantly reveals/hides one beat, no
  animation.
- *Play:* auto-advances through beats with fake short delays — user beats
  type out character by character with a blinking cursor; assistant beats
  appear as a brief "responding" pulse (not char-by-char, to keep markdown
  legible) then render fully formatted; activity and task-section beats
  appear quickly with minimal delay. Play can be paused at any time; Step
  buttons work whether playing or paused.
- There is no time-based scrubber — navigation is purely by beat sequence.

**Doc viewer (`doc.html`):** reads `?file=`, fetches the vendored `.md` file,
renders it client-side with marked.js + highlight.js, styled as a clean
readable document (not the terminal theme). Opens in a new tab. A fetch
failure shows a simple inline error.

## Error handling

None beyond the doc-viewer fetch-failure message above — this is static
curated content with no user input and no backend; there's nothing else
that can meaningfully fail at runtime.

## Out of scope

- Tests, CI, linting.
- Any content after the subagent-driven-development skill's final message.
- Blow-by-blow tool-call rendering.
- Time-accurate pacing (all delays are fake/short, sequence-only).
- Automatic regeneration/reconciliation of `content.json` from the live
  session (it's hand-authored once, from wherever the session has reached).
