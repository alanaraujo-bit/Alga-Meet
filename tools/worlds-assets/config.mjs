// What goes into the pack. Every source listed here must be CC0; see README.md before adding one.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOL_DIR = dirname(fileURLToPath(import.meta.url))

export const PACK_VERSION = 1
export const OUT_DIR = resolve(TOOL_DIR, '../../apps/server/assets/worlds/v1')
/** Hard ceiling for the whole pack; the build fails above it. */
export const BUDGET_BYTES = 48 * 1024 * 1024

// ---- A. Furniture and decor (Poly Haven models, 1k glTF) ------------------------------------------------------

export const MODELS = [
  // seating
  'modern_arm_chair_01',
  'mid_century_lounge_chair',
  'Ottoman_01',
  'sofa_02',
  'dining_chair_02',
  'metal_stool_01',
  // tables and storage
  'modern_coffee_table_01',
  'coffee_table_round_01',
  'modern_wooden_cabinet',
  'side_table_01',
  'side_table_tall_01',
  'round_wooden_table_02',
  'wooden_table_02',
  'small_wooden_table_01',
  'steel_frame_shelves_01',
  'steel_frame_shelves_03',
  'wooden_display_shelves_01',
  // plants
  'potted_plant_01',
  'potted_plant_02',
  'potted_plant_04',
  // decor
  'ceramic_vase_01',
  'ceramic_vase_02',
  'ceramic_vase_03',
  'ceramic_vase_04',
  'decorative_book_set_01', // no glTF on Poly Haven (blend/fbx/usd only, shader-driven covers): the build reports it and skips it
  'book_encyclopedia_set_01',
  'standing_picture_frame_01',
  'standing_picture_frame_02',
  'hanging_picture_frame_01',
  'hanging_picture_frame_02',
  'marble_bust_01',
  'chess_set',
  'tea_set_01',
  'wall_clock',
  'bronze_whale_statue',
  'Ukulele_01',
  'wicker_basket_01',
  'boombox',
  'gaming_console',
  // lighting
  'modern_ceiling_lamp_01',
  'desk_lamp_arm_01',
  'industrial_pipe_lamp',
]

export const MODEL_OPTIONS = {
  /** Largest texture side for furniture. */
  textureSize: 1024,
  /** Largest texture side for anything whose biggest bounding-box dimension is below `smallMeters`. */
  smallTextureSize: 512,
  smallMeters: 0.6,
  /** Models above this many triangles are simplified (never plants or alpha-tested foliage). */
  simplifyAbove: 60_000,
  /** Simplifier target: never below this share of the original triangle count. */
  simplifyRatio: 0.6,
  /** Simplifier error limit, as a fraction of the mesh radius. */
  simplifyError: 0.001,
  /** Foliage keeps every triangle: simplification tears alpha-tested leaf cards apart. */
  neverSimplify: /^potted_plant_/,
}

/** WebP quality by what the texture holds. */
export const WEBP_QUALITY = { color: 85, data: 90, sky: 82 }

// ---- B. Tiling PBR sets (Poly Haven textures, 1k maps) --------------------------------------------------------
//
// `neutral` rewrites the colour map as luminance only, so a set whose scan happens to be a saturated colour can
// still be tinted by multiplying a colour over it. `neutral.level` (0..1, sRGB) also lifts the mean brightness
// to that value; without it the original brightness is kept. Normal and ARM maps are never altered.

export const TEXTURE_SIZE = 1024

export const TEXTURES = {
  floor_oak: { source: 'oak_wood_planks' },
  floor_walnut: { source: 'wood_floor' },
  floor_concrete: { source: 'painted_concrete_02' },
  floor_stone: { source: 'marble_01' },
  wall_plaster: { source: 'white_stucco' },
  wall_concrete: { source: 'concrete_wall_008', neutral: {} },
  wall_wood: { source: 'european_walnut_veneer_04' },
  fabric_boucle: { source: 'curly_teddy_natural' },
  fabric_linen: { source: 'rough_linen', neutral: { level: 0.8 } },
  fabric_velvet: { source: 'velour_velvet', neutral: { level: 0.8 } },
  leather_smooth: { source: 'leather_white' },
  rug_wool: { source: 'jogging_melange' },
  rug_jute: { source: 'hessian_380' },
}

// ---- C. Skies (Poly Haven HDRIs) ------------------------------------------------------------------------------

export const SKY_SIZE = [4096, 2048]

export const SKIES = {
  tarde: { source: 'autumn_hill_view' },
  hora_azul: { source: 'qwantani_dusk_2' },
  noite: { source: 'kloppenheim_02' },
}

// ---- D. Avatar (Quaternius Universal Animation Library 1 and 2) -----------------------------------------------

// The archives are pinned by SHA-256: a changed upload must be reviewed (and its licence re-read) before use.
export const QUATERNIUS = {
  ual1: {
    title: 'Universal Animation Library',
    page: 'https://opengameart.org/content/universal-animation-library',
    zip: 'https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip',
    sha256: '18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2',
    license: 'Animation Library[Standard]/License.txt',
    files: { library: 'Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb' },
  },
  ual2: {
    title: 'Universal Animation Library 2',
    page: 'https://opengameart.org/content/universal-animation-library-2',
    zip: 'https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip',
    sha256: 'ec0e40d6d78fe9aaad59e322f40865a8675c22f0745e291622e54520391a9217',
    license: 'Universal Animation Library 2 [Standard]/License.txt',
    files: {
      library: 'Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb',
      female: 'Universal Animation Library 2 [Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb',
    },
  },
}

/** Pack clip id -> where it comes from. `loop` in the manifest follows the original name ending in `_Loop`. */
export const CLIPS = {
  idle: ['ual1', 'Idle_Loop'],
  idle_talk: ['ual1', 'Idle_Talking_Loop'],
  walk: ['ual1', 'Walk_Loop'],
  walk_formal: ['ual1', 'Walk_Formal_Loop'],
  jog: ['ual1', 'Jog_Fwd_Loop'],
  sit_enter: ['ual1', 'Sitting_Enter'],
  sit_exit: ['ual1', 'Sitting_Exit'],
  sit_idle: ['ual1', 'Sitting_Idle_Loop'],
  sit_talk: ['ual1', 'Sitting_Talking_Loop'],
  dance: ['ual1', 'Dance_Loop'],
  interact: ['ual1', 'Interact'],
  pickup: ['ual1', 'PickUp_Table'],
  idle_fold: ['ual2', 'Idle_FoldArms_Loop'],
  idle_phone: ['ual2', 'Idle_TalkingPhone_Loop'],
  yes: ['ual2', 'Yes'],
  no: ['ual2', 'Idle_No_Loop'],
  drink: ['ual2', 'Consume'],
}

/** Only these bones keep their translation tracks; every other bone is driven by rotation alone. */
export const TRANSLATED_BONES = ['root', 'pelvis']
