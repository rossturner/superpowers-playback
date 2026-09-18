#!/usr/bin/env python3
"""Hand-authored assembly of data/content.json from the extracted skeleton.
One-off script for this project; not meant to be reusable."""
import json
import re

PRE_SDD = json.load(open("/tmp/pre_sdd.json"))

FILES = [
    {"path": "specs/2026-09-17-image-upload-dialog-design.md",
     "label": "Design spec — image upload dialog"},
    {"path": "plans/2026-09-17-image-upload-dialog.md",
     "label": "Implementation plan — 10 tasks"},
]

beats = []


def u(idx):
    beats.append({"type": "user", "text": PRE_SDD[idx]["text"]})


def a(idx, docs_revealed=None):
    beat = {"type": "assistant", "text": PRE_SDD[idx]["text"]}
    if docs_revealed:
        beat["docsRevealed"] = docs_revealed
    beats.append(beat)


def act(text, docs_revealed=None):
    beat = {"type": "activity", "text": text}
    if docs_revealed:
        beat["docsRevealed"] = docs_revealed
    beats.append(beat)


def u_custom(text):
    beats.append({"type": "user", "text": text})


def a_custom(text):
    beats.append({"type": "assistant", "text": text})


# --- first turn: clean up the slash-command invocation ---
raw0 = PRE_SDD[0]["text"]
cmd_name = re.search(r"<command-name>(.*?)</command-name>", raw0).group(1)
cmd_args = re.search(r"<command-args>(.*?)</command-args>", raw0, re.S).group(1)
u_custom(f"{cmd_name}\n\n{cmd_args}")

a(2)
act("Read the image-handling doc, roadmap, and the API's upload/poll endpoint "
    "contracts; checked the existing PhotoField and profile write actions, and "
    "how a photo attaches to a profile.")
a(10)
u(11)
act("Checked whether a profile write clears fields it omits, and how the night "
    "write detaches the old image.")
a(14)
u(15)
a(16)
u(17)
a(18)
u(19)
a(20)
act("Checked the API's actual check-pipeline timeouts and retry schedule, "
    "rather than trust the contract's own description of them.")
a(23)
u(24)
act("Checked the pica package and Next's server-action body-size limits.")
a(26)
u(27)
a(28)
act("Read the API fetcher, its git history, the proxy's refresh logic, and the "
    "generated client's cookie handling.")
a(32)
u(33)
a(34)
act("Looked at how the prentora frontend refreshes an expired access token on a "
    "401 — its axios instance, and the refresh endpoint's actual behaviour.")
a(38)
u(39)
a(40)
u(41)
a(42)
act("Read the API's image reducer and how it extracts EXIF data from an "
    "uploaded file.")
a(45)
u(46)
a(47)
u(48)
a(49)
u(50)
a(51)
act("Read both testing-strategy documents to ground the plan's testing section.")
a(53)
u(54)
a(55)
u(56)
a(57)
u(58)
a(59)
u(60)
act("Checked a recent spec's format, the roadmap's night-profile lines, and the "
    "sibling API repo's current state.")
a(63)
act("Checked whether an uploader can delete an image mid-check, the reaper and "
    "unattached-delete conditions, and the routing builders — then wrote the "
    "design spec and committed it.",
    docs_revealed=["specs/2026-09-17-image-upload-dialog-design.md"])
a(70)
act("Read the spec-reviewer prompt template, then dispatched four parallel "
    "adversarial reviewers: API integration, frontend conventions, browser "
    "image pipeline, and safety & lifecycle.")
a(76)
a(78)
a(80)
a(82)
a(84)

