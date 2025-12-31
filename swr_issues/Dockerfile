FROM public.ecr.aws/x8v8d7g8/mars-base:latest

# Set the initial working directory
WORKDIR /app

ENV NODE_ENV=development
ENV NODE_OPTIONS=--experimental-vm-modules

# --- 1. Clone, Checkout Base Commit ---
RUN git clone https://github.com/vercel/swr /app/swr
WORKDIR /app/swr

# Checkout the base commit ID to start from a clean, known source code state
RUN git checkout 705104016a6fb1d3536c8b9278acf30ddda0f770

# --- 2. Remove Redundant Dependency Injection ---
# We have removed the 'pnpm add eventsource' step to prevent conflicts on package.json.

# --- 3. Copy Patches ---
# Copy ONLY the patch files from the build context root
COPY solution.patch /app/swr/solution.patch
COPY test.patch /app/swr/test.patch

# --- 4. Clean Artifacts ---
RUN echo "Cleaning old artifacts before install..." && \
    rm -rf node_modules 

# --- 5. Apply Patches (Whitespace Fixed) ---
# Use --whitespace=fix to automatically remove the trailing whitespace
# that caused the warnings, ensuring a clean application of test.patch.
RUN git apply --whitespace=fix test.patch
RUN git apply --whitespace=fix solution.patch

# --- 6. Install Dependencies ---
# This step runs AFTER the patches have updated package.json to include 'eventsource'.
RUN pnpm install

# --- 7. Final Setup ---
RUN chmod +x ./test.sh

# Set the final entry point for interactive debugging
CMD ["/bin/bash"]