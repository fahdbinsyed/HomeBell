import type { OnModuleDestroy } from "@nestjs/common";
import type { Config } from "./config.js";
import { Database } from "./database.js";
import { Coordination } from "./coordination.js";
import { Auth } from "./auth.js";
import { Oidc } from "./oidc.js";
import { Records } from "./records.js";
import { Platform } from "./platform.js";
import { OtpPolicy } from "./otp.js";
import { ControlWork } from "./control-work.js";
import { Plans } from "./plans.js";
import { AccessManagement } from "./access-management.js";
import { ControlQueries } from "./control-queries.js";
export class Runtime implements OnModuleDestroy {
  readonly db: Database;
  readonly coordination: Coordination;
  readonly auth: Auth;
  readonly oidc: Oidc;
  readonly records: Records;
  readonly platform: Platform;
  readonly otp: OtpPolicy;
  readonly plans: Plans;
  readonly accessManagement: AccessManagement;
  readonly controlQueries: ControlQueries;
  readonly metrics = { requests: 0, errors: 0, totalDurationMs: 0 };
  constructor(readonly config: Config) {
    this.db = new Database(config);
    this.coordination = new Coordination(config);
    this.auth = new Auth(config, this.db);
    this.oidc = new Oidc(config, this.coordination, this.auth);
    this.records = new Records(this.db, config);
    this.platform = new Platform(this.db, config);
    this.otp = new OtpPolicy(this.db, this.coordination, config.OTP_PEPPER);
    const control = new ControlWork(this.db);
    this.plans = new Plans(control, config);
    this.accessManagement = new AccessManagement(control);
    this.controlQueries = new ControlQueries(control, config);
  }
  async connect() {
    await this.auth.ready();
    await this.coordination.connect();
    await this.oidc.connect();
  }
  async onModuleDestroy() {
    await this.coordination.close();
    await this.db.close();
  }
}
