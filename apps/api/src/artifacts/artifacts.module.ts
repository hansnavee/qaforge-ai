import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';

@Module({
  imports: [OrgsModule],
  controllers: [ArtifactsController],
  providers: [ArtifactsService],
})
export class ArtifactsModule {}
