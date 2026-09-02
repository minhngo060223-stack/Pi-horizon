FROM node:20-alpine

WORKDIR /app

COPY apps/web/package.json ./package.json
COPY apps/web/vite.config.ts ./vite.config.ts
COPY apps/web/index.html ./index.html
COPY apps/web/tsconfig.json ./tsconfig.json

RUN npm install --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000

COPY apps/web/src ./src

EXPOSE 5173
CMD ["npm", "run", "dev"]

