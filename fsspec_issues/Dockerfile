FROM public.ecr.aws/x8v8d7g8/mars-base:latest

# Set the initial working directory
WORKDIR /app

# --- 1. System Dependencies ---
# Installing essential build tools to ensure C-extensions or ffi-related 
# dependencies don't cause installation hangs.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
    build-essential \
    python3-dev \
    libffi-dev \
    libssl-dev \
    zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*

# --- 2. Clone and Checkout Base Commit ---
RUN git clone https://github.com/fsspec/filesystem_spec /app/filesystem_spec
WORKDIR /app/filesystem_spec

# Checkout the specific base commit ID requested
RUN git checkout c23674c4c7bd60f8c3b41d0c4bbcefe4d18d6c70

# --- 3. Copy Patches ---
# Copy the patch files from the build context root into the repo directory
COPY solution.patch /app/filesystem_spec/solution.patch
COPY test.patch /app/filesystem_spec/test.patch

# --- 4. Apply Patches (Whitespace Fixed) ---
# We use --whitespace=fix to prevent the patch application from failing due to 
# invisible formatting issues which can sometimes break automated builds.
RUN git apply --whitespace=fix test.patch
RUN git apply --whitespace=fix solution.patch

# --- 5. Install Dependencies ---
# Using -e (editable) to ensure the patches applied to the source code are active.
# Added pytest-timeout specifically to help debug the infinite hangs in the pipeline.
RUN pip install --no-cache-dir -e ".[test]" pytest-timeout && pip check

# --- 6. Final Setup ---
# Set the entry point for interactive debugging
CMD ["/bin/bash"]