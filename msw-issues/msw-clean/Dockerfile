FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

ENV NODE_ENV=development
ENV NODE_OPTIONS=--experimental-vm-modules

COPY . .


RUN pnpm add eventsource --save-dev

RUN echo "Cleaning up prior installation artifacts..." && \
    rm -rf node_modules 

RUN pnpm install 

CMD ["/bin/bash"]