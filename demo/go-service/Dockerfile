FROM golang:1.22-bookworm AS build

WORKDIR /src
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/mini-drop-demo-target main.go

FROM debian:bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/mini-drop-demo-target /usr/local/bin/mini-drop-demo-target

ENV DEMO_DATA_DIR=/data
EXPOSE 8080

CMD ["mini-drop-demo-target"]
