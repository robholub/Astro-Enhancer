export interface AstroPreset {
  id: string;
  name: string;
  description: string;
  isCustom?: boolean;
  params: AstroParams;
}

export interface AstroParams {
  stretch: number;        // 0.0 to 1.0 (Asinh midtone stretch)
  blackPoint: number;     // 0.0 to 0.35 (Sky background floor)
  bgExtract: number;      // 0.0 to 1.0 (Dynamic Background Extraction strength)
  scnrGreen: number;      // 0.0 to 1.0 (Subtractive green cast removal)
  waveletFine: number;    // 0.0 to 1.5 (Fine 1px wavelet detail)
  waveletMed: number;     // 0.0 to 1.5 (Medium 2.5px structure contrast)
  denoise: number;        // 0.0 to 1.0 (Hot-pixel & chroma blotch suppression)
  vibrance: number;       // 0.0 to 1.5 (Natural midtone color)
  temperature: number;    // -0.5 to 0.5 (Cool blue <-> Warm red/gold)
  tint: number;           // -0.5 to 0.5 (Green <-> Magenta)
  starControl: number;    // 0.0 to 1.0 (Star halo tightening & white core recovery)
}

export interface BgCornerModel {
  tl: [number, number, number];
  tr: [number, number, number];
  bl: [number, number, number];
  br: [number, number, number];
}

export const DEFAULT_BG_MODEL: BgCornerModel = {
  tl: [0, 0, 0],
  tr: [0, 0, 0],
  bl: [0, 0, 0],
  br: [0, 0, 0],
};

export const ASTRO_PRESETS: AstroPreset[] = [
  {
    id: 'auto_pro',
    name: 'Auto Pro',
    description: 'Auto DBE gradient removal, histogram stretch & natural stars',
    params: {
      stretch: 0.45,
      blackPoint: 0.05,
      bgExtract: 0.75,
      scnrGreen: 0.5,
      waveletFine: 0.4,
      waveletMed: 0.3,
      denoise: 0.65,
      vibrance: 0.42,
      temperature: 0.0,
      tint: 0.0,
      starControl: 0.35,
    },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    description: 'Deep H-alpha/OIII stretch with gradient subtraction & crisp stars',
    params: {
      stretch: 0.65,
      blackPoint: 0.07,
      bgExtract: 0.85,
      scnrGreen: 0.65,
      waveletFine: 0.35,
      waveletMed: 0.4,
      denoise: 0.7,
      vibrance: 0.6,
      temperature: 0.04,
      tint: 0.03,
      starControl: 0.45,
    },
  },
  {
    id: 'galaxy',
    name: 'Galaxies',
    description: 'Flattens sky glow, removes green cast & reveals dust lanes',
    params: {
      stretch: 0.52,
      blackPoint: 0.07,
      bgExtract: 0.85,
      scnrGreen: 0.75,
      waveletFine: 0.45,
      waveletMed: 0.45,
      denoise: 0.7,
      vibrance: 0.38,
      temperature: 0.02,
      tint: 0.0,
      starControl: 0.4,
    },
  },
  {
    id: 'moon',
    name: 'Moon',
    description: 'Multi-scale wavelet sharpening for craters & ejecta rays',
    params: {
      stretch: 0.15,
      blackPoint: 0.04,
      bgExtract: 0.0,
      scnrGreen: 0.4,
      waveletFine: 1.15,
      waveletMed: 0.75,
      denoise: 0.35,
      vibrance: 0.12,
      temperature: 0.0,
      tint: 0.0,
      starControl: 0.0,
    },
  },
  {
    id: 'sun',
    name: 'Sun',
    description: 'Enhances solar granulation, active regions & prominences',
    params: {
      stretch: 0.22,
      blackPoint: 0.05,
      bgExtract: 0.0,
      scnrGreen: 0.2,
      waveletFine: 1.0,
      waveletMed: 0.65,
      denoise: 0.4,
      vibrance: 0.45,
      temperature: 0.08,
      tint: 0.02,
      starControl: 0.0,
    },
  },
  {
    id: 'planets',
    name: 'Planets',
    description: 'Crisp cloud bands, storms & ring divisions without limb ringing',
    params: {
      stretch: 0.22,
      blackPoint: 0.05,
      bgExtract: 0.0,
      scnrGreen: 0.45,
      waveletFine: 1.25,
      waveletMed: 0.8,
      denoise: 0.5,
      vibrance: 0.4,
      temperature: 0.0,
      tint: 0.0,
      starControl: 0.0,
    },
  },
  {
    id: 'original',
    name: 'Original',
    description: 'Unprocessed raw input frame',
    params: {
      stretch: 0.0,
      blackPoint: 0.0,
      bgExtract: 0.0,
      scnrGreen: 0.0,
      waveletFine: 0.0,
      waveletMed: 0.0,
      denoise: 0.0,
      vibrance: 0.0,
      temperature: 0.0,
      tint: 0.0,
      starControl: 0.0,
    },
  },
];

