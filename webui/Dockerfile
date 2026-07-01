FROM docker.io/node:20-alpine AS base

RUN apk add --no-cache libc6-compat

WORKDIR /app

EXPOSE 3000


FROM base AS dev

CMD ["sh", "-c", "if [ ! -d node_modules ] || [ -z \"$(ls -A node_modules 2>/dev/null)\" ]; then npm install; fi && npm run dev"]


FROM base AS prod

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000} -H 0.0.0.0"]
