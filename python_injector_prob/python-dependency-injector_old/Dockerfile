FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

# Create user and group
RUN groupadd -g 1001 agent && useradd -m -u 1001 -g agent agent

# Copy project files first for build efficiency
COPY . .

# Ensure ownership
RUN chown -R agent:agent /app

# Install system build tools and git (git is needed for git clean)
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ make python3-dev git && \
    rm -rf /var/lib/apt/lists/*

# Install pinned development dependencies (uses your requirements_dev.txt)
# This ensures deterministic Cython, pytest, setuptools versions etc.
RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements-dev.txt

# Make sure any stale build artifacts are removed to force a fresh compile
RUN git clean -fdx || true
RUN rm -rf build/ src/dependency_injector/*.c src/dependency_injector/*.so

# Force a fresh Cython build and install the package in editable mode
RUN python -m cython src/dependency_injector/_cwiring.pyx -3 --force && \
    python setup.py build_ext --force --inplace && \
    pip install --no-cache-dir -e .

# Sanity: print Python/Cython versions and list compiled extension files
RUN python -c "import sys, Cython; print('Python', sys.version.splitlines()[0]); print('Cython', Cython.__version__)" && \
    ls -la src/dependency_injector | grep _cwiring || true

# Switch to non-root user AFTER installation (important for permissions)
USER agent

# Default command: open a shell (override with test commands when running)
CMD ["/bin/bash"]
