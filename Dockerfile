# Leaderboard service only — the game itself is static files served by Caddy.
FROM node:22-alpine
WORKDIR /app
COPY server/leaderboard.js ./server/leaderboard.js
# Both data paths point at the mounted volume. Telemetry defaulting to a path
# inside the image would look like it worked and then vanish on every recreate.
ENV PORT=3800 DATA_FILE=/data/scores.json TELEMETRY_FILE=/data/runs.jsonl
EXPOSE 3800
CMD ["node", "server/leaderboard.js"]
