FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5173 INTERVIEW_DATA_FILE=/data/public-interviews.json PUBLIC_SPEECH_CONFIG_FILE=/data/public-speech.json
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/lib ./lib
COPY --from=build /app/server.mjs ./server.mjs
VOLUME ["/data"]
EXPOSE 5173
CMD ["node", "server.mjs"]
