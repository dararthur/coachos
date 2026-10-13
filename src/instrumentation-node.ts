/**
 * Validation de la configuration AU DÉMARRAGE (runtime Node.js uniquement ; appelée par src/instrumentation.ts).
 * Une configuration absente, incohérente ou interdite — par exemple MAIL_PROVIDER=outbox avec APP_ENV=production — arrête
 * le processus avec un code de sortie non nul : un superviseur (systemd) voit l'échec, aucun port ne reste ouvert.
 * (Sans `process.exit`, Next.js garde le processus vivant et répond 500 à tout : une instance « démarrée » mais cassée.)
 * Le message ne contient que des noms de variables et des raisons, jamais de valeur.
 */
export async function validateConfigOrExit() {
  try {
    const { env } = await import("@/server/env");
    env();
  } catch (error) {
    console.error(`[coachos] DÉMARRAGE REFUSÉ : ${error instanceof Error ? error.message : "configuration invalide"}`);
    process.exit(1);
  }
}
