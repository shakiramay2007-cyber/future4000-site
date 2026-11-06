FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN addgroup -S f4 && adduser -S f4 -G f4 && chown -R f4:f4 /app
USER f4
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "server.js"]
