import { Global, Module } from '@nestjs/common';
import { SessionAuthGuard } from './auth.guard';

@Global()
@Module({
  providers: [SessionAuthGuard],
  exports: [SessionAuthGuard],
})
export class AuthModule {}
