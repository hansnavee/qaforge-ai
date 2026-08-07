import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { auth } from './auth/auth';
import { rateLimit } from './common/rate-limit';

async function bootstrap() {
  // bodyParser disabled so Better Auth can read the raw request body
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const logger = new Logger('Bootstrap');
  const webOrigin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const port = Number(process.env.PORT || 4000);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(rateLimit({ windowMs: 60_000, max: 180 }));

  app.enableCors({
    origin: webOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  });

  const expressApp = app.getHttpAdapter().getInstance();

  // Mount Better Auth before JSON body parsing
  expressApp.all('/api/auth/*', toNodeHandler(auth));

  // JSON / urlencoded for Nest routes; preserve rawBody for Stripe webhooks
  expressApp.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  expressApp.use(express.urlencoded({ extended: true }));

  app.setGlobalPrefix('api/v1');
  app.useWebSocketAdapter(new WsAdapter(app));

  await app.listen(port);
  logger.log(`QAForge API listening on http://localhost:${port}`);
  logger.log(`Auth: http://localhost:${port}/api/auth`);
  logger.log(`REST: http://localhost:${port}/api/v1`);
  logger.log(`WS:   ws://localhost:${port}/executions`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
