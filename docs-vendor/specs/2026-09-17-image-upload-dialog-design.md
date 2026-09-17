# Image upload dialog design

## Goal

Build the image upload dialog and use it for the profile photo on `/profile` and `/night/profile`. The member drops a photograph onto the dialog or picks one with a file picker. The browser reduces it to the size the API stores, uploads it with a progress bar, and polls the API until the image check settles. The photo is attached to the profile only once the image is `READY`. The dialog then closes. A failure keeps the dialog open with a message and a way forward. The header also gains a control that removes the photo.

The dialog knows nothing about profiles. A caller passes the side and an `onReady` callback, so a diary entry, a board post or a mail can use the same dialog later.

The work spans three repositories. `../api` gains the profile image endpoints and changes to the upload endpoint. This repository gains the dialog, a browser API client and the profile wiring. `../scratchpad` gains the roadmap lines and the compliance document changes.

## Decisions already made

- **The photo is attached straight away, separately from the profile form.** The profile's Save button never touches the photo, and the photo control never touches the form.
- **The API gains `PUT` and `DELETE` on `/api/member/me/day-profile/image` and `/api/member/me/night-profile/image`.** `imageId` is removed from `DayProfileRequest` and `NightProfileRequest`, and the code that carried it is deleted.
- **Removing the photo is in scope.**
- **The poll runs for 30 seconds.** The first poll is at 400 ms, then every 500 ms until 5 seconds have passed, then every 2 seconds until 30 seconds. The API's own schedule stops at 10 seconds, which is shorter than a check that passes after slow vendor answers: Arachnid Shield can take 8 seconds (`app.arachnid.timeout`), Rekognition can take 8 seconds (`app.rekognition.call-timeout`), and a day image is then copied between Bunny zones. The retry sweep runs every 5 minutes on images at least 5 minutes old, so nothing can be learned between 30 seconds and 5 minutes. The API's description of the schedule is corrected to match. 30 seconds is a practical bound, not a worst case: two slow Bunny copies on top of two slow vendors can exceed it.
- **An image that has not settled by 30 seconds is a failure.** The dialog asks the member to try again in a few minutes. Nothing remembers the image across page loads.
- **While checking, the dialog shows the API's blurred placeholder** (`placeholderDataUrl`, 32 pixels, returned by the upload).
- **The happy path closes the dialog.** Every failure keeps the dialog open with a plain explanation.
- **The browser resizes with pica, Lanczos filter, in a Web Worker, without WebAssembly.**
- **The output is JPEG at quality 0.92.** The server re-encodes to WebP at 0.82 whatever it receives, Safari's canvas cannot encode WebP, and the server reads EXIF only from a JPEG.
- **The long edge is reduced to 1280 pixels**, which is the API's `FULL_EDGE`. `docs/image-handling.md` gives 1400 and is corrected.
- **Only an RGB or greyscale JPEG within 1280 pixels is uploaded untouched.** Java's image reader cannot decode a CMYK JPEG, may not decode an animated WebP, and ignores a Display P3 profile on a PNG. Every other file goes through the browser encoder, at its own size when it is already within 1280.
- **The raw EXIF segment travels as a separate `exif` part.** The server needs EXIF for a National Crime Agency report (`../scratchpad/project-scoping.md`, "`ReducedImage.exifBase64` holds the EXIF data Schedule 1 asks for, and nothing else keeps it"), and a canvas discards it. Splicing it back into the JPEG was rejected because its orientation tag would make the server rotate pixels the browser has already rotated.
- **The privacy notice and the Children's Code assessment are not changed for the EXIF part.** `project-scoping.md` records the reason: the location in a photograph's EXIF is received for the length of the check and kept only for a hash match. The API's upload description, which says re-encoding discards location data, is corrected.
- **A photograph must be at least 320 pixels on its short edge after reduction**, in the API and in the browser. The API answers a new `400 IMAGE_TOO_SMALL`. The copy tells a photo that is too small apart from one that is too narrow.
- **There is no upper size limit in the browser.** Above 50 megapixels the browser decodes at a power-of-two fraction of the original before pica runs.
- **A transparent PNG is accepted and its transparency is dropped.** The API flattens the stored image onto white.
- **Night uploads and night attaches need verification and an open night side. Removing a night photo does not**, so a member who closes the night side can still remove the photo.
- **The API's image `DELETE` is not changed.** It still deletes a `PENDING` or `CHECKING` image. The dialog offers no deletion before an image is `READY`, and a direct API call that deletes an image mid-check is accepted as it stands.
- **Browser requests to `/api` are allowed where a server action cannot do the job**, and `CLAUDE.md`'s rule is narrowed to say so. React Query and axios are not introduced.
- **Upload progress is shown as a bar.**

