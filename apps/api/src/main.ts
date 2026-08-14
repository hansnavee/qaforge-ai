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
import { seedDefaultAdmin } from './common/seed-admin';

async function bootstrap() {
  // bodyParser disabled so Better Auth can read the raw request body
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const logger = new Logger('Bootstrap');
  const port = Number(process.env.PORT || 4000);
  const webOrigin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const allowedOrigins = [
    webOrigin.replace(/\/$/, ''),
    'https://qaforge-ai-tau.vercel.app',
    'http://localhost:3000',
  ];

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(rateLimit({ windowMs: 60_000, max: 180 }));

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (
        allowedOrigins.includes(origin) ||
        /^https:\/\/qaforge[-a-z0-9]*-testing-agent\.vercel\.app$/.test(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  });

  const expressApp = app.getHttpAdapter().getInstance();

  // Mount Better Auth before JSON body parsing.
  // Use /api/auth (not /*) — Express 5 path-to-regexp rejects bare "*".
  const authHandler = toNodeHandler(auth);
  expressApp.use('/api/auth', (req, res) => {
    // better-auth expects the full path; restore base when mounted via use()
    return authHandler(req, res);
  });

  // JSON / urlencoded for Nest routes; preserve rawBody for Stripe webhooks
  expressApp.use(
    express.json({
      limit: '12mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  expressApp.use(express.urlencoded({ extended: true }));

  app.setGlobalPrefix('api/v1');
  app.useWebSocketAdapter(new WsAdapter(app));

  await seedDefaultAdmin();

  await app.listen(port, '0.0.0.0');
  logger.log(`QAForge API listening on http://0.0.0.0:${port}`);
  logger.log(`Auth: http://0.0.0.0:${port}/api/auth`);
  logger.log(`REST: http://0.0.0.0:${port}/api/v1`);
  logger.log(`WS:   ws://0.0.0.0:${port}/executions`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
