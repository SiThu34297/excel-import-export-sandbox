import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://sandbox:sandbox@localhost:5433/sandbox',
    max: 5,
  });
  async onModuleDestroy() {
    await this.pool.end();
  }
}
