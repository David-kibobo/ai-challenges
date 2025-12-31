FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

# 1. Create mandatory agent user
RUN groupadd -g 1001 agent && useradd -m -u 1001 -g agent agent

# 2. Install build tools and git
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ make python3-dev git && \
    rm -rf /var/lib/apt/lists/*

# 3. Clone Celery and checkout the target base commit
RUN git clone https://github.com/celery/celery.git repo
WORKDIR /app/repo
RUN git checkout ba20bed7723c684d12ddd62d6a7c0c0d901b3351

# 4. Install dependencies as root
RUN pip install --no-cache-dir -r requirements/test.txt && \
    pip install --no-cache-dir -e .

# 5. Copy and apply the TEST patch only
COPY test.patch /test.patch
RUN git apply /test.patch

# 6. Set ownership and switch to agent user
RUN chown -R agent:agent /app/repo /test.patch
USER agent

CMD ["/bin/bash"]