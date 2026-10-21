"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html } from "@react-three/drei";
import { Color, Object3D } from "three";
import type { Group, InstancedMesh } from "three";
import { PLAN, PLAN_MAGASINS, ROUTE, positionSurRoute } from "./geometrie";
import type { CodeDepot } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — le décor animé.
 *
 * ⚠ TOUT CE FICHIER EST DÉCORATIF. Aucun chariot, aucun ouvrier, aucun arbre
 * ne porte la moindre information métier : ils ne sont pas cliquables et ne
 * figurent dans aucun panneau. Ils servent uniquement à ce que la scène
 * respire. Les objets porteurs d'information — caisses, camions, bâtiments —
 * sont les seuls à réagir au clic.
 */

const BITUME = "#6f7378";

// Réutilisés par les décors instanciés : un seul objet de travail, jamais
// alloué dans une boucle de rendu.
const pivot = new Object3D();
const teinte = new Color();

/** Le sol et la route d'affrètement. */
export function Sol() {
  const longueur = ROUTE.arrivee[2] - ROUTE.depart[2];
  const milieu = (ROUTE.arrivee[2] + ROUTE.depart[2]) / 2;
  // La chaussée déborde largement : les arrivages fournisseurs et les
  // tournées circulent au-delà des deux dépôts.
  const debord = 46;
  const bandes = Math.max(4, Math.floor((longueur + debord) / 4));

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[320, 320]} />
        <meshStandardMaterial color="#a9b49c" roughness={1} />
      </mesh>

      {/* La route : c'est elle qui raconte l'affrètement Argenteuil → La Penne. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, milieu]} receiveShadow>
        <planeGeometry args={[ROUTE.largeur + 3.6, longueur + debord]} />
        <meshStandardMaterial color={BITUME} roughness={0.95} />
      </mesh>
      {Array.from({ length: bandes }, (_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.03, ROUTE.depart[2] - debord / 2 + i * 4]}
        >
          <planeGeometry args={[0.22, 1.8]} />
          <meshStandardMaterial color="#d9d4c4" roughness={0.9} />
        </mesh>
      ))}

      {/* Bordures de trottoir le long de la chaussée : c'est ce détail qui
          fait lire « voirie » plutôt que « bande grise posée sur l'herbe ». */}
      {[-1, 1].map((c) => (
        <mesh
          key={c}
          position={[c * (ROUTE.largeur / 2 + 1.9), 0.09, milieu]}
          receiveShadow
        >
          <boxGeometry args={[0.45, 0.18, longueur + debord]} />
          <meshStandardMaterial color="#b9b4aa" roughness={1} />
        </mesh>
      ))}

      {/* Bretelles vers les magasins. */}
      {PLAN_MAGASINS.map((m) => (
        <mesh
          key={m.nom}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[m.position[0] / 2, 0.02, m.position[2]]}
          receiveShadow
        >
          <planeGeometry args={[Math.abs(m.position[0]) + 8, 3.2]} />
          <meshStandardMaterial color={BITUME} roughness={0.95} />
        </mesh>
      ))}

      {/* Parkings visiteurs, avec leurs places marquées. Un dépôt sans
          stationnement, c'est un dépôt où personne ne travaille. */}
      {(["argenteuil", "aubagne"] as CodeDepot[]).map((code) => {
        const p = PLAN[code];
        const x = p.largeur / 2 + 5.5;
        // Du côté OPPOSÉ aux quais : les bretelles des magasins passent de
        // l'autre bord, et deux revêtements qui se chevauchent se voient.
        const z = p.centre[2] - p.orientationQuais * 4;
        return (
          <group key={`parking-${code}`}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, z]} receiveShadow>
              <planeGeometry args={[7.5, 10]} />
              <meshStandardMaterial color="#7b7f84" roughness={0.95} />
            </mesh>
            {Array.from({ length: 5 }, (_, i) => (
              <mesh
                key={i}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[x, 0.03, z - 4 + i * 2]}
              >
                <planeGeometry args={[7, 0.13]} />
                <meshStandardMaterial color="#e6e1d2" roughness={0.9} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/** Un chariot élévateur qui fait la navette dans un dépôt. DÉCORATIF. */
export function Chariot({
  depot,
  decalage,
}: {
  depot: CodeDepot;
  decalage: number;
}) {
  const g = useRef<Group>(null);
  const p = PLAN[depot];

  useFrame((state) => {
    if (!g.current) return;
    const t = state.clock.elapsedTime * 0.45 + decalage;
    const course = (p.profondeur - 10) / 2;
    // Un aller-retour continu, avec demi-tour aux extrémités.
    const z = Math.sin(t) * course;
    g.current.position.set(p.centre[0] + Math.cos(decalage) * 5, 0, p.centre[2] + z);
    g.current.rotation.y = Math.cos(t) > 0 ? 0 : Math.PI;
  });

  return (
    <group ref={g}>
      <RoundedBox args={[0.9, 0.7, 1.4]} radius={0.1} smoothness={2} position={[0, 0.52, 0]} castShadow>
        <meshStandardMaterial color="#d8a435" roughness={0.6} metalness={0.15} />
      </RoundedBox>
      {/* Mât et fourches */}
      <mesh position={[0, 1.15, 0.72]} castShadow>
        <boxGeometry args={[0.72, 1.5, 0.1]} />
        <meshStandardMaterial color="#4a4f55" roughness={0.8} />
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.22, 1.0]}>
          <boxGeometry args={[0.1, 0.06, 0.62]} />
          <meshStandardMaterial color="#5c6066" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      {/* Arceau de protection */}
      <mesh position={[0, 1.42, -0.2]}>
        <boxGeometry args={[0.86, 0.06, 0.86]} />
        <meshStandardMaterial color="#4a4f55" roughness={0.8} />
      </mesh>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 1.05, -0.2]}>
          <boxGeometry args={[0.07, 0.8, 0.07]} />
          <meshStandardMaterial color="#4a4f55" roughness={0.8} />
        </mesh>
      ))}
      {[-0.42, 0.42].map((x) =>
        [-0.5, 0.5].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.18, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.12, 10]} />
            <meshStandardMaterial color="#2b2f34" roughness={0.95} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Un ouvrier qui marche. DÉCORATIF. */
