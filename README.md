# Session playback

A static site that replays a real Claude Code session (the `sundial-cafe-frontend`
image-upload-dialog session) as a terminal-styled, semi-interactive playback.
See `docs/superpowers/specs/2026-09-17-session-playback-design.md` for the design.

## Running it

No build step. From this directory:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Regenerating `data/content.json`

The content is hand-authored, not auto-generated, but two scripts helped build it:

1. `scripts/extract_skeleton.py <session.jsonl> <out.json>` — dumps a raw
   structured skeleton (primary text turns, tool-call groups, agent calls)
   from a Claude Code session transcript.
2. `scripts/build_content.py` — assembles `data/content.json` from that
   skeleton plus hand-written activity summaries and the
   subagent-driven-development task-block data. It currently reads from
   `/tmp/pre_sdd.json` (a filtered slice of the skeleton, pre-dating the
   subagent-driven-development phase) — re-run `extract_skeleton.py` and
   re-slice if the source session changes.

If the source session finishes and you want to extend the playback with the
remaining tasks and the skill's closing message, redo this process from the
current end point (the last `task-section` beat).
