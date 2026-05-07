import { Module } from '@nestjs/common';
import { CompletionController } from './completion.controller';
import { CompletionService } from './completion.service';

@Module({
  controllers: [CompletionController],
  providers: [CompletionService],
})
export class CompletionModule {}
