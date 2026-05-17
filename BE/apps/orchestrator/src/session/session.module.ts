// session.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { Session } from './entities/session.entity';
import { Turn } from '../turn/entities/turn.entity';
import { UserModule } from '../user/user.module';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Turn]), HttpModule, UserModule],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
