# The web app as one small container, e.g. for Cloud Run. Point it at the API with API_URL (read at request time):
#   docker build -t finmlops-web web/
#   docker run -p 8080:8080 -e API_URL=http://host.docker.internal:8000 finmlops-web
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 8080
CMD ["node", "server.js"]