## 1. API changes (`../api`)

### Profile image endpoints

| Method and path                             | Body                                                | Success                            |
| ------------------------------------------- | --------------------------------------------------- | ---------------------------------- |
| `PUT /api/member/me/day-profile/image`      | `ProfileImageRequest { imageId: string }`, required | `204`                              |
| `DELETE /api/member/me/day-profile/image`   | none                                                | `204`, also when there is no photo |
| `PUT /api/member/me/night-profile/image`    | `ProfileImageRequest { imageId: string }`, required | `204`                              |
| `DELETE /api/member/me/night-profile/image` | none                                                | `204`, also when there is no photo |

The endpoints live on a `Member*` controller, so `RestrictionInterceptor` applies `ACCOUNT_RESTRICTED` to them.

**`PUT`**, inside one transaction that first locks the member row:

1. If `imageId` is the side's current image, answer `204` and change nothing. A retry after a lost response therefore succeeds.
2. Otherwise attach the image through `ImageService.attach`.
3. Upsert the side's profile row, writing only `image_id`. The row is created on first write with every other field absent.
4. If a previous image existed, clear its `attached_at` and delete it after commit.
5. Complete the profile-photo checklist award for the side.
6. Move the recently-updated listing when the image id changed, under the full write's 24-hour cooldown.

**`DELETE`**, inside one transaction that first locks the member row:

1. If the side has no image, answer `204`.
2. Set the profile row's `image_id` to null.
3. Clear the image's `attached_at`.
4. Delete it after commit. `claimForDeletion` refuses an image a profile row still references, so step 2 must come first.

A removal does not move the recently-updated listing.

**Errors:**

- Both methods: `401 UNAUTHORIZED`, `403 ACCOUNT_RESTRICTED`, `500 INTERNAL_ERROR`.
- `PUT` also: `400 VALIDATION_ERROR`, `404 NOT_FOUND` for an image the caller does not own, `409 IMAGE_NOT_ATTACHABLE` for an image that is not `READY` or is attached elsewhere, `409 IMAGE_SIDE_MISMATCH`.
- Night `PUT` also: `403 VERIFICATION_REQUIRED` and `403 NIGHT_NOT_ENABLED`. Night `DELETE` has no night gate.

### The full profile writes

`imageId` is removed from `DayProfileRequest` and `NightProfileRequest`. The upsert in `DayProfileRepository` and `NightProfileRepository` stops writing the `image_id` column, on insert and on update. `sameContentAs` stops comparing the image for the full write's bump decision. The full writes keep the member-row lock, and its Javadoc is rewritten to give the current reason: the full write and the image endpoints both upsert the same row. `ProfileUpdate` and anything else left without a caller is deleted.

Existing tests that attach an image through the full write move to the image endpoints. These include `ChecklistCompletionIntegrationTest`, `ImageDeletionE2ETest`, `DayProfileServiceTest` and `NightProfileServiceTest`. Spring ignores an unknown JSON property, so a test still sending `imageId` to the full write would pass its request and attach nothing.

### `POST /api/member/images`

- **An optional `exif` part.** It carries the bytes of the original JPEG's `APP1` segment, from the `Exif\0\0` header to the segment's end. That is the same span `ImageReducer.exifBase64` copies. The server applies these rules:
  - **The uploaded file's own `APP1` always wins.** The part is used only when the file carries none.
  - **The part must start with `Exif\0\0` and be at most 65,533 bytes**, or it is ignored.
  - **The part is never read for orientation.**
  - **The source is recorded.** `image_hash_match` gains an `exif_source` column (`UPLOAD` or `BROWSER`).
  - `ImageUploadService.upload` and `ImageReducer.reduce` each take the part as a new parameter.
