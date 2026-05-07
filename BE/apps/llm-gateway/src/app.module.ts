import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompletionModule } from './completion/completion.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CompletionModule,
  ],
})
export class AppModule {}
