FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev && npx prisma generate
COPY . .
RUN npm run build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
USER node
EXPOSE 3001
CMD ["npm", "start"]
