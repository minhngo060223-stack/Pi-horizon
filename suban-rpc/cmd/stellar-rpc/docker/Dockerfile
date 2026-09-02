FROM rust:1.95-bookworm AS rust

FROM golang:1.25-bookworm AS build
ARG REPOSITORY_VERSION

WORKDIR /go/src/github.com/Junman140/pi-rpc

ADD . ./

RUN git config --global --add safe.directory "/go/src/github.com/Junman140/pi-rpc"

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

# Pre-download Go dependencies with robust retries to handle network instability.
# Fail the layer if all retries fail.
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

RUN make REPOSITORY_VERSION=${REPOSITORY_VERSION} build-pi-rpc

# Move the binary to a common location
RUN mv pi-rpc /bin/pi-rpc

FROM ubuntu:22.04
ARG PI_NODE_VERSION
ENV PI_NODE_VERSION=${PI_NODE_VERSION:-*}
ENV PI_NODE_BINARY_PATH=/usr/bin/pi-node
ENV DEBIAN_FRONTEND=noninteractive

# ca-certificates are required to make tls connections
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    gnupg \
    jq \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
# Note: Pi Node repository might be different, using Stellar as placeholder if Pi Node is derived from it
RUN curl -sSL https://apt.stellar.org/SDF.asc | gpg --dearmor >/etc/apt/trusted.gpg.d/SDF.gpg
RUN echo "deb https://apt.stellar.org jammy stable" >/etc/apt/sources.list.d/SDF.list
RUN echo "deb https://apt.stellar.org jammy unstable" >/etc/apt/sources.list.d/SDF-unstable.list

# install llvm-20 so that core can be installed
RUN wget -O /etc/apt/trusted.gpg.d/apt.llvm.org.asc https://apt.llvm.org/llvm-snapshot.gpg.key
RUN echo 'deb http://apt.llvm.org/jammy/ llvm-toolchain-jammy-20 main' > /etc/apt/sources.list.d/llvm.list
RUN echo 'deb-src http://apt.llvm.org/jammy/ llvm-toolchain-jammy-20 main' >> /etc/apt/sources.list.d/llvm.list

RUN apt-get update && apt-get install -y --no-install-recommends stellar-core=${PI_NODE_VERSION} \
    && ln -s /usr/bin/stellar-core /usr/bin/pi-node \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary from the build stage
COPY --from=build /bin/pi-rpc /app/pi-rpc

# Set the entrypoint to the specific binary
ENTRYPOINT ["/app/pi-rpc"]
