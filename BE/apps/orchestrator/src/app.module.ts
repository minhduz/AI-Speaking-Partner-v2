import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HttpModule } from "@nestjs/axios";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { SessionModule } from "./session/session.module";
import { TurnModule } from "./turn/turn.module";
import { HistoryModule } from "./history/history.module";
import { ProgressModule } from "./progress/progress.module";
import { BillingProxyModule } from "./billing/billing-proxy.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule.register({ timeout: 30000 }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: "postgres",
        host: cfg.get("DB_HOST"),
        port: +cfg.get("DB_PORT"),
        username: cfg.get("DB_USER"),
        password: cfg.get("DB_PASS"),
        database: cfg.get("DB_NAME"),
        schema: cfg.get("DB_SCHEMA"),
        autoLoadEntities: true,
        synchronize: false,
        logging: cfg.get("NODE_ENV") === "development",
      }),
    }),

    AuthModule,
    UserModule,
    SessionModule,
    TurnModule,
    HistoryModule,
    ProgressModule,
    BillingProxyModule,
  ],
})
export class AppModule {}
