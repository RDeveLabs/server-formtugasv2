FROM node:26

WORKDIR /belajar

COPY . .
RUN npm install && npm install express mysql2 prisma@6.19.3 @prisma/client@6.19.3 @prisma/adapter-mariadb@6.19.3 dotenv

EXPOSE 3000
CMD [ "sh", "-c", "npx prisma migrate deploy && npx prisma generate && npx tsx server.js" ]