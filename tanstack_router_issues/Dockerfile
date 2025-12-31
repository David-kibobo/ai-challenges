# Dockerfile — clean clone from base commit, apply patch, test workspace
FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

# --- Environment variables ---
ENV NODE_ENV=development
ENV NPM_CONFIG_PRODUCTION=false
ENV MODE=base

# Disable Nx Cloud for offline test runs
ENV NX_SKIP_NX_CLOUD=true
ENV NX_CLOUD_SKIP_INSTALL=true
ENV NX_DAEMON=false
ENV NX_TASKS_RUNNER_OUTPUT_STYLE=stream
ENV NX_CLOUD_NO_TIMEOUTS=true
ENV NX_CLOUD_OFFLINE=1
ENV NX_SKIP_NX_CLOUD_INSTALL=1
ENV NX_NO_CLOUD=true
ENV NX_HIDE_UPDATE_MESSAGE=1
ENV CI=1

# --- Upgrade Node to >= 22.12 ---
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && node -v \
    && npm -v

# --- Install git for cloning ---
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# --- Clone the upstream repository at the base commit ---
RUN git clone https://github.com/TanStack/router.git . \
    && git checkout dfb4f9af4540acab1d00c3add0a54bbccf7f08bc

# --- Copy and apply your patch into the cloned repo ---
# Copy the patch into the image and apply it to the checkout.
COPY test.patch ./test.patch
RUN git apply test.patch || true

# --- Copy local workspace files into the cloned repository ---
# This overlays local changes (including test/experimental files) into the
# cloned repo before installing dependencies.
COPY . .

# --- Install all workspace dependencies inside the repo ---
RUN pnpm install

# --- Optional: install Playwright for e2e tests ---
# RUN pnpm exec playwright install --with-deps

# --- Default shell ---
CMD ["/bin/bash"]
