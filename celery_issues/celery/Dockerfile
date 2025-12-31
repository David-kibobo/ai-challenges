FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

RUN groupadd -g 1001 agent && useradd -m -u 1001 -g agent agent

COPY . .


RUN chown -R agent:agent /app


RUN pip install --no-cache-dir pytest-timeout && \
    pip install --no-cache-dir -r requirements/test.txt && \
    pip install --no-cache-dir -e .

USER agent

CMD ["/bin/bash"]