"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html } from "@react-three/drei";
import type { Group } from "three";
import { PLAN, rectangleZone } from "./geometrie";
import type { Depot as DepotModele } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — un bâtiment logistique.
 *
 * Tout est construit en code, sans aucun modèle importé : une dalle, des
 * murs à arêtes adoucies, un bandeau vitré, des portes de quai en creux,
 * un auvent, et un toit SÉPARÉ qui se soulève pour découvrir l'intérieur.
 *
 * Les arêtes adoucies (`RoundedBox`) font l'essentiel de la différence entre
 * « des cubes » et « un bâtiment » : la lumière y accroche sur un filet, ce
 * qui donne du relief sans coûter un triangle de plus à l'affichage.
 */

const MUR = "#e8e4dc";
const MUR_SOMBRE = "#d8d2c6";
const TOIT = "#5d6672";
const DALLE = "#cfc9bd";
const VITRAGE = "#8fb4cc";
const PORTE = "#7d8794";

interface Props {
  modele: DepotModele;
  /** Toit levé : on voit l'intérieur. */
  ouvert: boolean;
  selectionne: boolean;
  onClickBatiment: () => void;
  onClickToit: () => void;
  occupation: number;
  anomalies: number;
}

export function Depot({
  modele,
  ouvert,
  selectionne,
  onClickBatiment,
  onClickToit,
  occupation,
  anomalies,
}: Props) {
  const p = PLAN[modele.code];
  const toitRef = useRef<Group>(null);
  const q = p.orientationQuais;

  // Le toit monte et s'efface en douceur. Une interpolation amortie à chaque
  // image donne un mouvement qui part vite et s'arrête doucement : c'est ce
  // qui sépare « fluide » de « mécanique ».
  useFrame((_, delta) => {
    if (!toitRef.current) return;
    const cible = ouvert ? p.hauteur + 6 : p.hauteur;
    const g = toitRef.current;
    g.position.y += (cible - g.position.y) * Math.min(1, delta * 4);
  });

  // Les quatre murs de la coque. Épaisseur 0,4 : assez pour accrocher la
  // lumière sur l'arête, assez peu pour ne pas rogner l'intérieur.
  const murs = useMemo(() => {
    const e = 0.4;
    const h = p.hauteur;
    return [
      {
        cle: "mur-nord",
        axe: "x" as const,
        taille: [p.largeur, h, e] as [number, number, number],
        position: [0, h / 2, -p.profondeur / 2] as [number, number, number],
      },
      {
        cle: "mur-sud",
        axe: "x" as const,
        taille: [p.largeur, h, e] as [number, number, number],
        position: [0, h / 2, p.profondeur / 2] as [number, number, number],
      },
      {
        cle: "mur-ouest",
        axe: "z" as const,
        taille: [e, h, p.profondeur] as [number, number, number],
        position: [-p.largeur / 2, h / 2, 0] as [number, number, number],
      },
      {
        cle: "mur-est",
        axe: "z" as const,
        taille: [e, h, p.profondeur] as [number, number, number],
        position: [p.largeur / 2, h / 2, 0] as [number, number, number],
      },
    ];
  }, [p.hauteur, p.largeur, p.profondeur]);

  // Les portes de quai, réparties sur la façade côté route.
  const quais = useMemo(() => {
    const nombre = modele.code === "argenteuil" ? 5 : 3;
    const pas = (p.largeur - 6) / Math.max(1, nombre - 1);
    return Array.from({ length: nombre }, (_, i) => ({
      x: -(p.largeur - 6) / 2 + i * pas,
      cle: `quai-${i}`,
    }));
  }, [modele.code, p.largeur]);

  return (
    <group position={p.centre}>
      {/* Dalle débordante : elle ancre le bâtiment au sol. */}
      <mesh receiveShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[p.largeur + 5, 0.1, p.profondeur + 5]} />
        <meshStandardMaterial color={DALLE} roughness={0.95} />
      </mesh>

      {/* Marquage au sol devant les quais. */}
      {quais.map((quai) => (
        <mesh
          key={`marquage-${quai.cle}`}
          position={[quai.x, 0.11, q * (p.profondeur / 2 + 1.8)]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[2.6, 3.2]} />
          <meshStandardMaterial color="#bdb5a6" roughness={1} />
        </mesh>
      ))}

      {/* Corps du bâtiment : QUATRE MURS, pas un volume plein.
          Un bloc plein paraît identique de l'extérieur mais ne révèle rien
          quand on lève le toit — c'est une coque qu'il faut. */}
      <group onClick={(e) => { e.stopPropagation(); onClickBatiment(); }}>
        {murs.map((m) => (
          <RoundedBox
            key={m.cle}
            args={m.taille}
            radius={0.2}
            smoothness={2}
            position={m.position}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={selectionne ? "#f4f1ea" : MUR}
              roughness={0.78}
              metalness={0.04}
              // Toit levé : les murs deviennent translucides, sinon celui
              // qui est devant la caméra masque tout l'intérieur.
              transparent={ouvert}
              opacity={ouvert ? 0.22 : 1}
            />
          </RoundedBox>
        ))}

        {/* Soubassement plus sombre : un bâtiment n'est jamais d'une seule
            teinte. Il suit les QUATRE murs et ne traverse pas le bâtiment :
            un seul bloc plein ici remplissait tout le rez-de-chaussée et
            masquait la marchandise une fois le toit levé. */}
        {murs.map((m) => (
          <mesh
            key={`soubassement-${m.cle}`}
            position={[m.position[0], 0.85, m.position[2]]}
            castShadow
          >
            <boxGeometry
              args={
                m.axe === "x"
                  ? [p.largeur + 0.12, 1.7, 0.56]
                  : [0.56, 1.7, p.profondeur + 0.12]
              }
            />
            <meshStandardMaterial
              color={MUR_SOMBRE}
              roughness={0.9}
              transparent={ouvert}
              opacity={ouvert ? 0.3 : 1}
            />
          </mesh>
        ))}

        {/* Bandeau vitré en haut de façade, des deux côtés. */}
        {[1, -1].map((cote) => (
          <mesh
            key={`vitrage-${cote}`}
            position={[0, p.hauteur - 1.5, cote * (p.profondeur / 2 + 0.08)]}
          >
            <boxGeometry args={[p.largeur - 3, 1.1, 0.12]} />
            <meshStandardMaterial
              color={VITRAGE}
              roughness={0.18}
              metalness={0.35}
              emissive={VITRAGE}
              emissiveIntensity={0.14}
              transparent
              opacity={ouvert ? 0.25 : 1}
            />
          </mesh>
        ))}
      </group>

      {/* Portes de quai, en léger retrait, avec leur auvent. */}
      {quais.map((quai) => (
        <group key={quai.cle} position={[quai.x, 0, q * (p.profondeur / 2 + 0.05)]}>
          <mesh position={[0, 1.7, 0]}>
            <boxGeometry args={[2.3, 3.4, 0.22]} />
            <meshStandardMaterial color={PORTE} roughness={0.6} metalness={0.2} />
          </mesh>
          <mesh position={[0, 3.6, q * 0.7]} castShadow>
            <boxGeometry args={[2.9, 0.18, 1.5]} />
            <meshStandardMaterial color={TOIT} roughness={0.8} />
          </mesh>
          {/* Butoirs de quai. */}
          {[-1, 1].map((c) => (
            <mesh key={c} position={[c * 1.25, 0.55, q * 0.25]}>
              <boxGeometry args={[0.28, 1.1, 0.3]} />
              <meshStandardMaterial color="#3f444b" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Le toit : objet séparé, c'est lui qui se soulève. */}
      <group ref={toitRef} position={[0, p.hauteur, 0]}>
        <mesh
          // Toit levé : il cesse de projeter son ombre, sinon il plonge dans
          // le noir l'intérieur qu'on vient précisément de découvrir.
          castShadow={!ouvert}
          onClick={(e) => { e.stopPropagation(); onClickToit(); }}
          position={[0, 0.2, 0]}
        >
          <boxGeometry args={[p.largeur + 1.2, 0.4, p.profondeur + 1.2]} />
          <meshStandardMaterial
            color={TOIT}
            roughness={0.85}
            transparent
            opacity={ouvert ? 0.12 : 1}
          />
        </mesh>
        {/* Lanterneaux : le détail qui fait lire « entrepôt ». */}
        {[-1, 0, 1].map((i) => (
          <mesh key={i} position={[i * (p.largeur / 3.4), 0.65, 0]} castShadow={!ouvert}>
            <boxGeometry args={[p.largeur / 5, 0.5, p.profondeur - 4]} />
            <meshStandardMaterial
              color={VITRAGE}
              roughness={0.25}
              transparent
              opacity={ouvert ? 0.25 : 0.85}
            />
          </mesh>
        ))}
      </group>

      {/* Sol intérieur, visible une fois le toit levé. */}
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[p.largeur - 0.4, p.profondeur - 0.4]} />
        <meshStandardMaterial color="#bfb9ad" roughness={1} />
      </mesh>

      {/* Délimitation des zones au sol : lisible seulement toit ouvert. */}
      {ouvert &&
        (["reception", "stockage", "preparation", "expedition"] as const).map((zone) => {
          const r = rectangleZone(modele.code, zone);
          return (
            <mesh
              key={zone}
              position={[r.x, 0.14, r.z]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[r.largeur, r.profondeur]} />
              <meshStandardMaterial
                color={zone === "stockage" ? "#aca596" : "#b8b1a2"}
                roughness={1}
                transparent
                opacity={0.65}
              />
            </mesh>
          );
        })}

      {/* Enseigne du dépôt : du HTML, donc net à tout niveau de zoom. */}
      <Html
        position={[0, p.hauteur + (ouvert ? 8.5 : 4.6), 0]}
        center
        zIndexRange={[20, 0]}
      >
        <div className="pointer-events-none select-none whitespace-nowrap rounded-md border border-white/20 bg-slate-900/85 px-3 py-1.5 text-center shadow-lg backdrop-blur-sm">
          <div className="text-[13px] font-semibold leading-tight text-white">
            {modele.nom}
          </div>
          <div className="text-[11px] leading-tight text-slate-300">
            {Math.round(occupation * 100)} % occupé
            {anomalies > 0 ? ` · ${anomalies} anomalie(s)` : ""}
          </div>
        </div>
      </Html>
    </group>
  );
}
