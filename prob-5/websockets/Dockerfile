# ─────────────────────────────────────────────────────────────
# Shipd preferred base
FROM public.ecr.aws/x8v8d7g8/mars-base:latest

# ─────────────────────────────────────────────────────────────
# System setup
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    git curl wget build-essential zlib1g-dev libffi-dev libssl-dev \
    libbz2-dev libreadline-dev libsqlite3-dev liblzma-dev tk-dev \
    ca-certificates && rm -rf /var/lib/apt/lists/*

# ─────────────────────────────────────────────────────────────
# Build CPython 3.14 (free-threaded)
ENV PYTHON_VERSION=3.14.0
ENV PREFIX=/usr/local/python-free
ENV PATH="$PREFIX/bin:$PATH"

RUN curl -L https://github.com/python/cpython/archive/refs/tags/v${PYTHON_VERSION}.tar.gz -o /tmp/python.tar.gz \
    && tar -xzf /tmp/python.tar.gz -C /tmp \
    && cd /tmp/cpython-${PYTHON_VERSION} \
    && ./configure --prefix=$PREFIX --disable-gil --enable-optimizations \
    && make -j$(nproc) \
    && make install \
    && rm -rf /tmp/cpython-${PYTHON_VERSION} /tmp/python.tar.gz

# ─────────────────────────────────────────────────────────────
# Make free-threaded Python the default
RUN ln -sf $PREFIX/bin/python3 /usr/local/bin/python3 && \
    ln -sf $PREFIX/bin/pip3 /usr/local/bin/pip3 && \
    ln -sf $PREFIX/bin/python3 /usr/local/bin/python && \
    python3 -V && python3 -c "import sys; print('Free-threaded build:', not sys._is_gil_enabled())"

# ─────────────────────────────────────────────────────────────
# Copy project files
WORKDIR /app
COPY . .

# ─────────────────────────────────────────────────────────────
# Install dependencies using free-threaded Python
RUN pip install --upgrade pip && \
    pip install -e . && \
    pip install \
        pytest==8.4.2 \
        pytest-asyncio==1.2.0 \
        pytest-timeout==2.4.0 \
        coverage==7.6.1

# ─────────────────────────────────────────────────────────────
# Default command
CMD ["/bin/bash"]
