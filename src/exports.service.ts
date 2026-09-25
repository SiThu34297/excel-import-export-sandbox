import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import Redis from 'ioredis';
import { Db } from './db';
import { writeItemsWorkbook } from './export-workbook';

const ttlSeconds = 24 * 60 * 60;
const key = (id: string) => `excel-sandbox-export:${id}`;

type ExportRecord = {
  jobId: string;
  owner: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED';
  progress: { processedRows: number };
  result: { totalRows: number } | null;
  error: string | null;
};

@Injectable()
export class ExportsService implements OnModuleDestroy {
  private readonly redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6380),
    db: Number(process.env.REDIS_DB ?? 0),
    maxRetriesPerRequest: 1,
  });

  constructor(private readonly db: Db) {
    this.redis.on('error', (error) =>
      console.error('Export Redis error', error),
    );
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async create(owner: string) {
    const jobId = randomUUID();
    const record: ExportRecord = {
      jobId,
      owner,
      status: 'PENDING',
      progress: { processedRows: 0 },
      result: null,
      error: null,
    };
    await this.save(record);
    return { jobId, status: record.status };
  }

  private async save(record: ExportRecord) {
    await this.redis.set(
      key(record.jobId),
      JSON.stringify(record),
      'EX',
      ttlSeconds,
    );
  }

  private async getOwned(id: string, owner: string): Promise<ExportRecord> {
    const value = await this.redis.get(key(id));
    const record = value ? (JSON.parse(value) as ExportRecord) : null;
    if (!record || record.owner !== owner)
      throw new NotFoundException('Export not found');
    return record;
  }

  async status(id: string, owner: string) {
    const { owner: _owner, ...record } = await this.getOwned(id, owner);
    return record;
  }

  async download(id: string, owner: string, response: Response) {
    const record = await this.getOwned(id, owner);
    if (record.status !== 'PENDING')
      throw new ConflictException('Export already started; create a new job');
    const started = await this.redis.set(
      `${key(id)}:started`,
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    if (started !== 'OK')
      throw new ConflictException('Export already started; create a new job');

    record.status = 'ACTIVE';
    await this.save(record);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="ITEMS.xlsx"',
    );
    try {
      const totalRows = await writeItemsWorkbook(
        this.db,
        response,
        async (processedRows) => {
          record.progress = { processedRows };
          await this.save(record);
        },
      );
      record.status = 'COMPLETED';
      record.result = { totalRows };
      await this.save(record);
    } catch (error) {
      record.status = 'FAILED';
      record.error = (error as Error).message;
      await this.save(record);
      if (response.headersSent) response.destroy(error as Error);
      else throw error;
    }
  }
}
