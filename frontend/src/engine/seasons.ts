// 天の川の四季。日本（北半球中緯度）の夜空で季節ごとに見える天の川の特徴を、描画パラメータに落とし込む。
//  春：天の川は地平線近くに沈み淡い。春霞で全体がぼんやり霞み、銀河系の外（おとめ座銀河団など）の銀河が多く見える。
//  夏：銀河系の中心方向（いて座）。一年で最も太く明るく、黄金色の核の輝きを暗黒星雲の裂け目（グレートリフト）が割る。赤い散光星雲も多い。
//  秋：天頂を横切るが夏より細く控えめ。空気が澄んで星は鋭く青白い。天の川から離れた暗い空にアンドロメダ銀河が浮かぶ。
//  冬：銀河系の外側（反中心方向）なので川自体は淡いが、一等星がひしめき（冬のダイヤモンド）、冷たい空気で強くまたたく。

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const SEASON_LABEL: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

export const SEASON_DESCRIPTION: Record<Season, string> = {
  spring: '春霞にかすむ淡い天の川。遠い銀河が漂う',
  summer: '銀河の中心へ。暗黒の裂け目が走る最も濃い流れ',
  autumn: '澄んだ空を細く横切る流れ。アンドロメダが浮かぶ',
  winter: '淡い流れに一等星がきらめく冬のダイヤモンド',
};

// 実際の日付から季節を決める（3〜5月:春 / 6〜8月:夏 / 9〜11月:秋 / 12〜2月:冬）
export function seasonOf(date: Date): Season {
  const m = date.getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

export type RGB = [number, number, number];

// 季節の切り替え時に補間できるよう、数値とRGB（パレットは長さ4で固定）だけで構成する
export interface SeasonLook {
  background: RGB;
  // 川の太さの倍率（見た目のみ。移動範囲や釣り場の判定には影響させない）
  widthScale: number;
  // 川の星の数の倍率
  starDensity: number;
  starColors: [RGB, RGB, RGB, RGB];
  // またたきの強さ（0〜1）
  twinkle: number;
  nebulaAlpha: number;
  nebulaColors: [RGB, RGB, RGB, RGB];
  // 川の中心線に沿った帯状の輝き（夏の銀河中心のバルジ、春の霞んだ光など）
  bandGlow: RGB;
  bandAlpha: number;
  // 暗黒星雲の裂け目の濃さ
  riftStrength: number;
  // 一等星（光条つき）の出現率
  brightStarRate: number;
  brightStarColors: [RGB, RGB, RGB, RGB];
  // 天の川から離れた暗い空に浮かぶ系外銀河の出現率
  galaxyRate: number;
  // 画面全体にかかる霞
  hazeColor: RGB;
  hazeAlpha: number;
  dustColor: RGB;
  // UIのアクセント色
  accent: RGB;
}

export const SEASON_LOOKS: Record<Season, SeasonLook> = {
  spring: {
    background: [14, 10, 24],
    widthScale: 0.8,
    starDensity: 0.55,
    starColors: [[255, 240, 246], [255, 214, 228], [236, 226, 255], [255, 255, 255]],
    twinkle: 0.18,
    nebulaAlpha: 0.8,
    nebulaColors: [[255, 170, 205], [214, 170, 255], [255, 205, 225], [190, 180, 255]],
    bandGlow: [255, 196, 222],
    bandAlpha: 0.12,
    riftStrength: 0.08,
    brightStarRate: 0.25,
    brightStarColors: [[255, 190, 140], [200, 220, 255], [255, 240, 230], [255, 210, 170]],
    galaxyRate: 0.55,
    hazeColor: [255, 190, 220],
    hazeAlpha: 0.13,
    dustColor: [255, 200, 225],
    accent: [255, 176, 212],
  },
  summer: {
    background: [8, 6, 16],
    widthScale: 1.25,
    starDensity: 1.35,
    starColors: [[255, 236, 200], [255, 214, 160], [255, 255, 240], [230, 235, 255]],
    twinkle: 0.3,
    nebulaAlpha: 0.8,
    nebulaColors: [[255, 120, 100], [255, 200, 140], [140, 150, 255], [255, 225, 170]],
    bandGlow: [255, 205, 140],
    bandAlpha: 0.17,
    riftStrength: 1,
    brightStarRate: 0.35,
    brightStarColors: [[235, 240, 255], [255, 255, 255], [255, 150, 110], [220, 230, 255]],
    galaxyRate: 0,
    hazeColor: [60, 30, 10],
    hazeAlpha: 0,
    dustColor: [255, 214, 150],
    accent: [255, 196, 110],
  },
  autumn: {
    background: [4, 7, 18],
    widthScale: 0.9,
    starDensity: 0.8,
    starColors: [[220, 234, 255], [200, 220, 255], [255, 255, 255], [255, 236, 200]],
    twinkle: 0.32,
    nebulaAlpha: 0.55,
    nebulaColors: [[120, 150, 255], [120, 220, 255], [170, 150, 255], [255, 200, 140]],
    bandGlow: [170, 190, 255],
    bandAlpha: 0.07,
    riftStrength: 0.35,
    brightStarRate: 0.12,
    brightStarColors: [[255, 255, 255], [210, 225, 255], [255, 220, 170], [230, 235, 255]],
    galaxyRate: 0.25,
    hazeColor: [0, 0, 0],
    hazeAlpha: 0,
    dustColor: [210, 225, 255],
    accent: [150, 196, 255],
  },
  winter: {
    background: [3, 6, 16],
    widthScale: 0.75,
    starDensity: 0.6,
    starColors: [[210, 228, 255], [255, 255, 255], [190, 210, 255], [240, 245, 255]],
    twinkle: 0.65,
    nebulaAlpha: 0.45,
    nebulaColors: [[255, 110, 140], [140, 170, 255], [180, 210, 255], [120, 140, 255]],
    bandGlow: [180, 205, 255],
    bandAlpha: 0.05,
    riftStrength: 0.15,
    brightStarRate: 1,
    brightStarColors: [[190, 215, 255], [255, 255, 255], [255, 170, 120], [255, 240, 190]],
    galaxyRate: 0,
    hazeColor: [0, 0, 0],
    hazeAlpha: 0,
    dustColor: [225, 240, 255],
    accent: [180, 225, 255],
  },
};

export function cloneLook(look: SeasonLook): SeasonLook {
  return structuredClone(look);
}

function lerpRGBInto(out: RGB, to: RGB, k: number) {
  out[0] += (to[0] - out[0]) * k;
  out[1] += (to[1] - out[1]) * k;
  out[2] += (to[2] - out[2]) * k;
}

// 毎フレーム目標の季節へ少しずつ寄せる（アロケーションを避けるため out を直接書き換える）
export function blendLookInto(out: SeasonLook, to: SeasonLook, k: number) {
  for (const key of Object.keys(to) as (keyof SeasonLook)[]) {
    const target = to[key];
    if (typeof target === 'number') {
      (out[key] as number) += (target - (out[key] as number)) * k;
    } else if (typeof target[0] === 'number') {
      lerpRGBInto(out[key] as RGB, target as RGB, k);
    } else {
      const palette = out[key] as RGB[];
      (target as RGB[]).forEach((c, i) => lerpRGBInto(palette[i], c, k));
    }
  }
}

export function rgba(c: RGB, alpha: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
}