- **Night gates.** `side=NIGHT` answers `403 VERIFICATION_REQUIRED` or `403 NIGHT_NOT_ENABLED` through `NightSideGate`, before anything is decoded or stored.
- **`400 IMAGE_TOO_SMALL`** when the short edge after reduction is under 320 pixels. It replaces the 80-pixel `MIN_CLASSIFIER_EDGE` check, which answered `IMAGE_UNREADABLE`. It needs its own exception class, because `UnreadableImageException` fixes its code. It also needs a `@Failure` on `uploadImage`, or `OpenApiDocumentIntegrationTest` fails. The `IMAGE_UNREADABLE` description stops mentioning small images.
- **The stored image, the thumbnail and the placeholder are flattened onto white** before they are encoded. `buildArtefacts` already builds the flattened copy for the classifier, so the classifier bytes and the hash do not change.
- **The description gives the new polling schedule**, explained by the three steps it covers. It also replaces the sentence saying re-encoding discards location data: the stored image carries no EXIF, and the EXIF received is kept only for a hash match.
- **`../api/docs/bunny.md`, "Decoding an upload"**, describes the `exif` part, its precedence and the browser's reduction.

The regenerated `openapi.json` is copied into this repository, and `npm run generate:api` is run.

### Member address on browser uploads

`image.upload_ip` is the Schedule 1 "IP address of the uploading device". A browser upload reaches the API through the Next `/api` rewrite, not through `apiFetch`. The rewrite must pass `cf-connecting-ip` through unchanged, and the API must resolve it as the client address. That resolution depends on the frontend container's address falling inside Tomcat's `internal-proxies` (`application-prod.yml`). Section 8 verifies the first half locally. The plan records the second half as a deploy check in `../api/docs`.

## 2. Preparing the file in the browser

### `planUpload`

`lib/images/plan-upload.ts` exports a pure function. Its input is the decoded width and height with orientation applied, the MIME type, the byte size, and the JPEG colour component count when the file is a JPEG. It returns one of:

| Result               | When                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `reject: too-small`  | The short edge is under 320                                                                                   |
| `reject: too-narrow` | The short edge is 320 or more, and under 320 once the long edge is scaled to 1280                             |
| `original`           | The long edge is 1280 or less, the type is `image/jpeg` with 1 or 3 components, and the size is at most 5 MiB |
| `encode`             | Everything else. It carries the target width and height, each rounded to a whole pixel, and a decode fraction |

- **The decode fraction** is 1 at 50 megapixels or below. Above 50 megapixels it is the smallest of 1/2, 1/4, 1/8 and so on that keeps the long edge at 1280 or more.
- **An `encode` result already within 1280 pixels**, such as a small PNG or HEIC, has a target equal to the original size.
- **The 5 MiB cap** keeps an untouched upload far below every body limit on the way. A 1280-pixel JPEG is normally well under 2 MiB.

### JPEG header parsing

`lib/images/jpeg-segments.ts` reads the first 1 MiB of a JPEG and walks its markers the way `ImageReducer.exifBase64` does, stopping at the start-of-scan marker. It exports two functions:

- **`extractExifSegment(bytes)`** returns the span from `Exif\0\0` to the segment's end, or nothing.
- **`readComponentCount(bytes)`** returns the component count from the start-of-frame segment, or nothing.

### `reduceForUpload`

`lib/images/reduce-for-upload.ts` is the only module that imports pica. It holds one Pica instance for the page's lifetime.

- **Signature:** `reduceForUpload(file, { signal })`.
- **Success:** `{ file: Blob, exif?: Uint8Array }`.
- **Failure:** a typed failure of `undecodable`, `too-small`, `too-narrow` or `timed-out`.

1. **Read the dimensions** by loading the file into an `HTMLImageElement` from an object URL. A load error is `undecodable`.
2. **Read the JPEG header** when the type is `image/jpeg`.
3. **Plan** with `planUpload`.
4. **`original`:** return the file untouched, with no `exif` part. The server reads the EXIF and orientation from the file itself.
5. **`encode`:**
   1. **Keep the EXIF** from step 2, if any.
   2. **Decode.**
      - A full decode uses `createImageBitmap(file, { imageOrientation: 'from-image' })`.
      - When the decode fraction is below 1, the call also passes `resizeWidth`, `resizeHeight` and `resizeQuality: 'high'` for the fractional size.
      - A browser that rejects the call, or returns a bitmap of the wrong size, falls back to the `HTMLImageElement` from step 1. Pica accepts that element as a source, and the browser has already applied its orientation.
   3. **Resize** with `pica.resize` into a canvas at the target size, using `features: ['js', 'ww']`, `filter: 'lanczos3'`, and a `cancelToken` driven by `signal`.
   4. **Flatten.** Draw that canvas onto a second canvas of the same size filled with white. A browser composites transparent pixels onto black when it encodes a JPEG.
   5. **Encode** with `canvas.toBlob('image/jpeg', 0.92)`. A `null` blob is `undecodable`.
   6. **Release memory.** Close the bitmap, revoke the object URL, and set both canvases' width and height to 0. iOS frees canvas memory promptly only when this is done.

