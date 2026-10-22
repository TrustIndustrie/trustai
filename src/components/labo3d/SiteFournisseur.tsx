"use client";

import { RoundedBox } from "@react-three/drei";
import { Cartouche, PlaqueAuSol } from "./Etiquette";
import {
  COULEURS_MODE,
  LIBELLES_MODE,
  type Fournisseur,
} from "@/lib/labo3d/fournisseurs";

/**
 * LABORATOIRE 3D — un site fournisseur.
 *
 * Un hangar sobre, volontairement différent des dépôts Trust : bardage
 * nervuré, toit à deux pentes, pas de quais numérotés. Il ne doit pas être
 * confondu avec un site de la maison.
 *
 * LA COULEUR PORTE L'INFORMATION, et c'est la seule chose ici qui en porte :
 * le bandeau et la flèche disent le mode logistique — ambre quand c'est à
 * nous d'aller chercher, vert quand le fournisseur livre. La position, elle,
 * ne dit rien d'autre que le pays : la base n'a pas d'adresse.
 */
export function SiteFournisseur({
  fournisseur,
  position,
  survole,
  onSurvol,
  onClick,
}: {
  fournisseur: Fournisseur;
  position: [number, number, number];
  survole: boolean;
  onSurvol: (id: string | null) => void;
  onClick: (id: string) => void;
}) {
  const couleur = COULEURS_MODE[fournisseur.mode];
  // « On va chercher » : la marchandise descend vers nous, flèche vers le sud.
  // « Il nous livre » : c'est son camion qui vient, flèche aussi vers le sud —
  // ce qui change, c'est QUI roule, pas le sens. La couleur fait la différence.
  const largeur = 9;
  const profondeur = 6;

  return (
    <group
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); onSurvol(fournisseur.id); }}
      onPointerOut={() => onSurvol(null)}
      onClick={(e) => { e.stopPropagation(); onClick(fournisseur.id); }}
    >
      {/* Plateforme. */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[largeur + 3, 0.1, profondeur + 3]} />
        <meshStandardMaterial color="#c4c0b6" roughness={0.95} />
      </mesh>

      {/* Le hangar. */}
      <RoundedBox
        args={[largeur, 3.4, profondeur]}
        radius={0.12}
        smoothness={2}
        position={[0, 1.75, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={survole ? "#ffffff" : "#dcd8d0"}
          roughness={0.82}
          metalness={0.05}
        />
      </RoundedBox>

      {/* Bardage nervuré : six refends verticaux suffisent à faire lire
          « tôle » plutôt que « bloc lisse ». */}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={i}
          position={[-largeur / 2 + 0.9 + i * 1.5, 1.75, profondeur / 2 + 0.03]}
        >
          <boxGeometry args={[0.1, 3.2, 0.06]} />
          <meshStandardMaterial color="#c2bdb3" roughness={0.9} />
        </mesh>
      ))}

      {/* Toit à deux pentes, par deux plans inclinés. */}
      {[-1, 1].map((c) => (
        <mesh
          key={c}
          position={[0, 3.85, (c * profondeur) / 4]}
          rotation={[c * 0.3, 0, 0]}
          castShadow
        >
          <boxGeometry args={[largeur + 0.6, 0.16, profondeur / 2 + 0.6]} />
          <meshStandardMaterial color="#7d848c" roughness={0.88} />
        </mesh>
      ))}

      {/* Le bandeau du mode logistique. */}
      <mesh position={[0, 3.1, profondeur / 2 + 0.1]}>
        <boxGeometry args={[largeur - 0.6, 0.5, 0.12]} />
        <meshStandardMaterial
          color={couleur}
          roughness={0.5}
          emissive={couleur}
          emissiveIntensity={0.22}
        />
      </mesh>

      {/* Porte de chargement. */}
      <mesh position={[0, 1.1, profondeur / 2 + 0.09]}>
        <boxGeometry args={[2.6, 2.2, 0.14]} />
        <meshStandardMaterial color="#79808a" roughness={0.6} metalness={0.2} />
      </mesh>

      {/* La flèche de flux vers le dépôt, dans la couleur du mode. */}
      <group position={[0, 0.14, profondeur / 2 + 3.2]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.6, 3.4]} />
          <meshStandardMaterial color={couleur} roughness={0.9} transparent opacity={0.8} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} position={[0, 0, 1.9]}>
          <planeGeometry args={[1.1, 1.1]} />
          <meshStandardMaterial color={couleur} roughness={0.9} transparent opacity={0.8} />
        </mesh>
      </group>

      {/* LE NOM AU SOL, SUR LA PLATEFORME. Quatorze cartouches HTML suspendus
          au-dessus du plateau se chevauchaient et masquaient les dépôts :
          peints au sol, les noms tiennent dans l'emprise de leur site. */}
      <PlaqueAuSol
        position={[0, 0.17, profondeur / 2 + 1.1]}
        lignes={[{ texte: fournisseur.nom, taille: 32 }]}
        fond="rgba(15, 23, 42, 0.8)"
        cadre={`${couleur}99`}
        echelle={0.8}
      />

      {/* Le mode logistique et le délai : seulement quand on désigne le site. */}
      <Cartouche position={[0, 5.2, 0]} visible={survole} zIndex={15}>
        <div className="text-[11px] font-medium text-white">{fournisseur.nom}</div>
        <div className="text-[9px]" style={{ color: couleur }}>
          {LIBELLES_MODE[fournisseur.mode]}
          {fournisseur.delaiJours !== null ? ` · ${fournisseur.delaiJours} j` : ""}
        </div>
      </Cartouche>
    </group>
  );
}
