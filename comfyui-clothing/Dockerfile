FROM node:20-alpine AS deps
WORKDIR /app
ARG PNPM_VERSION=10.30.2
COPY package.json pnpm-lock.yaml ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm install -g pnpm@${PNPM_VERSION} \
    && pnpm config set registry https://registry.npmmirror.com \
    && pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_TENANT_API_URL=http://tenant-service:8081
ARG TENANT_API_BASE_URL=http://tenant-service:8081
ARG NEXT_PUBLIC_SHOW_CREDITS_NAV=true
ARG NEXT_PUBLIC_BILLING_NAV_TARGET=credits
ARG PNPM_VERSION=10.30.2
ENV NEXT_PUBLIC_TENANT_API_URL=${NEXT_PUBLIC_TENANT_API_URL}
ENV TENANT_API_BASE_URL=${TENANT_API_BASE_URL}
ENV NEXT_PUBLIC_SHOW_CREDITS_NAV=${NEXT_PUBLIC_SHOW_CREDITS_NAV}
ENV NEXT_PUBLIC_BILLING_NAV_TARGET=${NEXT_PUBLIC_BILLING_NAV_TARGET}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm config set registry https://registry.npmmirror.com \
    && npm install -g pnpm@${PNPM_VERSION} \
    && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ARG NEXT_PUBLIC_TENANT_API_URL=http://tenant-service:8081
ARG TENANT_API_BASE_URL=http://tenant-service:8081
ARG NEXT_PUBLIC_SHOW_CREDITS_NAV=true
ARG NEXT_PUBLIC_BILLING_NAV_TARGET=credits
ENV NEXT_PUBLIC_TENANT_API_URL=${NEXT_PUBLIC_TENANT_API_URL}
ENV TENANT_API_BASE_URL=${TENANT_API_BASE_URL}
ENV NEXT_PUBLIC_SHOW_CREDITS_NAV=${NEXT_PUBLIC_SHOW_CREDITS_NAV}
ENV NEXT_PUBLIC_BILLING_NAV_TARGET=${NEXT_PUBLIC_BILLING_NAV_TARGET}

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "-p", "3000"]
