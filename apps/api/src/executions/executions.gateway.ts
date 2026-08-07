import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { Server, WebSocket } from 'ws';
import type IORedis from 'ioredis';
import { QueueService } from '../queue/queue.service';

type ClientSocket = WebSocket & {
  room?: string;
  subscriber?: IORedis;
};

@WebSocketGateway({
  path: '/executions',
  cors: {
    origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class ExecutionsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ExecutionsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly queue: QueueService) {}

  handleConnection(client: ClientSocket, ...args: unknown[]) {
    const req = args[0] as IncomingMessage | undefined;
    this.logger.debug(`WS connected ${req?.url ?? ''}`);
  }

  async handleDisconnect(client: ClientSocket) {
    if (client.subscriber) {
      try {
        if (client.room) {
          await client.subscriber.unsubscribe(`execution:${client.room}:events`);
        }
        await client.subscriber.quit();
      } catch {
        // ignore
      }
    }
  }

  @SubscribeMessage('join')
  async onJoin(
    @ConnectedSocket() client: ClientSocket,
    @MessageBody() data: { executionId?: string },
  ) {
    const executionId = data?.executionId;
    if (!executionId) {
      client.send(JSON.stringify({ type: 'error', message: 'executionId required' }));
      return;
    }

    client.room = executionId;

    const sub = this.queue.createSubscriber();
    if (!sub) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: 'Redis unavailable; use HTTP polling fallback',
        }),
      );
      return;
    }

    client.subscriber = sub;
    const channel = `execution:${executionId}:events`;
    await sub.subscribe(channel);
    sub.on('message', (_ch, message) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });

    client.send(
      JSON.stringify({
        type: 'joined',
        room: `execution:${executionId}`,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
