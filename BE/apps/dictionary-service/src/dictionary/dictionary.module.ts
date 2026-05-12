import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { DictionaryCache } from './entities/dictionary-cache.entity';
import { DictionaryHistory } from './entities/dictionary-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DictionaryCache, DictionaryHistory]),
    HttpModule,
  ],
  controllers: [DictionaryController],
  providers: [DictionaryService],
})
export class DictionaryModule {}
