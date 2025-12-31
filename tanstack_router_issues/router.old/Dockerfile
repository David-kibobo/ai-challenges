FROM public.ecr.aws/x8v8d7g8/mars-base:latest

WORKDIR /app

ENV NODE_ENV=development
ENV NPM_CONFIG_PRODUCTION=false
ENV MODE=base


COPY . .


RUN pnpm install --frozen-lockfile

CMD ["/bin/bash"]
