import { Controller, Get, Res } from '@nestjs/common';
import { join } from 'node:path';
import type { Response } from 'express';

@Controller('ui')
export class UiController {
  @Get()
  page(@Res() response: Response) {
    response.sendFile(join(process.cwd(), 'public/index.html'));
  }
}