Aborting `signal` stops the work between steps and cancels pica. It also releases memory as step 5.6 does.

- **A thrown error at any step is `undecodable`.**
- **A preparation that has not finished after 60 seconds is `timed-out`.** Pica 10 sets no `onerror` on its worker, so a worker blocked by the CSP or killed part-way leaves its promise unsettled instead of throwing. The same abort path then runs.
- **A phone killing the tab for memory cannot be caught at all.** Section 8 covers that case.

### Measuring the browser behaviour first

The first task of the plan measures the browser path with a throwaway Playwright harness in the scratchpad, run in Chromium, Firefox and WebKit. The harness is not committed.

**Inputs:**

- a photograph over 100 megapixels
- a photograph just under 50 megapixels
- orientation-6 JPEGs, one square and one not

**What it records for each engine:**

1. Whether `resizeWidth` and `resizeHeight` are honoured together with `imageOrientation`, checked on the pixels as well as on the dimensions. A lost rotation on a square photograph changes no dimension.
2. Whether `naturalWidth` reflects EXIF orientation.
3. The pixel difference at 1280 between fractional-decode output and full-decode output.
4. Peak memory for a full decode and for a fractional decode, measured through the Chrome DevTools Protocol in Chromium. This shows whether the fraction actually decodes less.
5. `pica.capabilities.bug_image_bitmap_orientation_region`. When that flag is set, pica copies the whole source into one canvas, which exceeds iOS's 16,777,216-pixel canvas limit for a large source.
6. Whether pica's worker starts under the new CSP, and how each engine fails when the worker is blocked.

**How the findings are applied:**

- **The findings adjust `reduceForUpload` before the dialog is built on it.** A browser that ignores the resize options takes the full decode. A fractional output that is visibly worse raises the 50-megapixel threshold or removes the fractional decode. If the pica flag is set in an engine that matters, the plan lowers the full-decode threshold for that engine.
- **Playwright's WebKit on Linux is WebKitGTK, not Apple's Safari.** It has different decoders and none of iOS's memory or canvas limits, so its results are indicative only. Safari's HEIC decoding, orientation with resize options, and memory behaviour are checked on an iPhone under the pre-launch roadmap line. `reduceForUpload` is not tuned on the Linux WebKit result alone.

## 3. The browser API client

### `lib/api/browser.ts`

`browserFetch` is an orval mutator for the browser. It returns the same `{ data, status, headers }` shape as `apiFetch`. Client code imports `unwrap` from `@/lib/api/unwrap` and `ApiError` from `@/lib/api/errors`, because `@/lib/api` pulls in the server output and `server-only`.

- **Headers.** It sets `X-Requested-With: sundial`. It sets no `content-type` for a `FormData` body, so the browser writes the multipart boundary.
- **Refresh on `401`.** A `401` from any path outside `/api/auth/` triggers `POST /api/auth/refresh`, and the request is retried once. Concurrent `401`s wait on one shared refresh.
  - **The refresh answers `401` or `403`**, or the retried request answers `401` again: the browser is sent to `links.loginReturningTo(path)`, a new builder in `lib/routing/links.ts`. `lib/auth/safe-next.ts` already validates the `next` value it writes.
  - **The refresh fails on the network or answers `5xx`:** the original request fails as a network failure, and the member is not sent anywhere. `proxy.ts` makes the same distinction between a refused refresh and an unreachable API.
  - **The API does not rotate the refresh token** (`AuthService.refresh`), so a browser refresh and a `proxy.ts` refresh can overlap safely.
- **Cancellation.** It passes the caller's `AbortSignal` through.
- **Upload progress.** When the options carry `onUploadProgress`, it sends the request with `XMLHttpRequest` and reports the fraction of bytes sent. Otherwise it uses `fetch`.
- **Keepalive.** It passes `keepalive` through, so a deletion can be sent while the dialog unmounts.

### The generated browser output

