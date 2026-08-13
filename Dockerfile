# Leaderboard service only — the game itself is static files served by Caddy.
FROM node:22-alpine
WORKDIR /app
COPY server/leaderboard.js ./server/leaderboard.js
ENV PORT=3800 DATA_FILE=/data/scores.json
EXPOSE 3800
CMD ["node", "server/leaderboard.js"]