export function Ouvrier({
  base,
  rayon,
  decalage,
}: {
  base: [number, number, number];
  rayon: number;
  decalage: number;
}) {
  const g = useRef<Group>(null);
  const jambeG = useRef<Group>(null);
  const jambeD = useRef<Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.6 + decalage;
    if (g.current) {
      g.current.position.set(
        base[0] + Math.cos(t) * rayon,
        0,
        base[2] + Math.sin(t) * rayon,
      );
      g.current.rotation.y = -t + Math.PI / 2;
    }
    // Un balancement de jambes suffit à faire lire « quelqu'un marche ».
    const pas = Math.sin(state.clock.elapsedTime * 5 + decalage) * 0.5;
    if (jambeG.current) jambeG.current.rotation.x = pas;
    if (jambeD.current) jambeD.current.rotation.x = -pas;
  });

  return (
    <group ref={g} scale={0.52}>
      {/* Gilet haute visibilité */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <capsuleGeometry args={[0.32, 0.6, 4, 10]} />
        <meshStandardMaterial color="#e0c23a" roughness={0.75} />
      </mesh>
      <mesh position={[0, 2.15, 0]} castShadow>
        <sphereGeometry args={[0.26, 14, 12]} />
        <meshStandardMaterial color="#d9b48f" roughness={0.9} />
      </mesh>
      {/* Casque */}
      <mesh position={[0, 2.3, 0]} castShadow>
        <sphereGeometry args={[0.28, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#d85b3a" roughness={0.6} />
      </mesh>
      <group ref={jambeG} position={[-0.16, 1.0, 0]}>
        <mesh position={[0, -0.45, 0]} castShadow>
          <capsuleGeometry args={[0.12, 0.6, 4, 8]} />
          <meshStandardMaterial color="#3d4a5c" roughness={0.9} />
        </mesh>
      </group>
      <group ref={jambeD} position={[0.16, 1.0, 0]}>
        <mesh position={[0, -0.45, 0]} castShadow>
          <capsuleGeometry args={[0.12, 0.6, 4, 8]} />
          <meshStandardMaterial color="#3d4a5c" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Un magasin Trust : un vrai commerce, pas un cube avec un bandeau.
 *
 * Ce qui fait lire « boutique » plutôt que « bâtiment » tient à quatre
 * choses, et aucune ne coûte cher : une VITRINE vitrée divisée par des
 * meneaux, un STORE BANNE rayé, une ENSEIGNE éclairée, et une LUEUR CHAUDE à
 * l'intérieur. La lueur est l'astuce la plus rentable : elle suggère qu'il y
 * a quelqu'un, et c'est elle qui sépare une maquette d'une scène vivante.
 *
 * Cliquable, contrairement au reste de ce fichier.
 */
export function Magasin({
  nom,
  position,
  couleur = "#d8562f",
  onClick,
}: {
  nom: string;
  position: [number, number, number];
  couleur?: string;
  onClick: (nom: string) => void;
}) {
  // Le store banne : des lames alternées, pas une texture.
  const lames = useMemo(
    () => Array.from({ length: 9 }, (_, i) => ({ x: -2.4 + i * 0.6, pair: i % 2 === 0 })),
    [],
  );

  return (
    <group
      position={position}
      onClick={(e) => { e.stopPropagation(); onClick(nom); }}
    >
      {/* Parvis et bordure de trottoir. */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[11, 0.1, 9]} />
        <meshStandardMaterial color="#cdc8bf" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.13, 4.45]} receiveShadow>
        <boxGeometry args={[11, 0.26, 0.4]} />
        <meshStandardMaterial color="#b4afa5" roughness={1} />
      </mesh>

      {/* Le corps du commerce. */}
      <RoundedBox args={[7, 3.6, 5.4]} radius={0.28} smoothness={3} position={[0, 1.9, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#f3efe7" roughness={0.72} />
      </RoundedBox>

      {/* LA VITRINE : un verre, puis des meneaux par-dessus. */}
      <mesh position={[0, 1.55, 2.73]}>
        <boxGeometry args={[5.8, 2.1, 0.1]} />
        <meshStandardMaterial
          color="#bcd8e6"
          roughness={0.08}
          metalness={0.55}
          emissive="#ffd9a0"
          emissiveIntensity={0.3}
          transparent
          opacity={0.72}
        />
      </mesh>
      {[-1.93, 0, 1.93].map((x) => (
        <mesh key={x} position={[x, 1.55, 2.79]}>
          <boxGeometry args={[0.1, 2.15, 0.06]} />
          <meshStandardMaterial color="#5a6068" roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 0.52, 2.79]}>
        <boxGeometry args={[5.9, 0.16, 0.08]} />
        <meshStandardMaterial color="#5a6068" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* La lueur intérieure : ce qu'on devine derrière la vitre. */}
      <mesh position={[0, 1.5, 2.3]}>
        <boxGeometry args={[5.4, 2, 0.1]} />
        <meshStandardMaterial color="#ffe3b8" emissive="#ffcf8a" emissiveIntensity={0.85} />
      </mesh>
      {/* Deux podiums de présentation, devinés en ombre chinoise. */}
      {[-1.5, 1.5].map((x) => (
        <group key={x} position={[x, 0, 1.7]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[1, 0.8, 0.8]} />
            <meshStandardMaterial color="#b9a88f" roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.1, 0]} castShadow>
            <boxGeometry args={[0.7, 0.5, 0.5]} />
            <meshStandardMaterial color="#8d7a62" roughness={0.85} />
          </mesh>
        </group>
      ))}

      {/* LE STORE BANNE, en lames alternées. */}
      <group position={[0, 2.95, 3.5]} rotation={[-0.32, 0, 0]}>
        {lames.map((l) => (
          <mesh key={l.x} position={[l.x, 0, 0]} castShadow>
            <boxGeometry args={[0.6, 0.06, 1.9]} />
            <meshStandardMaterial
              color={l.pair ? couleur : "#f6f1e8"}
              roughness={0.85}
            />
          </mesh>
        ))}
        {/* Le lambrequin, le petit volant qui pend au bout. */}
        <mesh position={[0, -0.16, 0.95]}>
          <boxGeometry args={[5.5, 0.3, 0.05]} />
          <meshStandardMaterial color={couleur} roughness={0.85} />
        </mesh>
      </group>
      {[-2.6, 2.6].map((x) => (
        <mesh key={x} position={[x, 2.6, 2.95]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.05, 0.05, 1.3, 6]} />
          <meshStandardMaterial color="#6a7079" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}

      {/* L'ENSEIGNE, éclairée, aux couleurs de la maison. */}
      <mesh position={[0, 3.35, 2.8]} castShadow>
        <boxGeometry args={[6.2, 0.62, 0.16]} />
        <meshStandardMaterial
          color={couleur}
          roughness={0.45}
          emissive={couleur}
          emissiveIntensity={0.35}
        />
      </mesh>

      {/* Deux jardinières de part et d'autre de l'entrée. */}
      {[-3.1, 3.1].map((x) => (
        <group key={x} position={[x, 0, 3.1]}>
          <mesh position={[0, 0.35, 0]} castShadow>
            <cylinderGeometry args={[0.42, 0.34, 0.6, 10]} />
            <meshStandardMaterial color="#9a8c78" roughness={1} />
          </mesh>
          <mesh position={[0, 0.9, 0]} castShadow>
            <sphereGeometry args={[0.46, 10, 8]} />
            <meshStandardMaterial color="#5d7a4f" roughness={0.95} />
          </mesh>
        </group>
      ))}

      {/* L'acrotère du toit. */}
      <mesh position={[0, 3.85, 0]} castShadow>
        <boxGeometry args={[7.4, 0.3, 5.8]} />
        <meshStandardMaterial color="#59606b" roughness={0.85} />
      </mesh>

      <Html position={[0, 5.4, 0]} center zIndexRange={[16, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap rounded border border-white/20 bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-white shadow">
          {nom}
        </div>
      </Html>
    </group>
  );
}

/**
 * La végétation, INSTANCIÉE. DÉCORATIF.
 *
 * Trente-deux arbres dessinés en deux appels au lieu de soixante-quatre : un
 * tronc, une frondaison, et une matrice par exemplaire. C'est ce qui permet
 * d'en planter davantage sans alourdir la scène — le décor était la première
 * source d'appels de dessin, il devient la moins chère.
 */
const ARBRES: [number, number][] = [
  [-42, -14], [-38, 4], [-44, 18], [42, -14], [38, 6], [44, 20],
  [-20, 0], [20, 0], [-30, -40], [30, -42], [-32, 44], [34, 46],
  [-14, 48], [14, -48], [48, 0], [-48, 34], [-52, -30], [52, -34],
  [-56, 8], [56, 12], [-24, -54], [26, -56], [-26, 56], [24, 58],
  [-62, -8], [62, -4], [-16, -62], [18, 62], [-46, -46], [46, -48],
  [-58, 46], [58, 44],
];

export function Vegetation() {
  const troncs = useRef<InstancedMesh>(null);
  const frondaisons = useRef<InstancedMesh>(null);

  useEffect(() => {
    const t = troncs.current;
    const f = frondaisons.current;
    if (!t || !f) return;
    ARBRES.forEach(([x, z], i) => {
      // Une variation déterministe : des arbres tous identiques trahissent la
      // scène aussi sûrement que des caisses toutes identiques.
      const e = 0.82 + ((i * 17) % 7) / 10;
      pivot.position.set(x, 0.8 * e, z);
      pivot.rotation.set(0, (i * 1.7) % Math.PI, 0);
      pivot.scale.set(e, e, e);
      pivot.updateMatrix();
      t.setMatrixAt(i, pivot.matrix);

      pivot.position.set(x, (1.6 + 0.6) * e + 0.1, z);
      pivot.scale.set(e, e * (0.85 + ((i * 11) % 5) / 20), e);
      pivot.updateMatrix();
      f.setMatrixAt(i, pivot.matrix);

      teinte.set(i % 3 === 0 ? "#688a57" : i % 3 === 1 ? "#5a7a4d" : "#74935f");
      f.setColorAt(i, teinte);
    });
    t.instanceMatrix.needsUpdate = true;
    f.instanceMatrix.needsUpdate = true;
    if (f.instanceColor) f.instanceColor.needsUpdate = true;
  }, []);

  return (
    <group>
      <instancedMesh ref={troncs} args={[undefined, undefined, ARBRES.length]} castShadow>
        <cylinderGeometry args={[0.18, 0.28, 1.6, 7]} />
        <meshStandardMaterial color="#6b5542" roughness={1} />
      </instancedMesh>
      <instancedMesh
        ref={frondaisons}
        args={[undefined, undefined, ARBRES.length]}
        castShadow
      >
        <sphereGeometry args={[1.2, 10, 8]} />
        <meshStandardMaterial roughness={0.95} />
      </instancedMesh>
    </group>
  );
}

/**
 * L'éclairage public, INSTANCIÉ. DÉCORATIF.
 *
 * Des lampadaires le long de la route : trois appels de dessin pour vingt-deux
 * mâts. Ils ne diffusent aucune lumière réelle — une lampe par lampadaire
 * coûterait une passe d'ombre chacune, pour un gain nul en plein jour.
 */
export function Eclairage() {
  const mats = useRef<InstancedMesh>(null);
  const bras = useRef<InstancedMesh>(null);
  const lampes = useRef<InstancedMesh>(null);

  const postes = useMemo(() => {
    const liste: { x: number; z: number; cote: number }[] = [];
    for (let i = 0; i < 8; i += 1) {
      const z = -58 + i * 16;
      liste.push({ x: -(ROUTE.largeur / 2 + 2.2), z, cote: 1 });
      liste.push({ x: ROUTE.largeur / 2 + 2.2, z, cote: -1 });
    }
    return liste;
  }, []);

  useEffect(() => {
    const m = mats.current, b = bras.current, l = lampes.current;
    if (!m || !b || !l) return;
    postes.forEach((p, i) => {
      pivot.rotation.set(0, 0, 0);
      pivot.scale.set(1, 1, 1);

      pivot.position.set(p.x, 3, p.z);
      pivot.updateMatrix();
      m.setMatrixAt(i, pivot.matrix);

      pivot.position.set(p.x - p.cote * 0.75, 5.95, p.z);
      pivot.updateMatrix();
      b.setMatrixAt(i, pivot.matrix);

      pivot.position.set(p.x - p.cote * 1.4, 5.8, p.z);
      pivot.updateMatrix();
      l.setMatrixAt(i, pivot.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    b.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
  }, [postes]);

  return (
    <group>
      {/* Sans `castShadow` : l'ombre d'un mât de dix centimètres de large est
          un trait noir qui parasite le sol sans rien apporter. */}
      <instancedMesh ref={mats} args={[undefined, undefined, postes.length]}>
        <cylinderGeometry args={[0.1, 0.14, 6, 6]} />
        <meshStandardMaterial color="#737a82" roughness={0.6} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={bras} args={[undefined, undefined, postes.length]}>
        <boxGeometry args={[1.6, 0.1, 0.1]} />
        <meshStandardMaterial color="#737a82" roughness={0.6} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={lampes} args={[undefined, undefined, postes.length]}>
        <boxGeometry args={[0.8, 0.14, 0.4]} />
        <meshStandardMaterial
          color="#e8e4d8"
          emissive="#fff3d0"
          emissiveIntensity={0.25}
          roughness={0.4}
        />
      </instancedMesh>
    </group>
  );
}

/** Un repère visible du flux : des jalons le long de la route. DÉCORATIF. */
export function Balisage() {
  return (
    <group>
      {[0.12, 0.38, 0.62, 0.88].map((t) => {
        const [x, , z] = positionSurRoute(t);
        return (
          <group key={t}>
            {[-1, 1].map((c) => (
              <mesh key={c} position={[x + c * (ROUTE.largeur / 2 + 0.5), 0.5, z]} castShadow>
                <cylinderGeometry args={[0.08, 0.08, 1, 6]} />
                <meshStandardMaterial color="#e8e4dc" roughness={0.8} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}