`orval.config.ts` gains a second output. It reads the same `openapi.json`, applies `input.filters.tags: ['Images']`, and writes to `lib/api/generated/browser/` with `browserFetch` as its mutator and no mock generation. Orval 8.27 supports the tag filter, and the generated functions already type their options as the mutator's second parameter.

- **Clearing.** The path sits under `lib/api/generated/`, so `generate:api`'s `rm -rf` still clears it.
- **Exports.** `lib/api/browser-client.ts` re-exports the output for client components. The output writes its own `api.schemas.ts`, which duplicates the server output's `ImageView` with the same structure.
- **Unchanged.** The server output and `lib/api/index.ts` stay as they are.
- **Extending.** Adding a tag to the filter is how a later feature gets browser calls.

### Body size through the rewrite

Next's external rewrite passes a request body through `experimental.proxyClientMaxBodySize`. Its default is 10 MiB, and above that the body is cut off silently. `next.config.ts` sets it to `12mb`, matching the API's `spring.servlet.multipart.max-request-size`. The browser's own uploads stay far below either limit.

### `CLAUDE.md`

The rule "The generated API client is server-only … A client component that needs data calls a server action" is rewritten.

The server-only client exists for three reasons:

1. **`proxy.ts` refreshes the session** before a page request or a server action, and its matcher excludes `/api`.
2. **`apiFetch` controls what reaches the API.** It forwards only the API's own cookies, the CSRF header and the member's address.
3. **`apiFetch` relays `Set-Cookie`** through `cookies()`.

Server actions stay the default. They remain required for any write whose effect must appear on a server-rendered page. A client component may call `/api` through `lib/api/browser-client.ts` when it needs upload progress, cancellation or polling. The address still reaches the API through the rewrite, which section 1 requires and section 8 verifies.

## 4. The dialog

### Files

- **`components/images/ImageUploadDialog.tsx`.** A client component. Props:
  - `side`
  - `title`
  - `open` and `onOpenChange`
  - `onReady(image: ImageView): Promise<{ error?: string }>`, where `error` is an API error code or `FAILED`
  - `operations: ImageUploadOperations`
  - `container?: HTMLElement`, passed to `DialogContent` like `ChalkWipeDialog` does
- **`components/images/ImageDropZone.tsx`.** The drop target, and a real button that opens a hidden `<input type="file" accept="image/*">`.
- **`lib/images/image-upload-operations.ts`.** Defines the `ImageUploadOperations` interface:
  - `prepare(file, { signal })`
  - `upload(prepared, side, { signal, onProgress })`
  - `get(id, { signal })`
  - `remove(id)`

  It exports `browserImageOperations`, which uses `reduceForUpload` and the browser client.

- **`lib/mock/image-upload-operations.ts`.** Simulated delays and outcomes, for the prototypes and the workbench.
- **`lib/images/await-image-check.ts`.** The polling schedule as a pure function of elapsed time, and the loop that uses it.
- **`lib/images/upload-error-copy.ts`.** Maps each failure to its message, and each error code `onReady` can return to its message and its offer.

### Stages

| Stage      | Shows                                                                            | Ends when                                                             |
| ---------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Choose     | The drop zone with its button                                                    | A file is chosen                                                      |
| Preparing  | Indeterminate progress                                                           | `prepare` returns                                                     |
| Uploading  | A progress bar with the fraction of bytes sent                                   | The last byte is sent                                                 |
| Processing | Indeterminate progress                                                           | The upload answers `201`                                              |
| Checking   | The blurred placeholder at the image's aspect ratio, with indeterminate progress | The image is `READY`, `REFUSED` or `CHECK_FAILED`, or 30 seconds pass |
| Attaching  | The placeholder with indeterminate progress                                      | `onReady` returns                                                     |

- **Success closes the dialog.** A successful `onReady` closes it.
- **Announcements.** Each stage change is announced through a polite live region.
- **Progress controls.** The progress bar is `components/ui/progress.tsx` with `aria-valuenow`. Indeterminate progress uses the spinner, which the reduced-motion rule already exempts.
- **Attaching cannot be interrupted.** While Attaching, `onOpenChange` refuses to close, which covers Escape and a click outside as well as the close button, and the close button is disabled.

### Choosing a file

