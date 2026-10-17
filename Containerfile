# --- frontend ---
FROM docker.io/library/node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- server (embeds the built frontend) ---
FROM docker.io/library/golang:1.24-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go setup.html ./
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/heyfiles . \
 && mkdir -p /out/data && chown 65532:65532 /out/data

# --- runtime: just the static binary ---
FROM scratch
COPY --from=server /out/heyfiles /heyfiles
COPY --from=server --chown=65532:65532 /out/data /data
USER 65532:65532
ENV HEYFILES_PORT=7000 HEYFILES_DATA=/data
EXPOSE 7000
VOLUME /data
ENTRYPOINT ["/heyfiles"]
