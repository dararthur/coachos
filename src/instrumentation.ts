/**
 * Next.js appelle `register` une fois au démarrage du serveur, avant d'accepter la moindre requête.
 * La validation de la configuration (qui peut arrêter le processus) vit dans instrumentation-node.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` ne dispose pas (et ne doit pas disposer) de la configuration d'exécution : elle est vérifiée au démarrage.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { validateConfigOrExit } = await import("./instrumentation-node");
  await validateConfigOrExit();
}
