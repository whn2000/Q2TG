FROM ghcr.io/clansty/q2tg:sleepyfox

# Copy built server bundle and frontend
COPY main/build/ /app/build/
COPY main/prisma/schema.prisma /app/schema.prisma
COPY ui/dist/ /app/front/

# Re-generate Prisma Client to include new composite indexes
RUN cd /app && ./node_modules/.bin/prisma generate
