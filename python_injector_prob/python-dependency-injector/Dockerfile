FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

# Create user and group
RUN groupadd -g 1001 agent && useradd -m -u 1001 -g agent agent

# Install build tools and git
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ make python3-dev git && \
    rm -rf /var/lib/apt/lists/*

# Install pinned Python dependencies
COPY requirements-dev.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements-dev.txt

# Clone the repo at the specific base commit
RUN git clone https://github.com/ets-labs/python-dependency-injector.git repo && \
    cd repo && git checkout 5acddac9c15e87edff76846e8903a3c4552da22b

# Copy solution.patch from old repo into container
COPY python-dependency-injector_old/solution.patch /solution.patch

# Apply the patch (no rebuild)
RUN cd repo && git apply /solution.patch

# Switch to non-root user
USER agent

# Default command: open shell
CMD ["/bin/bash"]
