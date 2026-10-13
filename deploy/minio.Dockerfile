FROM golang:1.24.8-alpine AS builder
RUN apk add --no-cache git
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOBIN=/out

FROM builder AS minio-build
RUN go install -trimpath \
      -ldflags="-s -w \
        -X github.com/minio/minio/cmd.Version=2025-09-07T16:13:09Z \
        -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-09-07T16-13-09Z \
        -X github.com/minio/minio/cmd.CommitID=07c3a429bfed433e49018cb0f78a52145d4bedeb \
        -X github.com/minio/minio/cmd.ShortCommitID=07c3a429bfed \
        -X github.com/minio/minio/cmd.CopyrightYear=2025" \
      github.com/minio/minio@RELEASE.2025-09-07T16-13-09Z \
    && cp "$(go list -m -f '{{.Dir}}' github.com/minio/minio@RELEASE.2025-09-07T16-13-09Z)/LICENSE" /out/LICENSE \
    && /out/minio --version

FROM builder AS mc-build
RUN go install -trimpath \
      -ldflags="-s -w \
        -X github.com/minio/mc/cmd.Version=2025-08-13T08:35:41Z \
        -X github.com/minio/mc/cmd.ReleaseTag=RELEASE.2025-08-13T08-35-41Z \
        -X github.com/minio/mc/cmd.CommitID=7394ce0dd2a80935aded936b09fa12cbb3cb8096 \
        -X github.com/minio/mc/cmd.ShortCommitID=7394ce0dd2a8 \
        -X github.com/minio/mc/cmd.CopyrightYear=2025" \
      github.com/minio/mc@RELEASE.2025-08-13T08-35-41Z \
    && cp "$(go list -m -f '{{.Dir}}' github.com/minio/mc@RELEASE.2025-08-13T08-35-41Z)/LICENSE" /out/LICENSE \
    && /out/mc --version

FROM alpine:3.24 AS runtime
RUN apk add --no-cache ca-certificates curl

FROM runtime AS minio
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.version="RELEASE.2025-09-07T16-13-09Z" \
      org.opencontainers.image.revision="07c3a429bfed433e49018cb0f78a52145d4bedeb" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=minio-build /out/minio /usr/local/bin/minio
COPY --from=minio-build /out/LICENSE /usr/share/licenses/minio/LICENSE
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data"]

FROM runtime AS mc
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.version="RELEASE.2025-08-13T08-35-41Z" \
      org.opencontainers.image.revision="7394ce0dd2a80935aded936b09fa12cbb3cb8096" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=mc-build /out/mc /usr/local/bin/mc
COPY --from=mc-build /out/LICENSE /usr/share/licenses/mc/LICENSE
ENTRYPOINT ["mc"]
CMD ["--help"]
