# Image Upload Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-ross:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members upload, replace and remove their day and night profile photo through a dialog. The browser reduces the photograph with pica, uploads it with a progress bar, and polls until the image check settles. The photo is attached only once the image is `READY`.

**Architecture:** The plan produces ten outcomes, in order:

1. A measured record of how Chromium, Firefox and WebKit decode and resize large and rotated photographs, which fixes the browser preparation code before it is written.
2. The API's profile image endpoints on both sides, with `imageId` removed from the full profile writes.
3. The API's upload endpoint accepting a browser `exif` part, refusing photographs under 320 pixels, flattening stored images, and gating night uploads.
4. The frontend on the new API contract, with a browser API client that refreshes the session on `401`.
5. Browser preparation of a photograph: planning, JPEG header parsing, and pica resizing.
6. Upload operations and the polling loop, as tested units the dialog drives.
7. The upload dialog and drop zone, with their copy and workbench specimens.
8. The profile photo controls on the four profile pages, with removal and server actions.
9. The durable documents brought up to date.
10. A final verification run with real high-resolution photographs.

**Tech Stack:**

- **API:** Spring Boot 4.1, Java 21, jOOQ, Flyway, PostgreSQL 17, JUnit 5, AssertJ, MockMvc, TestRestTemplate.
- **Frontend:** Next.js 16, React 19, TypeScript, Base UI through shadcn, Tailwind v4, pica 10, orval 8, Vitest, Testing Library, MSW, happy-dom.

**Global Constraints:**

- **Size limits:**
  - The long edge is 1280 pixels, matching `ImageReducer.FULL_EDGE`.
  - The short edge after reduction is at least 320 pixels, in the API and the browser.
  - The full decode applies at 50,000,000 pixels or fewer, matching `ImageReducer.MAX_PIXELS`. Above that, the browser decodes at a power-of-two fraction that keeps the long edge at 1280 or more.
  - The untouched-upload cap is 5 MiB (5,242,880 bytes).
  - `next.config.ts` sets `experimental.proxyClientMaxBodySize` to `'12mb'`.
- **Encoding:** browser JPEG output is quality 0.92, flattened onto white.
- **Untouched uploads:** only an `image/jpeg` whose start-of-frame segment declares 1 or 3 components, whose long edge is 1280 or less, and whose size is at most 5 MiB is uploaded untouched.
- **EXIF:**
  - The `exif` part carries the bytes from `Exif\0\0` to the end of the original JPEG's first EXIF `APP1` segment, at most 65,533 bytes.
  - The uploaded file's own EXIF always wins over the part.
  - `image_hash_match.exif_source` records `UPLOAD` or `BROWSER`.
- **Polling:**
  - The first poll is at 400 ms, then every 500 ms until 5,000 ms have elapsed, then every 2,000 ms until 30,000 ms, then stop.
  - Preparation times out after 60,000 ms.
  - `503 IMAGE_BUSY` is retried up to three times, 1,000 ms apart.
- **Night gates:** night upload and night `PUT` require verification and an open night side. Night `DELETE` requires neither.
- **Deletion:** the dialog deletes an image only when that image is `READY` and unattached.
- **Frontend rules** (all from `CLAUDE.md`):
  - No path literal outside `lib/routing/`.
  - No hex colour in a component.
  - Phosphor icons come from `@phosphor-icons/react/ssr` through `components/ui/icons.ts`.
  - Every test file that touches no DOM starts with `// @vitest-environment node`.
  - No em-dashes in copy, docs or comments.
  - No comments unless the code cannot say it.
- **Copy:** every string follows `docs/tone-guide.md`. The strings are written out in Task 7 and Task 8 and are used verbatim.
- **API rules:**
  - Every Spring test extends exactly one of `BaseUnitTest`, `BaseRepositoryTest` or `BaseE2ETest`.
  - No test class adds context configuration.
  - Tests are named `subject_shouldOutcome`.
- **Commits:**
  - All work is committed on `master` in each repository.
  - Hooks are never bypassed.
  - Each roadmap line is ticked in the commit that completes it.

**User decisions (already made):**

- The photo is attached straight away, separately from the profile form's Save button.
- The API gains `PUT` and `DELETE` on `/api/member/me/day-profile/image` and `/api/member/me/night-profile/image`. `imageId` is removed from the full profile writes, and the dead code with it.
- Removing a photo is in scope.
- Poll for 30 seconds with the backoff above. The API's upload description stops suggesting 10 seconds.
- An image unsettled at 30 seconds is a failure: stop, and ask the member to try again later.
- Show the API's blurred placeholder while checking.
- The dialog closes itself on success and stays open with a plain message on failure. Indeterminate progress shows while the server processes the upload.
- Resize with pica in a worker, Lanczos, without WebAssembly. Show a progress bar for the upload.
- Send JPEG at 0.92. The EXIF travels as a separate `exif` part rather than spliced back in.
- Skip resizing for images already within 1280. Reject a photograph under 320 on its short edge after reduction, and describe too small and too narrow separately.
- No upper size limit in the browser. Decode at a power-of-two fraction above 50 megapixels.
- Accept a transparent PNG and drop the transparency.
- Narrow `CLAUDE.md`'s server-action rule rather than delete it. Add a browser client with refresh on `401`. No React Query or axios.
- Night upload and night attach are gated. Night removal is not.
- The API's image `DELETE` of a `PENDING` or `CHECKING` image is left unchanged.
- The privacy notice and Children's Code assessment are not changed. `project-scoping.md` records why.
- Only an RGB or greyscale JPEG within 1280 is uploaded untouched.
- No Apple phone is available. The iPhone check is a pre-launch roadmap line, already added, and is not part of this plan.

---

## File structure

### API (`../api`)

| File                                                                                                               | Change            | Responsibility                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------- |
| `src/main/java/cafe/sundial/api/contract/member/dto/ProfileImageRequest.java`                                      | Create            | `PUT` body `{ imageId }`                                                        |
| `src/main/java/cafe/sundial/api/contract/member/MemberApi.java`                                                    | Modify            | Four image endpoint declarations                                                |
| `src/main/java/cafe/sundial/api/controller/member/MemberController.java`                                           | Modify            | Delegates the four endpoints                                                    |
| `src/main/java/cafe/sundial/api/service/member/ProfileImageService.java`                                           | Create            | Attach and remove per side                                                      |
| `src/main/java/cafe/sundial/api/service/member/ProfileUpdate.java`                                                 | Delete            | Its only job moves to `ProfileImageService`                                     |
| `src/main/java/cafe/sundial/api/service/member/DayProfileService.java`, `NightProfileService.java`                 | Modify            | Full writes stop touching the image                                             |
| `src/main/java/cafe/sundial/api/repository/member/DayProfileRepository.java`, `NightProfileRepository.java`        | Modify            | `upsert` stops writing `image_id`. `upsertImage` writes only it                 |
| `src/main/java/cafe/sundial/api/repository/member/DayProfile.java`, `NightProfile.java`                            | Modify            | `sameContentAs` ignores the image                                               |
| `src/main/java/cafe/sundial/api/contract/member/dto/DayProfileRequest.java`, `NightProfileRequest.java`            | Modify            | Lose `imageId`                                                                  |
| `src/main/resources/db/migration/V097__image_hash_match_exif_source.sql`                                           | Create            | `exif_source` enum and column                                                   |
| `src/main/java/cafe/sundial/api/service/image/ImageReducer.java`                                                   | Modify            | Browser EXIF, 320 minimum, flattening                                           |
| `src/main/java/cafe/sundial/api/service/image/ReducedImage.java`, `ImageCheckInput.java`, `HashMatchRecorder.java` | Modify            | Carry the EXIF source                                                           |
| `src/main/java/cafe/sundial/api/repository/image/NewHashMatch.java`, `ImageHashMatchRepository.java`               | Modify            | Store the EXIF source                                                           |
| `src/main/java/cafe/sundial/api/exception/ImageTooSmallException.java`                                             | Create            | `400 IMAGE_TOO_SMALL`                                                           |
| `src/main/java/cafe/sundial/api/contract/ErrorCode.java`                                                           | Modify            | `IMAGE_TOO_SMALL`                                                               |
| `src/main/java/cafe/sundial/api/contract/image/MemberImageApi.java`, `controller/image/MemberImageController.java` | Modify            | `exif` part, night gates, descriptions                                          |
| `src/main/java/cafe/sundial/api/service/image/ImageUploadService.java`                                             | Modify            | Night gate and the `exif` part                                                  |
| Tests under `src/test/java/cafe/sundial/api/`                                                                      | Modify and create | As each task lists                                                              |
| `docs/bunny.md`                                                                                                    | Modify            | The `exif` part, the browser reduction, and the `internal-proxies` deploy check |

### Frontend

| File                                                            | Change  | Responsibility                                                         |
| --------------------------------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `openapi.json`                                                  | Replace | Copied from the API                                                    |
| `orval.config.ts`                                               | Modify  | Second output for the `Images` tag                                     |
| `lib/api/browser.ts`                                            | Create  | `browserFetch` mutator: CSRF header, refresh on `401`, abort, progress |
| `lib/api/browser-navigation.ts`                                 | Create  | `navigateToSignIn`, the one navigation side effect, mockable           |
| `lib/api/browser-client.ts`                                     | Create  | Re-exports the browser output                                          |
| `lib/routing/links.ts`                                          | Modify  | `loginReturningTo`                                                     |
| `next.config.ts`                                                | Modify  | `proxyClientMaxBodySize`                                               |
| `lib/security/csp.ts`                                           | Modify  | `worker-src 'self' blob:`                                              |
| `lib/images/plan-upload.ts`                                     | Create  | Pure plan from dimensions                                              |
| `lib/images/jpeg-segments.ts`                                   | Create  | EXIF segment and component count                                       |
| `lib/images/reduce-for-upload.ts`                               | Create  | Decode, pica, flatten, encode                                          |
| `lib/images/image-upload-operations.ts`                         | Create  | Interface and browser implementation                                   |
| `lib/images/await-image-check.ts`                               | Create  | Poll schedule and loop                                                 |
| `lib/images/upload-with-retry.ts`                               | Create  | `IMAGE_BUSY` retry                                                     |
| `lib/images/upload-error-copy.ts`                               | Create  | Failure to message and offer                                           |
| `lib/mock/image-upload-operations.ts`                           | Create  | Simulated operations                                                   |
| `components/images/ImageDropZone.tsx`                           | Create  | Drop target and picker button                                          |
| `components/images/ImageUploadDialog.tsx`                       | Create  | The staged dialog                                                      |
| `lib/profile/photo-actions.ts`                                  | Create  | `attachProfilePhoto`, `removeProfilePhoto`                             |
| `lib/profile/photo-copy.ts`                                     | Create  | Labels and removal copy                                                |
| `components/profile/edit/PhotoControls.tsx`                     | Create  | Presentational photo, buttons, dialogs                                 |
| `components/profile/edit/PhotoField.tsx`                        | Rewrite | Production wiring                                                      |
| `components/profile/edit/PrototypePhotoField.tsx`               | Create  | Mock wiring                                                            |
| `components/profile/edit/ProfileHeaderPanel.tsx`                | Modify  | `photo` slot                                                           |
| Four profile pages                                              | Modify  | Render the photo control into the slot                                 |
| `lib/profile/actions.ts`, `lib/profile/night-actions.ts`        | Modify  | Stop sending `imageId`                                                 |
| `components/dev/workbench/sections/OurComposites.tsx`           | Modify  | Three specimens                                                        |
| `CLAUDE.md`, `docs/image-handling.md`, `docs/page-inventory.md` | Modify  | Durable documentation                                                  |

### Scratchpad

| File                                                                                                | Change | Responsibility                    |
| --------------------------------------------------------------------------------------------------- | ------ | --------------------------------- |
| `roadmap.md`                                                                                        | Modify | New lines, and ticks              |
| `project-scoping.md`, `compliance/csea-content-handling-procedure.md`, `design/operator-console.md` | Modify | EXIF source and retention wording |

---

### Task 1: Measure how browsers decode and resize large photographs

**Goal:** Record, for Chromium, Firefox and WebKit, how `createImageBitmap` and pica behave on large and rotated photographs, so that Task 5's `reduceForUpload` is written against measured behaviour.

**Files:**

- Create (scratchpad, not committed): `$SCRATCH/decode-harness/package.json`, `$SCRATCH/decode-harness/harness.html`, `$SCRATCH/decode-harness/measure.mjs`, `$SCRATCH/decode-harness/fixtures/*`
- Create (committed): `docs/superpowers/plans/2026-09-17-image-upload-dialog-browser-findings.md`

`$SCRATCH` is `/tmp/claude-1000/-home-ross-workspace-sundial-cafe-frontend/b5eb8184-3cdb-4604-8480-f07cf1eb1567/scratchpad`. Use the session's scratchpad directory if it differs.

**Acceptance Criteria:**

- [ ] The findings file has one table per engine. Each table records:
  - whether `resizeWidth`/`resizeHeight` with `imageOrientation: 'from-image'` returns the requested size
  - whether the pixels of an orientation-6 JPEG come out rotated, in both a square and a non-square fixture, with and without resize options
  - whether `naturalWidth` reflects EXIF orientation
  - the mean absolute pixel difference at 1280 between the fractional-decode and full-decode outputs
  - `pica.capabilities.bug_image_bitmap_orientation_region` (or the equivalent flag name, as printed)
  - whether pica's worker starts under `worker-src 'self' blob:`
  - how pica fails when the worker is blocked: a throw, a rejection, or a promise that never settles within 10 seconds
- [ ] The findings file records Chromium's peak JS heap and total renderer memory for the full decode and for the fractional decode of the 100-megapixel fixture.
- [ ] The findings file ends with a "Decisions for Task 5" list. Each entry states whether the fractional decode stays, the megapixel threshold, and any per-engine handling. It also states that WebKit results are indicative only.
- [ ] Nothing under the scratchpad directory is committed.

**Verify:** `test -s docs/superpowers/plans/2026-09-17-image-upload-dialog-browser-findings.md && grep -c "Decisions for Task 5" docs/superpowers/plans/2026-09-17-image-upload-dialog-browser-findings.md` → `1`

**Steps:**

- [ ] **Step 1: Set up the harness project**

```bash
mkdir -p "$SCRATCH/decode-harness/fixtures" && cd "$SCRATCH/decode-harness"
cat > package.json <<'EOF'
{ "name": "decode-harness", "private": true, "type": "module",
  "dependencies": { "pica": "10.0.3", "playwright": "latest", "sharp": "latest" } }
EOF
npm install
npx playwright install chromium firefox webkit
cp node_modules/pica/dist/pica.min.js .
```

- [ ] **Step 2: Generate the fixtures with sharp**

Create `$SCRATCH/decode-harness/fixtures.mjs`:

```js
import sharp from 'sharp';

const noise = (width, height) =>
  sharp({ create: { width, height, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } });

await noise(12000, 9000).jpeg({ quality: 90 }).toFile('fixtures/108mp.jpg');
await noise(8064, 6048).jpeg({ quality: 90 }).toFile('fixtures/48mp.jpg');

const quadrants = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: '#00ff00' } }).composite([
    {
      input: { create: { width: width / 2, height: height / 2, channels: 3, background: '#ff0000' } },
      left: 0,
      top: 0,
    },
  ]);

await quadrants(1600, 1200).jpeg().withMetadata({ orientation: 6 }).toFile('fixtures/orient6-landscape.jpg');
await quadrants(1600, 1600).jpeg().withMetadata({ orientation: 6 }).toFile('fixtures/orient6-square.jpg');
```

Run: `node fixtures.mjs && ls -la fixtures`
Expected: four JPEGs. `108mp.jpg` is roughly 30 to 60 MB.

For each orientation-6 fixture, the red quadrant is stored at the top left. Displayed with the orientation applied, it appears at the top right. A pixel check at the top right tells whether the rotation was applied.

- [ ] **Step 3: Write the harness page**

Create `$SCRATCH/decode-harness/harness.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: blob:; worker-src 'self' blob:"
/>
<script src="pica.min.js"></script>
<script>
  const LONG_EDGE = 1280;

  async function fileFrom(path) {
    const response = await fetch(path);
    return new File([await response.blob()], path.split('/').pop(), { type: 'image/jpeg' });
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = URL.createObjectURL(file);
    });
  }

  function target(width, height) {
    const scale = Math.min(1, LONG_EDGE / Math.max(width, height));
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  }

  function divisor(width, height) {
    let value = 1;
    while (Math.max(width, height) / (value * 2) >= LONG_EDGE) value *= 2;
    return value;
  }

  function pixel(source, x, y) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0);
    return Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
  }

  async function resizeWithPica(source, width, height) {
    const pica = window.pica({ features: ['js', 'ww'] });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    await pica.resize(source, canvas, { filter: 'lanczos3' });
    return { canvas, capabilities: pica.capabilities ?? null };
  }

  window.measureOrientation = async (path) => {
    const file = await fileFrom(path);
    const image = await loadImage(file);
    const plain = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const halfWidth = Math.round(image.naturalWidth / 2);
    const halfHeight = Math.round(image.naturalHeight / 2);
    let resized = null;
    let resizeError = null;
    try {
      resized = await createImageBitmap(file, {
        imageOrientation: 'from-image',
        resizeWidth: halfWidth,
        resizeHeight: halfHeight,
        resizeQuality: 'high',
      });
    } catch (error) {
      resizeError = String(error);
    }
    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      plainSize: [plain.width, plain.height],
      plainTopRight: pixel(plain, plain.width - 5, 5),
      resizedSize: resized ? [resized.width, resized.height] : null,
      resizedTopRight: resized ? pixel(resized, resized.width - 5, 5) : null,
      resizeError,
    };
  };

  window.measureFractional = async (path, mode) => {
    const file = await fileFrom(path);
    const image = await loadImage(file);
    const size = target(image.naturalWidth, image.naturalHeight);
    const started = performance.now();
    let source;
    if (mode === 'fractional') {
      const value = divisor(image.naturalWidth, image.naturalHeight);
      source = await createImageBitmap(file, {
        imageOrientation: 'from-image',
        resizeWidth: Math.round(image.naturalWidth / value),
        resizeHeight: Math.round(image.naturalHeight / value),
        resizeQuality: 'high',
      });
    } else {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    const decodedSize = [source.width, source.height];
    const { canvas, capabilities } = await resizeWithPica(source, size.width, size.height);
    const data = Array.from(canvas.getContext('2d').getImageData(0, 0, size.width, size.height).data);
    return { decodedSize, target: size, milliseconds: performance.now() - started, capabilities, data };
  };

  window.measureBlockedWorker = async () => {
    const pica = window.pica({ features: ['ww'] });
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const source = document.createElement('canvas');
    source.width = 400;
    source.height = 400;
    const outcome = await Promise.race([
      pica.resize(source, canvas).then(
        () => 'resolved',
        (error) => `rejected: ${error}`
      ),
      new Promise((resolve) => setTimeout(() => resolve('unsettled after 10s'), 10000)),
    ]);
    return outcome;
  };
</script>
```

- [ ] **Step 4: Write the measuring script**

Create `$SCRATCH/decode-harness/measure.mjs`:

```js
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg' };
const blockedCsp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'none'";

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const file = path === '/' || path === '/blocked' ? '/harness.html' : path;
  try {
    let body = await readFile(`.${file}`);
    if (path === '/blocked') body = Buffer.from(body.toString().replace(/worker-src[^"]*/, "worker-src 'none'"));
    response.writeHead(200, { 'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(4173);

const meanDifference = (first, second) => {
  let total = 0;
  for (let index = 0; index < first.length; index += 4) {
    total +=
      Math.abs(first[index] - second[index]) +
      Math.abs(first[index + 1] - second[index + 1]) +
      Math.abs(first[index + 2] - second[index + 2]);
  }
  return total / ((first.length / 4) * 3);
};

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:4173/');
  const report = { engine: name };
  report.orientLandscape = await page.evaluate(() => window.measureOrientation('fixtures/orient6-landscape.jpg'));
  report.orientSquare = await page.evaluate(() => window.measureOrientation('fixtures/orient6-square.jpg'));

  let cdp = null;
  if (name === 'chromium') {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
  }
  for (const mode of ['full', 'fractional']) {
    try {
      const result = await page.evaluate((m) => window.measureFractional('fixtures/108mp.jpg', m), mode);
      report[mode] = { ...result, data: undefined };
      report[`${mode}Data`] = result.data;
      if (cdp) {
        const { metrics } = await cdp.send('Performance.getMetrics');
        report[mode].heap = metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value;
      }
    } catch (error) {
      report[mode] = { error: String(error) };
    }
  }
  if (report.fullData && report.fractionalData) {
    report.meanDifference = meanDifference(report.fullData, report.fractionalData);
  }
  delete report.fullData;
  delete report.fractionalData;

  const blocked = await browser.newPage();
  await blocked.goto('http://localhost:4173/blocked');
  report.blockedWorker = await blocked.evaluate(() => window.measureBlockedWorker());

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
server.close();
```

- [ ] **Step 5: Run it and capture the output**

Run: `cd "$SCRATCH/decode-harness" && node measure.mjs | tee results.json`
Expected: three JSON reports. An engine may report `error` for the 108-megapixel full decode. That is itself a finding to record.

For Chromium peak memory beyond the JS heap, re-run the Chromium full and fractional cases separately with `chromium.launch({ args: ['--enable-precise-memory-info'] })`. Watch the renderer process's resident memory with `ps -o rss= -p <renderer pid>`, sampled every 100 ms, and record the maximum.

- [ ] **Step 6: Write the findings file**

Create `docs/superpowers/plans/2026-09-17-image-upload-dialog-browser-findings.md`. It holds one section per engine with the measured values, and a final "Decisions for Task 5" list. Each decision states one of these outcomes:

- The fractional decode stays at the 50-megapixel threshold.
- The threshold moves.
- The fractional decode is removed.

The list also states:

- whether an engine needs a lower full-decode threshold because pica's orientation-region flag is set
- whether `imageOrientation: 'from-image'` must be omitted in the fallback
- that the blocked-worker outcome confirms the 60-second preparation timeout is needed
- that WebKit on Linux is WebKitGTK and does not stand for Safari on iOS

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-09-17-image-upload-dialog-browser-findings.md
git commit -m "Record how three browser engines decode and resize large photographs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Profile image endpoints in the API

**Goal:** The API attaches and removes a profile photo on each side through dedicated endpoints, and the full profile writes no longer carry or write the image.

**Files:**

- Create: `../api/src/main/java/cafe/sundial/api/contract/member/dto/ProfileImageRequest.java`
- Create: `../api/src/main/java/cafe/sundial/api/service/member/ProfileImageService.java`
- Delete: `../api/src/main/java/cafe/sundial/api/service/member/ProfileUpdate.java`
- Modify: `../api/src/main/java/cafe/sundial/api/contract/member/MemberApi.java`
- Modify: `../api/src/main/java/cafe/sundial/api/controller/member/MemberController.java`
- Modify: `../api/src/main/java/cafe/sundial/api/service/member/DayProfileService.java`
- Modify: `../api/src/main/java/cafe/sundial/api/service/member/NightProfileService.java`
- Modify: `../api/src/main/java/cafe/sundial/api/repository/member/DayProfileRepository.java`
- Modify: `../api/src/main/java/cafe/sundial/api/repository/member/NightProfileRepository.java`
- Modify: `../api/src/main/java/cafe/sundial/api/repository/member/DayProfile.java`
- Modify: `../api/src/main/java/cafe/sundial/api/repository/member/NightProfile.java`
- Modify: `../api/src/main/java/cafe/sundial/api/contract/member/dto/DayProfileRequest.java`
- Modify: `../api/src/main/java/cafe/sundial/api/contract/member/dto/NightProfileRequest.java`
- Create: `../api/src/test/java/cafe/sundial/api/integration/ProfileImageIntegrationTest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/controller/image/ImageDeletionE2ETest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/integration/ChecklistCompletionIntegrationTest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/service/member/DayProfileServiceTest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/service/member/NightProfileServiceTest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/service/member/MemberServiceDetailsTest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/service/screening/TextScreenWiringTest.java`
- Modify: `../scratchpad/roadmap.md`

**Acceptance Criteria:**

- [ ] **`PUT /api/member/me/day-profile/image` and `/night-profile/image`:**
  - they attach a `PUBLISHED` unattached image and answer `204`
  - a replaced image is deleted after commit
  - the profile-photo checklist award is completed
  - naming the current image answers `204` and changes nothing
  - a new image moves `updated_at` only when the cooldown has elapsed
