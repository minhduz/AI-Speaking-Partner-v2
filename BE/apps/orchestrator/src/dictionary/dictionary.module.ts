import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DictionaryController } from './dictionary.controller';

@Module({
  imports: [HttpModule],
  controllers: [DictionaryController],
})
export class DictionaryModule {}
