import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddonController } from './addon.controller';
import { AddonService } from './addon.service';
import { AddonPackage } from './addon-package.entity';
import { UserAddon } from './user-addon.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AddonPackage, UserAddon, PaymentOrder])],
  controllers: [AddonController],
  providers: [AddonService],
  exports: [AddonService],
})
export class AddonModule {}
