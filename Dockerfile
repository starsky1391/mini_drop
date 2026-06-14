FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
ENV MINI_DROP_REASONER_MODE=stub

EXPOSE 8787

CMD ["npm", "run", "start"]
