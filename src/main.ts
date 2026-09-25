import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Db } from './db';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { UiController } from './ui.controller';

@Module({
  controllers: [UiController, ImportsController, ExportsController],
  providers: [Db, ImportsService, ExportsService],
})
class AppModule {}

async function main() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  await app.listen(Number(process.env.PORT ?? 3000));
}
void main();