- **Drop target.** The whole dialog body accepts a drop, and shows a `--line-strong` dashed border while a file is dragged over it.
- **More than one file**, dropped or picked, stays on Choose with a message.
- **Type check.** A file whose type is set and is outside `image/*` stays on Choose with a message. An empty type, which Windows and Linux browsers give a HEIC or AVIF, goes on to Preparing. A failed decode there is `undecodable`. The copy never claims a file with an empty type is not an image.

### Failures

The dialog stays open on every failure. The copy is written against `docs/tone-guide.md` in the plan. This table fixes the behaviour only.

| Failure                                                                        | Stage                   | Offer                                                                                       |
| ------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------- |
| `undecodable`                                                                  | Preparing               | Choose another photo                                                                        |
| `timed-out`                                                                    | Preparing               | Choose another photo                                                                        |
| `too-small`, `too-narrow`, or `400 IMAGE_TOO_SMALL`                            | Preparing or Processing | Choose another photo. The message says which of the two it is, from the original dimensions |
| `400 IMAGE_UNREADABLE`, `400 UPLOAD_UNREADABLE`, `413 IMAGE_TOO_LARGE`         | Processing              | Choose another photo                                                                        |
| `503 IMAGE_BUSY`                                                               | Processing              | Retried automatically, up to three times, one second apart. After that, Try again           |
| A network failure or a `500`                                                   | Uploading or Processing | Try again, which re-sends the prepared file without preparing it again                      |
| `429 RATE_LIMIT_EXCEEDED`                                                      | Processing              | A message stating the daily limit of 30, with no retry                                      |
| `403 ACCOUNT_RESTRICTED`, `403 VERIFICATION_REQUIRED`, `403 NIGHT_NOT_ENABLED` | Processing or Attaching | A message stating the reason, with no retry                                                 |
| `REFUSED`                                                                      | Checking                | Choose another photo                                                                        |
| `CHECK_FAILED`, or still `CHECKING` at 30 seconds                              | Checking                | A message to try again in a few minutes                                                     |
| `onReady` answers `FAILED` or `INTERNAL_ERROR`                                 | Attaching               | Try again, which calls `onReady` again with the same image                                  |
| `onReady` answers `IMAGE_NOT_ATTACHABLE`, `IMAGE_SIDE_MISMATCH` or `NOT_FOUND` | Attaching               | Choose another photo                                                                        |

A `401` whose refresh is refused never reaches the dialog, because `browserFetch` has already navigated away.

### Closing and cleaning up

- **Closing aborts.** Closing the dialog aborts preparation or any request in flight, and stops the poll.
- **The dialog deletes an image only when it knows the image is `READY` and unattached.** That happens in two cases: closing after an attach failure, and choosing another photo after an attach failure. The deletion is a `keepalive` request.
- **Every other uploaded image is left for the reaper,** which removes an unattached image after 24 hours (`app.images.check.unattached-age`). That covers closing during Processing or Checking, a timeout, `CHECK_FAILED` and `REFUSED`.

## 5. The profile

### Server actions

`lib/profile/photo-actions.ts` is a `'use server'` module with two actions:

- `attachProfilePhoto(side, imageId)` calls the side's `PUT`.
- `removeProfilePhoto(side)` calls the side's `DELETE`.

Each one:

- returns `{ error?: string }` carrying the API's error code, or `FAILED` when there is none
- calls `revalidatePath` on `links.profile()` or `links.nightProfile()` on success

**Cleanup in the existing actions:**

- The `imageId: current.image?.id` lines in `lib/profile/actions.ts` and `lib/profile/night-actions.ts` are deleted, along with the tests asserting the id is carried forward.
- `saveNightProfile`'s read of the current night profile existed only to supply that id, so it is deleted too.
- The day save keeps its read, because it still carries `interests` and `whatYouLike` forward.

### `PhotoField` and the prototypes

`ProfileHeaderPanel` is a server component, so it cannot hand client functions to `PhotoField`. It takes a `photo: ReactNode` slot, and each page renders the photo control into it.

- **`components/profile/edit/PhotoField.tsx`** is the production control, a client component.
  - Props: `side`, `photo`, `gender` and `label`.
  - It imports `browserImageOperations`, `attachProfilePhoto` and `removeProfilePhoto` itself.
  - Its outer element keeps `id="profile-photo"`, which `SignupChalkboard` links to.
  - It loses its local preview.
