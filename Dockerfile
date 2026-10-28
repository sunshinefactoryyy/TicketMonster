# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

ARG TARGETARCH
ARG FOUNDRY_VERSION=v1.0.0

# Native amd64 and arm64 toolchains; no host Node/Foundry installation required.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
RUN case "${TARGETARCH}" in amd64|arm64) ;; *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; esac \
    && curl -fSL --retry 3 "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_${TARGETARCH}.tar.gz" -o /tmp/foundry.tar.gz \
    && tar -xzf /tmp/foundry.tar.gz -C /usr/local/bin forge anvil \
    && rm /tmp/foundry.tar.gz \
    && forge --version && anvil --version

# Pin solc explicitly, including its official release checksum. This also avoids
# compiler downloads on startup and Foundry's older ARM compiler discovery path.
RUN case "${TARGETARCH}" in \
      amd64) solc_asset=solc-static-linux; solc_sha=d40adc6f9fdbb22a97d32a02fa05688bf2ee7886affc48c9851b0afd4a726b39 ;; \
      arm64) solc_asset=solc-static-linux-arm; solc_sha=e4260e58f9f653f984c8c072f7262855ca4628570752aabc9a5b358c57d2a6e5 ;; \
    esac \
    && curl -fSL --retry 3 "https://github.com/argotorg/solidity/releases/download/v0.8.34/${solc_asset}" -o /usr/local/bin/solc \
    && echo "${solc_sha}  /usr/local/bin/solc" | sha256sum -c - \
    && chmod +x /usr/local/bin/solc && solc --version

ENV SOLC=/usr/local/bin/solc \
    FORGE=/usr/local/bin/forge \
    ANVIL=/usr/local/bin/anvil \
    HOST=0.0.0.0 \
    PORT=4173 \
    RPC_PORT=8545

WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .

# Cache compiled contracts and fail the image build if the project tests fail.
RUN npm run check

EXPOSE 4173
HEALTHCHECK --interval=10s --timeout=8s --start-period=30s --retries=3 \
    CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "scripts/demo.mjs"]
