FROM rust:1.79-bookworm AS rust

FROM golang:1.25-bookworm AS build

WORKDIR /go/src/github.com/Pi-Defi-world/suban-rpc

ADD . ./

RUN git config --global --add safe.directory "/go/src/github.com/Pi-Defi-world/suban-rpc"

RUN if [ ! -d ".git" ]; then git config --global user.email "build@suban.org"; git config --global user.name "Build"; git init; git add -A; git commit -m "init"; fi

COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
ENV PATH="/usr/local/go/bin:/usr/local/cargo/bin:${PATH}"
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    jq \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN cargo --version
RUN rustc --version
RUN go version

RUN go mod tidy
RUN set -eux; \
    success=0; \
    for i in 1 2 3 4 5; do \
      if go mod download; then \
        success=1; \
        break; \
      fi; \
      sleep 15; \
    done; \
    test "$success" -eq 1

RUN cargo update -p ed25519-dalek --precise 2.1.1
RUN cargo update -p rand@0.9.5 --precise 0.8.5 || true

RUN make REPOSITORY_VERSION=1.0.0 build-suban-rpc

# Runtime: use pi-node-docker as base (has correct glibc + stellar-core + all libs)
FROM pinetwork/pi-node-docker:community-v1.0-p27.1.0

# Copy the built suban-rpc binary
COPY --from=build /go/src/github.com/Pi-Defi-world/suban-rpc/suban-rpc /app/suban-rpc
COPY --from=build /go/src/github.com/Pi-Defi-world/suban-rpc/suban-core.cfg /app/suban-core.cfg

WORKDIR /app

EXPOSE 8000 8001

ENTRYPOINT ["/app/suban-rpc"]
