FROM docker.io/node:20-alpine AS base

RUN apk add --no-cache libc6-compat

WORKDIR /app

EXPOSE 3000


FROM base AS dev

# Always run install so newly added deps land in the node_modules volume — it's
# a near-noop when package-lock is unchanged. (The old conditional skipped
# install whenever the anonymous node_modules volume was non-empty, so a new
# dependency added to package.json never got installed on an existing volume.)
CMD ["sh", "-c", "npm install && npm run dev"]


FROM base AS prod

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000} -H 0.0.0.0"]
