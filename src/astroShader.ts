export interface AstroPreset {
  id: string;
  name: string;
  description: string;
  isCustom?: boolean;
  params: AstroParams;
}

export interface CurvePoints {
  rgb: [number, number, number, number, number]; // Output values at x = 0, 0.25, 0.5, 0.75, 1.0
  r: [number, number, number, number, number];
  g: [number, number, number, number, number];
  b: [number, number, number, number, number];
}

export const DEFAULT_CURVES: CurvePoints = {
  rgb: [0.0, 0.25, 0.5, 0.75, 1.0],
  r: [0.0, 0.25, 0.5, 0.75, 1.0],
  g: [0.0, 0.25, 0.5, 0.75, 1.0],
  b: [0.0, 0.25, 0.5, 0.75, 1.0],
};

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
  curves: CurvePoints;    // 5-point tone curves for RGB, R, G, B
}

export const ASTRO_PRESETS: AstroPreset[] = [
  {
    id: 'auto_pro',
    name: 'Auto Pro',
    description: 'Deep adaptive stretch, gradient removal, S-curve contrast & natural stars',
    params: {
      stretch: 0.68,
      blackPoint: 0.07,
      bgExtract: 0.85,
      scnrGreen: 0.65,
      waveletFine: 0.48,
      waveletMed: 0.45,
      denoise: 0.68,
      vibrance: 0.58,
      temperature: 0.02,
      tint: 0.0,
      starControl: 0.42,
      curves: {
        rgb: [0.0, 0.21, 0.54, 0.81, 1.0],
        r: [0.0, 0.25, 0.5, 0.75, 1.0],
        g: [0.0, 0.25, 0.5, 0.75, 1.0],
        b: [0.0, 0.25, 0.5, 0.75, 1.0],
      },
    },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    description: 'Rich H-alpha & OIII gas clouds with flattened sky & crisp stars',
    params: {
      stretch: 0.75,
      blackPoint: 0.08,
      bgExtract: 0.9,
      scnrGreen: 0.7,
      waveletFine: 0.4,
      waveletMed: 0.5,
      denoise: 0.72,
      vibrance: 0.68,
      temperature: 0.05,
      tint: 0.03,
      starControl: 0.48,
      curves: {
        rgb: [0.0, 0.2, 0.55, 0.82, 1.0],
        r: [0.0, 0.26, 0.53, 0.77, 1.0],
        g: [0.0, 0.25, 0.5, 0.75, 1.0],
        b: [0.0, 0.25, 0.51, 0.76, 1.0],
      },
    },
  },
  {
    id: 'galaxy',
    name: 'Galaxies',
    description: 'Reveals faint spiral arms & dust lanes while protecting bright cores',
    params: {
      stretch: 0.62,
      blackPoint: 0.08,
      bgExtract: 0.9,
      scnrGreen: 0.8,
      waveletFine: 0.5,
      waveletMed: 0.55,
      denoise: 0.72,
      vibrance: 0.48,
      temperature: 0.02,
      tint: 0.0,
      starControl: 0.44,
      curves: {
        rgb: [0.0, 0.22, 0.53, 0.78, 0.98],
        r: [0.0, 0.25, 0.51, 0.75, 1.0],
        g: [0.0, 0.25, 0.5, 0.75, 1.0],
        b: [0.0, 0.25, 0.51, 0.76, 1.0],
      },
    },
  },
  {
    id: 'moon',
    name: 'Moon',
    description: 'Multi-scale wavelet sharpening for craters & ejecta rays',
    params: {
      stretch: 0.18,
      blackPoint: 0.04,
      bgExtract: 0.0,
      scnrGreen: 0.45,
      waveletFine: 1.2,
      waveletMed: 0.8,
      denoise: 0.35,
      vibrance: 0.14,
      temperature: 0.0,
      tint: 0.0,
      starControl: 0.0,
      curves: {
        rgb: [0.0, 0.21, 0.52, 0.8, 1.0],
        r: [0.0, 0.25, 0.5, 0.75, 1.0],
        g: [0.0, 0.25, 0.5, 0.75, 1.0],
        b: [0.0, 0.25, 0.5, 0.75, 1.0],
      },
    },
  },
  {
    id: 'sun',
    name: 'Sun',
    description: 'Enhances solar granulation, active regions & prominences',
    params: {
      stretch: 0.25,
      blackPoint: 0.05,
      bgExtract: 0.0,
      scnrGreen: 0.2,
      waveletFine: 1.05,
      waveletMed: 0.7,
      denoise: 0.4,
      vibrance: 0.5,
      temperature: 0.1,
      tint: 0.02,
      starControl: 0.0,
      curves: {
        rgb: [0.0, 0.22, 0.53, 0.81, 1.0],
        r: [0.0, 0.26, 0.53, 0.78, 1.0],
        g: [0.0, 0.25, 0.5, 0.75, 1.0],
        b: [0.0, 0.23, 0.48, 0.74, 1.0],
      },
    },
  },
  {
    id: 'planets',
    name: 'Planets',
    description: 'Crisp cloud bands, storms & ring divisions without limb ringing',
    params: {
      stretch: 0.25,
      blackPoint: 0.05,
      bgExtract: 0.0,
      scnrGreen: 0.45,
      waveletFine: 1.3,
      waveletMed: 0.85,
      denoise: 0.5,
      vibrance: 0.45,
      temperature: 0.0,
      tint: 0.0,
      starControl: 0.0,
      curves: {
        rgb: [0.0, 0.22, 0.53, 0.8, 1.0],
        r: [0.0, 0.25, 0.5, 0.75, 1.0],
        g: [0.0, 0.25, 0.5, 0.75, 1.0],
        b: [0.0, 0.25, 0.5, 0.75, 1.0],
      },
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
      curves: DEFAULT_CURVES,
    },
  },
];