- [ ] **The `PUT` error cases:**
  - `404 NOT_FOUND` for another member's image
  - `409 IMAGE_NOT_ATTACHABLE` for a `PENDING` image
  - `409 IMAGE_SIDE_MISMATCH` for the other side's image
  - `400 VALIDATION_ERROR` for a blank `imageId`
  - on night, `403 VERIFICATION_REQUIRED` and `403 NIGHT_NOT_ENABLED`
- [ ] **`DELETE` on both sides:**
  - it sets `image_id` to null, clears `attached_at`, deletes the image after commit, and answers `204`
  - it answers `204` with no photo
  - on night it succeeds with the night side closed
  - it does not move `updated_at`
- [ ] **The full writes:**
  - `DayProfileRequest` and `NightProfileRequest` have no `imageId`
  - `upsert` does not write `image_id`, so a full write after an image `PUT` leaves the image attached and referenced
  - `sameContentAs` ignores the image
  - the full writes still lock the member row
- [ ] **Removed code:** `ProfileUpdate` no longer exists, and neither `DayProfileService` nor `NightProfileService` depends on `AwardService`.
- [ ] **The whole suite:** `./gradlew check` passes.
- [ ] **The roadmap:** `../scratchpad/roadmap.md` carries every new line in Step 9, with this task's two (API) lines ticked.

**Verify:** `cd ../api && ./gradlew check` → `BUILD SUCCESSFUL`

**Steps:**

- [ ] **Step 1: Write the failing integration test**

Create `../api/src/test/java/cafe/sundial/api/integration/ProfileImageIntegrationTest.java`:

```java
package cafe.sundial.api.integration;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import cafe.sundial.api.jooq.enums.AreaCode;
import cafe.sundial.api.jooq.enums.AwardType;
import cafe.sundial.api.jooq.enums.ImageCheckState;
import cafe.sundial.api.jooq.enums.MemberGender;
import cafe.sundial.api.jooq.enums.PostSide;
import cafe.sundial.api.service.auth.CookieService;
import cafe.sundial.api.service.auth.JwtService;
import cafe.sundial.api.service.auth.domain.JwtUser;
import cafe.sundial.api.tests.BaseRepositoryTest;

import static cafe.sundial.api.jooq.Tables.IMAGE;
import static cafe.sundial.api.jooq.Tables.MEMBER;
import static cafe.sundial.api.jooq.Tables.MEMBER_AWARD;
import static cafe.sundial.api.jooq.Tables.MEMBER_DAY_PROFILE;
import static cafe.sundial.api.jooq.Tables.MEMBER_NIGHT_PROFILE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ProfileImageIntegrationTest extends BaseRepositoryTest {

    private static final String CSRF_HEADER = "X-Requested-With";
    private static final String CSRF_VALUE = "sundial";
    private static final Instant LONG_AGO = Instant.parse("2026-08-01T09:00:00Z");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Test
    void putDayImage_shouldAttachThePhotoAndCompleteTheChecklistItem() throws Exception {
        String member = member(true, false);
        String image = image(member, PostSide.DAY, ImageCheckState.PUBLISHED);

        putImage(member, "day", image).andExpect(status().isNoContent());

        assertThat(dayImageId(member)).isEqualTo(image);
        assertThat(attachedAt(image)).isNotNull();
        assertThat(completedTypes(member)).containsExactly(AwardType.DAY_PROFILE_PHOTO);
    }

    @Test
    void putNightImage_shouldAttachThePhotoAndCompleteTheNightChecklistItem() throws Exception {
        String member = member(true, true);
        String image = image(member, PostSide.NIGHT, ImageCheckState.PUBLISHED);

        putImage(member, "night", image).andExpect(status().isNoContent());

        assertThat(nightImageId(member)).isEqualTo(image);
        assertThat(completedTypes(member)).containsExactly(AwardType.NIGHT_PROFILE_PHOTO);
    }

    @Test
    void putDayImage_shouldAnswer204AndChangeNothingForTheCurrentImage() throws Exception {
        String member = member(true, false);
        String image = image(member, PostSide.DAY, ImageCheckState.PUBLISHED);
        putImage(member, "day", image).andExpect(status().isNoContent());
        Instant updatedAt = dayUpdatedAt(member);

        putImage(member, "day", image).andExpect(status().isNoContent());

        assertThat(dayImageId(member)).isEqualTo(image);
        assertThat(attachedAt(image)).isNotNull();
        assertThat(dayUpdatedAt(member)).isEqualTo(updatedAt);
    }

    @Test
    void putDayImage_shouldDetachTheReplacedImage() throws Exception {
        String member = member(true, false);
        String first = image(member, PostSide.DAY, ImageCheckState.PUBLISHED);
        String second = image(member, PostSide.DAY, ImageCheckState.PUBLISHED);
        putImage(member, "day", first).andExpect(status().isNoContent());

        putImage(member, "day", second).andExpect(status().isNoContent());

        assertThat(dayImageId(member)).isEqualTo(second);
        assertThat(attachedAt(first)).isNull();
    }

    @Test
    void putDayImage_shouldAnswer404ForAnotherMembersImage() throws Exception {
        String member = member(true, false);
        String other = member(true, false);
        String image = image(other, PostSide.DAY, ImageCheckState.PUBLISHED);

        putImage(member, "day", image).andExpect(status().isNotFound())
            .andExpect(jsonPath("$.errorCode").value("NOT_FOUND"));
    }

    @Test
    void putDayImage_shouldAnswer409ForAnImageStillBeingChecked() throws Exception {
        String member = member(true, false);
        String image = image(member, PostSide.DAY, ImageCheckState.PENDING);

        putImage(member, "day", image).andExpect(status().isConflict())
            .andExpect(jsonPath("$.errorCode").value("IMAGE_NOT_ATTACHABLE"));
    }

    @Test
    void putDayImage_shouldAnswer409ForANightImage() throws Exception {
        String member = member(true, true);
        String image = image(member, PostSide.NIGHT, ImageCheckState.PUBLISHED);

        putImage(member, "day", image).andExpect(status().isConflict())
            .andExpect(jsonPath("$.errorCode").value("IMAGE_SIDE_MISMATCH"));
    }

    @Test
    void putDayImage_shouldAnswer400ForABlankImageId() throws Exception {
        String member = member(true, false);

        putImage(member, "day", "").andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));
    }

    @Test
    void putNightImage_shouldRefuseAnUnverifiedMember() throws Exception {
        String member = member(false, false);
        String image = image(member, PostSide.NIGHT, ImageCheckState.PUBLISHED);

        putImage(member, "night", image).andExpect(status().isForbidden())
            .andExpect(jsonPath("$.errorCode").value("VERIFICATION_REQUIRED"));
    }

    @Test
    void putNightImage_shouldRefuseAMemberWithTheNightSideClosed() throws Exception {
        String member = member(true, false);
        String image = image(member, PostSide.NIGHT, ImageCheckState.PUBLISHED);

        putImage(member, "night", image).andExpect(status().isForbidden())
            .andExpect(jsonPath("$.errorCode").value("NIGHT_NOT_ENABLED"));
    }

    @Test
    void deleteDayImage_shouldClearTheProfileAndDetachTheImage() throws Exception {
        String member = member(true, false);
        String image = image(member, PostSide.DAY, ImageCheckState.PUBLISHED);
        putImage(member, "day", image).andExpect(status().isNoContent());
        Instant updatedAt = dayUpdatedAt(member);

        deleteImage(member, "day").andExpect(status().isNoContent());

        assertThat(dayImageId(member)).isNull();
        assertThat(attachedAt(image)).isNull();
        assertThat(dayUpdatedAt(member)).isEqualTo(updatedAt);
    }

    @Test
    void deleteDayImage_shouldAnswer204WhenThereIsNoPhoto() throws Exception {
        String member = member(true, false);

        deleteImage(member, "day").andExpect(status().isNoContent());
    }

    @Test
    void deleteNightImage_shouldSucceedWithTheNightSideClosed() throws Exception {
        String member = member(true, true);
        String image = image(member, PostSide.NIGHT, ImageCheckState.PUBLISHED);
        putImage(member, "night", image).andExpect(status().isNoContent());
        dsl.update(MEMBER).setNull(MEMBER.NIGHT_ENABLED_AT).where(MEMBER.ID.eq(member)).execute();

        deleteImage(member, "night").andExpect(status().isNoContent());

        assertThat(nightImageId(member)).isNull();
    }

    @Test
    void fullDayWrite_shouldLeaveTheAttachedImageReferenced() throws Exception {
        String member = member(true, false);
        String image = image(member, PostSide.DAY, ImageCheckState.PUBLISHED);
        putImage(member, "day", image).andExpect(status().isNoContent());

        mockMvc.perform(put("/api/member/me/day-profile")
                .cookie(accessCookieFor(member, false))
                .header(CSRF_HEADER, CSRF_VALUE)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"description\":\"A quiet life.\"}"))
            .andExpect(status().isNoContent());

        assertThat(dayImageId(member)).isEqualTo(image);
        assertThat(attachedAt(image)).isNotNull();
    }

    @Test
    void fullNightWrite_shouldLeaveTheAttachedImageReferenced() throws Exception {
        String member = member(true, true);
        String image = image(member, PostSide.NIGHT, ImageCheckState.PUBLISHED);
        putImage(member, "night", image).andExpect(status().isNoContent());

        mockMvc.perform(put("/api/member/me/night-profile")
                .cookie(accessCookieFor(member, true))
                .header(CSRF_HEADER, CSRF_VALUE)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"description\":\"Late.\"}"))
            .andExpect(status().isNoContent());

        assertThat(nightImageId(member)).isEqualTo(image);
    }

    private ResultActions putImage(String member, String side, String imageId) throws Exception {
        return mockMvc.perform(put("/api/member/me/" + side + "-profile/image")
            .cookie(accessCookieFor(member, "night".equals(side)))
            .header(CSRF_HEADER, CSRF_VALUE)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"imageId\":\"%s\"}".formatted(imageId)));
    }

    private ResultActions deleteImage(String member, String side) throws Exception {
        return mockMvc.perform(delete("/api/member/me/" + side + "-profile/image")
            .cookie(accessCookieFor(member, "night".equals(side)))
            .header(CSRF_HEADER, CSRF_VALUE));
    }

    private String member(boolean verified, boolean nightOpen) {
        String id = uniqueId();
        dsl.insertInto(MEMBER)
            .set(MEMBER.ID, id)
            .set(MEMBER.EMAIL, uniqueEmail(id))
            .set(MEMBER.NICKNAME, uniqueNickname(id))
            .set(MEMBER.GENDER, MemberGender.WOMAN)
            .set(MEMBER.DATE_OF_BIRTH, LocalDate.of(1990, 1, 1))
            .set(MEMBER.AREA_CODE, AreaCode.ABDN)
            .set(MEMBER.VERIFIED_AT, verified ? LONG_AGO : null)
            .set(MEMBER.NIGHT_ENABLED_AT, nightOpen ? LONG_AGO : null)
            .execute();
        return id;
    }

    private String image(String uploaderId, PostSide side, ImageCheckState state) {
        String id = uniqueId();
        dsl.insertInto(IMAGE)
            .set(IMAGE.ID, id)
            .set(IMAGE.UPLOADER_ID, uploaderId)
            .set(IMAGE.SIDE, side)
            .set(IMAGE.CHECK_STATE, state)
            .set(IMAGE.STORAGE_KEY, id.substring(0, 2) + "/" + id)
            .set(IMAGE.WIDTH, 800)
            .set(IMAGE.HEIGHT, 600)
            .set(IMAGE.PLACEHOLDER, "AAAA")
            .execute();
        return id;
    }

    private String dayImageId(String member) {
        return dsl.select(MEMBER_DAY_PROFILE.IMAGE_ID).from(MEMBER_DAY_PROFILE)
            .where(MEMBER_DAY_PROFILE.MEMBER_ID.eq(member)).fetchOne(MEMBER_DAY_PROFILE.IMAGE_ID);
    }

    private Instant dayUpdatedAt(String member) {
        return dsl.select(MEMBER_DAY_PROFILE.UPDATED_AT).from(MEMBER_DAY_PROFILE)
            .where(MEMBER_DAY_PROFILE.MEMBER_ID.eq(member)).fetchOne(MEMBER_DAY_PROFILE.UPDATED_AT);
    }

    private String nightImageId(String member) {
        return dsl.select(MEMBER_NIGHT_PROFILE.IMAGE_ID).from(MEMBER_NIGHT_PROFILE)
            .where(MEMBER_NIGHT_PROFILE.MEMBER_ID.eq(member)).fetchOne(MEMBER_NIGHT_PROFILE.IMAGE_ID);
    }

    private Instant attachedAt(String image) {
        return dsl.select(IMAGE.ATTACHED_AT).from(IMAGE).where(IMAGE.ID.eq(image)).fetchOne(IMAGE.ATTACHED_AT);
    }

    private List<AwardType> completedTypes(String memberId) {
        return dsl.select(MEMBER_AWARD.TYPE).from(MEMBER_AWARD)
            .where(MEMBER_AWARD.MEMBER_ID.eq(memberId)).fetch(MEMBER_AWARD.TYPE);
    }

    private Cookie accessCookieFor(String memberId, boolean night) {
        String token = jwtService.generateAccessToken(new JwtUser(memberId, "MEMBER", true, night)).value();
        return new Cookie(CookieService.ACCESS_TOKEN_COOKIE, token);
    }
}
```

If `MEMBER.DATE_OF_BIRTH` is not nullable-safe for an unverified member, keep the date. `NightSideGate` reads `verified_at`, not the date of birth. If the `updated_at` column's type is not `Instant` in the generated jOOQ classes, use the type the `DayProfileRepository` already reads.

- [ ] **Step 2: Run it to see it fail**

Run: `cd ../api && ./gradlew test --tests '*ProfileImageIntegrationTest'`
Expected: FAIL. The image endpoints answer `404` or `405`, and the full-write tests pass or fail depending on the current `imageId` handling.

- [ ] **Step 3: Add the request and the contract**

Create `../api/src/main/java/cafe/sundial/api/contract/member/dto/ProfileImageRequest.java`:

```java
package cafe.sundial.api.contract.member.dto;

import jakarta.validation.constraints.NotBlank;

public record ProfileImageRequest(@NotBlank String imageId) {
}
```

In `MemberApi.java`, import `ProfileImageRequest` and add the declarations after `updateOwnDayProfile`:

```java
    @PutMapping("/me/day-profile/image")
    @Operation(operationId = "setOwnDayProfileImage", summary = "Set the day profile photo",
        description = "Attaches an image that reports READY and deletes the photo it replaces. Naming the "
            + "current photo again answers 204 and changes nothing, so a retry after a lost response succeeds. "
            + "Creates the profile on first write.")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Failure(status = HttpStatus.NOT_FOUND, code = ErrorCode.NOT_FOUND,
        when = "The image does not exist or belongs to another member.")
    @Failure(status = HttpStatus.CONFLICT, code = ErrorCode.IMAGE_NOT_ATTACHABLE,
        when = "The image does not report READY, or is attached elsewhere.")
    @Failure(status = HttpStatus.CONFLICT, code = ErrorCode.IMAGE_SIDE_MISMATCH,
        when = "The image was uploaded for the night side.")
    @Failure(status = HttpStatus.FORBIDDEN, code = ErrorCode.ACCOUNT_RESTRICTED,
        when = "The member is restricted from writing.")
    void setOwnDayProfileImage(@Valid @RequestBody ProfileImageRequest request);

    @DeleteMapping("/me/day-profile/image")
    @Operation(operationId = "removeOwnDayProfileImage", summary = "Remove the day profile photo",
        description = "Removes the photo and deletes the image. Answers 204 when there is no photo.")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Failure(status = HttpStatus.FORBIDDEN, code = ErrorCode.ACCOUNT_RESTRICTED,
        when = "The member is restricted from writing.")
    void removeOwnDayProfileImage();
```

After `updateOwnNightProfile`, add:

```java
    @PutMapping("/me/night-profile/image")
    @Operation(operationId = "setOwnNightProfileImage", summary = "Set the night profile photo",
        description = "Needs verification and an open night side. Attaches an image that reports READY and "
            + "deletes the photo it replaces. Naming the current photo again answers 204 and changes nothing. "
            + "Creates the profile on first write.")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Failure(status = HttpStatus.FORBIDDEN, code = ErrorCode.VERIFICATION_REQUIRED,
        when = "The member is not verified.")
    @Failure(status = HttpStatus.FORBIDDEN, code = ErrorCode.NIGHT_NOT_ENABLED,
        when = "The member has not opened the night side.")
    @Failure(status = HttpStatus.NOT_FOUND, code = ErrorCode.NOT_FOUND,
        when = "The image does not exist or belongs to another member.")
    @Failure(status = HttpStatus.CONFLICT, code = ErrorCode.IMAGE_NOT_ATTACHABLE,
        when = "The image does not report READY, or is attached elsewhere.")
    @Failure(status = HttpStatus.CONFLICT, code = ErrorCode.IMAGE_SIDE_MISMATCH,
        when = "The image was uploaded for the day side.")
    @Failure(status = HttpStatus.FORBIDDEN, code = ErrorCode.ACCOUNT_RESTRICTED,
        when = "The member is restricted from writing.")
    void setOwnNightProfileImage(@Valid @RequestBody ProfileImageRequest request);

    @DeleteMapping("/me/night-profile/image")
    @Operation(operationId = "removeOwnNightProfileImage", summary = "Remove the night profile photo",
        description = "Removes the photo and deletes the image. Needs neither verification nor an open night "
            + "side, so a member who has closed the night side can still remove the photo. Answers 204 when "
            + "there is no photo.")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Failure(status = HttpStatus.FORBIDDEN, code = ErrorCode.ACCOUNT_RESTRICTED,
        when = "The member is restricted from writing.")
    void removeOwnNightProfileImage();
```

In the same file, delete both `@Failure(... IMAGE_SIDE_MISMATCH ...)` annotations from `updateOwnDayProfile` and `updateOwnNightProfile`.

- [ ] **Step 4: Add the repository writes and stop the full upsert writing the image**

In `DayProfileRepository.java`, delete both `.set(MEMBER_DAY_PROFILE.IMAGE_ID, profile.imageId())` lines from `upsert`, then add:

```java
    public void upsertImage(String memberId, @Nullable String imageId, boolean bumpUpdatedAt) {
        dsl.insertInto(MEMBER_DAY_PROFILE)
            .set(MEMBER_DAY_PROFILE.MEMBER_ID, memberId)
            .set(MEMBER_DAY_PROFILE.IMAGE_ID, imageId)
            .onConflict(MEMBER_DAY_PROFILE.MEMBER_ID)
            .doUpdate()
            .set(MEMBER_DAY_PROFILE.IMAGE_ID, imageId)
            .set(MEMBER_DAY_PROFILE.UPDATED_AT,
                bumpUpdatedAt ? DSL.currentInstant() : MEMBER_DAY_PROFILE.UPDATED_AT)
            .execute();
    }
```

In `NightProfileRepository.java`, delete both `.set(MEMBER_NIGHT_PROFILE.IMAGE_ID, profile.imageId())` lines from `upsert`, then add:

```java
    public void upsertImage(String memberId, @Nullable String imageId, boolean bumpUpdatedAt) {
        dsl.insertInto(MEMBER_NIGHT_PROFILE)
            .set(MEMBER_NIGHT_PROFILE.MEMBER_ID, memberId)
            .set(MEMBER_NIGHT_PROFILE.IMAGE_ID, imageId)
            .onConflict(MEMBER_NIGHT_PROFILE.MEMBER_ID)
            .doUpdate()
            .set(MEMBER_NIGHT_PROFILE.IMAGE_ID, imageId)
            .set(MEMBER_NIGHT_PROFILE.UPDATED_AT,
                bumpUpdatedAt ? DSL.currentInstant() : MEMBER_NIGHT_PROFILE.UPDATED_AT)
            .execute();
    }
```

In `DayProfile.java`, delete the final `&& Objects.equals(imageId, other.imageId)` from `sameContentAs`, so the previous condition ends the statement. Do the same in `NightProfile.java`. Both records keep their `imageId` component, because `get` still reads it.

- [ ] **Step 5: Write `ProfileImageService`**

Create `../api/src/main/java/cafe/sundial/api/service/member/ProfileImageService.java`:

```java
package cafe.sundial.api.service.member;

import java.time.Clock;
import java.time.Instant;

import org.jspecify.annotations.Nullable;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cafe.sundial.api.contract.ErrorCode;
import cafe.sundial.api.exception.ConflictException;
import cafe.sundial.api.exception.NotFoundException;
import cafe.sundial.api.jooq.enums.PostSide;
import cafe.sundial.api.jooq.tables.pojos.Member;
import cafe.sundial.api.repository.image.ImageRepository;
import cafe.sundial.api.repository.member.DayProfile;
import cafe.sundial.api.repository.member.DayProfileRepository;
import cafe.sundial.api.repository.member.MemberRepository;
import cafe.sundial.api.repository.member.NightProfile;
import cafe.sundial.api.repository.member.NightProfileRepository;
import cafe.sundial.api.service.image.ImageService;
import cafe.sundial.api.service.support.ConstraintViolations;

@Service
public class ProfileImageService {

    private static final String DAY_SIDE_MISMATCH_CONSTRAINT = "day_profile_image_side_matches";
    private static final String NIGHT_SIDE_MISMATCH_CONSTRAINT = "night_profile_image_side_matches";

    private final MemberRepository memberRepository;
    private final DayProfileRepository dayProfileRepository;
    private final NightProfileRepository nightProfileRepository;
    private final ImageService imageService;
    private final ImageRepository imageRepository;
    private final AwardService awardService;
    private final Clock clock;

    public ProfileImageService(MemberRepository memberRepository, DayProfileRepository dayProfileRepository,
                               NightProfileRepository nightProfileRepository, ImageService imageService,
                               ImageRepository imageRepository, AwardService awardService, Clock clock) {
        this.memberRepository = memberRepository;
        this.dayProfileRepository = dayProfileRepository;
        this.nightProfileRepository = nightProfileRepository;
        this.imageService = imageService;
        this.imageRepository = imageRepository;
        this.awardService = awardService;
        this.clock = clock;
    }

    @Transactional
    public void attach(String memberId, PostSide side, String imageId) {
        Member member = lockOwner(memberId);
        if (side == PostSide.NIGHT) {
            NightSideGate.requireOpen(member);
        }
        CurrentImage current = currentImage(memberId, side);
        if (imageId.equals(current.imageId())) {
            return;
        }
        imageService.attach(imageId, memberId);
        try {
            upsertImage(memberId, side, imageId, MemberLimits.cooldownElapsed(current.updatedAt(), clock));
        } catch (DataIntegrityViolationException e) {
            if (ConstraintViolations.matches(e, sideMismatchConstraint(side))) {
                throw new ConflictException(ErrorCode.IMAGE_SIDE_MISMATCH);
            }
            throw e;
        }
        if (current.imageId() != null) {
            imageRepository.detach(current.imageId());
            imageService.deleteRowAndObjectsAfterCommit(current.imageId());
        }
        awardService.completeChecklistItem(memberId, AwardTypes.profilePhoto(side));
    }

    @Transactional
    public void remove(String memberId, PostSide side) {
        lockOwner(memberId);
        CurrentImage current = currentImage(memberId, side);
        if (current.imageId() == null) {
            return;
        }
        upsertImage(memberId, side, null, false);
        imageRepository.detach(current.imageId());
        imageService.deleteRowAndObjectsAfterCommit(current.imageId());
    }

    /**
     * The full profile write and these image writes upsert the same profile row. Serialising both on the
     * member row means an image swap always sees the image a concurrent write left behind, and first
     * creation of the row, which has no row to lock, is covered too.
     */
    private Member lockOwner(String memberId) {
        return memberRepository.findByIdForUpdate(memberId)
            .orElseThrow(() -> new NotFoundException(ErrorCode.NOT_FOUND));
    }

    private CurrentImage currentImage(String memberId, PostSide side) {
        if (side == PostSide.DAY) {
            DayProfile profile = dayProfileRepository.find(memberId).orElseGet(DayProfile::empty);
            return new CurrentImage(profile.imageId(), profile.updatedAt());
        }
        NightProfile profile = nightProfileRepository.find(memberId).orElseGet(NightProfile::empty);
        return new CurrentImage(profile.imageId(), profile.updatedAt());
    }

    private void upsertImage(String memberId, PostSide side, @Nullable String imageId, boolean bumpUpdatedAt) {
        if (side == PostSide.DAY) {
            dayProfileRepository.upsertImage(memberId, imageId, bumpUpdatedAt);
        } else {
            nightProfileRepository.upsertImage(memberId, imageId, bumpUpdatedAt);
        }
    }

    private String sideMismatchConstraint(PostSide side) {
        return side == PostSide.DAY ? DAY_SIDE_MISMATCH_CONSTRAINT : NIGHT_SIDE_MISMATCH_CONSTRAINT;
    }

    private record CurrentImage(@Nullable String imageId, @Nullable Instant updatedAt) {
    }
}
```

