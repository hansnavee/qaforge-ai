import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { auth, type AuthSession, type SessionUser } from './auth';

export type AuthenticatedRequest = Request & {
  user: SessionUser;
  session: AuthSession;
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      throw new UnauthorizedException('Authentication required');
    }

    req.session = session as AuthSession;
    req.user = session.user as SessionUser;
    return true;
  }
}