- **"Add a photo" or "Change photo"** opens `ImageUploadDialog` with `onReady` bound to `attachProfilePhoto`.
- **"Remove photo"** is shown when a photo exists. It opens an `AlertDialog` that confirms, then calls `removeProfilePhoto`. A failure shows inside the alert dialog.
- **`components/profile/edit/PrototypePhotoField.tsx`** renders the same controls with the mock operations and with attach and remove functions that resolve without calling the API.
  - The two prototype profile pages render it.
  - The mock code therefore stays out of the production pages' client bundle.
  - Both controls share a presentational component, which takes the operations and the two functions as props.
  - The prototype pages stay.

### Workbench

The `ours` workbench page gains three specimens:

- **The upload dialog,** driven by the mock operations, with one control per stage and per failure. It receives its `container` through `WithPortalContainer`.
- **The drop zone.**
- **The remove confirmation.** Its alert dialog also takes a `container`.

## 6. Configuration

- **`lib/security/csp.ts`** gains `worker-src 'self' blob:` for pica's worker, which pica creates from a blob URL. A comment names the dependency, and `lib/security/csp.test.ts` pins the directive. `'wasm-unsafe-eval'` is not added: pica's worker probes for WebAssembly inside a try block, and that probe will log a CSP violation once the nonce-based policy drops `'unsafe-eval'`.
- **`next.config.ts`** sets `experimental.proxyClientMaxBodySize: '12mb'`, and `next.config.test.ts` pins it.
- **`package.json`** gains `pica`.

## 7. Testing

`docs/testing-strategy.md` applies. A file that touches no DOM carries `// @vitest-environment node`, counts are exact, and each guard is broken once to show it fails.

### API

Tests that depend on deletion after commit are `BaseE2ETest`. Status codes, awards and side mismatches go through MockMvc on the repository tier.

- **`PUT` on both sides:**
  - replacement deletes the previous image
  - `PUT` with the current image answers `204` and changes nothing
  - the checklist award
  - `IMAGE_NOT_ATTACHABLE`, `IMAGE_SIDE_MISMATCH`, and `NOT_FOUND` for another member's image
  - the night gates on the night `PUT`
- **`DELETE` on both sides:**
  - deletion removes the image
  - `DELETE` with no photo
  - the night `DELETE` succeeding with the night side closed
- **The full writes:**
  - they leave the stored image unchanged
  - a full write racing an image `PUT` leaves the attached image referenced by the row
- **The `exif` part:**
  - a part on a file with no EXIF becomes `exifBase64` on a hash match, with `exif_source = BROWSER`
  - a file with its own EXIF keeps it, and records `UPLOAD`, whatever part is sent
  - a part without the header, or over 65,533 bytes, is ignored
- **The night gates on `POST /api/member/images?side=NIGHT`.**
- **`IMAGE_TOO_SMALL`** at a short edge of 319 and not at 320, including a panorama whose reduction takes it under.
- **Flattening:** the stored image and thumbnail of a transparent PNG are opaque, with white where the source was transparent.
- **The moved tests** listed in section 1.

### Frontend

- **`planUpload`.** Every boundary:
  - long edge 1280 and 1281
  - short edge 319 and 320, before and after scaling
  - 50 megapixels and one pixel over
  - the choice of fraction
  - 5 MiB
  - a CMYK JPEG, a PNG and a HEIC within 1280
- **`jpeg-segments`.** Against committed fixtures:
  - JPEGs with EXIF, with `APP1` ahead of `JFIF`, with no EXIF, CMYK, and truncated
  - a PNG
- **The polling schedule,** with fake timers:
  - the first poll at 400 ms
  - the 500 ms and 2 s intervals
  - a stop at each final state
  - a stop at 30 seconds
  - abort
- **`browserFetch`:**
  - the CSRF header
  - no `content-type` on a `FormData` body
  - one refresh and one retry on `401`
  - one shared refresh for concurrent `401`s
  - navigation on a refused refresh
  - no navigation, and a network failure, when the refresh fails on the network or answers `5xx`
  - no refresh for `/api/auth/`
  - abort
  - progress events on an upload
- **`links.loginReturningTo`**, and `link-construction.test.ts` still passing.
- **`ImageUploadDialog`,** with fake operations:
  - each stage
  - each failure row's message and offer
  - the `IMAGE_BUSY` retries
  - the 60-second preparation timeout
  - the happy path calling `onReady` and closing
  - abort on close, preparation included
  - deletion only for a `READY` unattached image
  - `onOpenChange` refusing to close during Attaching
