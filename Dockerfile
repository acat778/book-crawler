# ============================================
# book-crawler Docker 镜像
# 构建: 依赖安装 + 前端编译在 CI 容器内完成
# 运行: 仅需 Chromium 系统依赖 + Node.js 22
# ============================================

FROM node:22

# Chromium 浏览器 + Puppeteer 需要的系统库（Debian Bookworm）
# puppeteer v24+ 不再捆绑 Chromium，需通过 apt 安装
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libnss3 libnspr4 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    libcups2 libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# 告诉 Puppeteer 使用系统 Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 后端依赖 + 源码
COPY node_modules ./node_modules
COPY package.json .
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src

# 前端构建产物（CI 步骤编译）
COPY frontend/dist ./frontend/dist

EXPOSE 8609

CMD ["node", "src/server.js"]
