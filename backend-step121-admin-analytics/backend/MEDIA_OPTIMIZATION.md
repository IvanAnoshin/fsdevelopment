# Media optimization strategy

Current approach in the project:

- Images are optimized on upload on the backend.
- The original uploaded binary is **not** kept as a separate heavy copy.
- The server strips metadata by decoding and re-encoding the image.
- Files are stored by **content hash**, so repeated uploads of the same image are deduplicated.
- Several responsive variants are generated:
  - `thumb`
  - `display`
  - `full`
- Feed/profile should prefer `display` and only open `full` on demand.

This is a good compromise for one inexpensive server:
- visually good enough quality
- much lower disk usage
- lower transfer cost per request
- predictable local storage layout

Suggested future step:
- move from JPEG/PNG-only pipeline to AVIF/WebP generation when infra budget allows it.


## HEIC / HEIF

- Uploads in `HEIC/HEIF` are accepted by the media pipeline.
- The server decodes them through ImageMagick (`magick` / `convert`) and then generates the same optimized variants as for JPEG/PNG.
- This keeps display quality high while serving lightweight variants in the feed.
- For production, install ImageMagick with HEIC/HEIF support and optionally set `MEDIA_MAGICK_BIN`.
