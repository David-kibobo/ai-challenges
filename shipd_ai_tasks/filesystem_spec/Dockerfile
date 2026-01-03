FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app


RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    python3-dev \
    libffi-dev \
    libssl-dev \
    zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*

COPY . .


RUN pip install -e ".[test]" pytest-timeout && pip check

CMD ["/bin/bash"]