// GPU Runtime Shader (SkSL) - Full Astro Suite + 5-Point Per-Channel Tone Curves
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
uniform float curveRGB0;
uniform float curveRGB1;
uniform float curveRGB2;
uniform float curveRGB3;
uniform float curveRGB4;
uniform float curveR0;
uniform float curveR1;
uniform float curveR2;
uniform float curveR3;
uniform float curveR4;
uniform float curveG0;
uniform float curveG1;
uniform float curveG2;
uniform float curveG3;
uniform float curveG4;
uniform float curveB0;
uniform float curveB1;
uniform float curveB2;
uniform float curveB3;
uniform float curveB4;

float getLuma(float3 c) {
  return dot(c, float3(0.2126, 0.7152, 0.0722));
}

float asinhCurve(float x, float amount) {
  if (amount <= 0.001) return x;
  float b = amount * 12.0;
  return log(b * x + sqrt(b * b * x * x + 1.0)) / log(b + sqrt(b * b + 1.0));
}

// Smooth Hermite interpolation across 5 evenly spaced control points (0.0, 0.25, 0.50, 0.75, 1.0)
float evalSpline5(float x, float p0, float p1, float p2, float p3, float p4) {
  float t = clamp(x, 0.0, 1.0) * 4.0;
  if (t <= 1.0) {
    float s = smoothstep(0.0, 1.0, t);
    return mix(p0, p1, mix(t, s, 0.45));
  } else if (t <= 2.0) {
    float u = t - 1.0;
    float s = smoothstep(0.0, 1.0, u);
    return mix(p1, p2, mix(u, s, 0.45));
  } else if (t <= 3.0) {
    float u = t - 2.0;
    float s = smoothstep(0.0, 1.0, u);
    return mix(p2, p3, mix(u, s, 0.45));
  } else {
    float u = t - 3.0;
    float s = smoothstep(0.0, 1.0, u);
    return mix(p3, p4, mix(u, s, 0.45));
  }
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

  // 1. Chroma-Only Hot Pixel Rejection (Preserves all real broadband stars)
  if (denoise > 0.001) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float midC = rgb.r + rgb.g + rgb.b - maxC - minC;
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

  // Star detection
  float localPeak = max(0.0, luma - scale1Luma);
  float starMask = clamp(smoothstep(0.025, 0.14, localPeak) + smoothstep(0.68, 0.92, luma), 0.0, 1.0);

  // 3. Wide Chroma Blotch Suppression (Masked off stars)
  float3 centerChroma = rgb - float3(luma);
  float3 wideChroma = scale2 - float3(scale2Luma);
  float chromaDiff = length(centerChroma - wideChroma);
  float chromaSuppress = clamp(denoise * 0.85 + smoothstep(0.03, 0.13, chromaDiff) * 0.6, 0.0, 0.94);
  chromaSuppress *= (1.0 - smoothstep(0.45, 0.78, luma)) * (1.0 - starMask * 0.85);
  rgb = max(float3(luma) + mix(centerChroma, wideChroma, chromaSuppress), float3(0.0));

  // 4. Gentle Outer Halo Tightening
  if (starControl > 0.001) {
    float minLuma = getLuma(minNeighbor);
    float outerHaloZone = smoothstep(0.18, 0.42, scale1Luma) * smoothstep(0.03, 0.15, localPeak) * (1.0 - smoothstep(0.22, 0.48, localPeak));
    float targetStarLuma = mix(luma, min(luma, mix(scale1Luma, minLuma, 0.35)), starControl * outerHaloZone * 0.55);
    if (luma > 0.0001) {
      rgb *= (targetStarLuma / luma);
      luma = targetStarLuma;
    }
  }

  // 5. Luminance Background Smoothing
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

  // 7. Black Point Floor
  if (blackPoint > 0.001) {
    float neutralFloor = blackPoint * 0.75;
    rgb = max(rgb - float3(neutralFloor), float3(0.0)) / max(1.0 - neutralFloor, 0.05);
  }

  // 8. Pure Luminance-Preserving Asinh Stretch
  if (stretch > 0.001) {
    float curLuma = getLuma(rgb);
    if (curLuma > 0.0001) {
      float targetLuma = asinhCurve(curLuma, stretch);
      targetLuma = mix(targetLuma, curLuma, smoothstep(0.68, 0.99, curLuma) * 0.55);
      rgb *= (targetLuma / curLuma);
    }
  }

  // 9. Per-Channel & Master RGB Tone Curves
  rgb.r = evalSpline5(rgb.r, curveR0, curveR1, curveR2, curveR3, curveR4);
  rgb.g = evalSpline5(rgb.g, curveG0, curveG1, curveG2, curveG3, curveG4);
  rgb.b = evalSpline5(rgb.b, curveB0, curveB1, curveB2, curveB3, curveB4);
  rgb.r = evalSpline5(rgb.r, curveRGB0, curveRGB1, curveRGB2, curveRGB3, curveRGB4);
  rgb.g = evalSpline5(rgb.g, curveRGB0, curveRGB1, curveRGB2, curveRGB3, curveRGB4);
  rgb.b = evalSpline5(rgb.b, curveRGB0, curveRGB1, curveRGB2, curveRGB3, curveRGB4);

  // 10. White Balance (Temperature & Tint)
  if (abs(temperature) > 0.001 || abs(tint) > 0.001) {
    rgb.r *= (1.0 + temperature * 0.35 + tint * 0.15);
    rgb.g *= (1.0 - tint * 0.25);
    rgb.b *= (1.0 - temperature * 0.35 + tint * 0.15);
    rgb = max(rgb, float3(0.0));
  }

  // 11. SCNR (Subtractive Chromatic Noise Reduction - Green Cast Removal)
  if (scnrGreen > 0.001) {
    float avgRB = (rgb.r + rgb.b) * 0.5;
    float cappedG = min(rgb.g, avgRB);
    rgb.g = mix(rgb.g, cappedG, scnrGreen);
  }

  // 12. Shadow Chroma Neutralization + Midtone-Only Vibrance
  float postLuma = getLuma(rgb);
  float shadowNeutralize = (1.0 - smoothstep(0.025, 0.12, postLuma)) * (1.0 - starMask);
  rgb = mix(rgb, float3(postLuma), shadowNeutralize * 0.9);

  if (vibrance > 0.001) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float sat = maxC - minC;
    float midtoneMask = smoothstep(0.08, 0.25, postLuma) * (1.0 - smoothstep(0.50, 0.78, postLuma)) * (1.0 - starMask);
    float gain = vibrance * (1.0 - sat) * midtoneMask * 1.1;
    rgb = mix(float3(postLuma), rgb, 1.0 + gain);
  }

  // 13. Natural White Star Core Recovery
  float finalLuma = getLuma(rgb);
  float coreWhiteMask = smoothstep(0.62, 0.90, finalLuma) * mix(0.45, 1.0, starControl);
  rgb = mix(rgb, float3(finalLuma), clamp(coreWhiteMask, 0.0, 0.95));

  rgb = clamp(rgb, 0.0, 1.0);

  // 14. Optional Highlight/Shadow Clipping Indicator Overlay
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
