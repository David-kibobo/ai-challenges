FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    gawk \
    util-linux \
    coreutils \
    procps \
    ca-certificates \
    tzdata \
    locales \
    tmux \
    asciinema \
 && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all files in /src into the working directory (/app)
COPY src/ /app/
