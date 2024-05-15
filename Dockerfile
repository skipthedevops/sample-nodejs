FROM --platform=arm64 node:latest

COPY dist/ /app
COPY node_modules/ /app/node_modules

ENTRYPOINT ["node", "app/main.js"]
