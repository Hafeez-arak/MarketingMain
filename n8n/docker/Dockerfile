# n8n + ffmpeg.
#
# ffmpeg is what makes "change the Arabic headline as often as you like, free"
# true. The Creative Compose workflow stamps our own text/logo layer onto a
# finished clip locally, so a wording, font or colour change re-composites the
# SAME footage in about a second and costs nothing — where re-rendering through
# a model costs money and comes back a visibly different take every time.
#
# Why a multi-stage COPY instead of the obvious `apk add ffmpeg`:
# `n8nio/n8n:latest` is a **Docker Hardened Image** (checked 2026-08-11, n8n
# 2.33.3 on Alpine 3.24). Hardened images ship no package manager at all — there
# is no /sbin/apk, and no curl either, only busybox wget. So `RUN apk add` fails
# outright rather than merely being slower. Copying a statically linked binary
# in needs no package manager, no shared libraries and no root at runtime, which
# is the point of a hardened base rather than a fight with it.
#
# mwader/static-ffmpeg is a scratch image holding exactly two static binaries.
# Pinned to 7.1 deliberately: `latest` would silently change the encoder under a
# rebuild, and video encoding is the one place where "it re-encoded slightly
# differently this time" is very hard to debug from the output.
FROM mwader/static-ffmpeg:7.1 AS ffmpeg

FROM n8nio/n8n:latest
USER root
COPY --from=ffmpeg /ffmpeg  /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
USER node

# Sanity check at build time rather than at 2am inside a failed workflow run.
RUN ffmpeg -version > /dev/null && ffprobe -version > /dev/null
