"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { CanvasTexture, Group, SRGBColorSpace, Vector3 } from "three";

/**
 * LES ÉTIQUETTES DE LA SCÈNE — au sol en permanence, en cartouche au clic.
 *
 * LE PROBLÈME QU'ON CORRIGE ICI. Une étiquette HTML (`<Html>` de drei) garde
 * une TAILLE FIXE À L'ÉCRAN : elle ne rétrécit pas quand on dézoome, et elle
 * flotte toujours devant la scène, quoi qu'il y ait derrière. Sur une vue
 * d'ensemble qui compte deux dépôts, trois magasins et quatorze fournisseurs,
 * cela fait dix-neuf panneaux opaques suspendus au-dessus du plateau : on ne
 * voit plus les bâtiments qu'ils désignent.
 *
 * LA RÉPONSE. Le nom descend AU SOL, dessiné comme une plaque peinte sur le
 * bitume : c'est de la géométrie, donc elle suit le zoom, prend la
 * perspective, et ne masque jamais rien puisqu'elle est posée à plat. Le
 * DÉTAIL — taux d'occupation, anomalies, mode logistique — ne s'affiche
 * qu'au survol ou à la sélection, là où l'œil le demande.
 *
 * Le texte est peint dans un canvas 2D, pas rendu par une police 3D : aucune
 * police à télécharger, aucun réseau, et le rendu reste net parce que la
 * texture est dessinée à 26 pixels par unité de scène.
 */

/** Pixels de texture par unité de scène. */
const PIXELS_PAR_UNITE = 26;

const POLICE =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export interface LigneEtiquette {
  texte: string;
  /** Hauteur de police, en pixels de texture. */
  taille?: number;
  couleur?: string;
  graisse?: number;
  /** Interlettrage, pour les surtitres en petites capitales. */
  espacement?: number;
}

export interface OptionsEtiquette {
  fond?: string;
  cadre?: string;
  /** Force les dimensions du canvas plutôt que de les déduire du texte. */
  largeurPx?: number;
  hauteurPx?: number;
  /** Alignement vertical du bloc de texte dans le canvas. */
  marge?: number;
}

/**
 * Peint les lignes dans un canvas et renvoie la texture, avec ses dimensions.
 *
 * Exportée parce que le panneau de distance, lui, a un caisson aux dimensions
 * déjà fixées : il lui faut la texture sans la géométrie qui va avec.
 */
export function textureEtiquette(
  lignes: LigneEtiquette[],
  options: OptionsEtiquette = {},
): { texture: CanvasTexture; largeurPx: number; hauteurPx: number } | null {
  // Rendu côté serveur : pas de canvas. On ne dessine rien plutôt que de
  // faire tomber la page entière.
  if (typeof document === "undefined") return null;

  const marge = options.marge ?? 26;
  const interligne = 6;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const mesures = lignes.map((l) => {
    const taille = l.taille ?? 40;
    ctx.font = `${l.graisse ?? 600} ${taille}px ${POLICE}`;
    const espacement = l.espacement ?? 0;
    return {
      ...l,
      taille,
      largeur: ctx.measureText(l.texte).width + espacement * l.texte.length,
    };
  });

  const largeurTexte = Math.max(...mesures.map((m) => m.largeur));
  const hauteurTexte =
    mesures.reduce((s, m) => s + m.taille, 0) + interligne * (mesures.length - 1);

  const largeurPx = options.largeurPx ?? Math.ceil(largeurTexte + marge * 2);
  const hauteurPx = options.hauteurPx ?? Math.ceil(hauteurTexte + marge * 1.5);

  // Redimensionner efface le contexte : on ne dessine qu'après.
  canvas.width = largeurPx;
  canvas.height = hauteurPx;

  const rayon = Math.min(14, hauteurPx / 4);
  ctx.beginPath();
  ctx.moveTo(rayon, 0);
  ctx.lineTo(largeurPx - rayon, 0);
  ctx.quadraticCurveTo(largeurPx, 0, largeurPx, rayon);
  ctx.lineTo(largeurPx, hauteurPx - rayon);
  ctx.quadraticCurveTo(largeurPx, hauteurPx, largeurPx - rayon, hauteurPx);
  ctx.lineTo(rayon, hauteurPx);
  ctx.quadraticCurveTo(0, hauteurPx, 0, hauteurPx - rayon);
  ctx.lineTo(0, rayon);
  ctx.quadraticCurveTo(0, 0, rayon, 0);
  ctx.closePath();
  ctx.fillStyle = options.fond ?? "rgba(15, 23, 42, 0.88)";
  ctx.fill();
  if (options.cadre) {
    ctx.strokeStyle = options.cadre;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  let y = (hauteurPx - hauteurTexte) / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const m of mesures) {
    ctx.font = `${m.graisse ?? 600} ${m.taille}px ${POLICE}`;
    ctx.fillStyle = m.couleur ?? "#ffffff";
    if (m.espacement) {
      // Le canvas 2D n'a pas d'interlettrage portable : on place les lettres
      // une à une. Seuls les surtitres en capitales en ont besoin.
      const lettres = Array.from(m.texte);
      const total =
        lettres.reduce((s, c) => s + ctx.measureText(c).width, 0) +
        m.espacement * (lettres.length - 1);
      let x = (largeurPx - total) / 2;
      ctx.textAlign = "left";
      for (const c of lettres) {
        ctx.fillText(c, x, y);
        x += ctx.measureText(c).width + m.espacement;
      }
      ctx.textAlign = "center";
    } else {
      ctx.fillText(m.texte, largeurPx / 2, y);
    }
    y += m.taille + interligne;
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, largeurPx, hauteurPx };
}

