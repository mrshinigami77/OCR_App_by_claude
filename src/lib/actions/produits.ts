"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/current-user";
import { produitSchema } from "@/lib/validations/produit";
import { withToast } from "@/lib/toastRedirect";
import { lireCouleur, nouvelleCouleur } from "@/lib/couleurs-serveur";

function parseFormData(formData: FormData) {
  return {
    reference: formData.get("reference"),
    designation: formData.get("designation"),
    description: formData.get("description"),
    type: formData.get("type"),
    categorie: formData.get("categorie"),
    prixUnitaireHT: formData.get("prixUnitaireHT"),
    uniteMesure: formData.get("uniteMesure") || "unite",
    tauxTva: formData.get("tauxTva"),
    stock: formData.get("stock"),
  };
}

export async function createProduit(formData: FormData) {
  await requireUser();
  const data = produitSchema.parse(parseFormData(formData));

  await prisma.$transaction(async (tx) => {
    const couleur = await nouvelleCouleur(tx, "produit", `${data.designation}${Date.now()}`);
    await tx.produit.create({
      data: {
        ...data,
        reference: data.reference || null,
        categorie: data.categorie || null,
        stock: data.stock ?? null,
        couleur,
      },
    });
  });

  revalidatePath("/produits");
  redirect(withToast("/produits", "Produit cree avec succes."));
}

export async function updateProduit(id: string, formData: FormData) {
  await requireUser();
  const data = produitSchema.parse(parseFormData(formData));

  await prisma.$transaction(async (tx) => {
    // Produit cree avant l'introduction des couleurs : on lui en attribue une maintenant.
    const couleur = (await lireCouleur(tx, "produit", id)) ?? (await nouvelleCouleur(tx, "produit", id));
    await tx.produit.update({
      where: { id },
      data: {
        ...data,
        reference: data.reference || null,
        categorie: data.categorie || null,
        stock: data.stock ?? null,
        couleur,
      },
    });
  });

  revalidatePath("/produits");
  revalidatePath(`/produits/${id}`);
  redirect(withToast("/produits", "Produit modifie avec succes."));
}

export async function deactivateProduit(id: string) {
  await requireUser();
  await prisma.produit.update({ where: { id }, data: { actif: false } });
  revalidatePath("/produits");
}

export async function activateProduit(id: string) {
  await requireUser();
  await prisma.produit.update({ where: { id }, data: { actif: true } });
  revalidatePath("/produits");
}
