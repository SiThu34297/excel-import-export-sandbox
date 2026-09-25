import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { HEADERS } from './import-core';
import { ImportsService } from './imports.service';

const XlsxUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('template')
  async template(@Res() res: Response) {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Item Bulk Import').addRow([...HEADERS]);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="ITEM_BULK_IMPORT.xlsx"',
    );
    await workbook.xlsx.write(res);
    res.end();
  }

  @Post('validate')
  @UseInterceptors(XlsxUpload)
  async validate(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-demo-user') user?: string,
  ) {
    if (!file) throw new BadRequestException('XLSX file is required');
    return this.imports.validateUpload(file.buffer, user || 'demo');
  }

  @Post('commit')
  @UseInterceptors(XlsxUpload)
  async commit(
    @UploadedFile() file: Express.Multer.File,
    @Body('validationToken') token: string,
    @Headers('x-demo-user') user?: string,
  ) {
    if (!file) throw new BadRequestException('XLSX file is required');
    return this.imports.commit(file.buffer, token || '', user || 'demo');
  }
}
