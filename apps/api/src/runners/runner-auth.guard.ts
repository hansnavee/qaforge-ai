import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { RunnersService, type RunnerPrincipal } from './runners.service';

export type AuthenticatedRunnerRequest = Request & {
  runner: RunnerPrincipal;
};

export const CurrentRunner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RunnerPrincipal => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRunnerRequest>();
    return req.runner;
  },
);

@Injectable()
export class RunnerAuthGuard implements CanActivate {
  constructor(private readonly runners: RunnersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRunnerRequest>();
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
        ? header.slice(7).trim()
        : '';
    if (!token) {
      throw new UnauthorizedException('Runner token required');
    }
    const runner = await this.runners.resolveByToken(token);
    if (!runner) {
      throw new UnauthorizedException('Invalid runner token');
    }
    req.runner = runner;
    return true;
  }
}
