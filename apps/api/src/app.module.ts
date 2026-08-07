import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { QueueModule } from './queue/queue.module';
import { OrgsModule } from './orgs/orgs.module';
import { ProjectsModule } from './projects/projects.module';
import { ExecutionsModule } from './executions/executions.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { BillingModule } from './billing/billing.module';
import { GithubModule } from './github/github.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    AuthModule,
    QueueModule,
    OrgsModule,
    ProjectsModule,
    ExecutionsModule,
    ArtifactsModule,
    BillingModule,
    GithubModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
