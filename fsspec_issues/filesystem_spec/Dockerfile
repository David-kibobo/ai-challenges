FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

COPY . .


RUN pip install --no-cache-dir ".[test_full]"


CMD ["/bin/bash"]
