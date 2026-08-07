import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';

@Module({
  imports: [OrgsModule],
  controllers: [GithubController],
  providers: [GithubService],
})
export class GithubModule {}
