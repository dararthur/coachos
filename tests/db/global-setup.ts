import { startEmbeddedDb } from "../support/embedded-db.mjs";

// Un PostgreSQL embarqué par exécution ; les URLs sont transmises aux tests via l'environnement.
export default async function setup() {
  const db = await startEmbeddedDb();
  process.env.TEST_ADMIN_DATABASE_URL = db.adminUrl;
  process.env.TEST_APP_DATABASE_URL = db.appUrl;
  return async () => {
    await db.stop();
  };
}
