FROM docker.io/node:20-alpine

RUN apk add --no-cache libc6-compat

WORKDIR /app

EXPOSE 3000

CMD ["sh", "-c", "if [ ! -d node_modules ] || [ -z \"$(ls -A node_modules 2>/dev/null)\" ]; then npm install; fi && npm run dev"]
