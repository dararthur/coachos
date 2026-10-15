import { createClub, expect, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

test("actualités : l'équipe publie, modifie et supprime ; un membre lit sans pouvoir publier", async ({ browser }) => {
  const ownerCtx = await browser.newContext({ locale: "fr-FR", extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const owner = await ownerCtx.newPage();
  await signUp(owner, uniqueEmail("actus"), "Proprio Actus");
  const club = await createClub(owner, "Club Actus");

  // Vide : invitation à publier la première actualité.
  await owner.goto(`/a/${club}/news`);
  await expect(owner.getByText("Aucune actualité pour le moment")).toBeVisible();

  // Publication : retour sur la liste avec un bandeau de confirmation.
  await owner.getByRole("link", { name: "Nouvelle publication" }).click();
  await owner.getByLabel("Titre").fill("Stage de samedi");
  await owner.getByLabel("Texte").fill("Rendez-vous à 10 h au dojo.\nApportez votre gi.");
  await owner.getByRole("button", { name: "Publier" }).click();
  await expect(owner).toHaveURL(new RegExp(`/a/${club}/news\\?published=1`));
  await expect(owner.getByText("Publication en ligne")).toBeVisible();
  await expect(owner.getByRole("heading", { name: "Stage de samedi" })).toBeVisible();
  await expect(owner.getByText("Apportez votre gi.")).toBeVisible();

  // Un membre du club (inscrit par le code) lit la publication ; il n'a ni bouton de publication ni accès au formulaire.
  await owner.goto(`/a/${club}/settings#inscription`);
  const code = (await owner.getByTestId("join-code").innerText()).replace("-", "");
  const memberCtx = await browser.newContext({ locale: "fr-FR", extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const member = await memberCtx.newPage();
  await signUp(member, uniqueEmail("lecteur"), "Lecteur Actus");
  await member.goto("/join");
  await member.getByLabel("Code du club").fill(code);
  await member.getByRole("button", { name: "Rejoindre" }).click();
  await expect(member).toHaveURL(new RegExp(`/a/${club}/profile`));
  await member.goto(`/a/${club}/news`);
  await expect(member.getByRole("heading", { name: "Stage de samedi" })).toBeVisible();
  await expect(member.getByRole("link", { name: "Nouvelle publication" })).toHaveCount(0);
  await expect(member.getByRole("link", { name: /Modifier/ })).toHaveCount(0);
  await member.goto(`/a/${club}/news/new`);
  await expect(member).toHaveURL(new RegExp(`/a/${club}/forbidden`));

  // Modification puis suppression (avec confirmation) par le propriétaire.
  await owner.goto(`/a/${club}/news`);
  await owner.getByRole("link", { name: /Modifier/ }).click();
  await owner.getByLabel("Titre").fill("Stage de samedi (10 h)");
  await owner.getByRole("button", { name: "Enregistrer" }).click();
  await expect(owner.getByText("Publication modifiée")).toBeVisible();
  await expect(owner.getByRole("heading", { name: "Stage de samedi (10 h)" })).toBeVisible();

  await owner.getByRole("link", { name: /Modifier/ }).click();
  await owner.getByRole("button", { name: "Supprimer la publication" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(owner.getByText("Publication supprimée")).toBeVisible();
  await expect(owner.getByText("Aucune actualité pour le moment")).toBeVisible();
});