- [ ] **Step 6: Strip the image from the full writes and delete `ProfileUpdate`**

In `DayProfileRequest.java`, delete the `@Nullable String imageId` component and the comma before it. Do the same in `NightProfileRequest.java`.

In `DayProfileService.java`, make these changes:

- Delete `SIDE_MISMATCH_CONSTRAINT`, the `profileUpdate` and `awardService` fields, and their constructor parameters and assignments.
- Replace `update` and the lock method with:

```java
    @Transactional
    public void update(String memberId, DayProfileRequest request) {
        requireAllowedText(memberId, request);
        lockOwnerSoTheImageEndpointsSeeThisWrite(memberId);
        DayProfile existing = dayProfileRepository.find(memberId).orElseGet(DayProfile::empty);
        DayProfile incoming = new DayProfile(request.description(), request.interests(),
            request.favouriteArtist(), request.favouriteFilm(), request.favouriteBook(),
            request.whatYouLike(), null, null);
        dayProfileRepository.upsert(memberId, incoming, shouldBump(existing, incoming));
    }
```

```java
    /**
     * The photo endpoints in ProfileImageService upsert this same row under the member row's lock. Taking it
     * here as well keeps first creation of the row, and the cooldown read that decides the bump, serialised
     * with them.
     */
    private void lockOwnerSoTheImageEndpointsSeeThisWrite(String memberId) {
        memberRepository.findByIdForUpdate(memberId)
            .orElseThrow(() -> new NotFoundException(ErrorCode.NOT_FOUND));
    }
```

Remove the `AwardTypes` and `PostSide` imports only if nothing else in the file uses them. `PostSide` is still used by `getFor`.

In `NightProfileService.java`, make these changes:

- Delete `SIDE_MISMATCH_CONSTRAINT`, `profileUpdate` and `awardService`, with their constructor parameters and assignments.
- Replace the body of `update` from `String imageId = request.imageId();` onwards with:

```java
        NightProfile incoming = new NightProfile(request.description(), request.lookAlike(),
            request.erogenousZone(), request.bestFeature(), request.dominance(), request.cupSize(),
            request.length(), request.girth(), request.firmness(), null, null);
        requireBodyFieldsMatchGender(member.getGender(), incoming);
        nightProfileRepository.upsert(memberId, incoming, shouldBump(existing, incoming));
```

- Replace the Javadoc on `loadMemberForUpdate` with the same paragraph as the day lock above.

Then delete `ProfileUpdate.java`:

```bash
git -C ../api rm src/main/java/cafe/sundial/api/service/member/ProfileUpdate.java
```

- [ ] **Step 7: Wire the controller**

In `MemberController.java`:

- import `ProfileImageRequest`, `ProfileImageService` and `PostSide` (already imported)
- add a `ProfileImageService profileImageService` field, constructor parameter and assignment
- add:

```java
    @Override
    public void setOwnDayProfileImage(ProfileImageRequest request) {
        profileImageService.attach(currentUserProvider.require().memberId(), PostSide.DAY, request.imageId());
    }

    @Override
    public void removeOwnDayProfileImage() {
        profileImageService.remove(currentUserProvider.require().memberId(), PostSide.DAY);
    }

    @Override
    public void setOwnNightProfileImage(ProfileImageRequest request) {
        profileImageService.attach(currentUserProvider.require().memberId(), PostSide.NIGHT, request.imageId());
    }

    @Override
    public void removeOwnNightProfileImage() {
        profileImageService.remove(currentUserProvider.require().memberId(), PostSide.NIGHT);
    }
```

- [ ] **Step 8: Move the existing tests off `imageId`**

1. **`ChecklistCompletionIntegrationTest.java`.** In `savingTheDayProfileWithAPhoto_shouldCompleteTheDayPhotoItem`:
   - rename it `settingTheDayProfilePhoto_shouldCompleteTheDayPhotoItem`
   - change the URL to `/api/member/me/day-profile/image`
   - keep the body `{"imageId":"%s"}`
   - expect `status().isNoContent()`

   Give `savingTheNightProfileWithAPhoto_shouldCompleteTheNightPhotoItem` the same treatment under the name `settingTheNightProfilePhoto_shouldCompleteTheNightPhotoItem`, with `/api/member/me/night-profile/image`. Leave `savingTheDayProfileWithoutAPhoto_shouldCompleteNothing` as it is.

2. **`ImageDeletionE2ETest.java`.** Replace `putDayProfile` with:

```java
    private void putDayProfileImage(String memberId, String imageId) {
        ResponseEntity<Void> response = restTemplate.exchange("/api/member/me/day-profile/image", HttpMethod.PUT,
            new HttpEntity<>(new ProfileImageRequest(imageId), mutatingHeaders(accessTokenFor(memberId))),
            Void.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }
```

Then:

- Rename each call to `putDayProfileImage`.
- In `replacingAProfilePhoto_shouldStillSucceedWhenTheDeferredDeleteOfTheOldImageFails`, replace the inline `exchange` against `/api/member/me/day-profile` with the same call against `/api/member/me/day-profile/image` carrying `new ProfileImageRequest(secondImageId)`.
- Replace the `DayProfileRequest` import with `ProfileImageRequest`.
- Add this test:

```java
    @Test
    void removingAProfilePhoto_shouldDeleteTheImageAndItsObjects() {
        insertMember(AUTHOR_ID);
        flushAndCommit();
        String imageId = upload(AUTHOR_ID, PostSide.DAY).id();
        flushAndCommit();
        putDayProfileImage(AUTHOR_ID, imageId);
        flushAndCommit();
        String storageKey = imageRepository.find(imageId).orElseThrow().getStorageKey();

        ResponseEntity<Void> response = restTemplate.exchange("/api/member/me/day-profile/image",
            HttpMethod.DELETE, new HttpEntity<>(mutatingHeaders(accessTokenFor(AUTHOR_ID))), Void.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        flushAndCommit();
        assertThat(imageRepository.find(imageId)).isEmpty();
        assertThat(publicObjectExists(storageKey, "full.webp")).isFalse();
        assertThat(publicObjectExists(storageKey, "thumb.webp")).isFalse();
    }
```

3. **`DayProfileServiceTest.java`:**
   - In `service(Instant)`, drop the `new ProfileUpdate(imageService, imageRepository),` and `mock(AwardService.class)` arguments.
   - Delete `update_shouldLeaveThePreviousImageDetachedButNotDeletedWhenTheTransactionNeverCommits`, `requestWithImage` and `insertImage`.
   - Remove each `DayProfileRequest` constructor's final `null`.
   - Remove the `imageService`, `imageRepository`, `IMAGE`, `ImageCheckState`, `ImageService`, `ImageRepository` and `mock` imports and fields that become unused.

4. **`NightProfileServiceTest.java`:** make the same changes to `service(Instant)`, delete `update_shouldLeaveThePreviousImageDetachedButNotDeletedWhenTheTransactionNeverCommits` and `requestWithImage`, drop the final `null` from `request(...)`, and remove unused imports and fields.

5. **`MemberServiceDetailsTest.java`:** in `memberServiceAt`, drop the `new ProfileUpdate(imageService, imageRepository),` and `mock(AwardService.class)` arguments. Remove any fields and imports that become unused.

6. **`TextScreenWiringTest.java`:** drop the final `null` argument from the `DayProfileRequest` and `NightProfileRequest` constructors.

Then add a unit-level proof that the full write ignores the image to `DayProfileServiceTest.java`:

```java
    @Test
    void update_shouldNotBumpWhenOnlyTheStoredImageDiffers() {
        String memberId = insertMember();
        DayProfileService service = service(NOW);
        service.update(memberId, request("Same bio"));
        Instant firstUpdatedAt = dayProfileRepository.find(memberId).orElseThrow().updatedAt();

        service(NOW.plus(Duration.ofHours(25))).update(memberId, request("Same bio"));

        assertThat(dayProfileRepository.find(memberId).orElseThrow().updatedAt()).isEqualTo(firstUpdatedAt);
    }
```

- [ ] **Step 9: Update the roadmap**

In `../scratchpad/roadmap.md` §7.2, replace this line:

```
  - [ ] (FE) Upload the profile photo. `PhotoField` shows a local preview and sends nothing; the upload also has to handle `UPLOAD_UNREADABLE` and `IMAGE_UNREADABLE`
```

with:

```
  - [x] (API) `PUT` and `DELETE /api/member/me/day-profile/image`, with `imageId` taken out of `DayProfileRequest`
  - [ ] (FE) Upload, replace and remove the day profile photo through the image upload dialog
```

Change `- [x] **Night profile** — Description, look-alike` to `- [ ] **Night profile** — *partial*. Description, look-alike`, keeping the rest of that line. Then add under it, after its (API) line:

```
  - [x] (API) `PUT` and `DELETE /api/member/me/night-profile/image`, with `imageId` taken out of `NightProfileRequest`, and the night gates on `PUT` only
  - [ ] (FE) Upload, replace and remove the night profile photo through the image upload dialog
```

In §7.11, under **Stage 2: classification**, add:

```
  - [ ] (API) Rebuild the calibration set from photographs the browser has reduced, because re-encoding moved a test image across the day and night boundary (`../api/docs/aws-rekognition.md`)
```

In §7.13, change `- [x] **Bunny storage and CDN** (`../api/docs/bunny.md`)` to `- [ ] **Bunny storage and CDN** — *partial* (`../api/docs/bunny.md`)`, and add under its existing line:

```
  - [ ] (API) The browser's `exif` part with its recorded source, `IMAGE_TOO_SMALL` under 320 pixels, stored images flattened onto white, the night gates on a night upload, and the 30-second polling description
```

- [ ] **Step 10: Run the whole suite and commit**

Run: `cd ../api && ./gradlew check`
Expected: `BUILD SUCCESSFUL`. If `OpenApiDocumentIntegrationTest` or `ArchitectureTest` fails, read its message and fix the declaration it names. Do not weaken the test.

```bash
cd ../api && git add -A && git commit -m "Set and remove the profile photo through its own endpoints

The full day and night profile writes no longer carry imageId or write the
image column. PUT and DELETE on /me/day-profile/image and
/me/night-profile/image attach, replace and remove the photo under the
member row lock, and naming the current photo again answers 204.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
cd ../scratchpad && git add roadmap.md && git commit -m "Add the image upload dialog's roadmap lines and tick the profile image endpoints

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Upload endpoint changes in the API

**Goal:** `POST /api/member/images` gains five behaviours:

- It accepts an optional browser `exif` part, with the file's own EXIF winning and the source recorded.
- It refuses a photograph under 320 pixels on its short edge after reduction with `IMAGE_TOO_SMALL`.
- It flattens stored images onto white.
- It gates night uploads.
- Its description gives the 30-second schedule.

**Files:**

- Create: `../api/src/main/resources/db/migration/V097__image_hash_match_exif_source.sql`
- Create: `../api/src/main/java/cafe/sundial/api/exception/ImageTooSmallException.java`
- Modify: `../api/src/main/java/cafe/sundial/api/contract/ErrorCode.java`
- Modify: `../api/src/main/java/cafe/sundial/api/service/image/ImageReducer.java`
- Modify: `../api/src/main/java/cafe/sundial/api/service/image/ReducedImage.java`
- Modify: `../api/src/main/java/cafe/sundial/api/service/image/ImageCheckInput.java`
- Modify: `../api/src/main/java/cafe/sundial/api/service/image/HashMatchRecorder.java`
- Modify: `../api/src/main/java/cafe/sundial/api/repository/image/NewHashMatch.java`
- Modify: `../api/src/main/java/cafe/sundial/api/repository/image/ImageHashMatchRepository.java`
- Modify: `../api/src/main/java/cafe/sundial/api/service/image/ImageUploadService.java`
- Modify: `../api/src/main/java/cafe/sundial/api/contract/image/MemberImageApi.java`
- Modify: `../api/src/main/java/cafe/sundial/api/controller/image/MemberImageController.java`
- Create: `../api/src/test/resources/pdq/square-512x512.jpg`, `../api/src/test/resources/pdq/square-384x384.jpg`
- Modify: `../api/src/test/java/cafe/sundial/api/service/image/ImageReducerTest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/service/image/classify/PdqHashTest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/controller/image/ImageHashMatchE2ETest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/controller/image/ImageClassificationE2ETest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/controller/image/ImageDeletionE2ETest.java`
- Modify: `../api/src/test/java/cafe/sundial/api/controller/moderation/ReportE2ETest.java`
- Create: `../api/src/test/java/cafe/sundial/api/integration/ImageUploadNightGateIntegrationTest.java`
- Modify: `../api/docs/bunny.md`
- Modify: `../scratchpad/roadmap.md`

**Acceptance Criteria:**

- [ ] **The 320-pixel minimum:** `ImageReducer.reduce` throws `ImageTooSmallException` (400, `IMAGE_TOO_SMALL`) for a short edge of 319 after reduction and not for 320, including a 1600 by 399 panorama that reduces to 1280 by 319.
- [ ] **Flattening:** the stored full image and thumbnail of a PNG with a transparent left half are opaque, and read white (every channel above 240) in the transparent area.
- [ ] **EXIF source:**
  - A JPEG with its own `APP1` EXIF yields `exifSource = UPLOAD` and its own segment, whatever browser segment is passed.
  - A file without EXIF, given a valid browser segment, yields `exifSource = BROWSER` and that segment.
  - A browser segment not starting `Exif\0\0`, or over 65,533 bytes, is ignored.
- [ ] **The hash match record:** `image_hash_match.exif_source` is stored for a match, and a check constraint ties it to `exif_base64` being present.
- [ ] **Night gates:** `POST /api/member/images?side=NIGHT` answers `403 VERIFICATION_REQUIRED` for an unverified member and `403 NIGHT_NOT_ENABLED` for a verified member with night closed, before any decode.
- [ ] **The upload description** gives the 400 ms, 500 ms, 2 s and 30 s schedule and no longer says re-encoding discards location data.
- [ ] **Test fixtures:** every test fixture under 320 pixels on its short edge is replaced, including the two PDQ reference fixtures, and `PdqHashTest` proves the 512-pixel fixture's quality is at least 50.
- [ ] **Documentation:** `../api/docs/bunny.md` describes the `exif` part, its precedence, the browser's reduction and the `internal-proxies` deploy check.
- [ ] **The whole suite:** `./gradlew check` passes, and `./gradlew copyOpenApi` writes the new document to `../frontend/openapi.json`.

**Verify:** `cd ../api && ./gradlew check` → `BUILD SUCCESSFUL`

**Steps:**

- [ ] **Step 1: Write the failing reducer tests**

In `ImageReducerTest.java`, replace `reduce_shouldRejectAnImageWhoseShortEdgeIsUnder80Pixels` and `reduce_shouldAcceptAnImageExactlyAtThe80PixelFloor` with:

```java
    @Test
    void reduce_shouldRejectAnImageWhoseShortEdgeIsUnder320Pixels() throws Exception {
        byte[] letterbox = jpeg(800, 319);

        assertThatThrownBy(() -> reducer.reduce(letterbox, null))
            .isInstanceOf(ImageTooSmallException.class);
    }

    @Test
    void reduce_shouldAcceptAnImageExactlyAtThe320PixelFloor() throws Exception {
        ReducedImage reduced = reducer.reduce(jpeg(800, 320), null);

        assertThat(reduced.height()).isEqualTo(320);
    }

    @Test
    void reduce_shouldRejectAPanoramaThatReductionTakesUnder320Pixels() throws Exception {
        byte[] panorama = jpeg(1600, 399);

        assertThatThrownBy(() -> reducer.reduce(panorama, null))
            .isInstanceOf(ImageTooSmallException.class);
    }

    @Test
    void reduce_shouldFlattenTransparencyOntoWhiteInTheStoredImages() throws Exception {
        ReducedImage reduced = reducer.reduce(pngWithTransparentLeftHalf(400, 320), null);

        for (byte[] stored : List.of(reduced.full(), reduced.thumbnail())) {
            BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(stored));
            int pixel = decoded.getRGB(10, 10);
            assertThat((pixel >>> 24) & 0xFF).isEqualTo(255);
            assertThat((pixel >> 16) & 0xFF).isGreaterThan(240);
            assertThat((pixel >> 8) & 0xFF).isGreaterThan(240);
            assertThat(pixel & 0xFF).isGreaterThan(240);
        }
    }

    @Test
    void reduce_shouldKeepTheFilesOwnExifWhateverTheBrowserSends() throws Exception {
        byte[] jpeg = jpegWithApp1Exif();
        byte[] browserExif = "Exif��II*�other".getBytes(StandardCharsets.ISO_8859_1);

        ReducedImage reduced = reducer.reduce(jpeg, browserExif);

        byte[] kept = Base64.getDecoder().decode(reduced.exifBase64());
        assertThat(new String(kept, 6, 2, StandardCharsets.ISO_8859_1)).isEqualTo("MM");
        assertThat(reduced.exifSource()).isEqualTo(ExifSource.UPLOAD);
    }

    @Test
    void reduce_shouldUseTheBrowserExifWhenTheFileCarriesNone() throws Exception {
        byte[] browserExif = "Exif��II*�".getBytes(StandardCharsets.ISO_8859_1);

        ReducedImage reduced = reducer.reduce(plainJpegWithNoExif(), browserExif);

        assertThat(Base64.getDecoder().decode(reduced.exifBase64())).isEqualTo(browserExif);
        assertThat(reduced.exifSource()).isEqualTo(ExifSource.BROWSER);
    }

    @Test
    void reduce_shouldIgnoreABrowserSegmentWithoutTheExifHeader() throws Exception {
        byte[] notExif = "JFIF��".getBytes(StandardCharsets.ISO_8859_1);

        ReducedImage reduced = reducer.reduce(plainJpegWithNoExif(), notExif);

        assertThat(reduced.exifBase64()).isNull();
        assertThat(reduced.exifSource()).isNull();
    }

    @Test
    void reduce_shouldIgnoreABrowserSegmentLongerThanOneJpegSegment() throws Exception {
        byte[] tooLong = new byte[65_534];
        System.arraycopy("Exif��".getBytes(StandardCharsets.ISO_8859_1), 0, tooLong, 0, 6);

        ReducedImage reduced = reducer.reduce(plainJpegWithNoExif(), tooLong);

        assertThat(reduced.exifBase64()).isNull();
    }
```

Throughout `ImageReducerTest.java`:

- Change every other `reducer.reduce(x)` call to `reducer.reduce(x, null)`.
- Change the fixtures under 320 on their short edge:
  - `png(200, 150)` and `webp(200, 150)` become `png(400, 320)` and `webp(400, 320)`, with the width and height assertions set to `400` and `320`
  - `plainJpegWithNoExif` draws `400 x 400`
  - `pngWithTransparentLeftHalf(400, 300)` becomes `(400, 320)`
- Point `photographicReferenceJpeg` at `/pdq/square-512x512.jpg`.
- Add imports for `ExifSource` (generated jOOQ enum `cafe.sundial.api.jooq.enums.ExifSource`), `ImageTooSmallException`, `java.util.List` and `java.awt.image.BufferedImage` where missing.

- [ ] **Step 2: Create the larger PDQ reference fixtures**

Run from `../api`:

```bash
cat > /tmp/UpscaleFixture.java <<'EOF'
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class UpscaleFixture {
    public static void main(String[] args) throws Exception {
        BufferedImage source = ImageIO.read(new File(args[0]));
        int size = Integer.parseInt(args[2]);
        BufferedImage target = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        var graphics = target.createGraphics();
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        graphics.drawImage(source, 0, 0, size, size, null);
        graphics.dispose();
        ImageIO.write(target, "jpg", new File(args[1]));
    }
}
EOF
java /tmp/UpscaleFixture.java src/test/resources/pdq/square-256x256.jpg src/test/resources/pdq/square-512x512.jpg 512
java /tmp/UpscaleFixture.java src/test/resources/pdq/square-128x128.jpg src/test/resources/pdq/square-384x384.jpg 384
```

In `PdqHashTest.java`, add:

```java
    @Test
    void of_shouldGiveTheUpscaledReferenceFixtureAQualityOfAtLeast50() throws Exception {
        assertThat(hashOf("square-512x512.jpg").quality()).isGreaterThanOrEqualTo(50);
    }
```

Use the file's existing loader in place of `hashOf` if it is named differently. The loader reads `/pdq/` + fixture at line 48.

In `ImageHashMatchE2ETest.java`:

- Replace `referenceFixture("square-256x256.jpg")` with `referenceFixture("square-512x512.jpg")`.
- Replace `referenceFixture("square-128x128.jpg")` with `referenceFixture("square-384x384.jpg")`.
- Change `jpeg(Color.GREEN, 400, 300)` to `jpeg(Color.GREEN, 400, 320)`.
- Change every `imageReducer.reduce(x)` to `imageReducer.reduce(x, null)`.

Change the upload fixture sizes in three more tests:

- `ImageClassificationE2ETest.java`: both `400, 300` fixtures to `400, 320`.
- `ImageDeletionE2ETest.java`: `jpeg()` draws `400 x 320`.
- `ReportE2ETest.java`: `jpeg()` draws `400 x 320`.

Run: `grep -rn "new BufferedImage(\|jpeg(\|png(\|webp(" src/test/java | grep -v "ImageReducerTest"`. Confirm that no other fixture reaching `reduce` or an upload is under 320 on its short edge.

- [ ] **Step 3: Run the reducer tests to see them fail**

Run: `./gradlew test --tests '*ImageReducerTest' --tests '*PdqHashTest'`
Expected: compilation FAIL, because `reduce(byte[], byte[])`, `ImageTooSmallException`, `exifSource()` and `ExifSource` do not exist.

- [ ] **Step 4: Add the migration, the error code and the exception**

Create `src/main/resources/db/migration/V097__image_hash_match_exif_source.sql`:

```sql
CREATE TYPE exif_source AS ENUM ('UPLOAD', 'BROWSER');

ALTER TABLE image_hash_match
    ADD COLUMN exif_source exif_source,
    ADD CONSTRAINT image_hash_match_exif_source_present
        CHECK ((exif_base64 IS NULL) = (exif_source IS NULL));

COMMENT ON COLUMN image_hash_match.exif_source IS
    'UPLOAD when the EXIF came from the uploaded file itself. BROWSER when the file carried none and the '
    'uploader''s browser sent the original photograph''s EXIF segment separately, which is not tied to the '
    'pixels and is described that way in a report.';
```

Read `docs/database.md` before running it, and follow any naming rule it sets for types and constraints.

In `ErrorCode.java`, add `IMAGE_TOO_SMALL,` after `IMAGE_UNREADABLE,`.

Create `src/main/java/cafe/sundial/api/exception/ImageTooSmallException.java`:

```java
package cafe.sundial.api.exception;

import cafe.sundial.api.contract.ErrorCode;

public class ImageTooSmallException extends ApiException {

    public ImageTooSmallException() {
        super(400, ErrorCode.IMAGE_TOO_SMALL);
    }
}
```

Run: `./gradlew generateJooq` (or the project's jOOQ generation task named in `build.gradle.kts`), so that `ExifSource` and `IMAGE_HASH_MATCH.EXIF_SOURCE` exist.

- [ ] **Step 5: Change the reducer**

In `ImageReducer.java`:

1. Replace `MIN_CLASSIFIER_EDGE = 80` with `private static final int MIN_SHORT_EDGE = 320;`, and add `private static final int MAX_EXIF_SEGMENT_BYTES = 65_533;`.
2. Replace `reduce`:

```java
    public ReducedImage reduce(byte[] uploaded, byte @Nullable [] browserExif) {
        return withReader(uploaded, reader -> {
            requireWithinPixelCeiling(reader);
            Orientation orientation = "JPEG".equals(reader.getFormatName())
                ? readOrientation(reader)
                : null;
            BufferedImage decoded = applyOrientation(reader.read(0), orientation);
            return buildArtefacts(decoded, chooseExif(exifBase64(uploaded), browserExif));
        });
    }

    private ChosenExif chooseExif(@Nullable String fromUpload, byte @Nullable [] browserExif) {
        if (fromUpload != null) {
            return new ChosenExif(fromUpload, ExifSource.UPLOAD);
        }
        if (browserExif != null && browserExif.length <= MAX_EXIF_SEGMENT_BYTES
            && startsWithExifHeader(browserExif, 0, browserExif.length)) {
            return new ChosenExif(Base64.getEncoder().encodeToString(browserExif), ExifSource.BROWSER);
        }
        return new ChosenExif(null, null);
    }

    private record ChosenExif(@Nullable String base64, @Nullable ExifSource source) {
    }
