FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

# Create user and group
RUN groupadd -g 1001 agent && useradd -m -u 1001 -g agent agent

# Install system build tools and git
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ make python3-dev git && \
    rm -rf /var/lib/apt/lists/*

# Copy patch files into container
COPY solution.patch /solution.patch
COPY test.patch /test.patch

# Clone the repo fresh
RUN git clone https://github.com/ets-labs/python-dependency-injector.git repo

WORKDIR /app/repo

# Checkout the base commit that Shipd will use
RUN git checkout 5acddac9c15e87edff76846e8903a3c4552da22b

# Install dependencies and package from inside the cloned repo
RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements-dev.txt && \
    pip install --no-cache-dir -e .

# Apply solution.patch then test.patch (simulate upstream: apply then run tests)
RUN git apply /solution.patch
RUN git apply /test.patch

# Make repo files writable by non-root user
RUN chown -R agent:agent /app/repo /solution.patch /test.patch

# Switch to non-root user for running tests
USER agent

# Drop into a shell to run tests manually
CMD ["/bin/bash"]