/**
 * LE NOM POSÉ AU SOL. C'est l'étiquette par défaut de la scène.
 *
 * La plaque PIVOTE AVEC LA CAMÉRA, à plat. Posée dans une orientation fixe,
 * elle se lisait de travers dès qu'on tournait autour du plateau — et à
 * l'envers une fois passé de l'autre côté. Elle tourne donc sur elle-même pour
 * présenter son texte au regard, sans jamais se relever : elle reste au sol,
 * et ne masque donc rien.
 */
export function PlaqueAuSol({
  position,
  lignes,
  fond,
  cadre,
  echelle = 1,
}: {
  position: [number, number, number];
  lignes: LigneEtiquette[];
  fond?: string;
  cadre?: string;
  echelle?: number;
}) {
  // Les lignes sont recréées à chaque rendu par les appelants : on mémorise
  // sur leur CONTENU, sinon on repeindrait un canvas soixante fois par
  // seconde dès qu'une image bouge dans la scène.
  const cle = JSON.stringify(lignes) + (fond ?? "") + (cadre ?? "");
  const peint = useMemo(
    () => textureEtiquette(lignes, { fond, cadre }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cle],
  );

  useEffect(() => {
    const t = peint?.texture;
    return () => t?.dispose();
  }, [peint]);

  const pivot = useRef<Group>(null);
  const ici = useRef(new Vector3());

  useFrame(({ camera }) => {
    const g = pivot.current;
    if (!g) return;
    g.getWorldPosition(ici.current);
    // Une feuille posée au sol se lit quand son BORD HAUT est du côté
    // opposé au lecteur : on oriente donc le haut du texte à l'écart de la
    // caméra, et non vers elle — l'inverse donnait un texte en miroir.
    const dx = camera.position.x - ici.current.x;
    const dz = camera.position.z - ici.current.z;
    g.rotation.y = Math.atan2(dx, dz);
  });

  if (!peint) return null;

  const largeur = (peint.largeurPx / PIXELS_PAR_UNITE) * echelle;
  const profondeur = (peint.hauteurPx / PIXELS_PAR_UNITE) * echelle;

  return (
    <group ref={pivot} position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[largeur, profondeur]} />
        <meshBasicMaterial
          map={peint.texture}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * LE DÉTAIL, AU SURVOL OU À LA SÉLECTION.
 *
 * Le même cartouche HTML qu'avant — net, lisible, cliquable — mais il
 * n'apparaît que lorsqu'on désigne l'objet. Vingt cartouches permanents
 * cachaient la scène ; un seul, demandé, la renseigne.
 */
export function Cartouche({
  position,
  visible,
  zIndex = 20,
  children,
}: {
  position: [number, number, number];
  visible: boolean;
  zIndex?: number;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <Html position={position} center zIndexRange={[zIndex, 0]}>
      <div className="pointer-events-none select-none whitespace-nowrap rounded-md border border-white/20 bg-slate-900/90 px-3 py-1.5 text-center shadow-lg backdrop-blur-sm">
        {children}
      </div>
    </Html>
  );
}
