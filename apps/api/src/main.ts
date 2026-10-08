import { createApplication } from "./app.js";
import { readConfig } from "./config.js";
import { logger } from "./common.js";
const config = readConfig();
const { app } = await createApplication(config);
await app.listen(config.PORT, config.HOST);
logger.info(
  { event: "server.started", port: config.PORT, environment: config.NODE_ENV },
  "HomeBell API ready",
);
