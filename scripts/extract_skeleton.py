#!/usr/bin/env python3
"""One-off aid: dump a raw structured skeleton from a Claude Code session
JSONL to speed up hand-authoring data/content.json. Not part of the deployed
site."""
import json
import sys

TOOL_SUMMARY_IGNORE = {"TodoWrite"}


def load(path):
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def text_of(content):
    if isinstance(content, str):
        return content
    parts = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
    return "\n".join(parts).strip()


def tool_uses_of(content):
    out = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                out.append(block)
    return out


def main():
    path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else None
    events = []

    for obj in load(path):
        t = obj.get("type")
        if obj.get("isSidechain"):
            continue  # inside a subagent; not top-level conversation
        if t == "user":
            msg = obj.get("message", {})
            content = msg.get("content")
            txt = text_of(content)
            if txt:
                events.append({
                    "kind": "user_text",
                    "ts": obj.get("timestamp"),
                    "text": txt,
                })
            # tool_result blocks inside user turns are noise here; skipped
        elif t == "assistant":
            msg = obj.get("message", {})
            content = msg.get("content")
            txt = text_of(content)
            if txt:
                events.append({
                    "kind": "assistant_text",
                    "ts": obj.get("timestamp"),
                    "text": txt,
                })
            for tu in tool_uses_of(content):
                name = tu.get("name")
                if name in TOOL_SUMMARY_IGNORE:
                    continue
                inp = tu.get("input", {})
                if name == "Agent":
                    events.append({
                        "kind": "agent_call",
                        "ts": obj.get("timestamp"),
                        "subagent_type": inp.get("subagent_type"),
                        "description": inp.get("description"),
                        "prompt": (inp.get("prompt") or "")[:400],
                    })
                else:
                    summary_bits = {
                        "Read": inp.get("file_path"),
                        "Edit": inp.get("file_path"),
                        "Write": inp.get("file_path"),
                        "Grep": inp.get("pattern"),
                        "Glob": inp.get("pattern"),
                        "Bash": inp.get("description") or inp.get("command"),
                        "WebFetch": inp.get("url"),
                        "WebSearch": inp.get("query"),
                    }.get(name)
                    events.append({
                        "kind": "tool_call",
                        "ts": obj.get("timestamp"),
                        "tool": name,
                        "detail": summary_bits,
                    })

    if out_path:
        with open(out_path, "w") as f:
            json.dump(events, f, indent=2)
        print(f"wrote {len(events)} events to {out_path}", file=sys.stderr)
    else:
        json.dump(events, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
