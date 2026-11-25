# Imagen del servicio. Requiere dist/ (graficos.js compilado por el workflow) en el contexto.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PUERTO=8080

WORKDIR /app

COPY servicio/package.json servicio/package-lock.json ./
# Solo Chromium (con sus dependencias de sistema y fuentes); misma versión que el paquete playwright.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*

COPY servicio/config.mjs servicio/superset.mjs servicio/generador.mjs servicio/servidor.mjs servicio/cli.mjs ./
COPY servicio/plantilla ./plantilla
COPY servicio/pruebas ./pruebas
COPY dist ./graficos

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PUERTO||8080)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "servidor.mjs"]
