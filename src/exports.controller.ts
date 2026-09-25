import { Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExportsService } from './exports.service';

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post()
  create(@Headers('x-demo-user') user?: string) {
    return this.exports.create(user || 'demo');
  }

  @Get(':id')
  status(@Param('id') id: string, @Headers('x-demo-user') user?: string) {
    return this.exports.status(id, user || 'demo');
  }

  @Get(':id/download')
  download(
    @Param('id') id: string,
    @Headers('x-demo-user') user: string | undefined,
    @Res() response: Response,
  ) {
    return this.exports.download(id, user || 'demo', response);
  }
}