```

3. Replace `buildArtefacts` and `requireClassifiableSize`:

```java
    private ReducedImage buildArtefacts(BufferedImage decoded, ChosenExif exif) throws IOException {
        int longestEdge = Math.max(decoded.getWidth(), decoded.getHeight());
        int fullEdge = Math.min(longestEdge, FULL_EDGE);
        BufferedImage reduced = Thumbnails.of(decoded)
            .size(fullEdge, fullEdge)
            .keepAspectRatio(true)
            .asBufferedImage();
        requireMinimumShortEdge(reduced);
        BufferedImage opaque = flattenOntoWhite(reduced);
        byte[] fullBytes = encodeWebp(opaque, FULL_QUALITY);
        byte[] classifierBytes = encodeJpeg(opaque);
        PdqHash pdqHash = PdqHash.of(opaque);

        BufferedImage thumbnail = Thumbnails.of(opaque)
            .size(THUMBNAIL_EDGE, THUMBNAIL_EDGE)
            .keepAspectRatio(true)
            .asBufferedImage();
        byte[] thumbnailBytes = encodeWebp(thumbnail, THUMBNAIL_QUALITY);

        String placeholderBase64 = placeholder(opaque);

        return new ReducedImage(fullBytes, thumbnailBytes, classifierBytes, pdqHash, placeholderBase64,
            opaque.getWidth(), opaque.getHeight(), exif.base64(), exif.source());
    }

    private void requireMinimumShortEdge(BufferedImage reduced) {
        if (Math.min(reduced.getWidth(), reduced.getHeight()) < MIN_SHORT_EDGE) {
            throw new ImageTooSmallException();
        }
    }
```

4. Change `checkInputFrom`'s construction to `new ImageCheckInput(encodeJpeg(opaque), PdqHash.of(opaque), storedImage, null, null)`.

5. Import `cafe.sundial.api.exception.ImageTooSmallException` and `cafe.sundial.api.jooq.enums.ExifSource`.

In `ReducedImage.java`, add a final component `@Nullable ExifSource exifSource` and change `checkInput()` to `return new ImageCheckInput(classifierJpeg, pdqHash, full, exifBase64, exifSource);`.

In `ImageCheckInput.java`, add a final component `@Nullable ExifSource exifSource`.

In `NewHashMatch.java`, add `@Nullable ExifSource exifSource` directly after `exifBase64`. In `HashMatchRecorder.record`, pass `input.exifSource()` after `input.exifBase64()`. In `ImageHashMatchRepository.insert`, add `.set(IMAGE_HASH_MATCH.EXIF_SOURCE, match.exifSource())` after the `EXIF_BASE64` line.

Search for other constructors of these records and update them: `grep -rn "new ImageCheckInput(\|new ReducedImage(\|new NewHashMatch(" src`.

- [ ] **Step 6: Write the failing night-gate test**

Create `src/test/java/cafe/sundial/api/integration/ImageUploadNightGateIntegrationTest.java`:

```java
package cafe.sundial.api.integration;

import java.time.Instant;
import java.time.LocalDate;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import cafe.sundial.api.jooq.enums.AreaCode;
import cafe.sundial.api.jooq.enums.MemberGender;
import cafe.sundial.api.service.auth.CookieService;
import cafe.sundial.api.service.auth.JwtService;
import cafe.sundial.api.service.auth.domain.JwtUser;
import cafe.sundial.api.tests.BaseRepositoryTest;

import static cafe.sundial.api.jooq.Tables.IMAGE;
import static cafe.sundial.api.jooq.Tables.MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ImageUploadNightGateIntegrationTest extends BaseRepositoryTest {

    private static final Instant LONG_AGO = Instant.parse("2026-08-01T09:00:00Z");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Test
    void uploadImage_shouldRefuseANightUploadFromAnUnverifiedMember() throws Exception {
        String member = member(false, false);

        mockMvc.perform(multipart("/api/member/images").file(notAnImage()).param("side", "NIGHT")
                .cookie(accessCookieFor(member)).header("X-Requested-With", "sundial"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.errorCode").value("VERIFICATION_REQUIRED"));

        assertThat(dsl.fetchCount(IMAGE, IMAGE.UPLOADER_ID.eq(member))).isZero();
    }

    @Test
    void uploadImage_shouldRefuseANightUploadWithTheNightSideClosed() throws Exception {
        String member = member(true, false);

        mockMvc.perform(multipart("/api/member/images").file(notAnImage()).param("side", "NIGHT")
                .cookie(accessCookieFor(member)).header("X-Requested-With", "sundial"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.errorCode").value("NIGHT_NOT_ENABLED"));
    }

    @Test
    void uploadImage_shouldReachTheDecoderForADayUploadFromAnUnverifiedMember() throws Exception {
        String member = member(false, false);

        mockMvc.perform(multipart("/api/member/images").file(notAnImage()).param("side", "DAY")
                .cookie(accessCookieFor(member)).header("X-Requested-With", "sundial"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("IMAGE_UNREADABLE"));
    }

    private MockMultipartFile notAnImage() {
        return new MockMultipartFile("file", "photo.jpg", "image/jpeg", "not an image".getBytes());
    }

    private String member(boolean verified, boolean nightOpen) {
        String id = uniqueId();
        dsl.insertInto(MEMBER)
            .set(MEMBER.ID, id)
            .set(MEMBER.EMAIL, uniqueEmail(id))
            .set(MEMBER.NICKNAME, uniqueNickname(id))
            .set(MEMBER.GENDER, MemberGender.WOMAN)
            .set(MEMBER.DATE_OF_BIRTH, LocalDate.of(1990, 1, 1))
            .set(MEMBER.AREA_CODE, AreaCode.ABDN)
            .set(MEMBER.VERIFIED_AT, verified ? LONG_AGO : null)
            .set(MEMBER.NIGHT_ENABLED_AT, nightOpen ? LONG_AGO : null)
            .execute();
        return id;
    }

    private Cookie accessCookieFor(String memberId) {
        String token = jwtService.generateAccessToken(new JwtUser(memberId, "MEMBER", true, true)).value();
        return new Cookie(CookieService.ACCESS_TOKEN_COOKIE, token);
    }
}
```

Run: `./gradlew test --tests '*ImageUploadNightGateIntegrationTest'`
Expected: FAIL on the two night cases, which answer `400 IMAGE_UNREADABLE`.

- [ ] **Step 7: Gate the upload and accept the `exif` part**

In `ImageUploadService.java`:

- add a `MemberRepository memberRepository` constructor parameter and field
- replace `upload` with:

```java
    public String upload(String uploaderId, PostSide side, byte[] content, byte @Nullable [] browserExif,
                         String uploadIp) {
        if (side == PostSide.NIGHT) {
            NightSideGate.requireOpen(memberRepository.findById(uploaderId)
                .orElseThrow(() -> new NotFoundException(ErrorCode.NOT_FOUND)));
        }
        imageUploadRateLimitService.check(uploaderId);
        ReducedImage reduced = imageDecodeLimiter.decoding(() -> imageReducer.reduce(content, browserExif));
        String id = idGenerator.generate();
        String storageKey = id.substring(0, 2) + "/" + id;

        imageRepository.insert(new NewImage(id, uploaderId, side, storageKey,
            reduced.width(), reduced.height(), reduced.placeholderBase64(), uploadIp));

        imageStorage.putPrivate(storageKey, ImageObject.FULL, reduced.full());
        imageStorage.putPrivate(storageKey, ImageObject.THUMBNAIL, reduced.thumbnail());
        imageRepository.markStored(id);
        imageUploadRateLimitService.record(uploaderId);

        imageCheckDispatcher.dispatch(id,
            () -> imageCheckPipeline.check(id, reduced.checkInput()));
        return id;
    }
```

Import `ErrorCode`, `NotFoundException`, `MemberRepository`, `NightSideGate` and `org.jspecify.annotations.Nullable`. If `ArchitectureTest` refuses `service.image` depending on `service.member`, move the gate check into `MemberImageController.uploadImage` through a `MemberService` method that already loads the member. Do not weaken the rule.

In `MemberImageApi.java`:

- change the `uploadImage` signature to:

```java
    ImageView uploadImage(@RequestParam PostSide side, @RequestPart("file") MultipartFile file,
        @Parameter(description = "The original JPEG's EXIF APP1 segment, from the Exif header to the segment's "
            + "end, sent when the browser re-encoded the photograph. Used only when the file carries no EXIF "
            + "of its own, and never read for orientation.")
        @RequestPart(value = "exif", required = false) @Nullable MultipartFile exif,
        @Parameter(hidden = true) HttpServletRequest request);
```

- add the failures:

```java
    @Failure(status = HttpStatus.BAD_REQUEST, code = ErrorCode.IMAGE_TOO_SMALL,
        when = "The image's short edge is under 320 pixels once its long edge is reduced to 1280.")
    @Failure(status = HttpStatus.FORBIDDEN, code = ErrorCode.VERIFICATION_REQUIRED,
        when = "side is NIGHT and the member is not verified.")
    @Failure(status = HttpStatus.FORBIDDEN, code = ErrorCode.NIGHT_NOT_ENABLED,
        when = "side is NIGHT and the member has not opened the night side.")
```

- replace the `description` of `uploadImage` with:

```java
        description = "Answers once the image has been stored, with a state of CHECKING and no URLs. The "
            + "check runs afterwards on its own threads, so the outcome arrives by polling "
            + "GET /api/member/images/{id}: READY once the image is published, or REFUSED. Show "
            + "placeholderDataUrl, which is a blurred 32-pixel WebP, while you wait.\n\n"
            + "Poll first at 400 ms, then every 500 ms until 5 seconds have passed, then every 2 seconds until "
            + "30 seconds. A night-side image usually settles in around a quarter of a second and a day-side "
            + "one in under a second. A slow check waits on hash matching (up to 8 seconds), classification "
            + "(up to 8 seconds) and, for a day image, a copy between storage zones.\n\n"
            + "Stop polling at 30 seconds. An image still CHECKING then is retried no sooner than five minutes "
            + "after its upload, so there is nothing to observe in between. Tell the member to try again in a "
            + "few minutes. An image nothing can resolve reaches CHECK_FAILED within the hour, which means no "
            + "vendor answered and nothing was judged.\n\n"
            + "An image cannot be attached to a post or a profile until it reports READY, and an attempt "
            + "before then answers 409 IMAGE_NOT_ATTACHABLE. The image is reduced to at most 1280 pixels on "
            + "its longest edge, flattened onto white and re-encoded, and the stored image carries no EXIF. "
            + "EXIF received with an upload is kept only when a hash scheme matches the image. The side "
            + "cannot be changed afterwards.")
```

In `MemberImageController.java`, change `uploadImage` to:

```java
    @Override
    public ImageView uploadImage(PostSide side, MultipartFile file, @Nullable MultipartFile exif,
                                 HttpServletRequest request) {
        JwtUser user = currentUserProvider.require();
        String id = imageUploadService.upload(user.memberId(), side, readBytes(file),
            exif == null ? null : readBytes(exif), ClientAddressResolver.remoteAddressOf(request));
        return viewOf(id, user);
    }
```

Import `org.jspecify.annotations.Nullable`. Update every other call to `imageUploadService.upload(` in `src/test` with a `null` browser EXIF argument: `grep -rn "imageUploadService.upload(" src`.

- [ ] **Step 8: Document it in `docs/bunny.md`**

In `../api/docs/bunny.md`, section "Decoding an upload", replace the sentence "The frontend reduces an image before uploading it, so ordinary traffic never waits here." with the following paragraphs:

```markdown
The frontend reduces a photograph in the browser to 1280 pixels on its long edge and uploads a JPEG, so ordinary traffic decodes a small image here. An RGB or greyscale JPEG already within 1280 pixels is uploaded untouched.

A canvas discards EXIF, so a browser that re-encoded the photograph sends the original JPEG's EXIF `APP1` segment as a separate `exif` part. `ImageReducer.reduce` uses the uploaded file's own EXIF whenever it has one, and falls back to the part only when it has none. The part must start `Exif\0\0` and be at most 65,533 bytes, or it is ignored. It is never read for orientation. `image_hash_match.exif_source` records which of the two was kept. EXIF from the part was supplied by the uploader's browser separately from the pixels, so a report never describes it as the camera's own data.

A browser upload reaches this API through the frontend's `/api` rewrite, and `upload_ip` is the Schedule 1 address of the uploading device. The rewrite passes `cf-connecting-ip` through. Tomcat resolves it as the client address only when the frontend container's address falls inside `server.tomcat.remoteip.internal-proxies` in `application-prod.yml`. Check that on every change to the deployment's network, by uploading through the site and reading the image row's `upload_ip`.
```

- [ ] **Step 9: Run the suite, copy the document, tick the line and commit**

Run: `cd ../api && ./gradlew check && ./gradlew copyOpenApi`
Expected: `BUILD SUCCESSFUL` twice. `git -C ../frontend diff --stat openapi.json` shows a change.

In `../scratchpad/roadmap.md` §7.13, tick the line added in Task 2 Step 9 that begins `(API) The browser's \`exif\` part`, and change the heading back to `- [x] **Bunny storage and CDN** (`../api/docs/bunny.md`)`.

```bash
cd ../api && git add -A && git commit -m "Take the browser's EXIF part, refuse photographs under 320 pixels and flatten stored images

The uploaded file's own EXIF always wins over the part, and the hash match
records which was kept. A night upload now needs verification and an open
night side. The upload description gives the 30-second polling schedule.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
cd ../scratchpad && git add roadmap.md && git commit -m "Tick the upload endpoint changes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

`openapi.json` in the frontend is committed in Task 4, together with the code that absorbs it.

---

### Task 4: The frontend on the new contract, with a browser API client

**Goal:** The frontend builds against the new `openapi.json` and gains a browser client for the `Images` tag. The client:

- sends the CSRF header
- refreshes the session once on `401`
- sends the member to sign in only when the refresh is refused
- passes cancellation through
- reports upload progress

**Files:**

- Modify: `openapi.json` (copied in Task 3)
- Modify: `lib/profile/actions.ts`, `lib/profile/night-actions.ts`, `lib/profile/night-actions.test.ts`
- Modify: `orval.config.ts`
- Create: `lib/api/browser.ts`, `lib/api/browser.test.ts`, `lib/api/browser-navigation.ts`, `lib/api/browser-client.ts`
- Modify: `lib/routing/links.ts`, `lib/routing/links.test.ts` (create if absent)
- Modify: `next.config.ts`, `next.config.test.ts`
- Modify: `CLAUDE.md`

**Acceptance Criteria:**

- [ ] `npm run generate:api` writes `lib/api/generated/browser/images/images.ts`, whose functions call `browserFetch` and type `uploadImageBody` with `file` and an optional `exif`.
- [ ] `saveProfile` and `saveNightProfile` send no `imageId`, and `saveNightProfile` makes no `GET /api/member/me/night-profile` request.
- [ ] **`browserFetch`:**
  - it sets `X-Requested-With: sundial`
  - it sets no `content-type` on a `FormData` body and sets `application/json` on a string body
  - on a `401` outside `/api/auth/`, it refreshes once and retries once
  - three concurrent `401`s share one refresh request
  - a refresh answering `401` or `403` calls `navigateToSignIn` and never settles
  - a refresh answering `5xx`, or failing on the network, rejects with `BrowserNetworkError` and does not navigate
  - a `401` from `/api/auth/login` is returned without a refresh
  - an aborted signal rejects with an `AbortError`
  - `onUploadProgress` receives fractions ending at `1`
- [ ] `links.loginReturningTo('/profile')` is `/login?next=%2Fprofile`.
- [ ] `next.config.ts` sets `experimental.proxyClientMaxBodySize: '12mb'`, pinned by a test.
- [ ] `CLAUDE.md`'s server-only client rule is replaced by the text in Step 8.
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass.

**Verify:** `npm run generate:api && npm run typecheck && npm run lint && npm test` → all pass

**Steps:**

- [ ] **Step 1: Regenerate and absorb the contract**

Run: `npm run generate:api && npm run typecheck`
Expected: FAIL in `lib/profile/actions.ts` and `lib/profile/night-actions.ts` on `imageId`.

In `lib/profile/actions.ts`, delete the line `      imageId: current.image?.id,` from `saveDayProfile`.

In `lib/profile/night-actions.ts`, delete `const current = unwrap(await getOwnNightProfile());` and `      imageId: current.image?.id,`. Remove `getOwnNightProfile` and `unwrap` from the import if nothing else uses them.

In `lib/profile/night-actions.test.ts`:

- delete `currentNightProfile`, the `getGetOwnNightProfileMockHandler(currentNightProfile),` handler and its import
- delete `imageId: 'img-1',` from the first test's `toMatchObject`
- replace the test `carries the current image id forward, since the form does not edit it` with:

```ts
it('sends no image id, since the photo has its own endpoint', async () => {
  await expect(save()).rejects.toThrow(/REDIRECT/);
  expect(lastNightProfilePut).not.toHaveProperty('imageId');
});
```

Run: `npm run typecheck && npx vitest run lib/profile`
Expected: PASS.

- [ ] **Step 2: Add the builder and the body size limit, with tests**

In `lib/routing/links.ts`, add to the `links` object after `login`:

```ts
  loginReturningTo: (path: string) => r(`/login?next=${encodeURIComponent(path)}`),
```

Add to `lib/routing/links.test.ts`. Create the file with `// @vitest-environment node` and `import { links } from './links';` if it does not exist.

```ts
describe('links.loginReturningTo', () => {
  it('encodes the return path into next', () => {
    expect(links.loginReturningTo('/night/profile?saved=true')).toBe('/login?next=%2Fnight%2Fprofile%3Fsaved%3Dtrue');
  });
});
```

In `next.config.ts`, change the `experimental` line to:

```ts
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react/ssr'],
    globalNotFound: true,
    proxyClientMaxBodySize: '12mb',
  },
```

Add a comment above `proxyClientMaxBodySize` only if the reason cannot be read from the test name.

In `next.config.test.ts`, add:

```ts
describe('next.config rewrite body limit', () => {
  it('lets an upload through the /api rewrite reach the API whole, up to the API multipart limit', () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe('12mb');
  });
});
```

Run: `npx vitest run lib/routing next.config.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing browser client tests**

Create `lib/api/browser-navigation.ts`:

```ts
import { links } from '@/lib/routing/links';

export function navigateToSignIn(): void {
  window.location.assign(links.loginReturningTo(`${window.location.pathname}${window.location.search}`));
}
```

Create `lib/api/browser.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserNetworkError, browserFetch } from './browser';
import { navigateToSignIn } from './browser-navigation';

vi.mock('./browser-navigation', () => ({ navigateToSignIn: vi.fn() }));

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type Call = { url: string; init: RequestInit };

function stubFetch(answer: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return answer(call, calls.length - 1);
    })
  );
  return calls;
}

const neverSettles = async (promise: Promise<unknown>) => {
  const outcome = await Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled'
    ),
    new Promise((r) => setTimeout(() => r('pending'), 20)),
  ]);
  return outcome;
};