a_custom(
    "The safety and lifecycle review raised four open decisions rather than "
    "plain errors:\n\n"
    "1. **Mid-check deletion.** An uploader can delete an image while it's "
    "still `PENDING`/`CHECKING`, before hash matching answers — no record, no "
    "operator alert. Close that gap here, or leave it as a separate roadmap "
    "line?\n"
    "2. **Night gates.** `POST /api/member/images?side=NIGHT` currently has no "
    "gate. Gate upload and PUT but not DELETE, gate all three, or leave upload "
    "ungated as written?\n"
    "3. **Location data.** The EXIF segment we now deliberately extract can "
    "carry GPS coordinates. The API description, the privacy notice and the "
    "Children's Code assessment all currently claim no location data is kept. "
    "Amend all three, or record why no change is needed?\n"
    "4. **Untouched uploads.** Which file types skip the browser resize "
    "entirely when already within 1280px? Java's reader can't decode a CMYK "
    "JPEG, may not decode an animated WebP, and likely ignores a Display P3 "
    "colour profile. RGB JPEG only, or JPEG/PNG/WebP as written?"
)
u_custom(
    "1. They wouldn't be able to delete from the UI until the image is "
    "accepted and shown, so I'm not concerned about the edge case of calling "
    "the API directly mid-check.\n"
    "2. Gate upload and PUT, not DELETE.\n"
    "3. Record why no change is needed.\n"
    "4. RGB JPEG only."
)

act("Folded the reviewers' findings into the spec and committed the revision.")
a(89)
u(90)
act("Found the roadmap's pre-launch section and pointed the spec at the right "
    "roadmap line; committed both repositories.")
act("Invoked the writing-plans skill.")
a(98)
act("Read the API's conventions, migrations and test strategy, the profile "
    "services and repositories, the request DTOs, the controllers, and the "
    "image-upload contract.")
a(107)
act("Read the hash-match recording and error codes, existing test helpers and "
    "fixtures, the generated frontend client, dialog and workbench patterns, "
    "and the tone guide.")
a(123)
act("Checked service constructors, existing imageId tests, generated types, "
    "login-redirect handling and the roadmap's image lines.")
a(129)
act("Wrote the ten-task implementation plan, fixed a poll-count/abort test "
    "detail, and committed it.",
    docs_revealed=["plans/2026-09-17-image-upload-dialog.md"])
a(132)
u_custom("/compact")
act("Compacted the session context, then resumed from its summary.")
u_custom("/superpowers-ross:subagent-driven-development")

