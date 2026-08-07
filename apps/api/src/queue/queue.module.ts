import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { QueueService } from './queue.service';

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule implements OnModuleDestroy {
  constructor(private readonly queueService: QueueService) {}

  async onModuleDestroy() {
    await this.queueService.close();
  }
}
