import { config } from "./config.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

const app = createServer();

app.listen(config.port, () => {
  logger.info(`BugFarm POC listening on port ${config.port}`);
});