describe('browserFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(navigateToSignIn).mockReset();
  });

  it('sends the CSRF header', async () => {
    const calls = stubFetch(() => json(200, {}));
    await browserFetch('/api/member/images/abc', { method: 'GET' });
    expect(new Headers(calls[0]!.init.headers).get('X-Requested-With')).toBe('sundial');
  });

  it('leaves the content type of a form body to the browser', async () => {
    const calls = stubFetch(() => json(201, {}));
    await browserFetch('/api/member/images?side=DAY', { method: 'POST', body: new FormData() });
    expect(new Headers(calls[0]!.init.headers).has('content-type')).toBe(false);
  });

  it('marks a string body as JSON', async () => {
    const calls = stubFetch(() => json(204));
    await browserFetch('/api/member/me/day-profile/image', { method: 'PUT', body: '{}' });
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBe('application/json');
  });

  it('returns the status, the parsed body and the headers', async () => {
    stubFetch(() => json(200, { id: 'abc', state: 'CHECKING' }));
    const result = await browserFetch<{ status: number; data: { id: string } }>('/api/member/images/abc');
    expect(result.status).toBe(200);
    expect(result.data.id).toBe('abc');
  });

  it('refreshes once on a 401 and retries the request', async () => {
    const calls = stubFetch((call, index) => {
      if (call.url === '/api/auth/refresh') return json(200, { refreshed: true });
      return index === 0 ? json(401) : json(200, { id: 'abc' });
    });
    const result = await browserFetch<{ status: number }>('/api/member/images/abc');
    expect(result.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/member/images/abc',
      '/api/auth/refresh',
      '/api/member/images/abc',
    ]);
  });

  it('shares one refresh between concurrent 401s', async () => {
    let refreshed = false;
    const calls = stubFetch(async (call) => {
      if (call.url === '/api/auth/refresh') {
        await new Promise((resolve) => setTimeout(resolve, 10));
        refreshed = true;
        return json(200, { refreshed: true });
      }
      return refreshed ? json(200, {}) : json(401);
    });
    await Promise.all([
      browserFetch('/api/member/images/a'),
      browserFetch('/api/member/images/b'),
      browserFetch('/api/member/images/c'),
    ]);
    expect(calls.filter((call) => call.url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('sends the member to sign in and never settles when the refresh is refused', async () => {
    stubFetch((call) => (call.url === '/api/auth/refresh' ? json(401) : json(401)));
    const pending = browserFetch('/api/member/images/abc');
    expect(await neverSettles(pending)).toBe('pending');
    expect(navigateToSignIn).toHaveBeenCalledTimes(1);
  });

  it('fails as a network failure without navigating when the refresh answers 5xx', async () => {
    stubFetch((call) => (call.url === '/api/auth/refresh' ? json(503) : json(401)));
    await expect(browserFetch('/api/member/images/abc')).rejects.toBeInstanceOf(BrowserNetworkError);
    expect(navigateToSignIn).not.toHaveBeenCalled();
  });

  it('fails as a network failure without navigating when the refresh cannot reach the API', async () => {
    stubFetch((call) => {
      if (call.url === '/api/auth/refresh') throw new TypeError('Failed to fetch');
      return json(401);
    });
    await expect(browserFetch('/api/member/images/abc')).rejects.toBeInstanceOf(BrowserNetworkError);
    expect(navigateToSignIn).not.toHaveBeenCalled();
  });

  it('returns a 401 from an auth endpoint without refreshing', async () => {
    const calls = stubFetch(() => json(401, { errorCode: 'INVALID_CREDENTIALS' }));
    const result = await browserFetch<{ status: number }>('/api/auth/login', { method: 'POST', body: '{}' });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it('rejects with an AbortError when the signal is aborted', async () => {
    stubFetch(
      (call) =>
        new Promise((_, reject) =>
          call.init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        )
    );
    const controller = new AbortController();
    const pending = browserFetch('/api/member/images/abc', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports upload progress through XMLHttpRequest when asked', async () => {
    const progress: number[] = [];
    class FakeRequest {
      upload: { onprogress?: (event: ProgressEvent) => void; onload?: () => void } = {};
      status = 201;
      responseText = '{"id":"abc","state":"CHECKING"}';
      onload?: () => void;
      onerror?: () => void;
      onabort?: () => void;
      headers: Record<string, string> = {};
      open() {}
      setRequestHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
      }
      getAllResponseHeaders() {
        return 'content-type: application/json\r\n';
      }
      abort() {
        this.onabort?.();
      }
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
        this.upload.onload?.();
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const result = await browserFetch<{ status: number; data: { id: string } }>('/api/member/images?side=DAY', {
      method: 'POST',
      body: new FormData(),
      onUploadProgress: (fraction) => progress.push(fraction),
    });
    expect(progress).toEqual([0.5, 1]);
    expect(result.data.id).toBe('abc');
  });
});
```

Run: `npx vitest run lib/api/browser.test.ts`
Expected: FAIL, because `./browser` does not exist.

- [ ] **Step 4: Write `lib/api/browser.ts`**

```ts
import { CSRF_HEADER, CSRF_VALUE } from './base-url';
import { navigateToSignIn } from './browser-navigation';

export type BrowserRequestInit = RequestInit & { onUploadProgress?: (fraction: number) => void };

type BrowserResponse = { data: unknown; status: number; headers: Headers };
type RefreshOutcome = 'refreshed' | 'refused' | 'unavailable';

const AUTH_PATH_PREFIX = '/api/auth/';
const REFRESH_PATH = '/api/auth/refresh';

export class BrowserNetworkError extends Error {
  constructor() {
    super('The request did not reach the API.');
    this.name = 'BrowserNetworkError';
  }
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

export const browserFetch = async <T>(url: string, init: BrowserRequestInit = {}): Promise<T> => {
  const first = await send(url, init);
  if (first.status !== 401 || url.startsWith(AUTH_PATH_PREFIX)) return first as T;

  const outcome = await refreshOnce();
  if (outcome === 'unavailable') throw new BrowserNetworkError();
  if (outcome === 'refused') return signInAndWait<T>();

  const second = await send(url, init);
  if (second.status === 401) return signInAndWait<T>();
  return second as T;
};

function signInAndWait<T>(): Promise<T> {
  navigateToSignIn();
  return new Promise<T>(() => {});
}

function refreshOnce(): Promise<RefreshOutcome> {
  refreshInFlight ??= refresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refresh(): Promise<RefreshOutcome> {
  try {
    const response = await fetch(REFRESH_PATH, {
      method: 'POST',
      headers: { [CSRF_HEADER]: CSRF_VALUE },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.ok) return 'refreshed';
    return response.status === 401 || response.status === 403 ? 'refused' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function send(url: string, init: BrowserRequestInit): Promise<BrowserResponse> {
  const { onUploadProgress, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  headers.set(CSRF_HEADER, CSRF_VALUE);
  if (typeof requestInit.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (onUploadProgress) return sendWithProgress(url, { ...requestInit, headers }, onUploadProgress);

  let response: Response;
  try {
    response = await fetch(url, { ...requestInit, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new BrowserNetworkError();
  }
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return { data, status: response.status, headers: response.headers };
}

function sendWithProgress(
  url: string,
  init: RequestInit & { headers: Headers },
  onUploadProgress: (fraction: number) => void
): Promise<BrowserResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(init.method ?? 'GET', url);
    init.headers.forEach((value, name) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onUploadProgress(event.loaded / event.total);
    };
    request.upload.onload = () => onUploadProgress(1);
    request.onload = () =>
      resolve({
        data: parseJson(request.responseText),
        status: request.status,
        headers: parseHeaders(request.getAllResponseHeaders()),
      });
    request.onerror = () => reject(new BrowserNetworkError());
    request.onabort = () => reject(new DOMException('The request was cancelled.', 'AbortError'));
    if (init.signal?.aborted) {
      request.abort();
      return;
    }
    init.signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(init.body as XMLHttpRequestBodyInit | null);
  });
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(':');
    if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
```

Run: `npx vitest run lib/api/browser.test.ts`
Expected: PASS, 13 tests.

Break the guard once to prove it:

- Change `response.status === 401 || response.status === 403 ? 'refused' : 'unavailable'` to `'refused'`.
- Watch the two network-failure tests fail.
- Restore it.

- [ ] **Step 5: Generate the browser output**

Replace `orval.config.ts` with:

```ts
import { defineConfig } from 'orval';

export default defineConfig({
  sundial: {
    input: './openapi.json',
    output: {
      target: './lib/api/generated/api.ts',
      client: 'fetch',
      mode: 'tags-split',
      baseUrl: '',
      mock: {
        generators: [{ type: 'msw', delay: false, useExamples: true }],
        indexMockFiles: true,
      },
      override: { mutator: { path: './lib/api/fetcher.ts', name: 'apiFetch' } },
    },
  },
  sundialBrowser: {
    input: { target: './openapi.json', filters: { tags: ['Images'] } },
    output: {
      target: './lib/api/generated/browser/api.ts',
      client: 'fetch',
      mode: 'tags-split',
      baseUrl: '',
      override: { mutator: { path: './lib/api/browser.ts', name: 'browserFetch' } },
    },
  },
});
```

Run: `npm run generate:api && ls lib/api/generated/browser`
Expected: `api.schemas.ts` and `images/`. If orval writes the schemas file elsewhere, adjust the re-export below to the paths it wrote.

Create `lib/api/browser-client.ts`:

```ts
export * from './generated/browser/api.schemas';
export * from './generated/browser/images/images';
```

Run: `npm run typecheck`
Expected: PASS. If the server output's `lib/api/index.ts` now fails because orval's first output also changed, stop and read the diff. The server output must be unchanged apart from the new endpoints.

- [ ] **Step 6: Confirm the browser output uses `browserFetch`**

Run: `grep -c "browserFetch" lib/api/generated/browser/images/images.ts && grep -n "exif" lib/api/generated/browser/api.schemas.ts`
Expected: a count of at least 3, and `exif?: Blob;` in `UploadImageBody`.

- [ ] **Step 7: Guard the generated browser output from the server client**

Add to `lib/api/browser.test.ts`:

```ts
describe('the generated browser client', () => {
  it('never imports the server fetcher', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('lib/api/generated/browser/images/images.ts', 'utf8');
    expect(source).not.toContain('fetcher');
    expect(source).toContain('browserFetch');
  });
});
```

Run: `npx vitest run lib/api/browser.test.ts`
Expected: PASS.

- [ ] **Step 8: Narrow the rule in `CLAUDE.md`**

In `CLAUDE.md`, replace the bullet that begins `- **The generated API client is server-only.**` with:

```markdown
- **The generated API client is server-only, and server actions are the default way a client component reaches the API.** Three mechanisms live on the server. `proxy.ts` refreshes the session before a page request or a server action, and its matcher excludes `/api`. `lib/api/fetcher.ts` forwards only the API's own cookies, the CSRF header and the member's address. It also relays `Set-Cookie` through `cookies()`, which needs `import 'server-only'`. A write whose effect must appear on a server-rendered page is a server action. A client component may call `/api` directly only when it needs upload progress, cancellation or polling, and then only through `lib/api/browser-client.ts`. That is orval's second output, filtered by tag in `orval.config.ts`, on the `browserFetch` mutator in `lib/api/browser.ts`. `browserFetch` sets the CSRF header, refreshes once on a `401` outside `/api/auth/`, sends the member to sign in only when the refresh is refused, and treats an unreachable refresh as a network failure, as `proxy.ts` does. The member's address still reaches the API, because the rewrite passes `cf-connecting-ip` through. A tag joins the filter when a feature needs one of these three things. Client code imports `unwrap` from `@/lib/api/unwrap` and `ApiError` from `@/lib/api/errors`, because `@/lib/api` pulls in the server output.
```

- [ ] **Step 9: Run everything and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

```bash
git add openapi.json orval.config.ts lib/api/browser.ts lib/api/browser.test.ts lib/api/browser-navigation.ts lib/api/browser-client.ts lib/routing/links.ts lib/routing/links.test.ts next.config.ts next.config.test.ts lib/profile/actions.ts lib/profile/night-actions.ts lib/profile/night-actions.test.ts CLAUDE.md
git commit -m "Take the new image API contract and add a browser client for the Images tag

The full profile saves stop sending imageId. browserFetch sets the CSRF
header, refreshes once on a 401, sends the member to sign in only when the
refresh is refused, passes cancellation through and reports upload
progress. The /api rewrite now passes a body of up to 12 MB whole.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Browser preparation of a photograph

**Goal:** `reduceForUpload` turns a chosen file into one of three results:

- the untouched original
- a 1280-pixel JPEG at 0.92, resized by pica and flattened onto white, with the original's EXIF segment kept aside
- a typed failure

Planning and JPEG header parsing are pure and fully tested.

**Files:**

- Create: `lib/images/plan-upload.ts`, `lib/images/plan-upload.test.ts`
- Create: `lib/images/jpeg-segments.ts`, `lib/images/jpeg-segments.test.ts`
- Create: `lib/images/reduce-for-upload.ts`
- Modify: `lib/security/csp.ts`, `lib/security/csp.test.ts`
- Modify: `package.json`, `package-lock.json`

**Acceptance Criteria:**

- [ ] **`planUpload` returns:**
  - `too-small` for a short edge of 319
  - `too-narrow` for 1600 by 399, and not for 1600 by 400
  - `original` for a 1280 by 960 RGB JPEG of 5,242,880 bytes, and `encode` at 5,242,881 bytes
  - `encode` at the original size for a 1280 by 960 CMYK JPEG, a PNG, a WebP and a HEIC
  - `encode` to 1280 by 961 for 1281 by 962
  - decode dimensions equal to the source at exactly 50,000,000 pixels
  - a divisor of 4 for 12000 by 9000, giving 3000 by 2250
- [ ] **`extractExifSegment` returns:**
  - the bytes from `Exif\0\0` to the segment's end for a JPEG whose `APP1` sits after `APP0`, and for one whose `APP1` comes first
  - nothing for a JPEG with no EXIF, a truncated segment and a PNG
- [ ] **`readComponentCount`** returns 3 for an SOF0 with three components and 4 for an SOF2 with four.
- [ ] **`reduceForUpload`** follows Task 1's "Decisions for Task 5". It closes bitmaps, zeroes both canvases and revokes the object URL on every exit. It returns `timed-out` after 60 seconds, and rethrows an `AbortError` when the caller aborts.
- [ ] **CSP:** `lib/security/csp.ts` carries `worker-src 'self' blob:`, pinned by a test.
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass.

**Verify:** `npx vitest run lib/images lib/security && npm run typecheck && npm run lint` → all pass

**Steps:**

- [ ] **Step 1: Write the failing planning tests**

Create `lib/images/plan-upload.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { type UploadSource, planUpload } from './plan-upload';

const jpeg = (width: number, height: number, overrides: Partial<UploadSource> = {}): UploadSource => ({
  width,
  height,
  type: 'image/jpeg',
  bytes: 400_000,
  jpegComponents: 3,
  ...overrides,
});

describe('planUpload', () => {
  it('rejects a photograph whose short edge is under 320 as too small', () => {
    expect(planUpload(jpeg(800, 319))).toEqual({ type: 'reject', reason: 'too-small' });
  });

  it('rejects a panorama that reduction takes under 320 as too narrow', () => {
    expect(planUpload(jpeg(1600, 399))).toEqual({ type: 'reject', reason: 'too-narrow' });
  });

  it('accepts a panorama that reduction leaves at 320', () => {
    expect(planUpload(jpeg(1600, 400))).toMatchObject({ type: 'encode', width: 1280, height: 320 });
  });

  it('uploads an RGB JPEG within 1280 and 5 MiB untouched', () => {
    expect(planUpload(jpeg(1280, 960, { bytes: 5_242_880 }))).toEqual({ type: 'original' });
  });

  it('uploads a greyscale JPEG within 1280 untouched', () => {
    expect(planUpload(jpeg(1000, 800, { jpegComponents: 1 }))).toEqual({ type: 'original' });
  });

  it('re-encodes a JPEG over 5 MiB at its own size', () => {
    expect(planUpload(jpeg(1280, 960, { bytes: 5_242_881 }))).toEqual({
      type: 'encode',
      width: 1280,
      height: 960,
      decodeWidth: 1280,
      decodeHeight: 960,
    });
  });

  it.each([
    ['a CMYK JPEG', jpeg(1280, 960, { jpegComponents: 4 })],
    ['a JPEG whose frame could not be read', jpeg(1280, 960, { jpegComponents: undefined })],
    ['a PNG', jpeg(1280, 960, { type: 'image/png', jpegComponents: undefined })],
    ['a WebP', jpeg(1280, 960, { type: 'image/webp', jpegComponents: undefined })],
    ['a HEIC', jpeg(1280, 960, { type: 'image/heic', jpegComponents: undefined })],
    ['a file with no type', jpeg(1280, 960, { type: '', jpegComponents: undefined })],
  ])('re-encodes %s within 1280 at its own size', (_, source) => {
    expect(planUpload(source)).toMatchObject({ type: 'encode', width: 1280, height: 960 });
  });

  it('reduces the long edge to 1280, rounding the other edge', () => {
    expect(planUpload(jpeg(1281, 962))).toMatchObject({ type: 'encode', width: 1280, height: 961 });
  });

  it('reduces a portrait by its height', () => {
    expect(planUpload(jpeg(3024, 4032))).toMatchObject({ type: 'encode', width: 960, height: 1280 });
  });

  it('decodes in full at exactly 50 megapixels', () => {
    expect(planUpload(jpeg(10000, 5000))).toMatchObject({ decodeWidth: 10000, decodeHeight: 5000 });
  });

  it('decodes at a quarter above 50 megapixels when a quarter keeps the long edge at 1280 or more', () => {
    expect(planUpload(jpeg(12000, 9000))).toMatchObject({ decodeWidth: 3000, decodeHeight: 2250 });
  });

  it('decodes at a half when a quarter would take the long edge under 1280', () => {
    expect(planUpload(jpeg(10001, 5000))).toMatchObject({ decodeWidth: 5001, decodeHeight: 2500 });
  });
});
```

Run: `npx vitest run lib/images/plan-upload.test.ts`
Expected: FAIL, because `./plan-upload` does not exist.

- [ ] **Step 2: Write `lib/images/plan-upload.ts`**

```ts
export const LONG_EDGE = 1280;
export const MIN_SHORT_EDGE = 320;
export const FULL_DECODE_PIXELS = 50_000_000;
export const UNTOUCHED_MAX_BYTES = 5 * 1024 * 1024;

export type UploadSource = {
  width: number;
  height: number;
  type: string;
  bytes: number;
  jpegComponents?: number;
};

export type RejectionReason = 'too-small' | 'too-narrow';

export type UploadPlan =
  | { type: 'reject'; reason: RejectionReason }
  | { type: 'original' }
  | { type: 'encode'; width: number; height: number; decodeWidth: number; decodeHeight: number };

export function planUpload(source: UploadSource): UploadPlan {
  const longEdge = Math.max(source.width, source.height);
  if (Math.min(source.width, source.height) < MIN_SHORT_EDGE) return { type: 'reject', reason: 'too-small' };

  const scale = Math.min(1, LONG_EDGE / longEdge);
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  if (Math.min(width, height) < MIN_SHORT_EDGE) return { type: 'reject', reason: 'too-narrow' };

  if (longEdge <= LONG_EDGE && canUploadUntouched(source)) return { type: 'original' };

  const divisor = decodeDivisor(source);
  return {
    type: 'encode',
    width,
    height,
    decodeWidth: Math.round(source.width / divisor),
    decodeHeight: Math.round(source.height / divisor),
  };
}

function canUploadUntouched(source: UploadSource): boolean {
  return (
    source.type === 'image/jpeg' &&
    (source.jpegComponents === 1 || source.jpegComponents === 3) &&
    source.bytes <= UNTOUCHED_MAX_BYTES
  );
}

function decodeDivisor({ width, height }: UploadSource): number {
  if (width * height <= FULL_DECODE_PIXELS) return 1;
  const longEdge = Math.max(width, height);
  let divisor = 1;
  while (longEdge / (divisor * 2) >= LONG_EDGE) divisor *= 2;
  return divisor;
}
```

Apply Task 1's decisions here:

- If the findings moved the threshold, change `FULL_DECODE_PIXELS` and the two tests that name 50 megapixels.
- If the findings removed the fractional decode, make `decodeDivisor` return 1 and replace the two fraction tests with one asserting full-size decode dimensions at 12000 by 9000.

Run: `npx vitest run lib/images/plan-upload.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing JPEG header tests**

Create `lib/images/jpeg-segments.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { extractExifSegment, readComponentCount } from './jpeg-segments';

const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());
const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ((payload.length + 2) >> 8) & 0xff,
  (payload.length + 2) & 0xff,
  ...payload,
];
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

const SOI = [0xff, 0xd8];
const APP0 = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const EXIF_PAYLOAD = [...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 42, 0, 0, 0, 8];
const APP1 = segment(0xe1, EXIF_PAYLOAD);
const XMP = segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x/>')]);
const sof = (marker: number, components: number) =>
  segment(marker, [8, 0x03, 0xc0, 0x04, 0x00, components, ...Array(components * 3).fill(0)]);
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];

describe('extractExifSegment', () => {
  it('returns the EXIF payload from an APP1 after APP0', () => {
    expect(extractExifSegment(bytes(SOI, APP0, APP1, sof(0xc0, 3), SOS))).toEqual(new Uint8Array(EXIF_PAYLOAD));
  });

  it('returns the EXIF payload from an APP1 placed before APP0', () => {
    expect(extractExifSegment(bytes(SOI, APP1, APP0, sof(0xc0, 3), SOS))).toEqual(new Uint8Array(EXIF_PAYLOAD));
  });

  it('skips an XMP APP1 and finds the EXIF one after it', () => {
    expect(extractExifSegment(bytes(SOI, XMP, APP1, SOS))).toEqual(new Uint8Array(EXIF_PAYLOAD));
  });

  it('returns nothing for a JPEG with no EXIF', () => {
    expect(extractExifSegment(bytes(SOI, APP0, sof(0xc0, 3), SOS))).toBeUndefined();
  });

  it('returns nothing when the EXIF segment runs past the bytes read', () => {
    expect(extractExifSegment(bytes(SOI, APP1.slice(0, 10)))).toBeUndefined();
  });

  it('returns nothing for a PNG', () => {
    expect(extractExifSegment(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeUndefined();
  });

  it('stops at the start of the scan', () => {
    expect(extractExifSegment(bytes(SOI, APP0, SOS, APP1))).toBeUndefined();
  });
});

describe('readComponentCount', () => {
  it('reads three components from a baseline frame', () => {
    expect(readComponentCount(bytes(SOI, APP0, sof(0xc0, 3), SOS))).toBe(3);
  });

  it('reads four components from a progressive frame', () => {
    expect(readComponentCount(bytes(SOI, APP0, APP1, sof(0xc2, 4), SOS))).toBe(4);
  });

  it('returns nothing when no frame precedes the scan', () => {
    expect(readComponentCount(bytes(SOI, APP0, SOS))).toBeUndefined();
  });
});
```

Run: `npx vitest run lib/images/jpeg-segments.test.ts`
Expected: FAIL, because `./jpeg-segments` does not exist.

- [ ] **Step 4: Write `lib/images/jpeg-segments.ts`**

```ts
export const HEADER_READ_BYTES = 1024 * 1024;

const START_OF_IMAGE = 0xffd8;
const APP1 = 0xffe1;
const START_OF_SCAN = 0xffda;
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const START_OF_FRAME = new Set([
  0xffc0, 0xffc1, 0xffc2, 0xffc3, 0xffc5, 0xffc6, 0xffc7, 0xffc9, 0xffca, 0xffcb, 0xffcd, 0xffce, 0xffcf,
]);

type Segment = { marker: number; start: number; end: number };

export function extractExifSegment(bytes: Uint8Array): Uint8Array | undefined {
  const exif = segments(bytes).find(
    (segment) => segment.marker === APP1 && startsWithExifHeader(bytes, segment.start + 4, segment.end)
  );
  return exif ? bytes.slice(exif.start + 4, exif.end) : undefined;
}

export function readComponentCount(bytes: Uint8Array): number | undefined {
  const frame = segments(bytes).find((segment) => START_OF_FRAME.has(segment.marker));
  return frame && frame.start + 9 < frame.end ? bytes[frame.start + 9] : undefined;
}

function segments(bytes: Uint8Array): Segment[] {
  if (bytes.length < 4 || markerAt(bytes, 0) !== START_OF_IMAGE) return [];
  const found: Segment[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = markerAt(bytes, offset);
    if (marker === START_OF_SCAN) break;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) break;
    found.push({ marker, start: offset, end });
    offset = end;
  }
  return found;
}

function markerAt(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function startsWithExifHeader(bytes: Uint8Array, offset: number, end: number): boolean {
  if (offset + EXIF_HEADER.length > end) return false;
  return EXIF_HEADER.every((value, index) => bytes[offset + index] === value);
}
```

Run: `npx vitest run lib/images/jpeg-segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Install pica and widen the CSP**

Run: `npm install pica@10.0.3`

In `lib/security/csp.ts`:

- Add this comment above the policy, beside the existing ones:

```ts
// worker-src names blob: for pica, which resizes a photograph before upload in a Web Worker it builds from a
// blob URL. Without it the worker is blocked and pica's promise never settles.
```

- Add the line `  worker-src 'self' blob:;` after `connect-src ${connectSources};`.

In `lib/security/csp.test.ts`, add:

```ts
it("lets pica's resize worker start from a blob URL", () => {
  expect(directive('worker-src')).toBe("worker-src 'self' blob:");
});
```

Run: `npx vitest run lib/security`
Expected: PASS.

- [ ] **Step 6: Write `lib/images/reduce-for-upload.ts`**

```ts
import Pica from 'pica';

import { HEADER_READ_BYTES, extractExifSegment, readComponentCount } from './jpeg-segments';
import { type RejectionReason, type UploadPlan, planUpload } from './plan-upload';

export const PREPARE_TIMEOUT_MS = 60_000;
export const JPEG_QUALITY = 0.92;

export type PreparedUpload = { file: Blob; exif?: Uint8Array; sourceWidth: number; sourceHeight: number };
export type PreparationFailure = RejectionReason | 'undecodable' | 'timed-out';
export type PreparationResult =
  { type: 'prepared'; upload: PreparedUpload } | { type: 'failed'; reason: PreparationFailure };

type EncodePlan = Extract<UploadPlan, { type: 'encode' }>;
type DecodedSource = ImageBitmap | HTMLImageElement;

let picaInstance: ReturnType<typeof Pica> | undefined;

function pica() {
  picaInstance ??= Pica({ features: ['js', 'ww'] });
  return picaInstance;
}

export async function reduceForUpload(file: File, { signal }: { signal: AbortSignal }): Promise<PreparationResult> {
  const timeout = AbortSignal.timeout(PREPARE_TIMEOUT_MS);
  const cancelled = AbortSignal.any([signal, timeout]);
  const url = URL.createObjectURL(file);
  const canvases: HTMLCanvasElement[] = [];
  let decoded: DecodedSource | undefined;

  try {
    const image = await untilCancelled(loadImage(url), cancelled);
    const header = file.type === 'image/jpeg' ? await readHeader(file) : new Uint8Array();
    const source = { sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight };
    const plan = planUpload({
      width: image.naturalWidth,
      height: image.naturalHeight,
      type: file.type,
      bytes: file.size,
      jpegComponents: readComponentCount(header),
    });

    if (plan.type === 'reject') return { type: 'failed', reason: plan.reason };
    if (plan.type === 'original') return { type: 'prepared', upload: { file, ...source } };

    decoded = await untilCancelled(decode(file, image, plan), cancelled);
    const resized = canvas(plan.width, plan.height, canvases);
    await pica().resize(decoded, resized, { filter: 'lanczos3', cancelToken: cancelToken(cancelled) });

    const flattened = canvas(plan.width, plan.height, canvases);
    const context = flattened.getContext('2d');
    if (!context) return { type: 'failed', reason: 'undecodable' };
    context.fillStyle = 'white';
    context.fillRect(0, 0, plan.width, plan.height);
    context.drawImage(resized, 0, 0);

    const blob = await untilCancelled(pica().toBlob(flattened, 'image/jpeg', JPEG_QUALITY), cancelled);
    if (!blob) return { type: 'failed', reason: 'undecodable' };
    return { type: 'prepared', upload: { file: blob, exif: extractExifSegment(header), ...source } };
  } catch (error) {
    if (signal.aborted) throw error;
    if (timeout.aborted) return { type: 'failed', reason: 'timed-out' };
    return { type: 'failed', reason: 'undecodable' };
  } finally {
    if (decoded instanceof ImageBitmap) decoded.close();
    for (const each of canvases) {
      each.width = 0;
      each.height = 0;
    }
    URL.revokeObjectURL(url);
  }
}

async function decode(file: File, image: HTMLImageElement, plan: EncodePlan): Promise<DecodedSource> {
  const fractional = plan.decodeWidth !== image.naturalWidth || plan.decodeHeight !== image.naturalHeight;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(
      file,
      fractional
        ? {
            imageOrientation: 'from-image',
            resizeWidth: plan.decodeWidth,
            resizeHeight: plan.decodeHeight,
            resizeQuality: 'high',
          }
        : { imageOrientation: 'from-image' }
    );
  } catch {
    return image;
  }
  if (bitmap.width === plan.decodeWidth && bitmap.height === plan.decodeHeight) return bitmap;
  bitmap.close();
  return image;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The browser could not decode the file.'));
    image.src = url;
  });
}

async function readHeader(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, HEADER_READ_BYTES).arrayBuffer());
}

function canvas(width: number, height: number, created: HTMLCanvasElement[]): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  created.push(element);
  return element;
}

function cancelToken(signal: AbortSignal): Promise<never> {
  const token = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  token.catch(() => undefined);
  return token;
}

function untilCancelled<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    promise.then(resolve, reject);
  });
}
```

Apply Task 1's decisions to `decode`. If an engine rejects `imageOrientation: 'from-image'` itself, the `catch` already falls back to the loaded image, which the browser has oriented. If pica's orientation-region flag is set in an engine, lower that engine's threshold by passing a smaller `FULL_DECODE_PIXELS` through `planUpload`. Make that a parameter of `planUpload`, defaulting to `FULL_DECODE_PIXELS`, with a test for the lower value.

This module has no unit test. happy-dom has no canvas, `createImageBitmap` or Web Worker, so a test would only exercise stubs. Task 10 exercises it against real photographs, and Task 7 replaces it with fake operations.

Run: `npm run typecheck && npm run lint`
Expected: PASS. If pica's types reject `cancelToken` or `filter`, read `node_modules/pica/dist/pica.cjs.d.ts` and use the option names it declares.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/images lib/security
git commit -m "Prepare a photograph in the browser before upload

planUpload decides between the untouched original, a 1280-pixel JPEG at
0.92 and a rejection. jpeg-segments reads the EXIF segment and the colour
component count. reduceForUpload decodes with orientation applied, resizes
with pica's Lanczos filter in a worker and flattens onto white. The CSP
lets pica's blob worker start.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Upload operations and the polling loop

**Goal:** The dialog's I/O sits behind an `ImageUploadOperations` interface with three implementations: a browser implementation, a mock implementation for prototypes and the workbench, and a tested polling loop and busy-retry helper.

**Files:**

- Create: `lib/images/image-upload-operations.ts`
- Create: `lib/images/await-image-check.ts`, `lib/images/await-image-check.test.ts`
- Create: `lib/images/upload-with-retry.ts`, `lib/images/upload-with-retry.test.ts`
- Create: `lib/mock/image-upload-operations.ts`

**Acceptance Criteria:**

- [ ] **`pollDelayAfter(elapsedMs)`:**
  - returns 400 at 0
  - returns 500 at 400 and at 4,999
  - returns 2,000 at 5,000
  - returns `undefined` once the next poll would start after 30,000
- [ ] **`awaitImageCheck`** resolves:
  - `{ type: 'settled', image }` on `READY`, `REFUSED` or `CHECK_FAILED`
  - `{ type: 'timed-out' }` when nothing settles within 30,000 ms

  It polls at 400, 900, 1,400 ms and so on, and rejects with the abort reason when aborted.

- [ ] **`uploadWithRetry`** retries only on `ApiError` with `IMAGE_BUSY`, up to three times with 1,000 ms between tries, and then rethrows.
- [ ] **`browserImageOperations`:**
  - `prepare` delegates to `reduceForUpload`
  - `upload` sends `file` and, when present, `exif` as a `Blob`, and reports progress
  - `get` returns the `ImageView`
  - `remove` sends a `keepalive` delete and ignores its failure
- [ ] **`mockImageOperations(outcome)`** simulates each outcome the workbench needs, with visible delays.
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass.

**Verify:** `npx vitest run lib/images && npm run typecheck && npm run lint` → all pass

**Steps:**

- [ ] **Step 1: Write the failing polling tests**

Create `lib/images/await-image-check.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImageView } from '@/lib/api/browser-client';

import { awaitImageCheck, pollDelayAfter } from './await-image-check';

const view = (state: ImageView['state']): ImageView => ({
  id: 'img',
  state,
  width: 800,
  height: 600,
  placeholderDataUrl: 'data:image/webp;base64,AAAA',
});

describe('pollDelayAfter', () => {
  it.each([
    [0, 400],
    [400, 500],
    [4_999, 500],
    [5_000, 2_000],
    [27_999, 2_000],
  ])('waits the right time after %i ms', (elapsed, delay) => {
    expect(pollDelayAfter(elapsed)).toBe(delay);
  });

  it('stops once the next poll would start after 30 seconds', () => {
    expect(pollDelayAfter(28_001)).toBeUndefined();
  });
});

describe('awaitImageCheck', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls at 400 ms and then every 500 ms until the image is READY', async () => {
    const pollTimes: number[] = [];
    const start = Date.now();
    const get = vi.fn(async () => {
      pollTimes.push(Date.now() - start);
      return pollTimes.length === 3 ? view('READY') : view('CHECKING');
    });
    const pending = awaitImageCheck('img', get, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1_400);
    await expect(pending).resolves.toEqual({ type: 'settled', image: view('READY') });
    expect(pollTimes).toEqual([400, 900, 1_400]);
  });

  it.each(['REFUSED', 'CHECK_FAILED'] as const)('settles on %s', async (state) => {
    const pending = awaitImageCheck('img', async () => view(state), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toEqual({ type: 'settled', image: view(state) });
  });

  it('times out when nothing settles within 30 seconds', async () => {
    const get = vi.fn(async () => view('CHECKING'));
    const pending = awaitImageCheck('img', get, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toEqual({ type: 'timed-out' });
    expect(get).toHaveBeenCalledTimes(23);
  });

  it('rejects with the abort reason when aborted', async () => {
    const controller = new AbortController();
    const pending = awaitImageCheck('img', async () => view('CHECKING'), controller.signal);
    controller.abort(new DOMException('Closed', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

The count of 23 polls follows from the schedule:

- 400 ms: 1 poll.
- 900 to 5,400 ms: 10 polls at 500 ms steps. The delay after 4,900 is still 500, because 4,900 is under 5,000.
- 7,400 to 29,400 ms: 12 polls at 2,000 ms steps.

A poll at 31,400 would start after 30,000, so it is not made. If the implementation measures elapsed time from a different instant and gets another count, fix the implementation to this schedule, not the number.

Run: `npx vitest run lib/images/await-image-check.test.ts`
Expected: FAIL, because `./await-image-check` does not exist.

- [ ] **Step 2: Write `lib/images/await-image-check.ts`**

```ts
import type { ImageView } from '@/lib/api/browser-client';

export const FIRST_POLL_MS = 400;
export const FAST_POLL_MS = 500;
export const SLOW_POLL_MS = 2_000;
export const SLOW_AFTER_MS = 5_000;
export const GIVE_UP_AFTER_MS = 30_000;

export type ImageCheckOutcome = { type: 'settled'; image: ImageView } | { type: 'timed-out' };

export function pollDelayAfter(elapsedMs: number): number | undefined {
  const delay = elapsedMs === 0 ? FIRST_POLL_MS : elapsedMs < SLOW_AFTER_MS ? FAST_POLL_MS : SLOW_POLL_MS;
  return elapsedMs + delay > GIVE_UP_AFTER_MS ? undefined : delay;
}

export async function awaitImageCheck(
  id: string,
  get: (id: string, options: { signal: AbortSignal }) => Promise<ImageView>,
  signal: AbortSignal
): Promise<ImageCheckOutcome> {
  let elapsed = 0;
  for (let delay = pollDelayAfter(elapsed); delay !== undefined; delay = pollDelayAfter(elapsed)) {
    await wait(delay, signal);
    elapsed += delay;
    const image = await get(id, { signal });
    if (image.state !== 'CHECKING') return { type: 'settled', image };
  }
  return { type: 'timed-out' };
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}
```

`elapsed` counts scheduled delays, not the time `get` takes. That keeps the schedule exact under fake timers and within one poll's latency of real time.

Run: `npx vitest run lib/images/await-image-check.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing retry tests**

Create `lib/images/upload-with-retry.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';

import { uploadWithRetry } from './upload-with-retry';

describe('uploadWithRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries IMAGE_BUSY up to three times, a second apart, then succeeds', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, 'IMAGE_BUSY'))
      .mockRejectedValueOnce(new ApiError(503, 'IMAGE_BUSY'))
      .mockResolvedValueOnce('stored');
    const pending = uploadWithRetry(attempt, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBe('stored');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('rethrows IMAGE_BUSY after the third retry', async () => {
    const attempt = vi.fn().mockRejectedValue(new ApiError(503, 'IMAGE_BUSY'));
    const pending = uploadWithRetry(attempt, new AbortController().signal);
    const assertion = expect(pending).rejects.toMatchObject({ errorCode: 'IMAGE_BUSY' });
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it('does not retry any other refusal', async () => {
    const attempt = vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMIT_EXCEEDED'));
    await expect(uploadWithRetry(attempt, new AbortController().signal)).rejects.toMatchObject({
      errorCode: 'RATE_LIMIT_EXCEEDED',
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npx vitest run lib/images/upload-with-retry.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `lib/images/upload-with-retry.ts`**

```ts
import { isApiError } from '@/lib/api/errors';

export const BUSY_RETRIES = 3;
export const BUSY_RETRY_DELAY_MS = 1_000;

export async function uploadWithRetry<T>(attempt: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      if (!isApiError(error) || error.errorCode !== 'IMAGE_BUSY' || retry === BUSY_RETRIES) throw error;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, BUSY_RETRY_DELAY_MS);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true }
        );
      });
    }
  }
}
```

Run: `npx vitest run lib/images/upload-with-retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the operations interface and browser implementation**

Create `lib/images/image-upload-operations.ts`:

```ts
import { type ImageView, deleteImage, getImage, uploadImage } from '@/lib/api/browser-client';
import { unwrap } from '@/lib/api/unwrap';
import type { Side } from '@/lib/side';

import { type PreparationResult, type PreparedUpload, reduceForUpload } from './reduce-for-upload';

export type ImageUploadOperations = {
  prepare(file: File, options: { signal: AbortSignal }): Promise<PreparationResult>;
  upload(
    prepared: PreparedUpload,
    side: Side,
    options: { signal: AbortSignal; onProgress: (fraction: number) => void }
  ): Promise<ImageView>;
  get(id: string, options: { signal: AbortSignal }): Promise<ImageView>;
  remove(id: string): void;
};

export const browserImageOperations: ImageUploadOperations = {
  prepare: (file, { signal }) => reduceForUpload(file, { signal }),

  async upload(prepared, side, { signal, onProgress }) {
    const result = await uploadImage(
      { side: side === 'day' ? 'DAY' : 'NIGHT' },
      { file: prepared.file, ...(prepared.exif ? { exif: new Blob([prepared.exif]) } : {}) },
      { signal, onUploadProgress: onProgress }
    );
    return unwrap(result);
  },

  async get(id, { signal }) {
    return unwrap(await getImage(id, { signal }));
  },

  remove(id) {
    deleteImage(id, { keepalive: true }).catch(() => undefined);
  },
};
```

If the generated `uploadImage` names its parameter types differently, for example `UploadImageSide`, adjust the literal to satisfy the type without a cast.

- [ ] **Step 6: Write the mock operations**

Create `lib/mock/image-upload-operations.ts`:

```ts
import type { ImageView } from '@/lib/api/browser-client';
import { ApiError } from '@/lib/api/errors';
import type { ImageUploadOperations } from '@/lib/images/image-upload-operations';
import type { PreparationFailure } from '@/lib/images/reduce-for-upload';

export type MockUploadOutcome =
  | 'ready'
  | 'refused'
  | 'check-failed'
  | 'slow-check'
  | PreparationFailure
  | 'IMAGE_TOO_SMALL'
  | 'IMAGE_UNREADABLE'
  | 'IMAGE_BUSY'
  | 'RATE_LIMIT_EXCEEDED'
  | 'ACCOUNT_RESTRICTED'
  | 'NIGHT_NOT_ENABLED'
  | 'network';

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="gray"/></svg>'
  );

const delay = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

const view = (state: ImageView['state']): ImageView => ({
  id: 'mock-image',
  state,
  width: 1280,
  height: 960,
  placeholderDataUrl: PLACEHOLDER,
});

const UPLOAD_REFUSALS: Partial<Record<MockUploadOutcome, [number, string]>> = {
  IMAGE_TOO_SMALL: [400, 'IMAGE_TOO_SMALL'],
  IMAGE_UNREADABLE: [400, 'IMAGE_UNREADABLE'],
  IMAGE_BUSY: [503, 'IMAGE_BUSY'],
  RATE_LIMIT_EXCEEDED: [429, 'RATE_LIMIT_EXCEEDED'],
  ACCOUNT_RESTRICTED: [403, 'ACCOUNT_RESTRICTED'],
  NIGHT_NOT_ENABLED: [403, 'NIGHT_NOT_ENABLED'],
};

export function mockImageOperations(outcome: MockUploadOutcome): ImageUploadOperations {
  let polls = 0;
  return {
    async prepare(file, { signal }) {
      await delay(600, signal);
      if (outcome === 'undecodable' || outcome === 'timed-out' || outcome === 'too-small' || outcome === 'too-narrow') {
        return { type: 'failed', reason: outcome };
      }
      return { type: 'prepared', upload: { file, sourceWidth: 4032, sourceHeight: 3024 } };
    },
    async upload(_, __, { signal, onProgress }) {
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        await delay(250, signal);
        onProgress(fraction);
      }
      await delay(400, signal);
      if (outcome === 'network') throw new Error('The request did not reach the API.');
      const refusal = UPLOAD_REFUSALS[outcome];
      if (refusal) throw new ApiError(refusal[0], refusal[1]);
      return view('CHECKING');
    },
    async get(_, { signal }) {
      await delay(50, signal);
      polls += 1;
      if (outcome === 'slow-check') return view('CHECKING');
      if (polls < 3) return view('CHECKING');
      if (outcome === 'refused') return view('REFUSED');
      if (outcome === 'check-failed') return view('CHECK_FAILED');
      return { ...view('READY'), fullUrl: PLACEHOLDER };
    },
    remove() {},
  };
}
```

The `fill="gray"` is an SVG attribute inside a data URL used only by mocks, not a component colour. If `components/ui/generated.test.ts` or another guard flags it, replace the SVG with a 1 by 1 transparent GIF data URL.

Run: `npm run typecheck && npm run lint && npx vitest run lib/images`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/images lib/mock/image-upload-operations.ts
git commit -m "Put the upload dialog's work behind operations with a tested polling loop

awaitImageCheck polls at 400 ms, then every 500 ms until 5 seconds, then
every 2 seconds, and gives up at 30 seconds. uploadWithRetry retries
IMAGE_BUSY three times a second apart. The browser operations use the new
browser client, and the mock operations drive the prototypes and the
workbench.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The upload dialog and drop zone

**Goal:** `ImageUploadDialog` takes a member from choosing a photograph through preparing, uploading, processing, checking and attaching. On success it closes itself. On failure it stays open with the copy below. `ImageDropZone` accepts one image by drop or by picker. Both have workbench specimens.

**Files:**

- Create: `lib/images/upload-error-copy.ts`
- Create: `components/images/ImageDropZone.tsx`, `components/images/ImageDropZone.test.tsx`
- Create: `components/images/ImageUploadDialog.tsx`, `components/images/ImageUploadDialog.test.tsx`
- Modify: `components/dev/workbench/sections/OurComposites.tsx`

**Acceptance Criteria:**

- [ ] **The drop zone:**
  - it shows "Drag a photo here" and a "Choose a photo" button that opens a hidden `input type="file" accept="image/*"`
  - it calls `onFile` for exactly one file with an empty type or an `image/*` type
  - it shows "Please choose one photo." for several files
  - it shows "That file isn't a photo. Please choose a photo." for a set type outside `image/*`
- [ ] **The dialog, driven by fake operations,** shows these in turn:
  - "Preparing your photo"
  - a progress bar at the reported fraction with "Uploading your photo"
  - "Processing your photo" once progress reaches 1
  - the placeholder with "Checking your photo"
  - "Adding your photo"

  Then it calls `onReady` with the `READY` image and calls `onOpenChange(false)`.

- [ ] **Failure copy:** each failure row in Step 1 shows its message and exactly its offer. "Try again" re-sends the prepared file without calling `prepare` again.
- [ ] **Busy retries:** `IMAGE_BUSY` is retried three times before the failure shows.
- [ ] **Closing:**
  - it aborts the signal passed to `prepare`, `upload` and `get`
  - it calls `remove` only for a `READY` image whose `onReady` failed
  - during Attaching, `onOpenChange(false)` from Escape is refused and the close button is disabled
- [ ] **Announcements:** the stage text sits in a region with `aria-live="polite"`.
- [ ] **The workbench:**
  - it has an "Image upload dialog" specimen with an outcome control covering every `MockUploadOutcome`, portalled through `WithPortalContainer`
  - it has an "Image drop zone" specimen
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass.

**Verify:** `npx vitest run components/images components/ui && npm run typecheck && npm run lint` → all pass

**Steps:**

- [ ] **Step 1: Write the copy module**

Create `lib/images/upload-error-copy.ts`:

```ts
import type { PreparationFailure } from './reduce-for-upload';

export type FailureOffer = 'choose-another' | 'try-again' | 'none';
export type UploadFailureCopy = { message: string; offer: FailureOffer };

export const stageCopy = {
  preparing: 'Preparing your photo',
  uploading: 'Uploading your photo',
  processing: 'Processing your photo',
  checking: 'Checking your photo',
  attaching: 'Adding your photo',
} as const;

export const actionCopy = {
  choose: 'Choose a photo',
  chooseAnother: 'Choose another photo',
  tryAgain: 'Try again',
  close: 'Close',
  dropHere: 'Drag a photo here',
  severalFiles: 'Please choose one photo.',
  notAPhoto: "That file isn't a photo. Please choose a photo.",
} as const;

const TOO_SMALL = "That photo is too small. Please choose one that's at least 320 pixels on each side.";
const TOO_NARROW =
  'That photo is too narrow. Please choose one whose longest side is no more than four times its shortest side.';

export const preparationFailureCopy: Record<PreparationFailure, UploadFailureCopy> = {
  undecodable: {
    message: "We couldn't open that photo. Please choose a JPEG, PNG or WebP photo.",
    offer: 'choose-another',
  },
  'timed-out': { message: "We couldn't prepare that photo. Please choose another photo.", offer: 'choose-another' },
  'too-small': { message: TOO_SMALL, offer: 'choose-another' },
  'too-narrow': { message: TOO_NARROW, offer: 'choose-another' },
};

export function uploadFailureCopy(
  errorCode: string | undefined,
  source: { width: number; height: number }
): UploadFailureCopy {
  switch (errorCode) {
    case 'IMAGE_TOO_SMALL':
      return Math.min(source.width, source.height) < 320
        ? preparationFailureCopy['too-small']
        : preparationFailureCopy['too-narrow'];
    case 'IMAGE_UNREADABLE':
    case 'UPLOAD_UNREADABLE':
      return { message: "We couldn't read that photo. Please choose another photo.", offer: 'choose-another' };
    case 'IMAGE_TOO_LARGE':
      return { message: 'That photo is too large to upload. Please choose another photo.', offer: 'choose-another' };
    case 'RATE_LIMIT_EXCEEDED':
      return { message: "You've uploaded 30 photos in the last 24 hours. Please try again later.", offer: 'none' };
    default:
      return (
        refusalCopy(errorCode) ?? {
          message: "We couldn't upload your photo. Please try again in a moment.",
          offer: 'try-again',
        }
      );
  }
}

export const checkFailureCopy = {
  refused: { message: "We can't use this photo. Please choose another photo.", offer: 'choose-another' },
  unsettled: { message: "We couldn't check your photo. Please try again in a few minutes.", offer: 'none' },
} satisfies Record<string, UploadFailureCopy>;

export function attachFailureCopy(errorCode: string): UploadFailureCopy {
  switch (errorCode) {
    case 'IMAGE_NOT_ATTACHABLE':
    case 'IMAGE_SIDE_MISMATCH':
    case 'NOT_FOUND':
      return { message: "We couldn't add this photo. Please choose another photo.", offer: 'choose-another' };
    default:
      return refusalCopy(errorCode) ?? { message: "We couldn't add your photo. Please try again.", offer: 'try-again' };
  }
}

function refusalCopy(errorCode: string | undefined): UploadFailureCopy | undefined {
  switch (errorCode) {
    case 'ACCOUNT_RESTRICTED':
      return { message: "You can't add photos while your account is restricted.", offer: 'none' };
    case 'VERIFICATION_REQUIRED':
      return { message: 'Please verify your age before adding a night photo.', offer: 'none' };
    case 'NIGHT_NOT_ENABLED':
      return { message: 'Please turn on the night side before adding a night photo.', offer: 'none' };
    default:
      return undefined;
  }
}
```

- [ ] **Step 2: Write the failing drop zone tests**

Create `components/images/ImageDropZone.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageDropZone } from './ImageDropZone';

const file = (name: string, type: string) => new File(['x'], name, { type });

const drop = (target: HTMLElement, files: File[]) =>
  fireEvent.drop(target, { dataTransfer: { files, types: ['Files'] } });

describe('ImageDropZone', () => {
  it('offers a button that opens the file picker for images', () => {
    render(<ImageDropZone onFile={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'image/*');
  });

  it('passes on a single dropped photo', () => {
    const onFile = vi.fn();
    render(<ImageDropZone onFile={onFile} />);
    const photo = file('photo.jpg', 'image/jpeg');
    drop(screen.getByTestId('image-drop-zone'), [photo]);
    expect(onFile).toHaveBeenCalledWith(photo);
  });

  it('passes on a dropped file with no type', () => {
    const onFile = vi.fn();
    render(<ImageDropZone onFile={onFile} />);
    const heic = file('IMG_0001.HEIC', '');
    drop(screen.getByTestId('image-drop-zone'), [heic]);
    expect(onFile).toHaveBeenCalledWith(heic);
  });

  it('asks for one photo when several are dropped', () => {
    const onFile = vi.fn();
    render(<ImageDropZone onFile={onFile} />);
    drop(screen.getByTestId('image-drop-zone'), [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')]);
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByText('Please choose one photo.')).toBeInTheDocument();
  });

  it('refuses a file that is not an image', () => {
    const onFile = vi.fn();
    render(<ImageDropZone onFile={onFile} />);
    drop(screen.getByTestId('image-drop-zone'), [file('notes.pdf', 'application/pdf')]);
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByText("That file isn't a photo. Please choose a photo.")).toBeInTheDocument();
  });

  it('passes on a photo picked with the button', () => {
    const onFile = vi.fn();
    render(<ImageDropZone onFile={onFile} />);
    const photo = file('photo.png', 'image/png');
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [photo] } });
    expect(onFile).toHaveBeenCalledWith(photo);
  });
});
```

Run: `npx vitest run components/images/ImageDropZone.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `components/images/ImageDropZone.tsx`**

```tsx
'use client';

import { type DragEvent, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { actionCopy } from '@/lib/images/upload-error-copy';
import { cn } from '@/lib/utils';

export function ImageDropZone({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const accept = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    if (list.length > 1) return setProblem(actionCopy.severalFiles);
    const [file] = list;
    if (file!.type !== '' && !file!.type.startsWith('image/')) return setProblem(actionCopy.notAPhoto);
    setProblem(null);
    onFile(file!);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files);
  };

  return (
    <div
      data-testid="image-drop-zone"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center gap-3 border border-dashed border-line bg-panel-alt px-4 py-8 text-[12px]',
        dragging && 'border-line-strong bg-panel'
      )}
    >
      <p>{actionCopy.dropHere}</p>
      <Button type="button" onClick={() => input.current?.click()}>
        {actionCopy.choose}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = '';
        }}
      />
      {problem ? (
        <p role="alert" className="text-alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
```

`lib/forms/validated-forms.test.ts` guards only constrained fields inside a `<form>`. This input sits outside a form and carries no constraint attribute.

Run: `npx vitest run components/images/ImageDropZone.test.tsx`
Expected: PASS.

- [ ] **Step 4: Write the failing dialog tests**

Create `components/images/ImageUploadDialog.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImageView } from '@/lib/api/browser-client';
import { ApiError } from '@/lib/api/errors';
import type { ImageUploadOperations } from '@/lib/images/image-upload-operations';

import { ImageUploadDialog } from './ImageUploadDialog';

const view = (state: ImageView['state']): ImageView => ({
  id: 'img-1',
  state,
  width: 800,
  height: 600,
  placeholderDataUrl: 'data:image/webp;base64,AAAA',
});
const photo = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
const prepared = { file: photo, sourceWidth: 4000, sourceHeight: 3000 };

function operations(overrides: Partial<ImageUploadOperations> = {}) {
  const signals: AbortSignal[] = [];
  const ops: ImageUploadOperations & { signals: AbortSignal[] } = {
    signals,
    prepare: vi.fn(async (_, { signal }) => {
      signals.push(signal);
      return { type: 'prepared' as const, upload: prepared };
    }),
    upload: vi.fn(async (_, __, { signal, onProgress }) => {
      signals.push(signal);
      onProgress(0.5);
      onProgress(1);
      return view('CHECKING');
    }),
    get: vi.fn(async (_, { signal }) => {
      signals.push(signal);
      return view('READY');
    }),
    remove: vi.fn(),
    ...overrides,
  };
  return ops;
}

function renderDialog(ops: ImageUploadOperations, onReady = vi.fn(async () => ({})), onOpenChange = vi.fn()) {
  render(
    <ImageUploadDialog
      side="day"
      title="Add a photo"
      open
      onOpenChange={onOpenChange}
      onReady={onReady}
      operations={ops}
    />
  );
  return { onReady, onOpenChange };
}

async function choose() {
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [photo] } });
}

