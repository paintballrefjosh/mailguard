FROM node:20-alpine
RUN apk add --no-cache tar logrotate
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p logs config/geoip
EXPOSE 3001
CMD ["node", "server.js"]