// GPU Runtime Shader (SkSL) - Star-Preserving Cosmetic Correction + Astro Pipeline
export const ASTRO_SKSL_SHADER = `
uniform shader image;
uniform float2 resolution;
uniform float stretch;
uniform float blackPoint;
uniform float bgExtract;
uniform float scnrGreen;
uniform float waveletFine;
uniform float waveletMed;
uniform float denoise;
uniform float vibrance;
uniform float temperature;
uniform float tint;
uniform float starControl;
uniform float3 bgTL;
uniform float3 bgTR;
uniform float3 bgBL;
uniform float3 bgBR;
uniform float showClipping;

float getLuma(float3 c) {
  return dot(c, float3(0.2126, 0.7152, 0.0722));
}

float asinhCurve(float x, float amount) {
  if (amount <= 0.001) return x;
  float b = amount * 10.0;
  return log(b * x + sqrt(b * b * x * x + 1.0)) / log(b + sqrt(b * b + 1.0));
}

half4 main(float2 xy) {
  half4 center = image.eval(xy);
  float3 rgb = float3(center.rgb);

  // Sample 3x3 fine scale + 5x5 medium scale
  float3 n  = float3(image.eval(xy + float2( 0.0, -1.0)).rgb);
  float3 s  = float3(image.eval(xy + float2( 0.0,  1.0)).rgb);
  float3 e  = float3(image.eval(xy + float2( 1.0,  0.0)).rgb);
  float3 w  = float3(image.eval(xy + float2(-1.0,  0.0)).rgb);
  float3 nw = float3(image.eval(xy + float2(-1.0, -1.0)).rgb);
  float3 ne = float3(image.eval(xy + float2( 1.0, -1.0)).rgb);
  float3 sw = float3(image.eval(xy + float2(-1.0,  1.0)).rgb);
  float3 se = float3(image.eval(xy + float2( 1.0,  1.0)).rgb);

  float3 n2 = float3(image.eval(xy + float2( 0.0, -2.5)).rgb);
  float3 s2 = float3(image.eval(xy + float2( 0.0,  2.5)).rgb);
  float3 e2 = float3(image.eval(xy + float2( 2.5,  0.0)).rgb);
  float3 w2 = float3(image.eval(xy + float2(-2.5,  0.0)).rgb);
  float3 nw2 = float3(image.eval(xy + float2(-2.0, -2.0)).rgb);
  float3 ne2 = float3(image.eval(xy + float2( 2.0, -2.0)).rgb);
  float3 sw2 = float3(image.eval(xy + float2(-2.0,  2.0)).rgb);
  float3 se2 = float3(image.eval(xy + float2( 2.0,  2.0)).rgb);

  float3 scale1 = (n + s + e + w) * 0.15 + (nw + ne + sw + se) * 0.10;
  float3 ring2 = (n2 + s2 + e2 + w2) * 0.15 + (nw2 + ne2 + sw2 + se2) * 0.10;
  float3 scale2 = scale1 * 0.5 + ring2 * 0.5;

  float3 maxNeighbor = max(max(max(n, s), max(e, w)), max(max(nw, ne), max(sw, se)));
  float3 minNeighbor = min(min(min(n, s), min(e, w)), min(min(nw, ne), min(sw, se)));

  // 1. Chroma-Only Hot Pixel Rejection (Preserves all real broadband stars!)
  // Real stars brighten R, G, and B together; hot pixels spike in a single isolated color channel.
  if (denoise > 0.001) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float midC = rgb.r + rgb.g + rgb.b - maxC - minC;
    // High single-channel purity (maxC >> midC) + isolated above 3x3 neighbors = sensor hot pixel
    float singleChannelPurity = clamp((maxC - midC) / max(maxC, 0.02), 0.0, 1.0);
    float neighborMaxMax = max(maxNeighbor.r, max(maxNeighbor.g, maxNeighbor.b));
    float isolatedSpike = smoothstep(0.04, 0.16, maxC - neighborMaxMax);
    float hotPixelMask = smoothstep(0.55, 0.85, singleChannelPurity) * isolatedSpike;
    rgb = mix(rgb, scale1, hotPixelMask * clamp(denoise * 1.3, 0.0, 1.0));
  }

  // 2. Dynamic Background Extraction (DBE)
  if (bgExtract > 0.001) {
    float2 uv = clamp(xy / max(resolution, float2(1.0)), 0.0, 1.0);
    float3 topGrad = mix(bgTL, bgTR, uv.x);
    float3 botGrad = mix(bgBL, bgBR, uv.x);
    float3 skyModel = mix(topGrad, botGrad, uv.y);
    float3 minCorner = min(min(bgTL, bgTR), min(bgBL, bgBR));
    float3 excessGrad = max(float3(0.0), skyModel - minCorner);
    rgb = max(rgb - excessGrad * bgExtract * 1.15, float3(0.0));
  }

  float luma = getLuma(rgb);
  float scale1Luma = getLuma(scale1);
  float scale2Luma = getLuma(scale2);

  // Star detection (both bright stars and faint pinpoint stars)
  float localPeak = max(0.0, luma - scale1Luma);
  float starMask = clamp(smoothstep(0.025, 0.14, localPeak) + smoothstep(0.68, 0.92, luma), 0.0, 1.0);

  // 3. Wide Chroma Blotch Suppression (Masked off stars so star colors stay intact)
  float3 centerChroma = rgb - float3(luma);
  float3 wideChroma = scale2 - float3(scale2Luma);
  float chromaDiff = length(centerChroma - wideChroma);
  float chromaSuppress = clamp(denoise * 0.85 + smoothstep(0.03, 0.13, chromaDiff) * 0.6, 0.0, 0.94);
  chromaSuppress *= (1.0 - smoothstep(0.45, 0.78, luma)) * (1.0 - starMask * 0.85);
  rgb = max(float3(luma) + mix(centerChroma, wideChroma, chromaSuppress), float3(0.0));

  // 4. Gentle Outer Halo Tightening (Only affects outer skirts of large bright stars, never erases faint stars)
  if (starControl > 0.001) {
    float minLuma = getLuma(minNeighbor);
    // Only engage on large bright star halos where scale1Luma is already elevated (> 0.18)
    float outerHaloZone = smoothstep(0.18, 0.42, scale1Luma) * smoothstep(0.03, 0.15, localPeak) * (1.0 - smoothstep(0.22, 0.48, localPeak));
    float targetStarLuma = mix(luma, min(luma, mix(scale1Luma, minLuma, 0.35)), starControl * outerHaloZone * 0.55);
    if (luma > 0.0001) {
      rgb *= (targetStarLuma / luma);
      luma = targetStarLuma;
    }
  }

  // 5. Luminance Background Smoothing (Strictly masked off stars so faint stars are never blurred away)
  if (denoise > 0.001) {
    float edgeDiff = abs(luma - scale1Luma);
    float flatMask = (1.0 - smoothstep(0.01, 0.08, edgeDiff)) * (1.0 - starMask);
    float smoothLuma = mix(luma, scale1Luma, denoise * flatMask * 0.8);
    if (luma > 0.0001) {
      rgb *= (smoothLuma / luma);
      luma = smoothLuma;
    }
  }

  // 6. Multi-Scale Wavelet Sharpening
  if (waveletFine > 0.001 || waveletMed > 0.001) {
    float wLayer1 = luma - scale1Luma;
    float wLayer2 = scale1Luma - scale2Luma;
    float limbGuard = 1.0 - smoothstep(0.22, 0.55, abs(wLayer2));
    float detailMask = (1.0 - starMask) * smoothstep(0.03, 0.15, luma) * limbGuard;
    float sharpLuma = max(0.0, luma + (wLayer1 * waveletFine * 1.45 + wLayer2 * waveletMed * 1.25) * detailMask);
    if (luma > 0.0001) {
      rgb *= (sharpLuma / luma);
    }
  }

  // 7. Black Point Floor (Gentle toe curve so faint stars near sky floor are preserved)
  if (blackPoint > 0.001) {
    float neutralFloor = blackPoint * 0.75;
    rgb = max(rgb - float3(neutralFloor), float3(0.0)) / max(1.0 - neutralFloor, 0.05);
  }

  // 8. Pure Luminance-Preserving Asinh Stretch (Boosts faint stars and nebulosity equally)
  if (stretch > 0.001) {
    float curLuma = getLuma(rgb);
    if (curLuma > 0.0001) {
      float targetLuma = asinhCurve(curLuma, stretch);
      targetLuma = mix(targetLuma, curLuma, smoothstep(0.65, 0.98, curLuma) * 0.6);
      rgb *= (targetLuma / curLuma);
    }
  }

  // 9. White Balance (Temperature & Tint)
  if (abs(temperature) > 0.001 || abs(tint) > 0.001) {
    rgb.r *= (1.0 + temperature * 0.35 + tint * 0.15);
    rgb.g *= (1.0 - tint * 0.25);
    rgb.b *= (1.0 - temperature * 0.35 + tint * 0.15);
    rgb = max(rgb, float3(0.0));
  }

  // 10. SCNR (Subtractive Chromatic Noise Reduction - Green Cast Removal)
  if (scnrGreen > 0.001) {
    float avgRB = (rgb.r + rgb.b) * 0.5;
    float cappedG = min(rgb.g, avgRB);
    rgb.g = mix(rgb.g, cappedG, scnrGreen);
  }

  // 11. Shadow Chroma Neutralization + Midtone-Only Vibrance
  float postLuma = getLuma(rgb);
  float shadowNeutralize = (1.0 - smoothstep(0.025, 0.12, postLuma)) * (1.0 - starMask);
  rgb = mix(rgb, float3(postLuma), shadowNeutralize * 0.9);

  if (vibrance > 0.001) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float sat = maxC - minC;
    float midtoneMask = smoothstep(0.09, 0.26, postLuma) * (1.0 - smoothstep(0.48, 0.76, postLuma)) * (1.0 - starMask);
    float gain = vibrance * (1.0 - sat) * midtoneMask * 1.0;
    rgb = mix(float3(postLuma), rgb, 1.0 + gain);
  }

  // 12. Natural White Star Core Recovery
  float finalLuma = getLuma(rgb);
  float coreWhiteMask = smoothstep(0.62, 0.90, finalLuma) * mix(0.45, 1.0, starControl);
  rgb = mix(rgb, float3(finalLuma), clamp(coreWhiteMask, 0.0, 0.95));

  rgb = clamp(rgb, 0.0, 1.0);

  // 13. Optional Highlight/Shadow Clipping Indicator Overlay
  if (showClipping > 0.5) {
    if (rgb.r >= 0.992 || rgb.g >= 0.992 || rgb.b >= 0.992) {
      return half4(1.0, 0.15, 0.15, center.a);
    }
    if (rgb.r <= 0.003 && rgb.g <= 0.003 && rgb.b <= 0.003) {
      return half4(0.15, 0.45, 1.0, center.a);
    }
  }

  return half4(rgb, center.a);
}
`;