describe('ImageUploadDialog', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('attaches a READY photo and closes', async () => {
    const ops = operations();
    const { onReady, onOpenChange } = renderDialog(ops);
    await choose();
    await act(() => vi.advanceTimersByTimeAsync(400));
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(view('READY')));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows the placeholder while the photo is checked', async () => {
    const ops = operations({ get: vi.fn(async () => view('CHECKING')) });
    renderDialog(ops);
    await choose();
    await waitFor(() => expect(screen.getByText('Checking your photo')).toBeInTheDocument());
    expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('src', 'data:image/webp;base64,AAAA');
  });

  it('announces each stage politely', async () => {
    renderDialog(operations({ get: vi.fn(async () => view('CHECKING')) }));
    await choose();
    await waitFor(() =>
      expect(screen.getByText('Checking your photo').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    );
  });

  it.each([
    [
      'too-small',
      "That photo is too small. Please choose one that's at least 320 pixels on each side.",
      'Choose another photo',
    ],
    [
      'too-narrow',
      'That photo is too narrow. Please choose one whose longest side is no more than four times its shortest side.',
      'Choose another photo',
    ],
    ['undecodable', "We couldn't open that photo. Please choose a JPEG, PNG or WebP photo.", 'Choose another photo'],
    ['timed-out', "We couldn't prepare that photo. Please choose another photo.", 'Choose another photo'],
  ] as const)('reports a %s preparation failure', async (reason, message, offer) => {
    renderDialog(operations({ prepare: vi.fn(async () => ({ type: 'failed' as const, reason })) }));
    await choose();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: offer })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it.each([
    [
      new ApiError(400, 'IMAGE_UNREADABLE'),
      "We couldn't read that photo. Please choose another photo.",
      'Choose another photo',
    ],
    [
      new ApiError(413, 'IMAGE_TOO_LARGE'),
      'That photo is too large to upload. Please choose another photo.',
      'Choose another photo',
    ],
    [
      new ApiError(400, 'IMAGE_TOO_SMALL'),
      'That photo is too narrow. Please choose one whose longest side is no more than four times its shortest side.',
      'Choose another photo',
    ],
    [new ApiError(500, 'INTERNAL_ERROR'), "We couldn't upload your photo. Please try again in a moment.", 'Try again'],
    [new Error('network'), "We couldn't upload your photo. Please try again in a moment.", 'Try again'],
  ])('reports an upload failure', async (error, message, offer) => {
    renderDialog(operations({ upload: vi.fn(async () => Promise.reject(error)) }));
    await choose();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: offer })).toBeInTheDocument();
  });

  it.each([
    [
      new ApiError(429, 'RATE_LIMIT_EXCEEDED'),
      "You've uploaded 30 photos in the last 24 hours. Please try again later.",
    ],
    [new ApiError(403, 'ACCOUNT_RESTRICTED'), "You can't add photos while your account is restricted."],
    [new ApiError(403, 'NIGHT_NOT_ENABLED'), 'Please turn on the night side before adding a night photo.'],
  ])('offers no retry for a refusal that cannot succeed', async (error, message) => {
    renderDialog(operations({ upload: vi.fn(async () => Promise.reject(error)) }));
    await choose();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose another photo' })).not.toBeInTheDocument();
  });

  it('re-sends the prepared file without preparing it again', async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR'))
      .mockResolvedValue(view('CHECKING'));
    const ops = operations({ upload, get: vi.fn(async () => view('CHECKING')) });
    renderDialog(ops);
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(ops.prepare).toHaveBeenCalledTimes(1);
  });

  it('retries IMAGE_BUSY three times before reporting it', async () => {
    const upload = vi.fn().mockRejectedValue(new ApiError(503, 'IMAGE_BUSY'));
    renderDialog(operations({ upload }));
    await choose();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(await screen.findByText("We couldn't upload your photo. Please try again in a moment.")).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it('reports a refused photo', async () => {
    renderDialog(operations({ get: vi.fn(async () => view('REFUSED')) }));
    await choose();
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(await screen.findByText("We can't use this photo. Please choose another photo.")).toBeInTheDocument();
  });

  it.each([['CHECK_FAILED' as const]])('asks for a later try when the check fails', async (state) => {
    const ops = operations({ get: vi.fn(async () => view(state)) });
    renderDialog(ops);
    await choose();
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(
      await screen.findByText("We couldn't check your photo. Please try again in a few minutes.")
    ).toBeInTheDocument();
    expect(ops.remove).not.toHaveBeenCalled();
  });

  it('asks for a later try when the check has not settled in 30 seconds', async () => {
    const ops = operations({ get: vi.fn(async () => view('CHECKING')) });
    renderDialog(ops);
    await choose();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(
      await screen.findByText("We couldn't check your photo. Please try again in a few minutes.")
    ).toBeInTheDocument();
    expect(ops.remove).not.toHaveBeenCalled();
  });

  it('offers to try the attach again, and deletes the ready image when another photo is chosen', async () => {
    const ops = operations();
    const onReady = vi.fn(async () => ({ error: 'FAILED' }));
    renderDialog(ops, onReady);
    await choose();
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(await screen.findByText("We couldn't add your photo. Please try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
    expect(ops.remove).not.toHaveBeenCalled();
  });

  it('deletes the ready image when the attach cannot succeed and another photo is chosen', async () => {
    const ops = operations();
    renderDialog(
      ops,
      vi.fn(async () => ({ error: 'IMAGE_SIDE_MISMATCH' }))
    );
    await choose();
    await act(() => vi.advanceTimersByTimeAsync(400));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another photo' }));
    expect(ops.remove).toHaveBeenCalledWith('img-1');
  });

  it('aborts the work in flight when closed', async () => {
    const ops = operations({
      get: vi.fn(async (_, { signal }) => {
        ops.signals.push(signal);
        return view('CHECKING');
      }),
    });
    renderDialog(ops);
    await choose();
    await waitFor(() => expect(screen.getByText('Checking your photo')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(ops.signals.every((signal) => signal.aborted)).toBe(true));
    expect(ops.remove).not.toHaveBeenCalled();
  });

  it('refuses to close while the photo is being added', async () => {
    let finish: (value: { error?: string }) => void = () => {};
    const onReady = vi.fn(() => new Promise<{ error?: string }>((resolve) => (finish = resolve)));
    const onOpenChange = vi.fn();
    renderDialog(operations(), onReady, onOpenChange);
    await choose();
    await act(() => vi.advanceTimersByTimeAsync(400));
    await waitFor(() => expect(screen.getByText('Adding your photo')).toBeInTheDocument());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    await act(async () => finish({}));
  });
});
```

Run: `npx vitest run components/images/ImageUploadDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 5: Write `components/images/ImageUploadDialog.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

import { ImageDropZone } from '@/components/images/ImageDropZone';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import type { ImageView } from '@/lib/api/browser-client';
import { isApiError } from '@/lib/api/errors';
import { awaitImageCheck } from '@/lib/images/await-image-check';
import type { ImageUploadOperations } from '@/lib/images/image-upload-operations';
import type { PreparedUpload } from '@/lib/images/reduce-for-upload';
import {
  type UploadFailureCopy,
  actionCopy,
  attachFailureCopy,
  checkFailureCopy,
  preparationFailureCopy,
  stageCopy,
  uploadFailureCopy,
} from '@/lib/images/upload-error-copy';
import { uploadWithRetry } from '@/lib/images/upload-with-retry';
import type { Side } from '@/lib/side';

type Stage =
  | { type: 'choose' }
  | { type: 'preparing' }
  | { type: 'uploading'; fraction: number }
  | { type: 'processing' }
  | { type: 'checking'; image: ImageView }
  | { type: 'attaching'; image: ImageView }
  | { type: 'failed'; copy: UploadFailureCopy; retry?: () => void; readyImage?: ImageView };

export function ImageUploadDialog({
  side,
  title,
  open,
  onOpenChange,
  onReady,
  operations,
  container,
}: {
  side: Side;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReady: (image: ImageView) => Promise<{ error?: string }>;
  operations: ImageUploadOperations;
  container?: HTMLElement;
}) {
  const [stage, setStage] = useState<Stage>({ type: 'choose' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const begin = () => {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  };

  const close = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (stage.type === 'attaching') return;
    controller.current?.abort();
    if (stage.type === 'failed' && stage.readyImage) operations.remove(stage.readyImage.id);
    setStage({ type: 'choose' });
    onOpenChange(false);
  };

  const attach = async (image: ImageView) => {
    setStage({ type: 'attaching', image });
    const { error } = await onReady(image);
    if (!error) {
      setStage({ type: 'choose' });
      return onOpenChange(false);
    }
    const copy = attachFailureCopy(error);
    setStage({
      type: 'failed',
      copy,
      retry: copy.offer === 'try-again' ? () => attach(image) : undefined,
      readyImage: image,
    });
  };

  const check = async (image: ImageView, signal: AbortSignal) => {
    setStage({ type: 'checking', image });
    const outcome = await awaitImageCheck(image.id, operations.get, signal);
    if (outcome.type === 'timed-out' || outcome.image.state === 'CHECK_FAILED') {
      return setStage({ type: 'failed', copy: checkFailureCopy.unsettled });
    }
    if (outcome.image.state === 'REFUSED') return setStage({ type: 'failed', copy: checkFailureCopy.refused });
    await attach(outcome.image);
  };

  const send = async (prepared: PreparedUpload) => {
    const signal = begin();
    setStage({ type: 'uploading', fraction: 0 });
    try {
      const image = await uploadWithRetry(
        () =>
          operations.upload(prepared, side, {
            signal,
            onProgress: (fraction) => setStage(fraction < 1 ? { type: 'uploading', fraction } : { type: 'processing' }),
          }),
        signal
      );
      await check(image, signal);
    } catch (error) {
      if (signal.aborted) return;
      const copy = uploadFailureCopy(isApiError(error) ? error.errorCode : undefined, {
        width: prepared.sourceWidth,
        height: prepared.sourceHeight,
      });
      setStage({ type: 'failed', copy, retry: copy.offer === 'try-again' ? () => send(prepared) : undefined });
    }
  };

  const choose = async (file: File) => {
    const signal = begin();
    setStage({ type: 'preparing' });
    try {
      const result = await operations.prepare(file, { signal });
      if (result.type === 'failed') return setStage({ type: 'failed', copy: preparationFailureCopy[result.reason] });
      await send(result.upload);
    } catch {
      if (!signal.aborted) setStage({ type: 'failed', copy: preparationFailureCopy.undecodable });
    }
  };

  const chooseAnother = () => {
    if (stage.type === 'failed' && stage.readyImage) operations.remove(stage.readyImage.id);
    setStage({ type: 'choose' });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent container={container} showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <div aria-live="polite" className="flex flex-col items-center gap-3 text-[12px]">
          {stage.type === 'choose' ? <ImageDropZone onFile={choose} /> : null}
          {stage.type === 'preparing' || stage.type === 'processing' ? (
            <p className="flex items-center gap-2">
              <Spinner aria-hidden="true" />
              {stageCopy[stage.type]}
            </p>
          ) : null}
          {stage.type === 'uploading' ? (
            <div className="flex w-full flex-col gap-2">
              <p>{stageCopy.uploading}</p>
              <Progress value={Math.round(stage.fraction * 100)} aria-label={stageCopy.uploading} />
            </div>
          ) : null}
          {stage.type === 'checking' || stage.type === 'attaching' ? (
            <>
              <img
                src={stage.image.placeholderDataUrl}
                alt=""
                width={stage.image.width}
                height={stage.image.height}
                className="block h-auto max-h-60 w-auto max-w-full self-center blur-md"
              />
              <p className="flex items-center gap-2">
                <Spinner aria-hidden="true" />
                {stageCopy[stage.type]}
              </p>
            </>
          ) : null}
          {stage.type === 'failed' ? <p role="alert">{stage.copy.message}</p> : null}
        </div>
        <DialogFooter>
          {stage.type === 'failed' && stage.copy.offer === 'choose-another' ? (
            <Button onClick={chooseAnother}>{actionCopy.chooseAnother}</Button>
          ) : null}
          {stage.type === 'failed' && stage.retry ? <Button onClick={stage.retry}>{actionCopy.tryAgain}</Button> : null}
          <Button variant="secondary" disabled={stage.type === 'attaching'} onClick={() => close(false)}>
            {actionCopy.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Read `components/ui/dialog.tsx` for the exact export names of the footer and title. If `DialogFooter` is named differently, use the existing name. Read `components/ui/spinner.tsx` for whether `Spinner` already sets `aria-hidden`.

Run: `npx vitest run components/images`
Expected: PASS. Where a test fails because a query does not match the rendered markup, fix the component to the behaviour the test describes. Do not loosen the assertion.

Prove two guards fail when broken, then restore each:

1. Remove the `stage.type === 'attaching'` early return in `close`, and watch "refuses to close while the photo is being added" fail.
2. Move `operations.remove` into the `CHECK_FAILED` branch, and watch that test fail.

- [ ] **Step 6: Add the workbench specimens**

In `components/dev/workbench/sections/OurComposites.tsx`, import `useState`, `ImageDropZone`, `ImageUploadDialog`, `Button`, `mockImageOperations` and `MockUploadOutcome`, then add:

```tsx
const uploadOutcomes = [
  'ready',
  'refused',
  'check-failed',
  'slow-check',
  'undecodable',
  'timed-out',
  'too-small',
  'too-narrow',
  'IMAGE_TOO_SMALL',
  'IMAGE_UNREADABLE',
  'IMAGE_BUSY',
  'RATE_LIMIT_EXCEEDED',
  'ACCOUNT_RESTRICTED',
  'NIGHT_NOT_ENABLED',
  'network',
] as const satisfies readonly MockUploadOutcome[];

function ImageUploadDialogDemo({
  outcome,
  attach,
  side,
}: {
  outcome: MockUploadOutcome;
  attach: 'succeeds' | 'fails';
  side: Side;
}) {
  const [open, setOpen] = useState(false);
  return (
    <WithPortalContainer>
      {(container) => (
        <>
          <Button size="small" onClick={() => setOpen(true)}>
            Add a photo
          </Button>
          <ImageUploadDialog
            key={`${outcome}-${attach}`}
            side={side}
            title="Add a photo"
            open={open}
            onOpenChange={setOpen}
            onReady={async () => (attach === 'succeeds' ? {} : { error: 'FAILED' })}
            operations={mockImageOperations(outcome)}
            container={container}
          />
        </>
      )}
    </WithPortalContainer>
  );
}
```

Then, inside the section's rendered list beside the other `Specimen`s:

```tsx
      <Specimen
        name="Image upload dialog"
        controls={{ outcome: uploadOutcomes, attach: ['succeeds', 'fails'] as const }}
        render={(state, side) => <ImageUploadDialogDemo outcome={state.outcome} attach={state.attach} side={side} />}
        code={(state) => `<ImageUploadDialog side="day" title="Add a photo" open={open} onOpenChange={setOpen} onReady={attachProfilePhoto} operations={mockImageOperations('${state.outcome}')} />`}
      />
      <Specimen
        name="Image drop zone"
        render={() => <ImageDropZone onFile={() => undefined} />}
        code={() => '<ImageDropZone onFile={choose} />'}
      />
```

Import `Side` from `@/lib/side` if the file does not already. Follow the file's existing `Specimen` usage if its `controls` shape differs from the one shown.

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

Load `/components/ours` with `npm run dev` and check each outcome on both the day and night panes:

- the night pane's dialog renders in night colours
- the progress bar moves
- the placeholder shows during checking

Use the Playwright browser tools without calling `browser_resize`.

- [ ] **Step 7: Commit**

```bash
git add lib/images/upload-error-copy.ts components/images components/dev/workbench/sections/OurComposites.tsx
git commit -m "Add the image upload dialog and drop zone

The dialog prepares, uploads with a progress bar, processes, checks with
the blurred placeholder and attaches, then closes. Each failure keeps it
open with its own message and offer. Closing aborts the work in flight and
deletes only a ready image that was never attached.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The profile photo controls

**Goal:** On `/profile`, `/night/profile` and their two prototypes, the header's photo control opens the upload dialog to add or change the photo and offers "Remove photo" with a confirmation. The production pages call the new server actions. The prototypes use mock operations and never call the API.

**Files:**

- Create: `lib/profile/photo-actions.ts`, `lib/profile/photo-actions.test.ts`
- Create: `lib/profile/photo-copy.ts`
- Create: `components/profile/edit/PhotoControls.tsx`
- Rewrite: `components/profile/edit/PhotoField.tsx`, `components/profile/edit/PhotoField.test.tsx`
- Create: `components/profile/edit/PrototypePhotoField.tsx`, `components/profile/edit/PrototypePhotoField.test.tsx`
- Modify: `components/profile/edit/ProfileHeaderPanel.tsx`, `components/profile/edit/ProfileHeaderPanel.test.tsx`
- Modify: `app/(day)/(site)/profile/page.tsx`, `app/(day)/prototype/profile/page.tsx`, `app/(night)/night/(site)/profile/page.tsx`, `app/(night)/night/prototype/profile/page.tsx`
- Modify: `components/dev/workbench/sections/OurComposites.tsx`
- Modify: `docs/page-inventory.md`, `../scratchpad/roadmap.md`

**Acceptance Criteria:**

- [ ] **The actions:**
  - `attachProfilePhoto('day', id)` sends `PUT /api/member/me/day-profile/image` with `{ imageId: id }`, revalidates `/profile`, and returns `{}`
  - on night, the same goes to `/night-profile/image` and revalidates `/night/profile`
  - a refusal returns `{ error: <errorCode> }` and does not revalidate
  - an error without a code returns `{ error: 'FAILED' }`
  - `removeProfilePhoto` behaves the same with `DELETE`
- [ ] **The photo control:**
  - `PhotoField` renders "Add a photo" with no photo, and "Change photo" plus "Remove photo" with one
  - its outer element has `id="profile-photo"`
  - "Remove photo" opens "Remove your photo?" with "Remove" and "Cancel"
  - "Remove" calls the remove action
  - a failure shows "We couldn't remove your photo. Please try again." inside the alert dialog
- [ ] **The prototype control** renders the same labels and imports nothing from `lib/profile/photo-actions` or `lib/images/image-upload-operations`.
- [ ] **The header panel** renders its `photo` slot, and no longer imports `PhotoField`.
- [ ] **The pages:** all four profile pages render, the production pages pass `PhotoField` and the prototypes pass `PrototypePhotoField`.
- [ ] **The workbench** has a "Profile photo control" specimen with `photo: ['none', 'some']`.
- [ ] **The docs:** `docs/page-inventory.md`'s `/profile` and `/night/profile` rows say the photo is added, changed and removed from the header, and both (FE) photo lines in the roadmap are ticked.
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass, and `npm run build` succeeds.

**Verify:** `npm run typecheck && npm run lint && npm test && npm run build` → all pass

**Steps:**

- [ ] **Step 1: Write the failing action tests**

Create `lib/profile/photo-actions.test.ts`:

```ts
// @vitest-environment node
import { revalidatePath } from 'next/cache';

import { HttpResponse, http } from 'msw';

import { setupTestServer } from '@/lib/test/mocks/setup-test-server';

import { attachProfilePhoto, removeProfilePhoto } from './photo-actions';

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let lastRequest: { method: string; url: string; body?: unknown } | undefined;

const server = setupTestServer([
  http.put('*/api/member/me/:side/image', async ({ request }) => {
    lastRequest = { method: 'PUT', url: new URL(request.url).pathname, body: await request.json() };
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete('*/api/member/me/:side/image', ({ request }) => {
    lastRequest = { method: 'DELETE', url: new URL(request.url).pathname };
    return new HttpResponse(null, { status: 204 });
  }),
]);

describe('attachProfilePhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastRequest = undefined;
  });

  it('sets the day photo and refreshes the day profile page', async () => {
    await expect(attachProfilePhoto('day', 'img-1')).resolves.toEqual({});
    expect(lastRequest).toEqual({ method: 'PUT', url: '/api/member/me/day-profile/image', body: { imageId: 'img-1' } });
    expect(revalidatePath).toHaveBeenCalledWith('/profile');
  });

  it('sets the night photo and refreshes the night profile page', async () => {
    await expect(attachProfilePhoto('night', 'img-2')).resolves.toEqual({});
    expect(lastRequest?.url).toBe('/api/member/me/night-profile/image');
    expect(revalidatePath).toHaveBeenCalledWith('/night/profile');
  });

  it('returns the API error code and refreshes nothing when refused', async () => {
    server.use(
      http.put('*/api/member/me/:side/image', () =>
        HttpResponse.json({ errorCode: 'IMAGE_SIDE_MISMATCH' }, { status: 409 })
      )
    );
    await expect(attachProfilePhoto('day', 'img-1')).resolves.toEqual({ error: 'IMAGE_SIDE_MISMATCH' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns FAILED when the refusal carries no code', async () => {
    server.use(http.put('*/api/member/me/:side/image', () => new HttpResponse(null, { status: 500 })));
    await expect(attachProfilePhoto('day', 'img-1')).resolves.toEqual({ error: 'FAILED' });
  });
});

describe('removeProfilePhoto', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes the night photo and refreshes the night profile page', async () => {
    await expect(removeProfilePhoto('night')).resolves.toEqual({});
    expect(lastRequest).toEqual({ method: 'DELETE', url: '/api/member/me/night-profile/image' });
    expect(revalidatePath).toHaveBeenCalledWith('/night/profile');
  });

  it('returns the API error code when refused', async () => {
    server.use(
      http.delete('*/api/member/me/:side/image', () =>
        HttpResponse.json({ errorCode: 'ACCOUNT_RESTRICTED' }, { status: 403 })
      )
    );
    await expect(removeProfilePhoto('day')).resolves.toEqual({ error: 'ACCOUNT_RESTRICTED' });
  });
});
```

Run: `npx vitest run lib/profile/photo-actions.test.ts`
Expected: FAIL.

- [ ] **Step 2: Write `lib/profile/photo-actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';

import {
  isApiError,
  removeOwnDayProfileImage,
  removeOwnNightProfileImage,
  setOwnDayProfileImage,
  setOwnNightProfileImage,
  unwrap,
} from '@/lib/api';
import { links } from '@/lib/routing/links';
import type { Side } from '@/lib/side';

export type PhotoActionResult = { error?: string };

export async function attachProfilePhoto(side: Side, imageId: string): Promise<PhotoActionResult> {
  try {
    unwrap(side === 'day' ? await setOwnDayProfileImage({ imageId }) : await setOwnNightProfileImage({ imageId }));
  } catch (error) {
    return { error: isApiError(error) ? (error.errorCode ?? 'FAILED') : 'FAILED' };
  }
  revalidatePath(side === 'day' ? links.profile() : links.nightProfile());
  return {};
}

export async function removeProfilePhoto(side: Side): Promise<PhotoActionResult> {
  try {
    unwrap(side === 'day' ? await removeOwnDayProfileImage() : await removeOwnNightProfileImage());
  } catch (error) {
    return { error: isApiError(error) ? (error.errorCode ?? 'FAILED') : 'FAILED' };
  }
  revalidatePath(side === 'day' ? links.profile() : links.nightProfile());
  return {};
}
```

The error-code expression repeats rather than living in a sync helper, because a `'use server'` module may export only async functions. A non-exported sync helper is allowed, and `lib/profile/actions.ts` has one named `errorCode`. Extract one here the same way if the reviewer prefers.

Run: `npx vitest run lib/profile/photo-actions.test.ts lib/auth/use-server.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the copy and the presentational control**

Create `lib/profile/photo-copy.ts`:

```ts
export const photoCopy = {
  add: 'Add a photo',
  change: 'Change photo',
  remove: 'Remove photo',
  removeTitle: 'Remove your photo?',
  removeDescription: 'Your profile will show no photo on this side.',
  removeConfirm: 'Remove',
  cancel: 'Cancel',
  removeFailed: "We couldn't remove your photo. Please try again.",
} as const;
```

Create `components/profile/edit/PhotoControls.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { ImageUploadDialog } from '@/components/images/ImageUploadDialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AvatarPlaceholder } from '@/components/ui/avatar-placeholder';
import { Button } from '@/components/ui/button';
import { UncroppedPhoto } from '@/components/ui/photo';
import type { ImageView } from '@/lib/api/browser-client';
import type { ImageUploadOperations } from '@/lib/images/image-upload-operations';
import type { Gender } from '@/lib/member/types';
import type { Photo } from '@/lib/mock/photo';
import { photoCopy } from '@/lib/profile/photo-copy';
import type { Side } from '@/lib/side';

export type PhotoControlsProps = {
  side: Side;
  photo?: Photo;
  gender: Gender;
  label: string;
  operations: ImageUploadOperations;
  attach: (side: Side, imageId: string) => Promise<{ error?: string }>;
  remove: (side: Side) => Promise<{ error?: string }>;
  container?: HTMLElement;
};

export function PhotoControls({
  side,
  photo,
  gender,
  label,
  operations,
  attach,
  remove,
  container,
}: PhotoControlsProps) {
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);

  const confirmRemove = async () => {
    setRemoving(true);
    const { error } = await remove(side);
    setRemoving(false);
    if (error) return setRemoveFailed(true);
    setConfirming(false);
  };

  return (
    <div id="profile-photo" className="flex shrink-0 flex-col items-start gap-2">
      {photo ? (
        <UncroppedPhoto photo={photo} label={label} className="max-h-36 max-w-24 sm:max-w-40" />
      ) : (
        <AvatarPlaceholder gender={gender} label={label} className="size-24 sm:size-32" />
      )}

      <Button variant="secondary" size="small" onClick={() => setUploading(true)}>
        {photo ? photoCopy.change : photoCopy.add}
      </Button>
      {photo ? (
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            setRemoveFailed(false);
            setConfirming(true);
          }}
        >
          {photoCopy.remove}
        </Button>
      ) : null}

      <ImageUploadDialog
        side={side}
        title={photo ? photoCopy.change : photoCopy.add}
        open={uploading}
        onOpenChange={setUploading}
        onReady={(image: ImageView) => attach(side, image.id)}
        operations={operations}
        container={container}
      />

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent container={container}>
          <AlertDialogHeader>
            <AlertDialogTitle>{photoCopy.removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{photoCopy.removeDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          {removeFailed ? <p role="alert">{photoCopy.removeFailed}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{photoCopy.cancel}</AlertDialogCancel>
            <Button onClick={confirmRemove} disabled={removing}>
              {photoCopy.removeConfirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

Read `components/ui/alert-dialog.tsx` to confirm `AlertDialogContent` accepts `container`. If it does not, add the prop exactly as `DialogContent` does in `components/ui/dialog.tsx`.

- [ ] **Step 4: Write the two wirings and their tests**

Rewrite `components/profile/edit/PhotoField.tsx`:

```tsx
'use client';

import { PhotoControls, type PhotoControlsProps } from '@/components/profile/edit/PhotoControls';
import { browserImageOperations } from '@/lib/images/image-upload-operations';
import { attachProfilePhoto, removeProfilePhoto } from '@/lib/profile/photo-actions';

export function PhotoField(props: Pick<PhotoControlsProps, 'side' | 'photo' | 'gender' | 'label'>) {
  return (
    <PhotoControls
      {...props}
      operations={browserImageOperations}
      attach={attachProfilePhoto}
      remove={removeProfilePhoto}
    />
  );
}
```

Create `components/profile/edit/PrototypePhotoField.tsx`:

```tsx
'use client';

import { PhotoControls, type PhotoControlsProps } from '@/components/profile/edit/PhotoControls';
import { mockImageOperations } from '@/lib/mock/image-upload-operations';

const resolves = async () => ({});

export function PrototypePhotoField(props: Pick<PhotoControlsProps, 'side' | 'photo' | 'gender' | 'label'>) {
  return <PhotoControls {...props} operations={mockImageOperations('ready')} attach={resolves} remove={resolves} />;
}
```

Rewrite `components/profile/edit/PhotoField.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { members } from '@/lib/mock/members';
import { removeProfilePhoto } from '@/lib/profile/photo-actions';

import { PhotoField } from './PhotoField';

vi.mock('@/lib/profile/photo-actions', () => ({
  attachProfilePhoto: vi.fn(async () => ({})),
  removeProfilePhoto: vi.fn(async () => ({})),
}));

const nickname = members.tomos.nickname;
const withPhoto = () => (
  <PhotoField
    side="day"
    photo={members.tomos.dayProfile.photo}
    gender={members.tomos.gender}
    label={`${nickname}, day photo`}
  />
);
const withoutPhoto = () => <PhotoField side="day" gender={members.tomos.gender} label={`${nickname}, day photo`} />;

describe('PhotoField', () => {
  it("shows the member's photo under the given label", () => {
    render(withPhoto());
    expect(screen.getByRole('img', { name: `${nickname}, day photo` })).toBeInTheDocument();
  });

  it('shows a placeholder and offers only to add a photo when there is none', () => {
    render(withoutPhoto());
    expect(screen.getByRole('img', { name: `${nickname}, day photo` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument();
  });

  it('offers to change or remove the photo when there is one', () => {
    render(withPhoto());
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument();
  });

  it('keeps the id the signup chalkboard links to', () => {
    const { container } = render(withoutPhoto());
    expect(container.querySelector('#profile-photo')).not.toBeNull();
  });

  it('opens the upload dialog', () => {
    render(withoutPhoto());
    fireEvent.click(screen.getByRole('button', { name: 'Add a photo' }));
    expect(screen.getByRole('dialog', { name: 'Add a photo' })).toBeInTheDocument();
  });

  it('removes the photo once the removal is confirmed', async () => {
    render(withPhoto());
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(screen.getByText('Remove your photo?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeProfilePhoto).toHaveBeenCalledWith('day'));
  });

  it('reports a failed removal inside the confirmation', async () => {
    vi.mocked(removeProfilePhoto).mockResolvedValueOnce({ error: 'FAILED' });
    render(withPhoto());
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText("We couldn't remove your photo. Please try again.")).toBeInTheDocument();
  });
});
```

Create `components/profile/edit/PrototypePhotoField.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';

import { members } from '@/lib/mock/members';

import { PrototypePhotoField } from './PrototypePhotoField';

describe('PrototypePhotoField', () => {
  it('offers the same controls as the production field', () => {
    render(
      <PrototypePhotoField
        side="night"
        photo={members.tomos.dayProfile.photo}
        gender={members.tomos.gender}
        label="Tomos, night photo"
      />
    );
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument();
  });

  it('never reaches the API', () => {
    const source = readFileSync('components/profile/edit/PrototypePhotoField.tsx', 'utf8');
    expect(source).not.toContain('photo-actions');
    expect(source).not.toContain('image-upload-operations');
  });
});
```

Run: `npx vitest run components/profile/edit/PhotoField.test.tsx components/profile/edit/PrototypePhotoField.test.tsx`
Expected: PASS.

- [ ] **Step 5: Turn the header's photo into a slot and render it from the pages**

In `components/profile/edit/ProfileHeaderPanel.tsx`:

- remove the `PhotoField` import
- add `photo: ReactNode` to the props, importing `type ReactNode` from `react`
- replace `<PhotoField photo={profile.photo} gender={member.gender} label={`${member.nickname}, ${side} photo`} />` with `{photo}`

In `ProfileHeaderPanel.test.tsx`, pass `photo={<span>photo slot</span>}` in each render, and add:

```tsx
it('renders the photo control it is given', () => {
  render(
    <ProfileHeaderPanel
      member={members.tomos}
      profile={members.tomos.dayProfile}
      base=""
      side="day"
      photo={<span>photo slot</span>}
    />
  );
  expect(screen.getByText('photo slot')).toBeInTheDocument();
});
```

In each of the four pages, pass the photo control as the `photo` prop:

- `app/(day)/(site)/profile/page.tsx`:

```tsx
<ProfileHeaderPanel
  member={member}
  profile={profile}
  base=""
  side="day"
  photo={<PhotoField side="day" photo={profile.photo} gender={member.gender} label={`${member.nickname}, day photo`} />}
/>
```

- `app/(night)/night/(site)/profile/page.tsx`: the same with `side="night"`, `PhotoField`, and `night photo` in the label.
- `app/(day)/prototype/profile/page.tsx`: the same shape with `PrototypePhotoField`, `side="day"`, and `base={PROTOTYPE_BASE}` kept.
- `app/(night)/night/prototype/profile/page.tsx`: `PrototypePhotoField`, `side="night"`, `member={me}`.

Use each page's existing variable names for the member and profile. Import `PhotoField` or `PrototypePhotoField` from `@/components/profile/edit/`.

- [ ] **Step 6: Add the workbench specimen**

In `components/dev/workbench/sections/OurComposites.tsx`, import `PhotoControls`, `mockImageOperations` (already imported in Task 7) and `members`, then add:

```tsx
<Specimen
  name="Profile photo control"
  controls={{ photo: ['none', 'some'] as const }}
  render={(state, side) => (
    <WithPortalContainer>
      {(container) => (
        <PhotoControls
          side={side}
          photo={state.photo === 'some' ? members.tomos.dayProfile.photo : undefined}
          gender={members.tomos.gender}
          label="Tomos, day photo"
          operations={mockImageOperations('ready')}
          attach={async () => ({})}
          remove={async () => ({})}
          container={container}
        />
      )}
    </WithPortalContainer>
  )}
  code={() =>
    '<PhotoField side="day" photo={profile.photo} gender={member.gender} label={`${member.nickname}, day photo`} />'
  }
/>
```

- [ ] **Step 7: Update the inventory and the roadmap**

In `docs/page-inventory.md`:

- In the `/profile` row, replace "The header panel is read-only apart from the photo," with "The header panel is read-only apart from the photo, which is added, changed and removed there through the image upload dialog,".
- Make the same replacement in the `/night/profile` row.
- Leave both Status cells unchanged: `partial` for `/profile` and `real` for `/night/profile`.

In `../scratchpad/roadmap.md`:

- Tick `(FE) Upload, replace and remove the day profile photo through the image upload dialog` and the night twin.
- Change `- [ ] **Night profile** — *partial*. Description` back to `- [x] **Night profile** — Description`.

- [ ] **Step 8: Run everything, check in the browser, and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

Start the API (`cd ../api && ./gradlew bootRun`) and `npm run dev`. Sign in as a verified member with night open, then check each item by eye in Chromium:

1. On `/profile`, add a photo by drag and drop. Watch the progress bar and the placeholder. The dialog closes and the header shows the photo.
2. Change it with the file picker.
3. Remove it and confirm.
4. Repeat on `/night/profile`, confirming the dialog renders in night colours.
5. On `/prototype/profile`, the dialog runs on mock operations and the page does not change.
6. With the operating system's reduced-motion setting on, the spinner still turns and nothing else animates.

```bash
git add lib/profile components/profile app docs/page-inventory.md components/dev/workbench/sections/OurComposites.tsx
git commit -m "Add, change and remove the profile photo from the header on both sides

The photo control opens the upload dialog and attaches the ready image
through its own endpoint. Removing it asks first. The prototype pages
render the same control on mock operations.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
cd ../scratchpad && git add roadmap.md && git commit -m "Tick the profile photo upload on both sides

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Durable documentation

**Goal:** The image handling doc and the three scratchpad documents describe the upload path as built:

- the 1280-pixel long edge and the 320-pixel minimum
- flattening
- where EXIF comes from, and how a report describes EXIF supplied by the browser
- why the privacy notice does not change

**Files:**

- Modify: `docs/image-handling.md`
- Modify: `../scratchpad/project-scoping.md`
- Modify: `../scratchpad/compliance/csea-content-handling-procedure.md`
- Modify: `../scratchpad/design/operator-console.md`

**Acceptance Criteria:**

- [ ] **`docs/image-handling.md`:**
  - It gives 1280 for member photos, and the "Sizes" section no longer says 1400.
  - A new "Uploading a photograph" section covers:
    - the untouched rule
    - the pica resize
    - the 320-pixel minimum with its too-small and too-narrow cases
    - flattening onto white
    - the EXIF part
    - the 30-second check
- [ ] **`project-scoping.md`:** the `exifBase64` passage says the EXIF comes from the uploaded file, or from the browser's `exif` part when the file carries none, and that the source is recorded. It also gives the reason no notice changes.
- [ ] **`csea-content-handling-procedure.md` and `operator-console.md`** state three things:
  - EXIF from the browser part is described in a report as supplied by the uploader's browser separately from the pixels
  - EXIF exists only for a hash match found on the first check attempt
  - a HEIC upload carries none
- [ ] No em-dash is added, and each paragraph is one line.

**Verify:** `grep -c "1400" docs/image-handling.md` → `2` (the two distortion examples, which describe a 1400-pixel file and stay), and `grep -n "exif_source\|BROWSER" ../scratchpad/project-scoping.md ../scratchpad/compliance/csea-content-handling-procedure.md` → at least one line in each

**Steps:**

- [ ] **Step 1: Update `docs/image-handling.md`**

In "Sizes", replace the member photos bullet with:

```markdown
- Member photos: 1280 on the long edge, which is what the API stores. The viewer opens at up to 88vh, so anything smaller shows a full-size view barely larger than the profile thumbnail.
```

Replace "1400px" with "1280px" in the "Not built" CDN bullet. Leave the two distortion examples in "The three classes on UncroppedPhoto" and "The viewer names both viewport caps" as they are, because they record measurements of a 1400-pixel file.

Add this section before "## Sizes":

```markdown
## Uploading a photograph

`components/images/ImageUploadDialog.tsx` takes one photograph by drop or by file picker, prepares it in the browser, uploads it, and polls the API until the image check settles. The caller attaches the image once it is `READY`.

An RGB or greyscale JPEG already within 1280 pixels and 5 MiB is uploaded untouched. Every other photograph is decoded with its EXIF orientation applied, resized to 1280 pixels on its long edge with pica's Lanczos filter in a Web Worker, flattened onto white and encoded as a JPEG at 0.92. Above 50 megapixels the browser decodes at a power-of-two fraction of the original first. The API re-encodes whatever it receives to WebP at 0.82 and flattens the stored image onto white, so a transparent PNG loses its transparency either way.

A photograph must be at least 320 pixels on its short edge once its long edge is reduced to 1280. A photograph under 320 pixels on its short edge is too small. A photograph whose long edge is more than four times its short edge is too narrow, even when both edges are large. The dialog says which of the two it is.

A canvas discards EXIF. When the browser re-encodes a JPEG, it sends the original's EXIF segment as a separate `exif` part, because the API keeps EXIF for a National Crime Agency report on a hash match. `../api/docs/bunny.md` describes how the API chooses between the file's own EXIF and the part.

The dialog polls at 400 ms, then every 500 ms until 5 seconds, then every 2 seconds, and gives up at 30 seconds with a message to try again in a few minutes. It deletes an uploaded image only when that image is `READY` and was never attached. An image left behind is removed by the API's reaper after 24 hours.

`lib/images/reduce-for-upload.ts` is the only module that imports pica. happy-dom has no canvas or Web Worker, so the resize itself is checked by eye with real photographs in Chromium, Firefox and WebKit.
```

- [ ] **Step 2: Update the scratchpad documents**

In `../scratchpad/project-scoping.md`, append these sentences to the paragraph beginning `**\`ReducedImage.exifBase64\` holds the EXIF data Schedule 1 asks for`, keeping it one line:

```
The browser re-encodes most photographs before upload, which discards the file's EXIF, so it sends the original JPEG's EXIF segment as a separate `exif` part. The uploaded file's own EXIF always wins, the part is used only when the file carries none, and `image_hash_match.exif_source` records `UPLOAD` or `BROWSER`. EXIF from the part was supplied by the uploader's browser separately from the pixels, so a report describes it that way and never as the camera's own data. The privacy notice and the Children's Code scope assessment are unchanged by this: the location a photograph's EXIF may carry is received for the length of the image check and kept only for a hash match, which the notice's photographs row and the child sexual abuse content handling procedure already cover.
```

In `../scratchpad/compliance/csea-content-handling-procedure.md`, after the sentence "The EXIF data exists only for a hash match, because the site keeps it only when a hash scheme matches.", insert:

```
It exists only for a match found on the first check attempt, because a retried check is rebuilt from the stored image, which carries no EXIF. A HEIC upload carries none. `image_hash_match.exif_source` says where the EXIF came from: `UPLOAD` is the uploaded file's own, and `BROWSER` is a segment the uploader's browser sent separately from the pixels, which the report describes as supplied by the uploader's browser and not as the camera's data.
```

In `../scratchpad/design/operator-console.md`, after "The EXIF data exists only for a hash match," at line 197, insert "and the page names its source, the uploaded file or the uploader's browser, as `image_hash_match.exif_source` records it," so the sentence reads on.

- [ ] **Step 3: Commit**

```bash
git add docs/image-handling.md && git commit -m "Describe how a photograph is prepared and uploaded

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
cd ../scratchpad && git add project-scoping.md compliance/csea-content-handling-procedure.md design/operator-console.md && git commit -m "Record where a hash match's EXIF comes from and why no notice changes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Final verification with real photographs

**Goal:** Real high-resolution photographs are run through the dialog on `/profile` against the local API and the dev Bunny zone. The originals, the sent files and the stored images are collected under the scratchpad for Ross to check, with a written report of what they show.

**Files:**

- Create (scratchpad, not committed): `$SCRATCH/verification/image-upload/**`

**Acceptance Criteria:**

- [ ] **The folder** holds these photographs, each with its source URL and licence recorded in `sources.md`:
  - one over 100 megapixels
  - one of 48 to 50 megapixels
  - one of 20 to 30 megapixels with GPS in its EXIF
  - an orientation-6 copy of a JPEG
  - a panorama over 4:1
  - one under 320 on its short edge
  - a transparent PNG
  - an RGB JPEG within 1280
  - a CMYK JPEG within 1280
- [ ] **For each accepted photograph**, the folder holds the original, the file the browser sent (captured from the upload request) and the stored WebP downloaded from `fullUrl`.
- [ ] **For each rejected photograph**, the folder holds the dialog's message as shown.
- [ ] **`index.html`** shows each set side by side at full size, with dimensions and byte sizes.
- [ ] **The member's address:** an upload sent through `http://localhost:3000/api/member/images` with `cf-connecting-ip: 203.0.113.9` stores `upload_ip = 203.0.113.9`.
- [ ] **`report.md`** states, per photograph:
  - sharpness compared with the original at the same size
  - whether edges are jagged
  - whether it is the right way up
  - any colour shift
  - whether behaviour matched the spec
- [ ] **Nothing is committed.** The folder stays in place.

**Verify:** `ls "$SCRATCH/verification/image-upload" && test -s "$SCRATCH/verification/image-upload/report.md" && test -s "$SCRATCH/verification/image-upload/index.html"`

**Steps:**

- [ ] **Step 1: Collect the photographs**

Search Unsplash and Wikimedia Commons with WebSearch and WebFetch. Use the Playwright browser where a site blocks fetching. Choose images under the Unsplash License, public domain, CC0 or CC BY. Wikimedia Commons' "Category:Large images" and NASA images are reliable sources above 100 megapixels. Download each with `curl -L -o`, and record the page URL, author and licence in `$SCRATCH/verification/image-upload/sources.md`.

Derive the synthetic cases from a downloaded photograph with sharp, installed in `$SCRATCH/decode-harness` in Task 1:

```js
import sharp from 'sharp';

const base = 'originals/medium.jpg';
await sharp(base).rotate(-90).jpeg().withMetadata({ orientation: 6 }).toFile('originals/orientation-6.jpg');
await sharp(base).resize(1280, 300, { fit: 'cover' }).jpeg().toFile('originals/panorama-4-3-to-1.jpg');
await sharp(base).resize(300, 225).jpeg().toFile('originals/too-small.jpg');
await sharp(base).resize(1200, 900).jpeg().toFile('originals/within-1280-rgb.jpg');
await sharp(base).resize(1200, 900).toColourspace('cmyk').jpeg().toFile('originals/within-1280-cmyk.jpg');
await sharp(base)
  .resize(800, 600)
  .ensureAlpha()
  .composite([
    {
      input: Buffer.from('<svg width="800" height="600"><rect width="400" height="600" fill="black"/></svg>'),
      blend: 'dest-out',
    },
  ])
  .png()
  .toFile('originals/transparent.png');
```

If the 20 to 30 megapixel photograph carries no GPS, add one with `exiftool -GPSLatitude=51.5 -GPSLatitudeRef=N -GPSLongitude=0.12 -GPSLongitudeRef=W` if `exiftool` is installed. Otherwise use sharp's `withExif`. Record which was used.

- [ ] **Step 2: Run each photograph through the dialog and capture the request**

Start the API and `npm run dev`. Open `/profile` as a verified test member in the Playwright browser, without calling `browser_resize`. For each photograph:

1. Start capturing network requests with `browser_network_requests`.
2. Upload the file with `browser_file_upload` through "Change photo" or "Add a photo".
3. Wait for the dialog to close, or for its message.
4. Save the multipart `file` part of the `POST /api/member/images` request.

If the Playwright tools cannot give the request body, run this in the page with `browser_evaluate` before uploading:

```js
const send = XMLHttpRequest.prototype.send;
window.__sentFiles = [];
XMLHttpRequest.prototype.send = function (body) {
  if (body instanceof FormData) window.__sentFiles.push(body.get('file'));
  return send.call(this, body);
};
```

After the upload, read the file back as a data URL with `FileReader` and write it to `sent/<name>.jpg`.

5. For an accepted photograph, read the image id from the response. Fetch `GET /api/member/images/{id}` and download `fullUrl` to `stored/<name>.webp`. For a rejection, copy the dialog's message text into `messages/<name>.txt`.

- [ ] **Step 3: Check the member's address**

```bash
TOKEN=<the access_token cookie value from the browser>
curl -s -o /dev/null -w '%{http_code}\n' -X POST 'http://localhost:3000/api/member/images?side=DAY' \
  -H 'X-Requested-With: sundial' -H 'cf-connecting-ip: 203.0.113.9' -H "Cookie: access_token=$TOKEN" \
  -F "file=@$SCRATCH/verification/image-upload/originals/within-1280-rgb.jpg"
PGPASSWORD=dev_password psql -h localhost -p 5433 -U sundial sundial_dev -c "select upload_ip from image order by created_at desc limit 1"
```

Expected: `201`, and `203.0.113.9`. If the address is `127.0.0.1` or the frontend's own address, record that in the report. It means the local rewrite or Tomcat's `internal-proxies` does not pass the header through, and the deploy check in `../api/docs/bunny.md` needs acting on.

- [ ] **Step 4: Build the comparison page**

Create `$SCRATCH/verification/image-upload/index.html`. It holds one `<section>` per photograph with three `<figure>`s: original, sent, stored. Each figure shows the image at its natural size inside a horizontally scrolling container, with a caption giving pixel dimensions and byte size. Read these with `sharp(file).metadata()` and `fs.statSync(file).size` in a small Node script that writes the HTML. A rejected photograph's section shows the original and the message.

- [ ] **Step 5: Write the report**

Compare each set by eye at full size, and at 1280 pixels against the original downscaled with `sharp(original).resize(1280, 1280, { fit: 'inside', kernel: 'lanczos3' })`. Write `report.md` with one entry per photograph covering:

- sharpness
- jagged edges on fine diagonals and hair
- orientation
- colour against the original
- the path taken (untouched, encoded, or fractional decode)
- the time from choosing to the dialog closing
- whether behaviour matched the spec

End with the list of anything that did not match, each with its evidence.

- [ ] **Step 6: Report to Ross**

Tell Ross where the folder is. Summarise the report's mismatches, or state that there were none. Say that the Apple phone check remains a pre-launch roadmap line.