# --- subagent-driven-development: task-section beats ---
TASKS = [
    {
        "title": "Task 1: browser measurements",
        "sections": [
            {"kind": "implementation",
             "summary": "Measured how Chromium, Firefox and WebKit decode and "
                         "resize large, rotated photographs; wrote a "
                         "committed findings document.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "Passed — the measurements support the plan as "
                         "written, so Task 5 needs no changes.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 2: API profile image endpoints",
        "sections": [
            {"kind": "implementation",
             "summary": "Built the PUT/DELETE profile-image endpoints for "
                         "the day and night profile sides.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "One finding accepted as real (a missing unit test); "
                         "a flagged night-gate concern turned out to already "
                         "be handled correctly.",
             "verdict": "1 issue"},
            {"kind": "code-review",
             "summary": "Ran alongside the spec review; between them, two "
                         "missing-test gaps turned up (a missing unit test, "
                         "and no test for the cooldown-bump behaviour on "
                         "image attach).",
             "verdict": "2 issues"},
            {"kind": "fix", "round": 1,
             "summary": "Implementer added the two missing tests.",
             "verdict": "fix applied"},
            {"kind": "code-review", "round": 1,
             "summary": "Re-review confirmed the fixes — Task 2 is clean and "
                         "marked complete.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 5: browser photo preparation",
        "sections": [
            {"kind": "implementation",
             "summary": "Built the browser-side photo preparation using "
                         "Task 1's measurements, deliberately using a "
                         "different divisor than the plan's own reference "
                         "code.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "Clean — the divisor deviation is confirmed as a "
                         "correct fix to a bug in the brief's own reference "
                         "code.",
             "verdict": "pass"},
            {"kind": "code-review",
             "summary": "Clean on both reviews; Task 5 marked complete.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 3: API upload endpoint changes",
        "sections": [
            {"kind": "implementation",
             "summary": "Built the upload endpoint's browser exif part, the "
                         "320-pixel minimum, stored-image flattening and "
                         "night gates.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "The diff ran over the reviewer's default 2,000-line "
                         "read limit, so both reviewers were given a raised "
                         "limit to avoid truncation; came back clean.",
             "verdict": "pass"},
            {"kind": "code-review",
             "summary": "Clean on both reviews; Task 3 marked complete.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 4: frontend contract and browser client",
        "sections": [
            {"kind": "implementation",
             "summary": "Regenerated the frontend's API contract and built "
                         "the browser client with session refresh on 401.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "Clean.",
             "verdict": "pass"},
            {"kind": "code-review",
             "summary": "Flagged an aborted-signal hang.",
             "verdict": "1 issue"},
            {"kind": "fix", "round": 1,
             "summary": "Implementer fixed the aborted-signal hang.",
             "verdict": "fix applied"},
            {"kind": "code-review", "round": 1,
             "summary": "Re-review confirmed the fix — Task 4 marked "
                         "complete.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 6: upload operations and polling",
        "sections": [
            {"kind": "implementation",
             "summary": "Built the upload operations and polling loop on "
                         "top of Task 4's browser client.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "Clean.",
             "verdict": "pass"},
            {"kind": "code-review",
             "summary": "Clean on both reviews; Task 6 marked complete.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 7: upload dialog and drop zone",
        "sections": [
            {"kind": "implementation",
             "summary": "Built the upload dialog and drop zone.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "Clean.",
             "verdict": "pass"},
            {"kind": "code-review",
             "summary": "Flagged mis-routed attach/check error handling.",
             "verdict": "1 issue"},
            {"kind": "fix", "round": 1,
             "summary": "Implementer fixed the mis-routed error handling.",
             "verdict": "fix applied"},
            {"kind": "code-review", "round": 1,
             "summary": "Re-review clean — Task 7 marked complete, with one "
                         "minor observation deferred to the final "
                         "whole-branch review.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 8: profile photo controls",
        "sections": [
            {"kind": "implementation",
             "summary": "Wired the dialog into the profile pages. Along the "
                         "way, traced a build failure to a pre-existing, "
                         "unrelated commit and left it out of scope, noting "
                         "it for the final report.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "Clean.",
             "verdict": "pass"},
            {"kind": "code-review",
             "summary": "Clean on both reviews; Task 8 marked complete.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 9: durable documentation",
        "sections": [
            {"kind": "implementation",
             "summary": "Brought the durable documentation up to date "
                         "across both repositories.",
             "verdict": "done"},
            {"kind": "spec-review",
             "summary": "Clean — as a small, mechanical task it skipped a "
                         "separate code-quality review, per the "
                         "model-selection rule for trivial tasks.",
             "verdict": "pass"},
        ],
    },
    {
        "title": "Task 10: final verification with real photographs",
        "sections": [
            {"kind": "implementation",
             "summary": "Ran the final verification against nine real "
                         "photographs (orientation, CMYK, transparency, the "
                         "untouched-upload path, over-100MP and 48-50MP "
                         "fractional-decode cases). The report and evidence "
                         "were independently spot-checked and confirmed "
                         "complete.",
             "verdict": "done"},
        ],
    },
]

for task in TASKS:
    for section in task["sections"]:
        beats.append({
            "type": "task-section",
            "task": task["title"],
            "kind": section["kind"],
            "round": section.get("round"),
            "summary": section["summary"],
            "verdict": section["verdict"],
        })

FINAL_SUMMARY = json.load(open("/tmp/sdd2.json"))[197]["text"]
beats.append({"type": "assistant", "text": FINAL_SUMMARY})

json.dump({"files": FILES, "beats": beats}, open("data/content.json", "w"), indent=2)
print(f"wrote {len(beats)} beats and {len(FILES)} files to data/content.json")
