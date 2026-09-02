FROM rust:1-bookworm AS contracts

WORKDIR /build

RUN apt-get update && apt-get install -y pkg-config libdbus-1-dev libudev-dev \
  && rustup target add wasm32-unknown-unknown \
  && cargo install --root /usr/local --git https://github.com/stellar/stellar-cli.git --locked stellar-cli

COPY contracts ./contracts
RUN cd contracts && cargo build --target wasm32-unknown-unknown --release

FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libudev1 libdbus-1-3 \
  && rm -rf /var/lib/apt/lists/*

COPY apps/faucet/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000

COPY apps/faucet/src ./src
COPY contracts ./contracts
COPY --from=contracts /build/contracts ./contracts
COPY --from=contracts /usr/local/bin/stellar /usr/local/bin/stellar
RUN chmod +x /usr/local/bin/stellar && ln -s /usr/local/bin/stellar /usr/local/bin/soroban
ENV PATH="/usr/local/bin:${PATH}"

EXPOSE 4000
CMD ["node", "src/index.js"]

