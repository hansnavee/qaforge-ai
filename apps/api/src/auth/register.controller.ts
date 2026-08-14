import {
  BadRequestException,
  ConflictException,
  Controller,
  Post,
  Body,
} from '@nestjs/common';
import { z } from 'zod';
import { auth } from './auth';
import { OrgsService } from '../orgs/orgs.service';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  organizationName: z.string().trim().min(2).max(120),
});

@Controller('auth')
export class RegisterController {
  constructor(private readonly orgs: OrgsService) {}

  @Post('register')
  async register(@Body() body: unknown) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', ') || 'Invalid signup',
      );
    }
    const { name, email, password, organizationName } = parsed.data;

    let userId: string | undefined;
    try {
      const result = await auth.api.signUpEmail({
        body: { email: email.toLowerCase(), password, name },
      });
      userId = result.user?.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signup failed';
      if (/already|exist/i.test(message)) {
        throw new ConflictException(
          'An account with this email already exists. Sign in instead.',
        );
      }
      throw new BadRequestException(message);
    }

    if (!userId) {
      throw new BadRequestException('Signup did not return a user');
    }

    const org = await this.orgs.create(
      {
        id: userId,
        email: email.toLowerCase(),
        name,
        emailVerified: false,
      },
      { name: organizationName },
    );

    return {
      userId,
      organization: { id: org.id, name: org.name },
    };
  }
}