- **`ImageDropZone`:** several files, a non-image type, an empty type, and the button.
- **The photo actions:** the endpoint called, `revalidatePath`, and the error code returned.
- **`PhotoField` and `PrototypePhotoField`:** the labels for each state, the remove confirmation, and the `profile-photo` id.
- **`ProfileHeaderPanel`:** the `photo` slot rendered.
- **Configuration:** the CSP directive and the body size limit.
- **The existing tests** asserting `imageId` is carried forward are deleted with the code.

### Checks by eye

In Chromium, on `/profile` and `/night/profile`, and on the workbench specimens on each side, check each of these:

- the dialog's colours on each side
- a drag and drop
- the file picker
- the progress bar
- the placeholder during checking
- the header after the dialog closes
- a removal
- reduced motion

## 8. Final verification

This is the plan's last task.

1. **Collect photographs** from Unsplash and Wikimedia Commons under licences that allow this use, recording each source and licence:
   - a photograph over 100 megapixels
   - one just under 50 megapixels
   - one of 20 to 30 megapixels with GPS in its EXIF
   - a copy of a JPEG with its EXIF orientation set to 6
   - a panorama that is too narrow after reduction
   - a photograph under 320 on its short edge
   - a transparent PNG
   - an RGB JPEG within 1280 pixels
   - a CMYK JPEG within 1280 pixels
2. **Run each one** through the dialog on `/profile` in Chromium, against the local API and the dev Bunny zone.
3. **Collect the results** under `verification/image-upload/` in the scratchpad directory. For each photograph, that folder holds:
   - the original
   - the file the browser sent
   - the stored WebP downloaded from its `fullUrl`

   An HTML page shows each set side by side at full size, with dimensions and byte sizes, and shows each rejection with the message the dialog gave.

4. **Check the member's address** on one browser upload through the local rewrite. The upload is sent with a `cf-connecting-ip` header, and the image row's `upload_ip` must equal that header's value, not the Next server's address.
5. **Report** what the results show: softness, jagged edges, wrong rotation, colour shift, and any case that behaved differently from this spec.
6. **Leave the folder in place.** Ross checks it after the plan is complete. The check on an Apple phone waits for the pre-launch roadmap line, because no Apple phone is available.

## 9. Documentation and roadmap

- **`CLAUDE.md`:** the narrowed server-action rule (section 3).
- **`docs/image-handling.md`:** 1280 pixels, the 320-pixel minimum, flattening, and how an upload is prepared.
- **`docs/page-inventory.md`:** the `/profile` and `/night/profile` rows describe the photo controls.
- **`../api/docs`:** the `exif` part in `bunny.md`, and the `internal-proxies` deploy check from section 1.
- **`../scratchpad/roadmap.md`, §7.2:**
  - The day profile's photo line is replaced by an (API) line for the image endpoints and an (FE) line for uploading, replacing and removing the photo.
  - The night profile gains the same pair, and loses its tick until they are done.
- **`../scratchpad/roadmap.md`, the image pipeline:**
  - An (API) line for the `exif` part and its source, `IMAGE_TOO_SMALL`, flattening, the night upload gates and the polling description.
  - An (API) line to rebuild the classifier calibration set from images the browser prepared. `../api/docs/aws-rekognition.md` records that re-encoding moved a test image across the day and night boundary.
- **`../scratchpad/project-scoping.md`:** the `exifBase64` passage says the EXIF comes from the uploaded file, or from the browser's `exif` part when the file carries none, and that the source is recorded. It also gives the reason no notice changes: the EXIF location is received for the length of the check and kept only for a hash match.
- **`../scratchpad/compliance/csea-content-handling-procedure.md` and `../scratchpad/design/operator-console.md`:**
  - EXIF from the browser part was supplied by the uploader's browser separately from the pixels, so a report describes it that way and never as the camera's own data.
  - EXIF exists only for a hash match found on the first check attempt, because the retry path rebuilds the check from the stored image.
  - A HEIC upload carries no EXIF.
- **Commits.** Each repository's lines are ticked in the commit that completes them.

## Out of scope

- Using the dialog for diary entries, board posts or mail.
- A crop control.
- Pasting an image from the clipboard.
- Remembering an unsettled image across page loads.
- Rebuilding the classifier calibration set.
- A retention hold on an uploader's images. `csea-content-handling-procedure.md` requires one, and the profile image `DELETE` becomes one more path it must cover when it is built.
