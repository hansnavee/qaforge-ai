import { Global, Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { SessionAuthGuard } from './auth.guard';
import { RegisterController } from './register.controller';

@Global()
@Module({
  imports: [OrgsModule],
  controllers: [RegisterController],
  providers: [SessionAuthGuard],
  exports: [SessionAuthGuard],
})
export class AuthModule {}
