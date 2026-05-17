// turn.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TurnController } from './turn.controller';
import { TurnService } from './turn.service';
import { Turn } from './entities/turn.entity';
import { Session } from '../session/entities/session.entity';
import { UserModule } from '../user/user.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Turn, Session]),
    HttpModule,
    UserModule,
    forwardRef(() => SessionModule),
  ],
  controllers: [TurnController],
  providers: [TurnService],
  exports: [TurnService],
})
export class TurnModule {}
